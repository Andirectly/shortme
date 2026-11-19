// Engine Mac 2 (Pipeline „mac-2.0“) – Standard-Engine für Mac-Analysen. Ablauf in Modellphasen (nie zwei große Modelle gleichzeitig):
//   A Vorbereitung: ffprobe/SHA, Keyframe-Bildwechsel, Apple SoundAnalysis (ganze Tonspur)
//   B Qwen3.5: Sprachsuche über alle Satzfenster (180 s / 30 s Überlappung)
//   C Bildsuche Qwen3-VL-Embedding (MPS) mit Anfragen passend zu Videotyp und Transkript
//   → Fusion aller Suchwege, Auswahl über die ganze Quelle (2 × Wunschzahl, höchstens +4 bei Restbudget)
//   D LFM3-Omni: echte Bilder + Ton je Kandidat (Pakete ≤ 30 s), höchstens 1 Zusatzanfrage (Kontext oder Korrektur) je Kandidat
//   E Qwen3.5: Schnittplan aus gemessenen Kanten, Titel, optionaler Cold-Opener-Moment; Rangfolge im direkten Vergleich
//   F Rendern der Gewinner (gleicher Export-Code wie der Nutzer-Export)
//   G LFM3-Omni: Beobachtung der fertigen Datei (ganze Tonlänge in Paketen), H Qwen3.5: Inhaltsprüfung + Messungen → Freigabe
//   I höchstens 1 gezielte Reparatur je Clip (neu rendern, neu prüfen). Gemma 4 nur für ≤ 2 konkrete ungelöste Beobachtungsfragen.
// Alle Aufgaben laufen über das Aufgabenbuch (Zähler, Tempo, Restzeit); Zeitlimits beenden den Modellprozess wirklich.
import { mkdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { app } from 'electron'
import type { ShortmeClip } from '@shared/shortme'
import { defaultWanted } from '@shared/estimate'
import type { Evidence } from '../../../../../shared/engineV2'
import { vram } from '../../../../engines'
import { dataRoot } from '../../../../engines/paths'
import { textWindows } from '../v2/search'
import { loadMeta, projectFile } from '../../../project'
import { loadTranscript } from '../../../transcription'
import { writeFileAtomic } from '../../../atomic'
import { planExport } from '../../../render/exporter'
import { runDir as runDirOf } from '../state'
import { marksBySentence } from '../../audioEvents'
import { splitSentences } from '../../sentences'
import type { SelectionOutcome, SelectionRequest } from '..'
import { frameDiffs, keyframeScan } from '../v2/visualIndex'
import { withEmbedder } from '../v3/embedWorker'
import { withMacAv } from '../v3/avWorker'
import { MAC_AV_MODEL } from '../v3/revisions'
import { decide, decilesCovered, firstRepairable, fuseSeeds, overlapRatio, selectBalanced, type CoverageWindow, type Criterion, type CutCandidate, type CutEdge, type Seed, type SeedGroup, type Span } from '../v4/core'
import { audioLane, crossModalLane, expandQueries, QUERY_BANK, speechLane, visualLane, type LaneResult, type V4Query } from '../v4/lanes'
import { actionEdges, buildEdges } from '../v4/cut'
import { clipFor, measuredCriteria, planRepair, renderVariant, type Rendered } from '../v4/finalize'
import { probeSource, type SourceInfo } from '../v4/media'
import { Tracer } from '../v4/trace'
import { V4_PROFILES } from '../v4/revisions'
import { investigatorPrompt, makeWindow } from '../v4/investigate'
import { cutAv } from '../v4/media'
import { parseModelJson, validateInvestigator } from '../v4/core'
import { analyzeSound, musicWindows, probeMac, soundEvents, soundProposals, SOUND_REVISION, type SoundWindow } from '../mac/sound'
import { MAC_LFM, MAC_QWEN, withLfm, withQwen, type MlxSession } from './mlxServer'
import { coldOpenFromObs, coverageOf, obsText, observePacket, packetsFor, type Packet, type PacketObs } from './observe'
import { judgeRender, planCandidate, planPrompt, rankPlans, type ClipPlan } from './director'
import { candidateLimits, decideExtraInvestigation, mayRequestInspection } from './runtimePolicy'
import { etaText, Ledger } from './ledger'
import { mac2MissingModels } from './models'
import { ensureProxy, needsProxy } from './proxy'
import { MAC2_MODELS, MAC2_PIPELINE_VERSION, mac2Revisions } from './revisions'

/** Laufzeit-Grenzen (05_LAUFZEITREGELN): weiches Zielbudget, Gemma-Rückfragen, Reparaturen. */
/**
 * Entscheidung für Engine Mac: wie v4 `decide`, aber „nicht eigenständig“ allein lehnt nicht ab (Vlog-Ausschnitte setzen fast immer etwas Kontext voraus;
 * gemessen Lauf 5: 5 von 9 Ablehnungen nur wegen hook/standalone). Ablehnung bei fehlender Pointe, fehlendem Kernereignis oder ≥ 3 Kernfehlern.
 */
export function decideMac2(crit: Criterion[]): ReturnType<typeof decide> {
  const core = ['hook', 'standalone', 'payoff', 'natural-end', 'essential-event']
  const st = (id: string): string | undefined => crit.find((c) => c.id === id)?.state
  if (st('payoff') === 'fail' || st('essential-event') === 'fail' || core.filter((id) => st(id) === 'fail').length >= 3) return 'reject'
  return decide(crit.map((c) => (c.id === 'standalone' && c.state === 'fail' ? { ...c, state: 'unknown' as const } : c)))
}

export const MAC2_LIMITS = { softRunBudgetMs: 30 * 60_000, gemmaQuestions: 2, repairRounds: 1, extraRequestsPerCandidate: 1, observePadSec: 12, maxObserveSec: 30 } as const

const sleep0 = (): Promise<void> => new Promise((r) => setImmediate(r))

/** Bildsuch-Anfragen passend zu Videotyp und Inhalt (Suchhypothesen, keine Beobachtungen). */
export function typeQueries(contentType: string | null | undefined, transcriptText: string): V4Query[] {
  const t = (contentType ?? '').toLowerCase()
  const q: Array<[string, string]> = []
  if (/essen|döner|kebab|schmeckt|probier|lecker|food|taste|bite|delicious|burger|pizza/i.test(transcriptText)) q.push(['t-bite', 'someone takes the first bite of food'], ['t-show', 'a person holding food close to the camera'], ['t-taste', 'a person reacting to the taste of food'])
  if (/podcast|talk|interview/.test(t)) q.push(['t-talk', 'two people talking and laughing together'], ['t-explain', 'a person explaining something with strong gestures'])
  else if (/stream|gaming|twitch/.test(t)) q.push(['t-game', 'a dramatic moment in a video game'], ['t-react', 'a streamer reacting loudly to the screen'])
  else q.push(['t-surprise', 'a person reacting with surprise to something'], ['t-present', 'a person showing something to the camera'])
  return q.map(([id, text]) => ({ id, text, polarity: 'pos' as const, origin: 'bank' as const }))
}

/** Gesprochener Text der Ausgabe in 5-s-Blöcken („[0–5 s] …“): halb so viele Token wie eine Zeitangabe je Wort, Zeitbezug bleibt erhalten. */
export function spokenBlocks(words: Array<{ w: string; start: number }>, block = 5): string {
  const out: string[] = []
  for (const w of words) { const k = Math.floor(w.start / block); out[k] = out[k] ? `${out[k]} ${w.w}` : w.w }
  return out.map((txt, k) => (txt ? `[${k * block}–${(k + 1) * block} s] ${txt}` : '')).filter(Boolean).join('\n').slice(0, 4000)
}

interface Candidate { id: string; group: SeedGroup; span: Span; packets: Packet[]; obs: PacketObs[]; extraUsed: number; failed: string[]; gemma?: string }

export async function selectMac2(req: SelectionRequest): Promise<SelectionOutcome> {
  const { project, signal } = req
  const missing = await mac2MissingModels()
  if (missing.length) throw new Error(`Für Engine Mac fehlt: ${missing.map((m) => m.name).join(', ')}. Im Modell-Manager installieren.`)
  const meta = await loadMeta(project.hash)
  const t = await loadTranscript(project.hash)
  if (!meta || !t) throw new Error('Projekt oder Transkript fehlt')
  const runDir = runDirOf(project.hash, req.runId)
  await mkdir(runDir, { recursive: true })
  const ratesFile = join(dataRoot(), 'mac2-throughput.json')
  const L = new Ledger(await readFile(ratesFile, 'utf8').then((x) => JSON.parse(x) as Record<string, number>).catch(() => ({})))
  const errors: Array<{ stage: string; error: string; at: string }> = []
  const fail = (st: string, e: unknown): void => { errors.push({ stage: st, error: e instanceof Error ? e.message.slice(0, 400) : String(e), at: new Date().toISOString() }) }
  const save = (name: string, obj: unknown): Promise<void> => writeFileAtomic(join(runDir, name), JSON.stringify(obj, null, 1))
  const phaseSec: Record<string, number> = {}
  const phase = async <T>(name: string, fn: () => Promise<T>): Promise<T> => { const a = Date.now(); try { return await fn() } finally { phaseSec[name] = Math.round((Date.now() - a) / 100) / 10 } }
  // jede neu geladene Modellsitzung genau einmal buchen (Ladezeit getrennt von Inferenz); Wiederverwendung innerhalb einer Phase kostet nichts
  const booked = new WeakSet<MlxSession>()
  const bookLoad = (s: MlxSession, label: string): void => { if (booked.has(s)) return; booked.add(s); L.book({ kind: 'model-load', label: `${s.modelId} laden (${label})`, reason: 'initial', model: s.modelId, ms: s.loadMs, ok: true, units: 1 }) }
  const say = (stage: string, f: number, label: string): void => req.report(stage, Math.max(0, Math.min(1, f)), `${label} · ${etaText(L.remainingSeconds())}`)

  const dur = project.durationSec
  const minSec = req.options.minSec ?? 15, maxSec = Math.min(75, req.options.maxSec ?? 75)
  const wanted = Math.max(1, req.options.wanted ?? defaultWanted(dur))
  const hasAudio = project.hasAudio
  const wav = projectFile(project.hash, 'audio.wav')
  const P = V4_PROFILES.fast // Bildsuch-Raster (12-s-Fenster, 4 Bilder) wie Engine 4 „Schnell“

  // ------------------------------------------------------------------------------------------------ A Vorbereitung
  say('signals', 0, 'Quelle prüfen (ffprobe, SHA-256) …')
  const src: SourceInfo = await phase('probe', () => probeSource(project.hash, project.sourcePath, signal))
  const tracer = new Tracer(runDir, req.runId, src.sha256)
  const device = await probeMac().catch((e) => ({ error: String(e).slice(0, 200) }))
  const manifest = {
    runId: req.runId, projectId: project.hash, engineId: 'engine-mac' as const, pipeline: 'mac-lfm-qwen', pipelineVersion: MAC2_PIPELINE_VERSION, protocolVersion: 1,
    source: { sha256: src.sha256, durationSec: src.durationSec, codecs: src.streams.map((s) => `${s.type}:${s.codec}`), vfr: src.vfr },
    snapshot: { gitSha: app?.getVersion?.() ?? 'dev', models: MAC2_MODELS, revisions: mac2Revisions(), options: { wanted, minSec, maxSec, query: req.options.query ?? null, contentType: req.contentType ?? null }, limits: MAC2_LIMITS },
    device, status: 'running' as string, createdAt: new Date().toISOString(), finishedAt: undefined as string | undefined, phaseSec, errors, tasks: {} as ReturnType<Ledger['summary']>
  }
  await save('manifest.json', manifest)
  const finish = async (status: string): Promise<void> => { if (status === 'completed' || status === 'partial') await writeFileAtomic(ratesFile, JSON.stringify(L.rates())).catch(() => undefined); manifest.status = status; manifest.finishedAt = new Date().toISOString(); manifest.tasks = L.summary(); await save('manifest.json', manifest); await save('tasks.json', L.tasks) }

  let specStop = false // Reserve-Renders: bei Ende/Fehler nicht mehr starten
  try {
    // AV1/VP9: einmal ein 720p-H.264-Proxy für alle Bildschritte (Original nur fürs Rendern); Zeit zählt zur Laufzeit
    const vcodec = src.streams.find((x) => x.type === 'video')?.codec
    const video = src.video && needsProxy(vcodec) ? await phase('proxy', () => L.run('proxy', `Analyse-Proxy (${vcodec} → H.264)`, { units: dur }, () => ensureProxy(project.hash, project.sourcePath, dur, (f) => say('signals', 0.1 + 0.8 * f, `Analyse-Kopie erstellen (${vcodec?.toUpperCase()} wird auf diesem Mac nur per Software gelesen)`), signal))) : project.sourcePath
    const scanP = src.video ? phase('keyframes', () => keyframeScan(video, signal)).catch((e) => { if (signal?.aborted) throw e; fail('keyframes', e); return null }) : Promise.resolve(null)
    const apple: SoundWindow[] | null = hasAudio ? await phase('apple-sound', () => analyzeSound(wav, signal)).catch((e) => { if (signal?.aborted) throw e; fail('apple-sound', e); return null }) : null
    if (apple) await save('sound_events.json', { revision: SOUND_REVISION, windows: apple.length, events: soundEvents(apple) })
    say('signals', 1, 'Vorbereitung fertig')

    // ------------------------------------------------------------------------------------------------ B Qwen3.5: Sprachsuche
    const sentences = splitSentences(t.words)
    if (req.input.events?.length && sentences.length) for (const [i, m] of marksBySentence(sentences, req.input.events)) sentences[i].ev = m
    // ganze Restarbeit von Anfang an in der Warteschlange (Schätzmengen, später durch die echten Mengen ersetzt) – keine Phase zählt als 0 s
    const speechWins = textWindows(sentences).length, embedWins = Math.ceil(dur / P.embed.hopSec)
    L.plan('model-load', 6); L.set('speech-window', speechWins); L.set('embed-window', embedWins)
    L.set('observe-packet', 2 * wanted * 2); L.set('plan', 2 * wanted); L.set('rank', 1); L.set('render', wanted * 40); L.set('audit-packet', wanted * 2); L.set('audit-judge', wanted)
    const speech: LaneResult = await phase('lane-speech', () => withQwen(async (s) => {
      bookLoad(s, 'Sprachsuche')
      return L.run('speech-window', 'Sprachsuche', { model: MAC_QWEN.id, units: speechWins }, () => speechLane(s.url, sentences, { duration: dur, query: req.options.query, asrModel: t.model ?? 'parakeet', max: 24, tracer, signal, model: s.model, modelLabel: `${MAC_QWEN.repo} (mlx_vlm.server)`, timeoutMs: 120_000, onProgress: (f) => say('candidates', 0.3 * f, `Sprachsuche (Qwen3.5), Fenster ${Math.min(speechWins, Math.floor(f * speechWins) + 1)} von ${speechWins}`) }))
    })).catch((e) => { if (signal?.aborted) throw e; fail('lane-speech', e); return { lane: 'speech' as const, seeds: [], evidence: [], coverage: [], diag: { error: String(e).slice(0, 200) } } })
    if (Number(speech.diag.windows) > 0 && speech.diag.failedWindows === speech.diag.windows) fail('lane-speech', new Error(`alle ${speech.diag.windows} Textfenster fehlgeschlagen`))

    // ------------------------------------------------------------------------------------------------ C Ton-/Bild-Wege, Bildsuche
    const audio = await audioLane(null, req.input.signals, { duration: dur, max: 24, tracer, hasAudio, apple: apple ? { events: soundProposals(soundEvents(apple), dur, 24), windows: apple.length } : undefined })
    const scan = await scanP
    const visual = visualLane(scan, { duration: dur, max: 24 })
    const queries = expandQueries([...QUERY_BANK, ...typeQueries(req.contentType, t.words.slice(0, 3000).map((w) => w.w).join(' '))], req.options.query, speech.seeds)
    const xm = await phase('lane-cross-modal', () => withEmbedder(req.runId, (s) => L.run('embed-window', 'Bildsuche', { units: embedWins }, () => crossModalLane(s, { hash: project.hash, video, duration: dur, profile: P, queries, max: 24, tracer, signal, onProgress: (f, m) => say('candidates', 0.3 + 0.6 * f, m) }))))
      .catch((e) => { if (signal?.aborted) throw e; fail('lane-cross-modal', e); return null })
    const lanes: LaneResult[] = [speech, audio, visual, ...(xm ? [xm] : [])]
    const coverage: CoverageWindow[] = lanes.flatMap((l) => l.coverage)
    const unsure = apple ? musicWindows(apple, dur) : []
    const evidence = new Map<string, Evidence>()
    for (const l of lanes) for (const e of l.evidence) evidence.set(e.id, e)
    for (const e of speech.evidence) if (unsure.some((u) => u.start < e.end && u.end > e.start)) Object.assign(e, { state: 'unknown', uncertainty: 'Gesang/Musik im Ton (Apple SoundAnalysis): Wortlaut unsicher' })
    const seeds: Seed[] = lanes.flatMap((l) => l.seeds)
    const groups = fuseSeeds(seeds)
    const limits = candidateLimits(wanted, groups.length)
    // Auswahl über die ganze Quelle (Lane-Quoten, zeitliche Streuung), nicht die ersten K einer chronologischen Liste
    const ranked = selectBalanced(groups, limits.totalMaximum, 3, dur)
    const deciles = Object.fromEntries((['speech', 'audio', 'visual', 'cross-modal'] as const).map((ln) => [ln, decilesCovered(coverage.filter((w) => w.lane === ln), dur)]))
    await save('candidates.json', { lanes: Object.fromEntries(lanes.map((l) => [l.lane, { seeds: l.seeds.length, diag: l.diag }])), groups: groups.length, limits, selected: ranked.map((g) => ({ id: g.id, lanes: g.lanes, anchor: g.anchor, span: g.span })), deciles, speechUncertain: unsure })
    say('candidates', 1, `${seeds.length} Hinweise aus ${lanes.length} Suchwegen → ${ranked.length} Kandidaten`)

    // ------------------------------------------------------------------------------------------------ D LFM3-Omni: Kandidaten beobachten
    const wordsIn = (sp: Span): string => t.words.filter((w) => w.start >= sp.start && w.end <= sp.end).map((w) => w.w).join(' ').slice(0, 1500)
    const mkCand = (g: SeedGroup, i: number): Candidate => {
      const a = Math.max(0, Math.min(g.span.start, g.anchor - MAC2_LIMITS.observePadSec)), b = Math.min(dur, Math.max(g.span.end, g.anchor + MAC2_LIMITS.observePadSec))
      const span = b - a > MAC2_LIMITS.maxObserveSec ? { start: Math.max(0, g.anchor - MAC2_LIMITS.maxObserveSec / 2), end: Math.min(dur, g.anchor + MAC2_LIMITS.maxObserveSec / 2) } : { start: a, end: b }
      const id = `k${i + 1}`
      return { id, group: g, span, packets: packetsFor(id, span), obs: [], extraUsed: 0, failed: [] }
    }
    // Kandidaten ohne Doppel: überlappt das Beobachtungsfenster zu > 50 % mit einem besser gerankten, wird derselbe Moment nicht erneut angesehen
    // (gemessen: 4 von 20 Kandidaten lagen auf demselben 7:00–8:10-Abschnitt)
    const distinct: SeedGroup[] = []
    for (const g of ranked) { const c = mkCand(g, 0); if (!distinct.some((d) => overlapRatio(mkCand(d, 0).span, c.span) > 0.5)) distinct.push(g) }
    const cands: Candidate[] = distinct.slice(0, limits.initialMaximum).map(mkCand)
    L.set('observe-packet', cands.reduce((n, c) => n + c.packets.length, 0))
    const observeCand = async (s: MlxSession, c: Candidate, idx: number, total: number): Promise<void> => {
      const hint = c.group.seeds.map((x) => x.summary).filter(Boolean).slice(0, 2).join(' / ') || 'auffälliger Moment'
      const run = async (p: Packet, reason: 'initial' | 'context' | 'schema-retry'): Promise<boolean> => {
        say('rate', idx / total, `Kandidat ${idx + 1} von ${total} ansehen und anhören (Paket ${p.id.split('.p')[1]}/${c.packets.length})`)
        try {
          const o = await L.run('observe-packet', `${c.id} ${p.id}`, { candidate: c.id, reason, model: MAC_LFM.id }, () => observePacket(s, { video, audio: hasAudio ? wav : null, packet: p, mode: 'candidate', transcript: wordsIn(p.span), hint, temperature: reason === 'schema-retry' ? 0.3 : 0, signal }))
          c.obs.push(o)
          return true
        } catch (e) {
          if (signal?.aborted) throw e
          c.failed.push(`${p.id}: ${e instanceof Error ? e.message.slice(0, 160) : e}`)
          if (String(e).includes('Zeitlimit')) throw e // Prozess ist beendet → Phase neu starten
          return false
        }
      }
      for (const p of c.packets) {
        if (c.obs.some((o) => o.packet.id === p.id)) continue
        if (!(await run(p, 'initial')) && mayRequestInspection({ initial: c.packets.length, context: 0, schemaRetries: c.extraUsed }, 'schemaRetry', c.packets.length, MAC2_LIMITS.extraRequestsPerCandidate)) { c.extraUsed++; L.plan('observe-packet', 1); await run(p, 'schema-retry') }
      }
      // Kontext: Ausgang fehlt (keine Reaktion/Pointe/Aussage beobachtet) → höchstens ein Zusatzpaket danach (gleiches Zusatzbudget)
      const roles = new Set(c.obs.flatMap((o) => o.events.filter((e) => e.state === 'observed').map((e) => e.role)))
      if (c.obs.length && !['reaction', 'payoff', 'statement'].some((r) => roles.has(r as never)) && c.span.end < dur - 2 && mayRequestInspection({ initial: c.packets.length, context: 0, schemaRetries: c.extraUsed }, 'context', c.packets.length, MAC2_LIMITS.extraRequestsPerCandidate)) {
        c.extraUsed++
        const ext = packetsFor(`${c.id}x`, { start: c.span.end, end: Math.min(dur, c.span.end + 20) })[0]
        L.plan('observe-packet', 1)
        if (await run(ext, 'context')) { c.packets.push(ext); c.span = { start: c.span.start, end: ext.span.end } }
      }
    }
    // Phase mit Neustart nach Zeitlimit (Prozess wurde beendet): restliche Kandidaten in einer neuen Phase
    const lfmPhase = async (list: Candidate[], label: string): Promise<void> => {
      let i = 0, restarts = 0
      while (i < list.length && restarts <= 2) {
        try {
          await withLfm(async (s) => {
            bookLoad(s, label)
            for (; i < list.length; i++) { await observeCand(s, list[i], i, list.length); await sleep0() }
          })
        } catch (e) {
          if (signal?.aborted) throw e
          fail(`observe ${list[i]?.id ?? ''}`, e); i++; restarts++
        }
      }
    }
    await phase('observe', () => lfmPhase(cands, 'Kandidaten'))
    // Zusatzkandidaten nur, wenn Restbudget und gemessene Reserve für Rendern + vollständige Prüfung reichen
    for (const g of distinct.slice(cands.length)) {
      const perPacket = L.secondsPerUnit('observe-packet'), perRender = L.secondsPerUnit('render')
      const d = decideExtraInvestigation({ elapsedMs: L.elapsedMs(), softBudgetMs: MAC2_LIMITS.softRunBudgetMs, nextTaskEstimateMs: perPacket === null ? null : perPacket * 2 * 1000, reservedCompletionMs: perPacket === null || perRender === null ? null : wanted * (perRender * 40 + perPacket * 2 + 30) * 1000, startedCandidates: cands.length, maximumCandidates: limits.totalMaximum })
      await tracer.log('scheduler.jsonl', { extraCandidate: g.id, decision: d })
      if (!d.start) break
      const c = mkCand(g, cands.length)
      cands.push(c); L.plan('observe-packet', c.packets.length)
      await lfmPhase([c], 'Zusatzkandidat')
    }
    // Gemma 4: nur für Kandidaten ohne jede gültige Beobachtung, höchstens 2 konkrete Rückfragen je Lauf
    const unresolved = cands.filter((c) => !c.obs.length).slice(0, MAC2_LIMITS.gemmaQuestions)
    if (unresolved.length) await phase('gemma-fallback', () => withMacAv(req.runId, async (s) => {
      const tmp = join(runDir, 'tmp'); await mkdir(tmp, { recursive: true })
      for (const c of unresolved) {
        const w = makeWindow(`${c.id}.g`, { start: c.span.start, end: Math.min(c.span.end, c.span.start + 30) }, dur)
        const file = join(tmp, `${c.id}-gemma.mp4`)
        try {
          await L.run('gemma', `${c.id} Gemma-Rückfrage`, { candidate: c.id, reason: 'fallback', model: MAC_AV_MODEL.id }, async () => {
            await cutAv(project.sourcePath, w.span.start, w.span.end - w.span.start, file, hasAudio, signal)
            const r = await s.worker.request<{ text: string }>('analyze_av', { path: file, prompt: investigatorPrompt(w, { summary: c.group.seeds[0]?.summary ?? '', lanes: c.group.lanes }, wordsIn(w.span), 'av'), maxNewTokens: 600 }, { runId: s.runId, timeoutMs: 120_000, signal })
            const a = validateInvestigator(parseModelJson(r.text), w.segments.map((x) => x.id))
            c.gemma = a.observations.map((o) => `${o.role} (${o.state}) in ${o.segmentIds.join(',')}: ${o.description}`).join(' | ')
          })
        } catch (e) { if (signal?.aborted) throw e; fail(`gemma ${c.id}`, e) } finally { await rm(file, { force: true }).catch(() => undefined) }
      }
    })).catch((e) => { if (signal?.aborted) throw e; fail('gemma-fallback', e) })
    await save('observations.json', cands.map((c) => ({ id: c.id, lanes: c.group.lanes, span: c.span, packets: c.packets.map((p) => p.id), coverage: coverageOf(c.span, c.obs.map((o) => o.packet)), extraUsed: c.extraUsed, failed: c.failed, gemma: c.gemma ?? null, obs: c.obs })))
    for (const c of cands) for (const o of c.obs) for (const sg of o.segments) evidence.set(sg.id, { id: sg.id, modality: hasAudio ? 'audio' : 'visual', state: 'observed', source: MAC_LFM.id, start: sg.span.start, end: sg.span.end, observation: `Bild: ${sg.visual} | Ton: ${sg.audio}`.slice(0, 600), modelRev: MAC_LFM.revision })

    // ------------------------------------------------------------------------------------------------ E Qwen3.5: Schnittplan + Rangfolge
    const edges: CutEdge[] = buildEdges({ duration: dur, words: t.words, silences: hasAudio ? req.input.signals.silences : [], shots: req.input.cuts, actions: scan ? actionEdges(scan.times, frameDiffs(scan.frames), Math.max(20, Math.round(dur / 15))) : [], audioPhrases: [] })
    await save('cut_edges.json', { count: edges.length, edges })
    // Schnittpläne nur für die aussichtsreichsten (Wunschzahl + 4): zuerst belegte Kernereignisse (Reaktion, Pointe, Aussage, Handlung), dann Suchrang
    // (gemessen: 35 s je Plan; 18 Pläne für 10 Wunsch-Clips kosteten 11 min). Nicht geplante Kandidaten werden protokolliert.
    const strength = (c: Candidate): number => c.obs.flatMap((o) => o.events).filter((e) => e.state === 'observed' && e.role !== 'context').length + (c.gemma ? 1 : 0)
    const viewed = cands.filter((c) => c.obs.length || c.gemma)
    const observed = viewed.map((c, i) => ({ c, i, k: strength(c) })).sort((a, b) => b.k - a.k || a.i - b.i).slice(0, wanted + 4).map((x) => x.c)
    await tracer.log('scheduler.jsonl', { plannedCandidates: observed.map((c) => c.id), skippedForPlanBudget: viewed.filter((c) => !observed.includes(c)).map((c) => ({ id: c.id, strength: strength(c) })) })
    // ------------------------------------------------------------------------------------------------ F Rendern
    interface Out { plan: ClipPlan; cut: CutCandidate; rendered: Rendered | null; obs: PacketObs[]; criteria: Criterion[]; decision: 'acceptable' | 'needs-review' | 'reject'; titleFinal: string; round: number; history: Array<{ round: number; sha256: string; decision: string; failure?: string }> }
    const mkOut = (p: ClipPlan): Out => ({ plan: p, cut: { id: `${p.candidateId}-cut`, startEdgeId: p.startEdge, endEdgeId: p.endEdge, span: p.span, prefilter: 0 }, rendered: null, obs: [], criteria: [], decision: 'needs-review', titleFinal: p.title, round: 0, history: [] })
    const renderOne = async (o: Out, i: number, n: number, trims: Array<{ start: number; end: number }>, reason: 'initial' | 'repair'): Promise<void> => {
      if (reason === 'repair') say('compare', 0.4 * (i / Math.max(1, n)), `Clip ${i + 1} von ${n} rendern (Reparatur)`)
      const clip = clipFor(`${req.runId}-${o.plan.candidateId}-r${o.round}`, o.cut, t, trims, { title: o.titleFinal, runId: req.runId, engine: 'engine-mac', ...(o.plan.coldOpen ? { coldOpen: o.plan.coldOpen } : {}) })
      o.rendered = await L.run(reason === 'repair' ? 'repair-render' : 'render', `${o.plan.candidateId} rendern`, { candidate: o.plan.candidateId, reason, units: o.cut.span.end - o.cut.span.start }, () => renderVariant(meta, t, req.input.signals, req.input.cuts, clip, join(runDir, 'previews', `${o.plan.candidateId}-r${o.round}`), signal))
    }
    // Vorab-Rendern: jeder fertige Schnittplan wird sofort im Hintergrund gerendert (CPU/VideoToolbox), während Qwen auf der GPU weiterplant.
    // Gemessen Lauf 4: Rendern begann erst nach der Rangfolge (13 min Render+Prüfung). Nicht gebrauchte Reservepläne dienen als Nachrücker; der Rest wird am Ende übersprungen.
    // Warteschlange mit Vorrang (gemessen Lauf 7: Prüfung wartete 5 min auf Renders in Planungsreihenfolge): nach der Rangfolge zuerst Gewinner in Rangfolge,
    // dann Reserve in Rangfolge; zwei Renders gleichzeitig (CPU/VideoToolbox, die GPU nutzt nur das Sprachmodell).
    const RENDER_WORKERS = 2
    const outOf = new Map<string, Out>()
    const ready0 = new Map<Out, Promise<void>>()
    const needed = new Set<Out>()
    const queue: Array<{ o: Out; seq: number; done: (e?: unknown) => void }> = []
    let active = 0, seq = 0
    const prio = (q: { o: Out; seq: number }): number => { const k = rankOrder.indexOf(q.o.plan.candidateId); return (needed.has(q.o) ? 0 : 1000) + (k >= 0 ? k : 500 + q.seq) }
    const pump = (): void => {
      queue.sort((x, y) => prio(x) - prio(y))
      while (active < RENDER_WORKERS && queue.length) {
        const q = queue.shift()!
        if (specStop && !needed.has(q.o)) { q.done(); continue }
        active++
        renderOne(q.o, 0, 1, [], 'initial')
          .then(() => q.done(), (e) => { if (signal?.aborted) return q.done(e); fail(`render ${q.o.plan.candidateId} r0`, e); q.o.rendered = null; q.done() })
          .finally(() => { active--; pump() })
      }
    }
    const preRender = (p: ClipPlan): void => {
      const o = mkOut(p)
      outOf.set(p.candidateId, o)
      const job = new Promise<void>((res, rej) => queue.push({ o, seq: seq++, done: (e) => (e ? rej(e) : res()) }))
      job.catch(() => undefined) // nicht gebrauchte Reserve wird nie abgewartet
      ready0.set(o, job); pump()
    }
    const allRenders = (): Promise<unknown> => { specStop = true; pump(); return Promise.allSettled([...ready0.values()]) }
    const plans: ClipPlan[] = []
    let rankOrder: string[] = []
    L.set('plan', observed.length)
    await phase('plan', () => withQwen(async (s) => {
      bookLoad(s, 'Schnittplan')
      for (let i = 0; i < observed.length; i++) {
        const c = observed[i]
        say('snap', i / Math.max(1, observed.length), `Schnitt planen ${i + 1} von ${observed.length}`)
        // ±40 s Kontext als Sätze: genug Raum für Einführung und Ausgang
        const win = { start: Math.max(0, c.span.start - 40), end: Math.min(dur, c.span.end + 40) }
        const winSentences = sentences.filter((x) => x.end > win.start && x.start < win.end).map((x) => ({ index: x.index, start: x.start, end: x.end, text: x.text }))
        if (!winSentences.length) { fail(`plan ${c.id}`, new Error('keine Sätze im Fenster')); continue }
        let retries = 0
        try {
          const r = await L.run('plan', `${c.id} Schnittplan`, { candidate: c.id, model: MAC_QWEN.id }, () => planCandidate(s, {
            candidateId: c.id, prompt: planPrompt({ contentType: req.contentType, hint: c.group.seeds.map((x) => x.summary).filter(Boolean).slice(0, 3).join(' / ') || 'auffälliger Moment', observations: c.obs.length ? obsText(c.obs, (x) => `${x.toFixed(1)}s`) : `Rückfrage Gemma 4: ${c.gemma}`, sentences: winSentences, minSec, maxSec, query: req.options.query }),
            sentences: winSentences, edges, minSec, maxSec, mayRetry: () => retries < 1, onRetry: () => { retries++; L.book({ kind: 'plan', label: `${c.id} Korrektur`, candidate: c.id, reason: 'schema-retry', model: MAC_QWEN.id, ms: 0, ok: true, units: 0 }) }, signal
          }))
          const plan = { ...r.plan, coldOpen: coldOpenFromObs(c.obs, r.plan.span) }
          plans.push(plan); preRender(plan)
          await tracer.log('plans.jsonl', { candidate: c.id, attempts: r.attempts, ms: r.ms, usage: r.usage, plan: r.plan, raw: r.raw.slice(0, 2000) })
        } catch (e) { if (signal?.aborted) throw e; fail(`plan ${c.id}`, e) }
      }
      const usable = plans
      if (usable.length) {
        const r = await L.run('rank', 'Rangfolge', { model: MAC_QWEN.id }, () => rankPlans(s, usable.map((p) => ({ id: p.candidateId, title: p.title, summary: p.summary, kind: p.kind, durationSec: p.span.end - p.span.start, evidence: (observed.find((c) => c.id === p.candidateId)?.obs ?? []).flatMap((o) => o.events.filter((e) => e.state === 'observed').map((e) => `${e.role}: ${e.description}`)).slice(0, 4).join('; ') || 'keine beobachteten Ereignisse' })), { contentType: req.contentType, signal }))
        rankOrder = r.order
      } else L.book({ kind: 'rank', label: 'Rangfolge (keine verwendbaren Pläne)', reason: 'initial', ms: 0, ok: true, units: 1 })
    }))
    await save('plans.json', { plans, rankOrder })
    // Gewinner: Rangfolge, ohne Überlappung (> 30 % des kürzeren Clips); Cold-Opener-Wiederholung innerhalb EINES Clips ist gewollt und zählt hier nicht
    const winners: ClipPlan[] = []
    for (const id of rankOrder) {
      const p = plans.find((x) => x.candidateId === id)!
      if (winners.length >= wanted) break
      if (winners.some((w) => overlapRatio(w.span, p.span) > 0.3)) continue
      winners.push(p)
    }
    const outs: Out[] = winners.map((p) => outOf.get(p.candidateId)!)
    for (const o of outs) needed.add(o)
    pump() // Rangfolge bekannt → Warteschlange neu ordnen
    L.set('render', plans.reduce((n, p) => n + (p.span.end - p.span.start), 0)); L.set('audit-packet', outs.reduce((n, o) => n + packetsFor('x', o.plan.span).length, 0)); L.set('audit-judge', outs.length)

    // Rendern läuft nacheinander im Hintergrund (CPU/VideoToolbox, keine GPU-Sperre); die LFM-Prüfung beginnt mit jedem fertigen Clip (Überlappung statt Wartezeit)
    const renderChain = (list: Out[], run: (o: Out, i: number) => Promise<void>): Map<Out, Promise<void>> => {
      const ready = new Map<Out, Promise<void>>()
      let prev: Promise<void> = Promise.resolve()
      list.forEach((o, i) => {
        const p = prev.then(() => run(o, i)).catch((e) => { if (signal?.aborted) throw e; fail(`render ${o.plan.candidateId} r${o.round}`, e); o.rendered = null })
        ready.set(o, p); prev = p.catch(() => undefined)
      })
      return ready
    }
    const t0Render = Date.now()

    // ------------------------------------------------------------------------------------------------ G+H Prüfung der fertigen Dateien (LFM beobachtet, Qwen prüft)
    const audit = async (list: Out[], label: string, ready: Map<Out, Promise<void>>): Promise<void> => {
      const todo = [...list]
      for (const o of todo) o.obs = []
      if (label !== 'r0') { L.plan('audit-packet', todo.reduce((n, o) => n + packetsFor('x', o.cut.span).length, 0)); L.plan('audit-judge', todo.length); L.plan('model-load', 2) } // Reparaturrunde: zusätzliche Arbeit
      await phase(`audit-observe-${label}`, async () => {
        let i = 0, restarts = 0
        while (i < todo.length && restarts <= 2) {
          try {
            await withLfm(async (s) => {
              bookLoad(s, `Prüfung ${label}`)
              for (; i < todo.length; i++) {
                const o = todo[i]
                say('compare', 0.4 * (i / todo.length), `Clip ${i + 1} von ${todo.length} wird gerendert und dann geprüft`)
                await ready.get(o)
                const r = o.rendered
                if (!r) continue // Rendern fehlgeschlagen (in errors protokolliert)
                for (const p of packetsFor(`${o.plan.candidateId}.r${o.round}`, { start: 0, end: r.durationSeconds })) {
                  say('compare', 0.4 + 0.3 * (i / todo.length), `Fertigen Clip ${i + 1} von ${todo.length} prüfen (Ton-/Bildpaket ${p.id.split('.p')[1]})`)
                  try { o.obs.push(await L.run('audit-packet', `${o.plan.candidateId} ${p.id}`, { candidate: o.plan.candidateId, model: MAC_LFM.id }, () => observePacket(s, { video: r.path, audio: r.streams.includes('audio') ? r.path : null, packet: p, mode: 'render', signal }))) }
                  catch (e) { if (signal?.aborted) throw e; fail(`audit-observe ${p.id}`, e); if (String(e).includes('Zeitlimit')) throw e }
                }
              }
            })
          } catch (e) { if (signal?.aborted) throw e; i++; restarts++ }
        }
      })
      // alle Renders fertig (auch wenn die Beobachtung vorher abbrach)
      await Promise.all(todo.map((o) => ready.get(o)))
      const judged = todo.filter((o) => o.rendered)
      await phase(`audit-judge-${label}`, () => withQwen(async (s) => {
        bookLoad(s, `Inhaltsprüfung ${label}`)
        for (let i = 0; i < judged.length; i++) {
          const o = judged[i], r = o.rendered!
          say('compare', 0.7 + 0.3 * (i / judged.length), `Inhalt prüfen ${i + 1} von ${judged.length}`)
          const cov = coverageOf({ start: 0, end: r.durationSeconds }, o.obs.map((x) => x.packet))
          const spoken = spokenBlocks(planExport(r.clip, t, req.input.signals, false, (r.clip.autoCuts ?? []).map((c) => [c.start, c.end] as [number, number])).words)
          const m = await measuredCriteria(r, wav, hasAudio, edges, signal)
          let model: Criterion[] = (['hook', 'standalone', 'payoff', 'natural-end', 'essential-event'] as const).map((id) => ({ id, state: 'unknown' as const, reason: 'nicht geprüft', evidenceIds: [] }))
          try {
            const j = await L.run('audit-judge', `${o.plan.candidateId} Inhaltsprüfung`, { candidate: o.plan.candidateId, model: MAC_QWEN.id }, () => judgeRender(s, { title: o.titleFinal, durationSec: r.durationSeconds, contentType: req.contentType, spoken, observations: obsText(o.obs, (x) => `${x.toFixed(1)}s`), evidenceIds: o.obs.flatMap((x) => x.segments.map((sg) => sg.id)), signal }))
            model = j.criteria
            if (!j.titleOk && j.betterTitle) o.titleFinal = j.betterTitle
          } catch (e) { if (signal?.aborted) throw e; fail(`audit-judge ${o.plan.candidateId}`, e) }
          // unvollständig gesehene/gehörte Ausgabe kann inhaltlich nicht bestehen: Modellurteile → unknown
          if (!cov.complete) model = model.map((c) => (c.state === 'pass' ? { ...c, state: 'unknown' as const, reason: `Ausgabe nicht vollständig beobachtet (${cov.covered.toFixed(0)}/${r.durationSeconds.toFixed(0)} s)` } : c))
          o.criteria = [...model, ...m.criteria]
          o.decision = decideMac2(o.criteria)
          o.history.push({ round: o.round, sha256: r.sha256, decision: o.decision, failure: firstRepairable(o.criteria) ?? undefined })
          await tracer.log('audits.jsonl', { candidate: o.plan.candidateId, round: o.round, sha256: r.sha256, coverage: cov, criteria: o.criteria, decision: o.decision, title: o.titleFinal })
        }
      }))
    }
    await audit(outs, 'r0', ready0)
    phaseSec['render+audit-observe overlap'] = Math.round((Date.now() - t0Render) / 100) / 10

    // ------------------------------------------------------------------------------------------------ H2 Nachrücken (eine Runde): abgelehnte Plätze mit den nächsten Reserveplänen der Rangfolge füllen, solange das Budget reicht
    const good = (): Out[] => outs.filter((o) => o.rendered && o.decision !== 'reject')
    const backfill: Out[] = []
    const perClipMs = (((L.secondsPerUnit('audit-packet') ?? 17) * 2) + (L.secondsPerUnit('audit-judge') ?? 25)) * 1000
    for (const id of rankOrder) {
      if (good().length + backfill.length >= wanted) break
      const o = outOf.get(id)
      if (!o || outs.includes(o)) continue
      if ([...good(), ...backfill].some((w) => overlapRatio(w.plan.span, o.plan.span) > 0.3)) continue
      if (L.elapsedMs() + (backfill.length + 1) * perClipMs + 60_000 > MAC2_LIMITS.softRunBudgetMs) { await tracer.log('scheduler.jsonl', { backfillStopped: 'Zeitbudget', candidate: id }); break }
      backfill.push(o); needed.add(o); pump()
    }
    if (backfill.length) {
      await tracer.log('scheduler.jsonl', { backfill: backfill.map((o) => o.plan.candidateId) })
      await audit(backfill, 'b1', ready0)
      outs.push(...backfill)
    }
    specStop = true

    // ------------------------------------------------------------------------------------------------ I höchstens eine Reparatur je Clip
    const repair: Out[] = []
    type Snap = Pick<Out, 'cut' | 'rendered' | 'obs' | 'criteria' | 'decision' | 'titleFinal' | 'round'>
    const before = new Map<Out, Snap>()
    const trimsOf = new Map<Out, Array<{ start: number; end: number }>>()
    for (const o of outs) {
      if (!o.rendered || o.decision === 'acceptable') continue
      const failure = firstRepairable(o.criteria)
      // nur mechanisch behebbare Fehler (gemessen Lauf 5: 4 von 4 Reparaturen wegen „standalone“ blieben abgelehnt, kosteten 5,5 min)
      if (failure !== 'natural-end' && failure !== 'dead-air') continue
      // nur reparieren, wenn höchstens 2 Kernkriterien durchfallen (gemessen: mit 3–4 Fehlern blieb jede Reparatur „reject“, kostete aber je ~1 min)
      const coreFails = o.criteria.filter((c) => ['hook', 'standalone', 'payoff', 'natural-end', 'essential-event'].includes(c.id) && c.state === 'fail').length
      if (coreFails > 2) { await tracer.log('repairs.jsonl', { candidate: o.plan.candidateId, failure, op: 'skip', reason: `${coreFails} Kernkriterien durchgefallen – Plan ungeeignet, Reparatur aussichtslos` }); continue }
      const sil = (await measuredCriteria(o.rendered, wav, hasAudio, edges, signal).catch(() => ({ silences: [] as Array<[number, number]> }))).silences
      const plan = planRepair(failure, o.cut, edges, o.rendered, sil, { minSec, maxSec })
      if (!plan) { await tracer.log('repairs.jsonl', { candidate: o.plan.candidateId, failure, op: 'stop', reason: 'keine begründete Änderung möglich' }); continue }
      await tracer.log('repairs.jsonl', { candidate: o.plan.candidateId, failure, op: plan.op, reason: plan.reason })
      before.set(o, { cut: o.cut, rendered: o.rendered, obs: o.obs, criteria: o.criteria, decision: o.decision, titleFinal: o.titleFinal, round: o.round })
      o.cut = plan.cut; o.round = 1; trimsOf.set(o, plan.trims)
      L.plan('repair-render', o.cut.span.end - o.cut.span.start)
      repair.push(o)
    }
    if (repair.length) {
      const ready1 = renderChain(repair, (o, i) => renderOne(o, i, repair.length, trimsOf.get(o) ?? [], 'repair'))
      await audit(repair, 'r1', ready1)
      // Reparatur nur behalten, wenn sie nicht schlechter ist (Vorversion liegt in einem eigenen Vorschau-Ordner und bleibt gültig)
      const rankD = { acceptable: 0, 'needs-review': 1, reject: 2 }
      for (const o of repair) {
        const b = before.get(o)!
        const worse = !o.rendered || rankD[o.decision] > rankD[b.decision]
        await tracer.log('repairs.jsonl', { candidate: o.plan.candidateId, before: b.decision, after: o.rendered ? o.decision : 'render-fehlgeschlagen', kept: worse ? 'vorher' : 'repariert' })
        if (worse) Object.assign(o, b)
      }
    }

    // ------------------------------------------------------------------------------------------------ Ergebnis
    const rankIdx = (id: string): number => { const k = rankOrder.indexOf(id); return k < 0 ? 999 : k }
    const order = { acceptable: 0, 'needs-review': 1, reject: 2 }
    const kept = outs.filter((o) => o.rendered && o.decision !== 'reject').sort((a, b) => order[a.decision] - order[b.decision] || rankIdx(a.plan.candidateId) - rankIdx(b.plan.candidateId)).slice(0, wanted)
    const st = (o: Out, id: string): number => ({ pass: 5, unknown: 3, 'not-applicable': 3, fail: 1 }[o.criteria.find((c) => c.id === id)?.state ?? 'unknown'] ?? 3)
    const clips: ShortmeClip[] = kept.map((o, rank) => {
      const r = o.rendered!
      const passes = o.criteria.filter((c) => c.state === 'pass').length, unknown = o.criteria.filter((c) => c.state === 'unknown').length
      const weak = o.criteria.filter((c) => c.state === 'fail' || c.state === 'unknown')
      const cand = cands.find((c) => c.id === o.plan.candidateId)!
      return {
        ...r.clip,
        id: `${req.runId}-c${rank + 1}`, runId: req.runId, engine: 'engine-mac', source: 'v4', title: o.titleFinal,
        // ehrliche Zahl: bestandene Kriterien, unbekannte halb, nicht „90–100 für alles“
        score: Math.round((100 * (passes + 0.5 * unknown)) / Math.max(1, o.criteria.length)),
        criteria: { hook: st(o, 'hook'), payoff: st(o, 'payoff'), quotable: st(o, 'standalone'), standalone: st(o, 'standalone'), density: st(o, 'dead-air') },
        reason: `${o.decision === 'acceptable' ? 'Freigegeben' : 'Prüfen'} – geprüft am fertigen Clip (${passes}/${o.criteria.length} bestanden, ${unknown} unklar). ${o.plan.summary}`.slice(0, 400),
        ...(o.plan.coldOpen ? { coldOpen: o.plan.coldOpen } : {}),
        v2: { eventId: cand.id, variantId: `${o.plan.candidateId}-r${o.round}`, kind: o.plan.kind, summary: o.plan.summary, verification: o.decision === 'acceptable' ? 'verified' : 'needs-review', evidenceIds: [...new Set(cand.obs.flatMap((x) => x.segments.map((s) => s.id)))].slice(0, 40), modalities: [...new Set(cand.group.lanes.map((l) => (l === 'speech' ? 'text' : l === 'cross-modal' ? 'visual' : l)))] as Array<'text' | 'audio' | 'visual'>, eventNote: `Engine Mac · Suchwege ${cand.group.lanes.join('+')} · LFM3 ${cand.obs.length} Pakete · Rang ${rankIdx(o.plan.candidateId) + 1} · Ausgabe ${r.sha256.slice(0, 12)}${o.round ? ' · repariert' : ''}`, uncertainty: weak.map((c) => `${c.id}: ${c.state} – ${c.reason}`).slice(0, 6) }
      } as ShortmeClip
    })
    await save('selection.json', { wanted, winners: winners.map((w) => w.candidateId), results: outs.map((o) => ({ candidate: o.plan.candidateId, title: o.titleFinal, decision: o.decision, round: o.round, output: o.rendered?.path ?? null, sha256: o.rendered?.sha256 ?? null, history: o.history, coldOpen: o.plan.coldOpen })), chosen: clips.map((c) => c.id) })
    await allRenders() // übersprungene Reserve-Renders sind sofort fertig
    await save('evidence.json', [...evidence.values()])
    const partial = errors.length > 0
    await finish(partial ? 'partial' : 'completed')
    return {
      clips, mode: 'v4',
      run: { status: partial ? 'incomplete' : 'done', modalities: { text: speech.seeds.length ? 'checked' : 'unavailable', audio: hasAudio ? 'checked' : 'unavailable', visual: 'checked' }, coverage: { text: deciles.speech.filter(Boolean).length / 10, audio: deciles.audio.filter(Boolean).length / 10, visual: deciles.visual.filter(Boolean).length / 10 }, models: { ...MAC2_MODELS }, ...(partial ? { error: `${errors.length} Teilfehler (errors in manifest.json)` } : {}) }
    }
  } catch (e) {
    fail('run', e)
    await finish(signal?.aborted ? 'cancelled' : 'failed').catch(() => undefined)
    throw e
  } finally {
    specStop = true
    // kein Modellprozess bleibt nach Ende/Abbruch geladen
    await vram.releaseAll().catch(() => undefined)
    await rm(join(runDir, 'tmp'), { recursive: true, force: true }).catch(() => undefined)
  }
}
