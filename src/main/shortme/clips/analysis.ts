import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import type { ShortmeClip } from '@shared/shortme'
import { withLlm } from '../../engines'
import { assets } from '../../engines'
import { markStage, projectFile, type ProjectMeta } from '../project'
import { writeFileAtomic } from '../atomic'
import { loadTranscript } from '../transcription'
import { signalsFromWav, type Signals } from './signals'
import { detectShots } from './scenes'
import { selectClips } from './select'
import { makeThumbs } from './thumbs'
import { layoutForClip } from '../layout/run'
import { applyPersons, buildPersons } from './persons'
import { loadHeat } from './heat'
import { loadChatSignal } from '../../twitch/chat'
import { loadProfile, channelLayout } from '../profiles'
import { applySecondPass, secondPassKind } from './secondPass'
import { findFacecam, camHasFace } from '../layout/facecam'
import { mergeStreamScenes, scenesOf } from '../layout/streamShots'
import { defaultStream, type StreamLayout } from '../../../shared/streamLayout'
import type { ContentType, FrameChoice } from '../../../shared/videoKind'
import type { PlanOptions } from '../../../shared/layoutPlan'
import { overlapsSilence } from '../../twitch/silence'
import { detectAudioEvents, loadEvents, saveEvents, yamnetAvailable, type AudioEvent } from './audioEvents'
import { loadTopics, saveTopics, type TopicMap } from './topics'
import type { PlanInput } from '../../../shared/layoutPlan'

