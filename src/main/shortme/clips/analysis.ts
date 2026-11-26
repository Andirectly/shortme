import { existsSync } from 'node:fs'
import { mkdir, readFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { RunTiming, ShortmeClip } from '@shared/shortme'
import { assets } from '../../engines'
import { markStage, projectFile, type ProjectMeta } from '../project'
import { writeFileAtomic } from '../atomic'
import { loadTranscript } from '../transcription'
import { signalsFromWav, type Signals } from './signals'
import { detectShots, refineCuts } from './scenes'
import { collecting, notifyLearnChange } from '../../learn/store'
import { applyAcceptedRules } from '../../learn/rules'
import { fetchTrend } from '../../learn/trend'
import type { CandTrace } from './select'
import { makeThumbs } from './thumbs'
import { layoutForClip } from '../layout/run'
import { layoutClip, prepareLayout } from './clipLayout'
import { applyPersons, buildPersons } from './persons'
import { loadHeat } from './heat'
import { loadChatSignal } from '../../twitch/chat'
import { loadProfile } from '../profiles'
import { applySecondPass, secondPassKind } from './secondPass'
import type { ContentType, FrameChoice } from '../../../shared/videoKind'
import { overlapsSilence } from '../../twitch/silence'
import { detectAudioEvents, loadEvents, saveEvents, yamnetAvailable, type AudioEvent } from './audioEvents'
import { loadTopics, saveTopics, type TopicMap } from './topics'
import type { PlanInput } from '../../../shared/layoutPlan'
import { displayedRunId, LEGACY_RUN_ID, newRunId, V2_ENGINE_VERSION, V3_ENGINE_VERSION, V4_ENGINE_VERSION, V6_ENGINE_VERSION, hasProfiles, isV3Profile, type RunInfo, type SelectionEngineId, type V3Profile } from '../../../shared/engine'
import { clipsPathFor, loadState, patchRun, registerRun, showRun } from './engines/state'
import { analysisFingerprint } from './engines/control'
import { engineRevisions, runSelection } from './engines'

export interface AnalysisOptions {
  /** Auswahl-Engine dieses Laufs (beim Jobstart festgelegt; Standard: bisherige Engine). */
  engine?: SelectionEngineId
  /** Nur Engine 3. */
  profile?: V3Profile
  query?: string
  /** Inhaltstyp → Profil (Tracking, Ton-Markierungen, Ranking-Gewichte, Prompt-Variante). Standard: Podcast / Interview. */
  contentType?: ContentType
  /** Gewählter Bildausschnitt; ohne Angabe der Standard des Profils. */
  frame?: FrameChoice
  wanted?: number
  signal?: AbortSignal
  /** Erzwingt den Fallback ohne LLM (Tests / kein Modell). */
  noLlm?: boolean
  onProgress?: (stage: string, fraction: number, message: string) => void
  /** Gemessene Dauer des Jobs (inkl. Transkription davor), wird am Ende in die Clipliste geschrieben. */
  timing?: () => RunTiming
}

export const layoutFile = (hash: string, clipId: string): string => projectFile(hash, `layout/${clipId.replace(/[^\w.-]/g, '_')}.json`)

/** Gespeicherte Tracks/Schnitte eines Clips (für „Person anklicken“); fehlt bei älteren Projekten. */
export async function loadLayoutInput(hash: string, clipId: string): Promise<PlanInput | null> {
  try { return JSON.parse(await readFile(layoutFile(hash, clipId), 'utf8')) as PlanInput } catch { return null }
}

const pending = new Map<string, Promise<PlanInput | null>>()

/** Ältere Projekte ohne gespeicherte Tracks: einmalig nachberechnen (≈ 0,5× Echtzeit des Clips) und ablegen. */
export function ensureLayoutInput(meta: ProjectMeta, clip: ShortmeClip): Promise<PlanInput | null> {
  const key = `${meta.hash}/${clip.id}`
  let p = pending.get(key)
  if (!p) {
    p = (async () => {
      const have = await loadLayoutInput(meta.hash, clip.id)
      if (have) return have
      try {
        const cuts = await ensureShots(meta)
        const l = await layoutForClip(meta, clip, cuts)
        await writeFileAtomic(layoutFile(meta.hash, clip.id), JSON.stringify(l.input))
        return l.input
      } catch (e) { console.error('Layout-Nachberechnung fehlgeschlagen:', e); return null }
    })().finally(() => pending.delete(key))
    pending.set(key, p)
  }
  return p
}

export interface ClipsFile {
  version: 1
  hash: string
  query: string
  createdAt: string
  /** `llm`/`texttiling`: bisherige Engine; `v2`: neue Engine (eigene Datenverträge, siehe `engine`/`runId`). */
  mode: 'llm' | 'texttiling' | 'v2' | 'v3' | 'v4' | 'v6'
  engine?: SelectionEngineId
  runId?: string
  clips: ShortmeClip[]
}

/** Clipliste des angezeigten Laufs (oder eines bestimmten). Ohne Angabe: der Lauf, der laut Projektzustand gerade angezeigt wird (bisher: clips.json). */
export async function loadClips(hash: string, runId?: string): Promise<ClipsFile | null> {
  const rid = runId ?? displayedRunId(await loadState(hash))
  if (!rid) return null
  try { return JSON.parse(await readFile(clipsPathFor(hash, rid), 'utf8')) as ClipsFile } catch { return null }
}

/** Clipliste eines Laufs zurückschreiben (Löschen, Personen-Nachplanung): immer in den Lauf, aus dem sie gelesen wurde – nie ins bisherige Ergebnis eines anderen Laufs. */
export async function saveClips(hash: string, file: ClipsFile): Promise<void> {
  const rid = file.runId ?? LEGACY_RUN_ID
  const path = clipsPathFor(hash, rid)
  await mkdir(dirname(path), { recursive: true })
  await writeFileAtomic(path, JSON.stringify(file, null, 1))
}

/** Findet Clips über alle Läufe (angezeigter zuerst): für Export und Editor, die an eine Clip-ID gebunden sind und nach einem Enginewechsel nicht plötzlich andere Clips lesen dürfen. */
export async function findClip(hash: string, clipId: string): Promise<{ clip: ShortmeClip; runId: string } | null> {
  const state = await loadState(hash)
  const ids = [state.shown, LEGACY_RUN_ID, ...state.runs.map((r) => r.runId)].filter((x, i, a): x is string => !!x && a.indexOf(x) === i)
  for (const rid of ids) {
    const f = await loadClips(hash, rid)
    const clip = f?.clips.find((c) => c.id === clipId)
    if (clip) return { clip, runId: rid }
  }
  return null
}

async function cached<T>(hash: string, name: string, make: () => Promise<T>): Promise<T> {
  const f = projectFile(hash, name)
  if (existsSync(f)) { try { return JSON.parse(await readFile(f, 'utf8')) as T } catch { /* neu berechnen */ } }
  const v = await make()
  await writeFileAtomic(f, JSON.stringify(v))
  return v
}

/** Analyse-Signale (je Video normalisiert, gecacht) und Kamerawechsel (TransNetV2, gecacht). */
export async function ensureSignals(meta: ProjectMeta): Promise<Signals> {
  const t = await loadTranscript(meta.hash)
  if (!t) throw new Error('Transkript fehlt – erst transkribieren')
  return cached(meta.hash, 'signals.json', () => signalsFromWav(projectFile(meta.hash, 'audio.wav'), t.words, meta.durationSec))
}

export async function ensureShots(meta: ProjectMeta, signal?: AbortSignal, onProgress?: (f: number) => void): Promise<number[]> {
  if (!(await assets.isInstalled('transnetv2'))) return []
  // shots.json = grobe Zeiten (25 Bilder/s); shots-exact.json = auf die echten Bilder gelegt (ältere Projekte werden hier einmalig nachgezogen)
  return cached(meta.hash, 'shots-exact.json', async () => refineCuts(meta.sourcePath, await cached(meta.hash, 'shots.json', () => detectShots(meta.sourcePath, meta.durationSec, signal, onProgress)), signal))
}

/** Stufe „Analysieren + Clips finden“: Signale → Kamerawechsel → LLM-Auswahl (oder TextTiling) → clips.json. */
/** Audio-Ereignisse (YAMNet + Pausen) einmal je Projekt berechnen und zwischenspeichern; ohne Modell nur Pausen (wird später mit Modell neu berechnet). */
async function ensureEvents(meta: ProjectMeta, speech: Array<[number, number]>, signal?: AbortSignal): Promise<AudioEvent[] | null> {
  const cached = await loadEvents(meta.hash)
  const hasModelEvents = !!cached?.some((e) => e.kind !== 'pause')
  if (cached && (hasModelEvents || !yamnetAvailable())) return cached
  try {
    const ev = await detectAudioEvents(projectFile(meta.hash, 'audio.wav'), speech, signal)
    await saveEvents(meta.hash, ev)
    return ev
  } catch (e) { if (signal?.aborted) throw e; console.error('Audio-Ereignisse fehlgeschlagen:', e); return null }
}

export async function runAnalysis(meta: ProjectMeta, opts: AnalysisOptions = {}): Promise<ClipsFile> {
  // Zeit je Stufe mitschreiben ([perf]-Zeile am Ende) – Grundlage für Tempo-Optimierung
  const userReport = opts.onProgress ?? (() => undefined)
  const stageSec: Record<string, number> = {}
  let curStage = 'start'
  let curAt = Date.now()
  const report: typeof userReport = (stage, f, m) => { if (stage !== curStage) { const n = Date.now(); stageSec[curStage] = (stageSec[curStage] ?? 0) + (n - curAt) / 1000; curStage = stage; curAt = n } userReport(stage, f, m) }
  const t = await loadTranscript(meta.hash)
  if (!t) throw new Error('Transkript fehlt – erst transkribieren')
  report('signals', 0, 'Signale berechnen …')
  const signals = await ensureSignals(meta)
  // Engine Mac braucht Kamerawechsel erst für Schnittkanten/Render (nach Sprachsuche und Beobachtung): TransNetV2 (CPU, ~5 min bei 26 min Video)
  // läuft parallel zu den GPU-Schritten statt davor
  const lateShots = opts.engine === 'engine-mac' || opts.engine === 'engine6'
  if (!lateShots) report('shots', 0, 'Kamerawechsel erkennen …')
  const shotsP = ensureShots(meta, opts.signal, lateShots ? undefined : (f) => report('shots', f, 'Kamerawechsel erkennen …'))
  shotsP.catch(() => undefined) // Fehler kommt beim Abwarten an
  let cuts = lateShots ? [] : await shotsP
  const heat = await loadHeat(meta.hash)
  report('signals', 0.5, 'Audio-Ereignisse erkennen (Lachen, Applaus, Pausen) …')
  const profile = await loadProfile(opts.contentType)
  const frame: FrameChoice = opts.frame ?? profile.frame
  const events00 = await ensureEvents(meta, t.speech, opts.signal)
  // Profil: nur die vorgesehenen Ton-Markierungen (fehlt YAMNet, gibt es ohnehin nur Pausen)
  const events0 = events00 ? events00.filter((e) => profile.marks.includes(e.kind)) : events00
  const chat = meta.twitch?.chat ? await loadChatSignal(meta.hash) : null
  const events = chat?.laughs.length ? [...(events0 ?? []), ...chat.laughs].sort((a, b) => a.start - b.start) : events0
  if (chat) report('signals', 1, `Chat-Signal gefunden (${chat.messages} Nachrichten) – fließt ins Ranking ein`)
  if (heat) report('signals', 1, 'Most-replayed-Kurve gefunden – fließt ins Ranking ein')
  const input = { words: t.words, durationSec: meta.durationSec, signals, cuts, heat, events, chat: chat?.heat ?? null, chatSpikes: chat?.spikes ?? null, weights: profile.ranking, ...(lateShots ? { cutsLater: shotsP } : {}) }
  const sel = { query: [profile.prompt, opts.query].filter(Boolean).join(' ') || undefined, wanted: opts.wanted, signal: opts.signal, report, topicsCache: { load: (n: number) => loadTopics(meta.hash, n), save: (m: TopicMap) => saveTopics(meta.hash, m) } }

  // Engine und Lauf stehen ab hier fest. Legacy schreibt wie bisher nach clips.json, die neue Engine in ihren eigenen Lauf-Ordner.
  const engine: SelectionEngineId = opts.engine ?? 'legacy'
  const v3Profile: V3Profile = isV3Profile(opts.profile) ? opts.profile : 'balanced'
  const runId = engine === 'legacy' ? LEGACY_RUN_ID : newRunId(Math.random, Date.now, engine === 'engine6' ? 'v6' : engine === 'engine-mac' ? 'vm' : engine === 'engine4' ? 'v4' : engine === 'adaptive-v3' ? 'v3' : 'v2')
  const clipsPath = clipsPathFor(meta.hash, runId)
  if (engine !== 'legacy') {
    const run: RunInfo = {
      runId, engineId: engine, engineVersion: engine === 'engine6' ? V6_ENGINE_VERSION : engine === 'engine4' || engine === 'engine-mac' ? V4_ENGINE_VERSION : engine === 'adaptive-v3' ? V3_ENGINE_VERSION : V2_ENGINE_VERSION, schema: 1, createdAt: new Date().toISOString(), status: 'running',
      fingerprint: analysisFingerprint({ hash: meta.hash, engine, transcriptVersion: t.version, wordCount: t.words.length, asrModel: t.model, query: opts.query, contentType: opts.contentType ?? null, frame, wanted: opts.wanted ?? null, revisions: engineRevisions(engine, v3Profile) }),
      options: { query: opts.query ?? '', contentType: opts.contentType ?? null, frame, wanted: opts.wanted ?? null, minSec: 15, maxSec: 75, ...(hasProfiles(engine) ? { profile: v3Profile } : {}) }, models: {}, modalities: {}
    }
    await registerRun(meta.hash, run)
  }
  let mode: ClipsFile['mode']
  let clips: ShortmeClip[]
  let trace: CandTrace[]
  let runPatch: Awaited<ReturnType<typeof runSelection>>['run']
  try {
    const out = await runSelection({ engine, runId, input, options: sel, noLlm: opts.noLlm, profile: v3Profile, contentType: opts.contentType ?? null, signal: opts.signal, report, project: { hash: meta.hash, sourcePath: meta.sourcePath, durationSec: meta.durationSec, hasAudio: meta.hasAudio }, layout: { frame, tracking: profile.tracking } })
    clips = out.clips; mode = out.mode; trace = out.trace ?? []; runPatch = out.run
    if (lateShots) cuts = await shotsP
  } catch (e) {
    if (engine !== 'legacy') await patchRun(meta.hash, runId, { status: opts.signal?.aborted ? 'stopped' : 'failed', error: e instanceof Error ? e.message : String(e), finishedAt: new Date().toISOString() })
    throw e
  }
  // Nur Legacy: bestätigte Lern-Regeln (Lernen → Regeln) auf die neuen Grenzen anwenden; ohne bestätigte Regel bleibt alles unverändert
  if (engine === 'legacy') clips = await applyAcceptedRules(clips, t.words, meta.durationSec)
  // Testlab „Clip-Transkription“: nur wenn dort der zweite Durchgang aktiv gewählt wurde (Standard: Parakeet-Transkript bleibt).
  // Der zweite Durchgang schreibt das gemeinsame Transkript um – deshalb nie in einem Lauf der neuen Engine.
  const spKind = clips.length && engine === 'legacy' ? await secondPassKind() : null
  if (spKind) {
    report('layout', 0, 'Clips noch einmal transkribieren …')
    try {
      const r = await applySecondPass(spKind, meta.hash, t, clips, opts.signal)
      clips = r.clips
      report('layout', 0, `Zweiter Durchgang: ${r.substituted} Wörter anders geschrieben, ${r.inserted} ergänzt`)
    } catch (e) { if (opts.signal?.aborted) throw e; console.error('Zweiter Durchgang fehlgeschlagen (Transkript bleibt):', e) }
  }
  // Twitch: von Twitch stumm geschaltete Abschnitte (geschützte Musik) nie als Clip vorschlagen
  const silent = meta.twitch?.silent ?? []
  if (silent.length) clips = clips.filter((c) => !overlapsSilence(silent, c.start, c.end))
  // Tracking & Layouts (M5): Gesichtsquote fließt ins Ranking ein
  // Layout-Analyse (Gesichter, Spuren, Sprecher) je Clip – zwei Clips gleichzeitig: Decodieren (FFmpeg) und Inferenz überlappen sich
  // Engine 6 hat den Ausschnitt vor Render und Prüfung festgelegt (Plan eingefroren): keine zweite Planung, keine Gesichtsquoten-Strafe, Reihenfolge = redaktioneller Rang
  const frozen = engine === 'engine6'
  // Facecam + Gameplay: Layout des Kanals (gespeichert) oder Facecam im Video finden; ohne Facecam bleibt es beim Gameplay-Ausschnitt
  const lctx = frozen ? null : await prepareLayout(meta, cuts, frame, profile.tracking, opts.signal, (m) => report('layout', 0, m))
  // Fortschrittliche Übersicht: Clips sofort veröffentlichen (ausgegraut), jeder wird fertig, sobald sein Layout berechnet ist
  await mkdir(dirname(clipsPath), { recursive: true })
  const meta0 = { engine, runId }
  let writing: Promise<unknown> = Promise.resolve()
  const publish = (): Promise<unknown> => (writing = writing.then(() => writeFileAtomic(clipsPath, JSON.stringify({ version: 1, hash: meta.hash, query: opts.query ?? '', createdAt: new Date().toISOString(), mode, ...meta0, clips: frozen ? [...clips] : [...clips].sort((x, y) => y.score - x.score) } satisfies ClipsFile, null, 1))))
  clips = clips.map((c) => ({ ...c, pending: true }))
  await publish()
  // Ab hier gibt es Clips dieses Laufs: sie erscheinen fortlaufend in der Übersicht (bis dahin blieb die bisherige Anzeige stehen)
  await showRun(meta.hash, runId)
  const layouts: Awaited<ReturnType<typeof layoutForClip>>[] = new Array(clips.length)
  let nextClip = 0
  let doneClips = 0
  const layoutWorker = async (): Promise<void> => {
    for (;;) {
      const i = nextClip++
      if (i >= clips.length) return
      if (!frozen) {
        const r = await layoutClip(lctx!, clips[i])
        layouts[i] = r.layout
        await writeFileAtomic(layoutFile(meta.hash, clips[i].id), JSON.stringify(r.layout.input))
        clips[i] = { ...r.clip, score: Math.max(0, clips[i].score - r.penalty) }
      }
      await makeThumbs(meta, [clips[i]], opts.signal)
      clips[i] = { ...clips[i], pending: undefined }
      await publish()
      report('layout', ++doneClips / clips.length, `Bildausschnitt planen (${doneClips}/${clips.length}) …`)
    }
  }
  report('layout', 0, `Bildausschnitt planen (0/${clips.length}) …`)
  try { await Promise.all([layoutWorker(), layoutWorker()]) } catch (e) {
    // Abbruch/Fehler: unfertige Clips verwerfen, fertige bleiben (Stoppen & behalten)
    clips = clips.filter((c) => !c.pending)
    await publish()
    if (engine !== 'legacy') await patchRun(meta.hash, runId, { status: opts.signal?.aborted ? 'incomplete' : 'failed', error: e instanceof Error ? e.message : String(e), finishedAt: new Date().toISOString(), clipCount: clips.length })
    throw e
  }
  // Personen über das ganze Video (Wiedererkennung) → persons.json; Plan-Eingaben tragen die Personen
  if (layouts.some((l) => l?.identities.length)) {
    const pf = await buildPersons(meta, clips, layouts).catch((e) => { console.error('Personen-Zuordnung fehlgeschlagen:', e); return null })
    if (pf) for (let i = 0; i < clips.length; i++) await writeFileAtomic(layoutFile(meta.hash, clips[i].id), JSON.stringify(applyPersons(layouts[i].input, clips[i].id, pf)))
  }
  if (!frozen) clips.sort((x, y) => y.score - x.score)
  const file: ClipsFile = { version: 1, hash: meta.hash, query: opts.query ?? '', createdAt: new Date().toISOString(), mode, ...meta0, clips, ...(opts.timing ? { timing: opts.timing() } : {}) }
  await writeFileAtomic(clipsPath, JSON.stringify(file, null, 1))
  if (engine === 'legacy') {
    if (trace.length && (await collecting())) await writeFileAtomic(projectFile(meta.hash, 'candidates.json'), JSON.stringify(trace))
    // „clips“ gilt nur für das bisherige Ergebnis; für die neue Engine zählt der Zustand ihres Laufs
    await markStage(meta.hash, 'clips', true)
  } else {
    const incomplete = runPatch?.status === 'incomplete'
    await patchRun(meta.hash, runId, { ...runPatch, status: incomplete ? 'incomplete' : 'done', finishedAt: new Date().toISOString(), clipCount: clips.length })
  }
  notifyLearnChange()
  void fetchTrend(meta.hash).catch(() => undefined)
  stageSec[curStage] = (stageSec[curStage] ?? 0) + (Date.now() - curAt) / 1000
  console.info(`[perf] Analyse ${Math.round(meta.durationSec / 60)} min Video: ${Object.entries(stageSec).map(([k, v]) => `${k} ${v.toFixed(0)} s`).join(' · ')}`)
  return file
}