export interface AnalysisOptions {
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

export interface ClipsFile { version: 1; hash: string; query: string; createdAt: string; mode: 'llm' | 'texttiling'; clips: ShortmeClip[] }

export async function loadClips(hash: string): Promise<ClipsFile | null> {
  try { return JSON.parse(await readFile(projectFile(hash, 'clips.json'), 'utf8')) as ClipsFile } catch { return null }
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
  return cached(meta.hash, 'shots.json', () => detectShots(meta.sourcePath, meta.durationSec, signal, onProgress))
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
  report('shots', 0, 'Kamerawechsel erkennen …')
  const cuts = await ensureShots(meta, opts.signal, (f) => report('shots', f, 'Kamerawechsel erkennen …'))
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
  const input = { words: t.words, durationSec: meta.durationSec, signals, cuts, heat, events, chat: chat?.heat ?? null, weights: profile.ranking }
  const sel = { query: [profile.prompt, opts.query].filter(Boolean).join(' ') || undefined, wanted: opts.wanted, signal: opts.signal, report, topicsCache: { load: (n: number) => loadTopics(meta.hash, n), save: (m: TopicMap) => saveTopics(meta.hash, m) } }

  let mode: ClipsFile['mode'] = 'llm'
  let clips: ShortmeClip[]
  const llmReady = !opts.noLlm && (await assets.isInstalled('llama-server'))
  if (!llmReady) { mode = 'texttiling'; clips = await selectClips(input, { ...sel, baseUrl: null }) }
  else {
    try { clips = await withLlm((url) => selectClips(input, { ...sel, baseUrl: url })) } catch (e) {
      if (opts.signal?.aborted) throw e
      report('llm', 0, `KI nicht verfügbar (${e instanceof Error ? e.message.slice(0, 80) : e}) – Fallback`)
      mode = 'texttiling'
      clips = await selectClips(input, { ...sel, baseUrl: null })
    }
  }
  // Testlab „Clip-Transkription“: nur wenn dort der zweite Durchgang aktiv gewählt wurde (Standard: Parakeet-Transkript bleibt)
  const spKind = clips.length ? await secondPassKind() : null
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
  const plan: Partial<PlanOptions> = { allowSplit: profile.tracking.split && frame !== 'fixed', follow: frame === 'fixed' ? 'fixed' : profile.tracking.follow }
  // Facecam + Gameplay: Layout des Kanals (gespeichert) oder Facecam im Video finden; ohne Facecam bleibt es beim Gameplay-Ausschnitt
  let streamBase: StreamLayout | null = null
  if (frame === 'stream') {
    report('layout', 0, 'Facecam suchen …')
    const dims = { width: meta.width, height: meta.height }
    streamBase = await channelLayout(meta.twitch?.channel)
    if (!streamBase) { const found = await findFacecam(meta.sourcePath, 0, meta.durationSec, 14, opts.signal).catch(() => null); if (found) streamBase = defaultStream(dims, found.cam) }
    report('layout', 0, streamBase ? 'Facecam gefunden' : 'Keine Facecam gefunden – Gameplay-Ausschnitt')
  }
  const layouts: Awaited<ReturnType<typeof layoutForClip>>[] = new Array(clips.length)
  let nextClip = 0
  let doneClips = 0
  const layoutWorker = async (): Promise<void> => {
    for (;;) {
      const i = nextClip++
      if (i >= clips.length) return
      const l = await layoutForClip(meta, clips[i], cuts, opts.signal, undefined, plan)
      layouts[i] = l
      await writeFileAtomic(layoutFile(meta.hash, clips[i].id), JSON.stringify(l.input))
      let shots = l.shots
      let penalty = l.penalty
      let stream: StreamLayout | undefined
      if (frame === 'fit') shots = [{ start: 0, end: clips[i].end - clips[i].start, layout: 'fit', cx: 0.5, zoom: 1 }]
      else if (frame === 'stream') {
        penalty = 0 // Gesichtsquote sagt bei Streams nichts: das Gameplay ist der Inhalt
        if (streamBase) {
          const base = streamBase
          const scenes = await Promise.all(scenesOf(clips[i].start, clips[i].end, cuts).map(async (sc) => ({ ...sc, cam: await camHasFace(meta.sourcePath, (sc.start + sc.end) / 2, base.cam, opts.signal).catch(() => false) })))
          shots = mergeStreamScenes(clips[i].start, clips[i].end, l.shots, scenes, base)
          stream = base
        } else shots = [{ start: 0, end: clips[i].end - clips[i].start, layout: 'fixed', cx: 0.5, zoom: 1 }]
      }
      clips[i] = { ...clips[i], shots, faceRatio: l.faceRatio, score: Math.max(0, clips[i].score - penalty), ...(stream ? { stream } : {}) }
      report('layout', ++doneClips / clips.length, `Bildausschnitt planen (${doneClips}/${clips.length}) …`)
    }
  }
  report('layout', 0, `Bildausschnitt planen (0/${clips.length}) …`)
  await Promise.all([layoutWorker(), layoutWorker()])
  // Personen über das ganze Video (Wiedererkennung) → persons.json; Plan-Eingaben tragen die Personen
  if (layouts.some((l) => l.identities.length)) {
    const pf = await buildPersons(meta, clips, layouts).catch((e) => { console.error('Personen-Zuordnung fehlgeschlagen:', e); return null })
    if (pf) for (let i = 0; i < clips.length; i++) await writeFileAtomic(layoutFile(meta.hash, clips[i].id), JSON.stringify(applyPersons(layouts[i].input, clips[i].id, pf)))
  }
  clips.sort((x, y) => y.score - x.score)
  report('thumbs', 0, 'Vorschaubilder …')
  await makeThumbs(meta, clips, opts.signal)
  const file: ClipsFile = { version: 1, hash: meta.hash, query: opts.query ?? '', createdAt: new Date().toISOString(), mode, clips }
  await writeFileAtomic(projectFile(meta.hash, 'clips.json'), JSON.stringify(file, null, 1))
  await markStage(meta.hash, 'clips', true)
  stageSec[curStage] = (stageSec[curStage] ?? 0) + (Date.now() - curAt) / 1000
  console.info(`[perf] Analyse ${Math.round(meta.durationSec / 60)} min Video: ${Object.entries(stageSec).map(([k, v]) => `${k} ${v.toFixed(0)} s`).join(' · ')}`)
  return file
}
