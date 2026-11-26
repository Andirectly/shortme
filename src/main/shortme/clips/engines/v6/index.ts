// Engine 6 – „Adaptive Intelligence“ (Pipeline 6.0), eigener Orchestrator. Breit entdecken, gezielt vertiefen, erst dann rendern.
//   A Index      : Transkript (Parakeet), Signale, YAMNet, Keyframes, Bild-Feature-Index (ein Decode, 448 px)
//   B Discovery  : Sprache (LLM, Cache), Ton, Bildwechsel, Bild-Embedding, Chat → Ereignisgruppen (RRF, Belege bleiben)
//   C Ranking    : Textmodell vergleicht den vollständigen Wortlaut (Gruppen ≤ 6, jede ID genau einmal, Spitzenvergleich)
//   D Untersuchung: nur offene Fragen und wortlose Kandidaten (AV-Modell), reservierte Plätze für wortlose Ereignisse
//   E Plan       : Satz-/Kanten-IDs → Quellzeit (Host), Ausschnitt VOR dem Render (eingefroren)
//   F Render     : derselbe Pfad wie der Nutzer-Export (unveränderliche Attempt-Artefakte)
//   G Prüfung    : Technik (ganzer Decode) + ganze Ausgabe in AV-Paketen + redaktionelles Urteil; höchstens eine gezielte Reparatur je Clip
// Modellphasen sind gebündelt (Text → Embedding → Text → AV → Text), damit auf 16 GB nie zwei große Modelle gleichzeitig liegen.
import { createHash } from 'node:crypto'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { ShortmeClip } from '@shared/shortme'
import { defaultWanted } from '@shared/estimate'
import type { Evidence } from '../../../../../shared/engineV2'
import { vram } from '../../../../engines'
import { loadMeta, projectFile } from '../../../project'
import { loadTranscript, type Transcript } from '../../../transcription'
import { writeFileAtomic } from '../../../atomic'
import { runDir as runDirOf } from '../state'
import { marksBySentence } from '../../audioEvents'
import { splitSentences, type Sentence } from '../../sentences'
import type { SelectionOutcome, SelectionRequest } from '..'
import { ensureSeries, decodeSeries } from '../v2/audioIndex'
import { frameDiffs, keyframeScan } from '../v2/visualIndex'
import { decilesCovered, firstRepairable, fuseSeeds, requiredSpan, selectBalanced, type CoverageWindow, type Criterion, type Span } from '../v4/core'
import { learnedLaneWeights } from '../v4/laneWeights'
import { audioLane, chatLane, crossModalLane, expandQueries, QUERY_BANK, speechLane, speechUncertainWindows, visualLane, type LaneResult } from '../v4/lanes'
import { investigateGroup, type InvestigationResult } from '../v4/investigate'
import { actionEdges, audioPhraseEdges, buildEdges, judgeCuts, makeVariants } from '../v4/cut'
import { clipFor, measuredCriteria, planRepair, type Rendered } from '../v4/finalize'
import { probeSource } from '../v4/media'
import { Tracer } from '../v4/trace'
import { checkpointKey, loadCheckpoint, saveCheckpoint } from '../v4/checkpoint'
import { V4_PROFILES } from '../v4/revisions'
import { layoutClip, prepareLayout } from '../../clipLayout'
import { layoutFile } from '../../analysis'
import { exportEffective } from '../../../render/exportOne'
import { adapterFor, hardwareProfile, v6MissingModels } from './adapters'
import { buildCandidate, rankCandidates, V6_RANK_PROMPT, type RankDecision, type V6Candidate } from './editorial'
import { planSpeech, planWordless, type V6CutPlan } from './plan'
import { cropSafety, decideV6, judgeEditorial, observeRendered, technicalCheck, V6_AUDIT_REVISION, type OutputAudit } from './audit'
import { buildV6Index } from './visualIndex'
import { detailZoom, isDetailQuestion, type RoiResult } from './roi'
import { Profiler } from './profiler'
import { V6_ALGORITHM_REVISION, V6_AV_DEDUPE, V6_BUDGET, V6_INDEX, V6_PIPELINE_VERSION, v6Revisions } from './revisions'

export type V6State = 'created' | 'indexing' | 'discovering' | 'ranking' | 'investigating' | 'planning' | 'rendering' | 'verifying' | 'completed' | 'incomplete' | 'cancelled' | 'failed'

const GERMAN = /\b(und|der|die|das|ist|nicht|ich|wir|aber|auch|mit|ein|eine|dass)\b/gi
const langOf = (t: Transcript): string => { const s = t.words.slice(0, 600).map((w) => w.w).join(' '); return (s.match(GERMAN)?.length ?? 0) > 15 ? 'Deutsch' : 'Englisch' }

interface Planned { cand: V6Candidate; rank: number; decision: RankDecision | null; plan: V6CutPlan; clip: ShortmeClip; reserve: boolean; inv: InvestigationResult | null; /** Render läuft schon (CPU) während das AV-Modell weitere Kandidaten untersucht; Reserven erst bei Bedarf */ rp?: Promise<Attempt | null> }
interface Attempt { attemptId: string; round: number; plan: V6CutPlan; clip: ShortmeClip; path: string; sha256: string; inputFingerprint: string; durationSec: number; rendered: Rendered; audit?: OutputAudit; measured?: Criterion[] }

/** Schalter für Messläufe: SHORTME_V6_AVDEDUPE=on|off überschreibt den Standard (nur Benchmark, nie still in der App). */
const avDedupe = (): { threshold: number; maxGapSec: number } | null => (process.env.SHORTME_V6_AVDEDUPE === 'on' ? { threshold: 0.035, maxGapSec: 6 } : process.env.SHORTME_V6_AVDEDUPE === 'off' ? null : V6_AV_DEDUPE)

export async function selectV6(req: SelectionRequest): Promise<SelectionOutcome> {
  const A = adapterFor()
  const missing = await v6MissingModels()
  if (missing.length) throw new Error(`Für Engine 6 fehlt: ${missing.map((m) => m.name).join(', ')}. Im Modell-Manager installieren.`)
  const { project, signal } = req
  const meta = await loadMeta(project.hash)
  const t = await loadTranscript(project.hash)
  if (!meta || !t) throw new Error('Projekt oder Transkript fehlt')
  const runDir = runDirOf(project.hash, req.runId)
  await mkdir(runDir, { recursive: true })
  const prof = new Profiler()
  prof.start()
  const report = (stage: string, f: number, m: string): void => req.report(stage, Math.max(0, Math.min(1, f)), m)
  const errors: Array<{ stage: string; error: string; at: string }> = []
  const fail = (st: string, e: unknown): void => { errors.push({ stage: st, error: e instanceof Error ? e.message.slice(0, 400) : String(e), at: new Date().toISOString() }) }
  const save = (name: string, obj: unknown): Promise<void> => writeFileAtomic(join(runDir, name), JSON.stringify(obj, null, 1))
  const hw = await hardwareProfile()
  const P4 = V4_PROFILES.balanced
  const wanted = req.options.wanted ?? defaultWanted(project.durationSec)
  const minSec = req.options.minSec ?? 15, maxSec = Math.min(75, req.options.maxSec ?? 75)
  const B = { ...V6_BUDGET, pool: Math.max(V6_BUDGET.poolMin, Math.min(V6_BUDGET.poolMax, wanted * V6_BUDGET.poolPerWanted + 5)), repairsGlobal: Math.max(1, wanted * V6_BUDGET.repairsGlobalPerWanted) }
  const manifest = {
    runId: req.runId, projectId: project.hash, engineId: 'engine6', pipelineVersion: V6_PIPELINE_VERSION, algorithm: V6_ALGORITHM_REVISION, state: 'created' as V6State, stateLog: [] as Array<{ state: V6State; at: string }>,
    source: null as unknown, models: { ...A.models, asr: t.model ?? 'parakeet-v3' }, revisions: v6Revisions(), platform: process.platform, hardware: hw,
    options: { query: req.options.query ?? '', wanted, minSec, maxSec, contentType: req.contentType ?? null, frame: req.layout?.frame ?? 'smart' }, budget: B, index: V6_INDEX,
    createdAt: new Date().toISOString(), finishedAt: undefined as string | undefined, errors, profile: null as unknown
  }
  const setState = async (s: V6State): Promise<void> => { manifest.state = s; manifest.stateLog.push({ state: s, at: new Date().toISOString() }); await save('manifest.json', manifest) }
  await setState('created')

  try {
    // ------------------------------------------------------------------------------------------------ A Index
    await setState('indexing')
    report('signals', 0, 'Quelle prüfen (ffprobe, SHA-256) …')
    const src = await prof.phase('probe', () => probeSource(project.hash, project.sourcePath, signal))
    manifest.source = { sha256: src.sha256, durationSec: src.durationSec, durationPts: src.durationPts, timebase: `${src.timebaseNum}/${src.timebaseDen}`, formatStartTime: src.formatStartTime, vfr: src.vfr, audioOffsetSec: src.audioOffsetSec, video: src.video, audio: src.audio }
    const tracer = new Tracer(runDir, req.runId, src.sha256)
    const dur = src.durationSec
    const hasAudio = !!src.audio && project.hasAudio
    const wav = projectFile(project.hash, 'audio.wav')
    const scanP = src.video ? prof.phase('keyframes', () => keyframeScan(project.sourcePath, signal), true).catch((e) => { if (signal?.aborted) throw e; fail('keyframes', e); return null }) : Promise.resolve(null)
    report('signals', 0.3, 'Ton-Klassen (YAMNet) …')
    const series = hasAudio ? await prof.phase('yamnet', async () => (await ensureSeries(project.hash, wav, signal)).series).catch((e) => { fail('yamnet', e); return null }) : null
    const sentences: Sentence[] = splitSentences(t.words)
    if (req.input.events?.length && sentences.length) for (const [i, m] of marksBySentence(sentences, req.input.events)) sentences[i].ev = m
    // wortloses Video (leeres Transkript) ist gültig – fehlende Tonspur, ASR ohne Sprache und leise Tonspur werden unterschieden
    const textState = !hasAudio ? 'keine Tonspur' : !t.words.length ? 'Tonspur ohne erkannte Sprache' : 'Sprache erkannt'

    // ------------------------------------------------------------------------------------------------ B Discovery
    await setState('discovering')
    report('candidates', 0, 'Sprachsuche (lokales Textmodell) …')
    const speech = await prof.phase('lane-speech', () => A.withText((url, model) => speechLane(url, sentences, { duration: dur, query: req.options.query, asrModel: t.model ?? 'parakeet', max: 24, tracer, signal, model, modelLabel: A.textLabel, cacheDir: projectFile(project.hash, 'analysis/cache'), onProgress: (f) => report('candidates', 0.3 * f, 'Sprachsuche …') })))
    if (speech.diag.cached) prof.count('cache:speech')
    const audio = await prof.phase('lane-audio', () => audioLane(series, req.input.signals, { duration: dur, max: 20, tracer, hasAudio }))
    const scan = await scanP
    const visual = visualLane(scan, { duration: dur, max: 16 })
    const queries = expandQueries(QUERY_BANK, req.options.query, speech.seeds)
    report('candidates', 0.4, 'Bild-Index (ein Decode) und Bildsuche …')
    const xm = await prof.phase('lane-cross-modal', () => A.withEmbedder(req.runId, (s) => crossModalLane(s, {
      hash: project.hash, video: project.sourcePath, duration: dur, profile: P4, queries, max: 20, tracer, signal, onProgress: (f, m) => report('candidates', 0.4 + 0.5 * f, m),
      index: async () => { const r = await buildV6Index(s, { hash: project.hash, video: project.sourcePath, durationSec: dur, cfg: V6_INDEX, cuts: [], signal, onProgress: (f, m) => report('candidates', 0.4 + 0.45 * f, m) }); if (r.cached) prof.count('cache:visual-index'); prof.count('visual-index:embedded', r.embedded); return r }
    })))
    const unsure = series ? speechUncertainWindows(decodeSeries(series) as never, series.hop, dur) : []
    for (const e of speech.evidence) if (unsure.some((u) => u.start < e.end && u.end > e.start)) Object.assign(e, { state: 'unknown', uncertainty: 'Gesang/Musik im Ton (YAMNet): Wortlaut unsicher' })
    const chat = chatLane(req.input.chatSpikes, { duration: dur, max: 16 })
    const lanes: LaneResult[] = [speech, audio, visual, xm, ...(chat ? [chat] : [])]
    if (Number(speech.diag.windows) > 0 && speech.diag.failedWindows === speech.diag.windows) fail('lane-speech', new Error(`alle ${speech.diag.windows} Textfenster fehlgeschlagen`))
    const coverage: CoverageWindow[] = lanes.flatMap((l) => l.coverage)
    const deciles = Object.fromEntries((['speech', 'audio', 'visual', 'cross-modal'] as const).map((ln) => [ln, decilesCovered(coverage.filter((w) => w.lane === ln), dur)]))
    await save('coverage.json', { durationSec: dur, textState, windows: coverage, deciles, speechUncertain: unsure, note: 'geplant = indexiert: Sprache (ASR ganze Tonspur + LLM-Fenster), Ton (Pegel + YAMNet ganze Tonspur), Bild (Keyframes + Embedding-Fenster ganze Zeitachse). Direkt beobachtet: siehe investigation.jsonl und audits.json.' })
    const evidence = new Map<string, Evidence>()
    for (const l of lanes) for (const e of l.evidence) evidence.set(e.id, e)
    const learned = await learnedLaneWeights().catch(() => ({ weights: {}, samples: 0 }))
    const groups = fuseSeeds(lanes.flatMap((l) => l.seeds), 60, learned.weights)
    const pool = selectBalanced(groups, B.pool, 3, dur)
    const cands = pool.map((g, i) => buildCandidate(`k${i + 1}`, { id: g.id, lanes: g.lanes, span: g.span, evidence: g.seeds.flatMap((s) => s.evidenceIds).map((id) => evidence.get(id)?.observation).filter((x): x is string => !!x) }, sentences, maxSec))
    const groupOf = new Map(pool.map((g, i) => [`k${i + 1}`, g]))
    await save('candidates.json', { lanes: Object.fromEntries(lanes.map((l) => [l.lane, { seeds: l.seeds.length, diag: l.diag }])), groups: groups.length, pool: pool.map((g) => ({ id: g.id, lanes: g.lanes, span: g.span, seeds: g.seeds.map((s) => s.id) })), candidates: cands, laneWeights: learned })
    report('candidates', 1, `${groups.length} Ereignisgruppen → ${cands.length} ernsthafte Kandidaten`)

    // ------------------------------------------------------------------------------------------------ C Ranking
    await setState('ranking')
    report('rate', 0, `Redaktionelles Ranking (${cands.length} Kandidaten, vollständiger Wortlaut) …`)
    const seed = parseInt(src.sha256.slice(0, 8), 16)
    const lang = langOf(t)
    const rkey = checkpointKey([src.sha256, cands.map((c) => [c.id, c.text, c.wordless, c.lanes]), req.options.query ?? '', V6_RANK_PROMPT, A.models.text, seed, lang])
    let ranking = await loadCheckpoint<{ order: string[]; decisions: Array<[string, RankDecision]>; rounds: unknown[]; incomplete: string[] }>(project.hash, 'v6-rank', rkey)
    if (ranking) prof.count('cache:ranking')
    else {
      const r = await prof.phase('ranking', () => A.withText((url, model) => rankCandidates(url, cands, { query: req.options.query, lang, seed, maxChars: B.rankMaxChars, signal, model, onRound: (x) => report('rate', 0.5, `Ranking ${x.round}: ${x.ok ? 'gültig' : 'ungültig – ' + x.error}`) })))
      ranking = { order: r.order, decisions: [...r.decisions], rounds: r.rounds, incomplete: r.incomplete }
      if (!r.incomplete.length) await saveCheckpoint(project.hash, 'v6-rank', rkey, ranking)
      prof.count('rank:rounds', r.rounds.length)
    }
    const decisions = new Map(ranking.decisions)
    if (ranking.incomplete.length) fail('ranking', new Error(`${ranking.incomplete.length} Kandidaten nicht bewertet (Modellantwort ungültig)`))
    await save('ranking.json', { seed, prompt: V6_RANK_PROMPT, order: ranking.order, decisions: Object.fromEntries(decisions), rounds: ranking.rounds, incomplete: ranking.incomplete })
    const ordered = ranking.order.map((id) => cands.find((c) => c.id === id)!).filter((c) => decisions.get(c.id) && decisions.get(c.id)!.decision !== 'reject')

    // ------------------------------------------------------------------------------------------------ D–G mit dem AV-Modell (eine GPU-Phase), dann Textmodell fürs Urteil
    const shotCuts = req.input.cutsLater ? await prof.phase('shots-wait', () => req.input.cutsLater!) : req.input.cuts
    const edges = buildEdges({ duration: dur, words: t.words, silences: hasAudio ? req.input.signals.silences : [], shots: shotCuts, actions: scan ? actionEdges(scan.times, frameDiffs(scan.frames), Math.max(20, Math.round(dur / 15))) : [], audioPhrases: hasAudio ? audioPhraseEdges(req.input.signals.loudness, series ? decodeSeries(series).music ?? null : null, series?.hop ?? 0.48) : [] })
    const lctx = await prepareLayout(meta, shotCuts, req.layout?.frame ?? 'smart', req.layout?.tracking ?? { split: true, follow: 'speaker' as never }, signal)
    const tmp = join(runDir, 'tmp')
    const wordsIn = (sp: Span): string => t.words.map((w, i) => ({ w, i })).filter(({ w }) => w.start >= sp.start && w.end <= sp.end).map(({ w, i }) => `[w${i}] ${w.w}`).join(' ').slice(0, 1800)
    const planned: Planned[] = []
    const attempts: Attempt[] = []
    const reserveQueue: V6Candidate[] = []
    const rois: Array<{ candidate: string; question: string } & RoiResult> = []
    let repairsLeft = B.repairsGlobal
    let investigatedWordless = 0
    const target = wanted + B.reserves

    const renderAttempt = async (p: Planned, plan: V6CutPlan, round: number): Promise<Attempt> => {
      const attemptId = `${p.clip.id}-a${round}`
      const dir = join(runDir, 'artifacts', attemptId)
      await rm(dir, { recursive: true, force: true }).catch(() => undefined)
      await mkdir(dir, { recursive: true })
      const clip0 = clipFor(p.clip.id, { id: plan.candidateId, startEdgeId: 'plan', endEdgeId: 'plan', span: plan.segments[0], prefilter: 0 }, t, [], { title: p.clip.title, runId: req.runId })
      // Ausschnitt VOR dem Render festlegen und einfrieren (dieselbe Planung wie bisher, aber keine zweite nach der Prüfung)
      const lay = await layoutClip(lctx, { ...clip0, engine: 'engine6', source: 'v6' })
      await writeFileAtomic(layoutFile(project.hash, lay.clip.id), JSON.stringify(lay.layout.input))
      const clip: ShortmeClip = { ...lay.clip, engine: 'engine6', source: 'v6' }
      const { exp, inputFingerprint } = await exportEffective(meta, t, clip, dir, { captions: true }, signal)
      const tech0 = await technicalCheck(exp.path, { durationSec: exp.durationSec, hasAudio }, signal)
      const shaOut = createHash('sha256')
      const { createReadStream } = await import('node:fs')
      await new Promise<void>((res, rej) => createReadStream(exp.path).on('data', (d) => shaOut.update(d)).on('end', () => res()).on('error', rej))
      const rendered: Rendered = { path: exp.path, sha256: shaOut.digest('hex'), durationSeconds: tech0.durationSec || exp.durationSec, streams: tech0.streams.filter((s): s is 'video' | 'audio' => s === 'video' || s === 'audio'), clip, trims: [], pieces: exp.pieces, faceRatio: lay.layout.faceRatio, emptyShots: clip.shots?.filter((s) => s.auto === 'empty').length ?? 0, layoutOk: true, captionWords: exp.wordsOut.length }
      const a: Attempt = { attemptId, round, plan, clip, path: exp.path, sha256: rendered.sha256, inputFingerprint, durationSec: rendered.durationSeconds, rendered }
      ;(a as Attempt & { tech: typeof tech0 }).tech = tech0
      attempts.push(a)
      prof.count('render')
      return a
    }

    // Renderkette: höchstens ein Render gleichzeitig (CPU/FFmpeg, Layout), überlappt mit der GPU-Arbeit; Fehler werden gemeldet, nie verschluckt
    let renderChain: Promise<unknown> = Promise.resolve()
    const startRender = (p: Planned): Promise<Attempt | null> => {
      const run = renderChain.then(() => prof.phase(`render ${p.clip.id}`, () => renderAttempt(p, p.plan, 0), true)).catch((e) => { if (signal?.aborted) throw e; fail(`render ${p.clip.id}`, e); return null })
      renderChain = run.catch(() => undefined)
      return run
    }

    await setState('investigating')
    // D Untersuchung + E Plan (AV-Modell): Gewinner + Reserven, wortlose Kandidaten auf reservierten Plätzen
    await prof.phase('av-investigate-plan', () => A.withAv(req.runId, async (s) => {
      let i = 0
      for (const c of [...ordered, ...cands.filter((k) => k.wordless && !ordered.includes(k) && decisions.get(k.id)?.decision !== 'reject')]) {
        if (planned.length >= target) { reserveQueue.push(c); continue }
        signal?.throwIfAborted()
        const d = decisions.get(c.id) ?? null
        const g = groupOf.get(c.id)!
        const isWordless = c.wordless
        if (isWordless && investigatedWordless >= B.wordlessSlots + wanted) { reserveQueue.push(c); continue }
        const needsLook = isWordless || d?.decision === 'investigate'
        report('rate', 0.1 + 0.6 * (planned.length / target), `${needsLook ? 'Gezielt untersuchen' : 'Planen'}: Kandidat ${++i} (${planned.length}/${target} geplant) …`)
        let inv: InvestigationResult | null = null
        if (needsLook) {
          const key = checkpointKey([src.sha256, g.seeds.map((x) => [x.lane, x.span, x.summary]), d?.question ?? '', A.models.av, V6_ALGORITHM_REVISION])
          inv = await loadCheckpoint<InvestigationResult>(project.hash, 'v6-inv', key)
          if (inv) prof.count('cache:investigation')
          else {
            try {
              inv = await investigateGroup(s, g, { video: project.sourcePath, hasAudio, duration: dur, tmpDir: tmp, profile: { ...P4, investigatorCalls: B.invCallsPerCandidate, investigatorSecPerSeed: B.invSecPerCandidate }, tracer, wordsIn, related: [], signal, question: d?.question || (isWordless ? 'Was passiert hier genau, und ist das Ergebnis/die Reaktion zu sehen oder zu hören?' : undefined) })
              prof.count('av:investigate-calls', inv.calls)
              if (inv.calls > 0 && !inv.stopReason.startsWith('Modellantwort ungültig')) await saveCheckpoint(project.hash, 'v6-inv', key, inv)
            } catch (e) { if (signal?.aborted) throw e; fail(`investigate ${c.id}`, e) }
          }
          if (isWordless) investigatedWordless++
          // Detail-Zoom: nur bei konkreter Detailfrage (Schrift, HUD, Objekt, Ausdruck …), Ausschnitt aus dem Original
          if (inv && d?.question && isDetailQuestion(d.question)) {
            try {
              const r = await detailZoom(s, { video: project.sourcePath, span: { start: Math.max(0, g.anchor - 8), end: Math.min(dur, g.anchor + 12) }, question: d.question, hasAudio, tmpDir: join(tmp, 'roi'), signal })
              rois.push({ candidate: c.id, question: d.question, ...r })
              prof.count('av:roi-calls', r.calls)
              if (r.visible === false) { await tracer.log('v6-selection.jsonl', { candidate: c.id, skipped: `Detail im Originalausschnitt nicht erkennbar: ${d.question}` }); continue }
            } catch (e) { if (signal?.aborted) throw e; fail(`roi ${c.id}`, e) }
          }
          // ungeklärt (keine beobachtete Kernrolle) oder Widerspruch: bleibt unknown → nicht geschnitten, nächste Reserve
          if (!inv || inv.graph.contradiction || !inv.graph.nodes.some((n) => n.state === 'observed' && n.role !== 'context' && n.role !== 'unknown')) { await tracer.log('v6-selection.jsonl', { candidate: c.id, skipped: inv ? (inv.graph.contradiction ? 'Widerspruch' : `Kernereignis nicht beobachtet (${inv.stopReason})`) : 'Untersuchung fehlgeschlagen' }); if (inv?.stopReason.startsWith('Modellantwort ungültig')) fail(`investigate ${c.id}`, new Error(inv.stopReason)); continue }
        }
        // E Plan
        let plan: V6CutPlan | null = null, why = ''
        if (!isWordless && d && d.first >= 0) {
          const r = planSpeech(c.id, sentences, t.words, d.first, d.last, { minSec, maxSec })
          if (r.ok) plan = r.plan; else why = r.reason
        } else if (inv) {
          try {
            const req0 = requiredSpan(inv.graph, { start: Math.max(0, g.anchor - 6), end: Math.min(dur, g.anchor + 6) })
            const reqSpan = req0.end - req0.start > maxSec - 4 ? { start: req0.start, end: req0.start + maxSec - 6 } : req0
            const { judged } = await judgeCuts(s, inv.graph, reqSpan, edges, { video: project.sourcePath, hasAudio, duration: dur, minSec, maxSec, limit: B.cutCandidates, tmpDir: tmp, tracer, signal })
            prof.count('av:cut-judge')
            const v = makeVariants(inv.graph.id, judged)[0]
            if (v) { const r = planWordless(c.id, v.cut, t.words, { minSec, maxSec }); if (r.ok) plan = r.plan; else why = r.reason } else why = 'keine geprüfte Schnittkante'
          } catch (e) { if (signal?.aborted) throw e; why = e instanceof Error ? e.message.slice(0, 120) : String(e) }
        } else why = 'keine Satzgrenzen'
        if (!plan) { await tracer.log('v6-selection.jsonl', { candidate: c.id, skipped: why }); continue }
        // Duplikat: Pflichtbereich überlappt einen besser gereihten Plan stark → nicht doppelt rendern
        if (planned.some((p) => { const a0 = p.plan.segments[0], b0 = plan!.segments[0]; const ov = Math.max(0, Math.min(a0.end, b0.end) - Math.max(a0.start, b0.start)); return ov / Math.min(a0.end - a0.start, b0.end - b0.start) > 0.5 })) { await tracer.log('v6-selection.jsonl', { candidate: c.id, skipped: 'Überlappung mit besser gereihtem Clip' }); continue }
        const rank = planned.length + 1
        const clip0 = clipFor(`${req.runId}-c${rank}`, { id: c.id, startEdgeId: 'plan', endEdgeId: 'plan', span: plan.segments[0], prefilter: 0 }, t, [], { title: d?.title || c.text.split('\n')[0]?.replace(/^S\d+:\s*/, '').split(/\s+/).slice(0, 7).join(' ') || 'Clip', runId: req.runId })
        const pl: Planned = { cand: c, rank, decision: d, plan, clip: clip0, reserve: rank > wanted, inv }
        planned.push(pl)
        if (!pl.reserve) pl.rp = startRender(pl)
      }
    }))
    await save('roi.json', rois)
    await save('plans.json', planned.map((p) => ({ rank: p.rank, candidate: p.cand.id, reserve: p.reserve, decision: p.decision, plan: p.plan, investigated: !!p.inv })))

    // F Render (wie der Export) – CPU/FFmpeg, ohne GPU-Modell
    await setState('rendering')
    const open = planned.filter((p) => p.rp)
    for (const [k, p] of open.entries()) {
      report('snap', k / Math.max(1, open.length), `Clip ${k + 1}/${open.length} fertig rendern (läuft seit der Planung) …`)
      await prof.phase(`render-wait ${p.clip.id}`, () => p.rp!)
    }

    // G Prüfung: AV-Pakete über jede ganze Ausgabedatei (eine AV-Sitzung), dann redaktionelles Urteil (eine Textsitzung)
    await setState('verifying')
    const observe = async (list: Attempt[]): Promise<void> => {
      await prof.phase('av-observe-output', () => A.withAv(req.runId, async (s) => {
        for (const [k, a] of list.entries()) {
          report('compare', 0.6 * (k / Math.max(1, list.length)), `Ausgabe ${k + 1}/${list.length} ansehen und anhören …`)
          const packets = await observeRendered(s, a.path, a.durationSec, hasAudio, join(tmp, a.attemptId), signal, avDedupe() ?? undefined)
          prof.count('av:packets', packets.length)
          const m = await measuredCriteria(a.rendered, wav, hasAudio, edges, signal)
          // keine pauschale Gesichtsquoten-Strafe für Gameplay/wortlose Clips: dort ist der Ausschnitt Gameplay bzw. Ganzes Bild
          const measured = m.criteria.map((c) => (c.id === 'crop-safety' ? cropSafety(c, a, lctx.frame) : c))
          ;(a as Attempt & { packets: typeof packets }).packets = packets
          a.measured = measured
        }
      }))
      await prof.phase('text-judge-output', () => A.withText(async (url, model) => {
        for (const [k, a] of list.entries()) {
          report('compare', 0.6 + 0.4 * (k / Math.max(1, list.length)), `Redaktionelle Prüfung ${k + 1}/${list.length} …`)
          const packets = (a as Attempt & { packets: OutputAudit['packets'] }).packets
          const tech = (a as Attempt & { tech: OutputAudit['technical'] }).tech
          const text = sentences.filter((s0) => s0.first >= a.plan.firstWord && s0.last <= a.plan.lastWord).map((s0) => s0.text).join(' ') || t.words.slice(Math.max(0, a.plan.firstWord), a.plan.lastWord + 1).map((w) => w.w).join(' ')
          let editorial: { criteria: Criterion[]; title: string } | null = null
          try { editorial = await judgeEditorial(url, { durationSec: a.durationSec, text, wordless: a.plan.wordless || !text.trim(), packets, measured: a.measured ?? [], lang: langOf(t) }, model, signal); prof.count('text:judge') } catch (e) { if (signal?.aborted) throw e; fail(`judge ${a.attemptId}`, e) }
          // Tonbeobachtung an den Rändern + gemessene Kriterien fließen in natural-end ein (Modell-Selbsturteil allein reicht nicht)
          const crit: Criterion[] = [...(editorial?.criteria ?? ['hook', 'standalone', 'payoff', 'natural-end', 'essential-event'].map((id) => ({ id, state: 'unknown' as const, reason: 'Urteil fehlgeschlagen', evidenceIds: [] }))), ...(a.measured ?? [])]
          const cutEnd = packets[packets.length - 1]?.wordCutAtEnd === true, cutStart = packets[0]?.wordCutAtStart === true
          if (cutEnd || cutStart) { const ne = crit.find((c) => c.id === 'natural-end'); if (ne) Object.assign(ne, { state: 'fail', reason: `Ton ${cutStart ? 'beginnt' : 'endet'} mitten im Wort (AV-Beobachtung)` }) }
          const observedSec = packets.filter((p) => p.ok).reduce((n, p) => n + (p.end - p.start), 0)
          const coverageOk = packets.length > 0 && packets.every((p) => p.ok)
          const status = decideV6(tech, coverageOk, crit, a.plan.wordless)
          const editorialStatus = !editorial ? 'unknown' : ['standalone', 'payoff'].some((id) => crit.find((c) => c.id === id)?.state === 'fail') ? 'fail' : status === 'verified' ? 'pass' : 'needs-review'
          a.audit = { clipId: a.clip.id, attemptId: a.attemptId, planFingerprint: a.plan.fingerprint, sha256: a.sha256, auditRevision: V6_AUDIT_REVISION, models: { av: A.models.av, text: A.models.text }, technical: tech, packets, coverage: { outputSec: Math.round(a.durationSec * 10) / 10, observedSec: Math.round(observedSec * 10) / 10, packets: packets.length, failedPackets: packets.filter((p) => !p.ok).length }, criteria: crit, status, technicalStatus: tech.ok ? 'pass' : 'fail', editorialStatus, title: editorial?.title ?? '', at: new Date().toISOString() }
          if (status === 'verified') prof.markVerified()
        }
      }))
    }
    const round0 = (): Attempt[] => attempts.filter((a) => a.round === 0)
    if (round0().length) await observe(round0())
    // Reserven erst bei Bedarf (Kap. 9/13): fehlen brauchbare (nicht abgelehnte) Clips, die nächste Reserve rendern und prüfen
    const needMore = wanted - round0().filter((a) => a.audit && a.audit.status !== 'rejected').length
    const reservesNow = planned.filter((p) => p.reserve && !p.rp).slice(0, Math.max(0, needMore))
    if (reservesNow.length) {
      await setState('rendering')
      for (const p of reservesNow) p.rp = startRender(p)
      await Promise.all(reservesNow.map((p) => p.rp))
      await setState('verifying')
      const fresh = round0().filter((a) => !a.audit)
      if (fresh.length) await observe(fresh)
      prof.count('reserve:activated', reservesNow.length)
    }
    const first = round0()

    // Gezielte Reparatur: höchstens eine je Clip, globales Budget; nur konkreter Mangel; schlechtere Reparatur überschreibt nichts
    const rankStatus = (s?: OutputAudit['status']): number => (s === 'verified' ? 0 : s === 'needs-review' ? 1 : 2)
    const repairs: Array<{ clipId: string; failure: string; op: string; ok: boolean }> = []
    const second: Attempt[] = []
    for (const a of first) {
      if (!a.audit || a.audit.status === 'verified' || repairsLeft <= 0 || !a.audit.technical.ok) continue
      const failure = firstRepairable(a.audit.criteria) ?? (a.audit.criteria.find((c) => c.id === 'natural-end' && c.state !== 'pass') ? 'natural-end' : null)
      if (!failure) continue
      const p = planned.find((x) => x.clip.id === a.clip.id)!
      let plan: V6CutPlan | null = null, op = ''
      if (!a.plan.wordless && p.decision) {
        const firstS = sentences.findIndex((s0) => s0.index === p.decision!.first), lastS = sentences.findIndex((s0) => s0.index === p.decision!.last)
        // fehlender Kontext → einen Satz davor; fehlender Ertrag/Ende → einen Satz danach (Schutz bleibt: alte Sätze sind enthalten)
        const [f2, l2] = failure === 'standalone' ? [Math.max(0, firstS - 1), lastS] : failure === 'payoff' || failure === 'natural-end' ? [firstS, Math.min(sentences.length - 1, lastS + 1)] : [firstS, lastS]
        if (f2 !== firstS || l2 !== lastS) { const r = planSpeech(p.cand.id, sentences, t.words, sentences[f2].index, sentences[l2].index, { minSec, maxSec }); if (r.ok) { plan = r.plan; op = failure === 'standalone' ? 'Satz davor' : 'Satz danach' } }
      } else {
        const rp = planRepair(failure, { id: a.plan.candidateId, startEdgeId: 'plan', endEdgeId: 'plan', span: a.plan.segments[0], prefilter: 0 }, edges, a.rendered, [], { minSec, maxSec })
        if (rp && !rp.trims.length) { const r = planWordless(p.cand.id, rp.cut, t.words, { minSec, maxSec }); if (r.ok) { plan = r.plan; op = rp.op } }
      }
      if (!plan) { repairs.push({ clipId: a.clip.id, failure, op: 'keine begründete Änderung', ok: false }); continue }
      repairsLeft--
      try { second.push(await prof.phase(`repair ${a.clip.id}`, () => renderAttempt(p, plan!, 1))); repairs.push({ clipId: a.clip.id, failure, op, ok: true }); prof.count('repair') } catch (e) { if (signal?.aborted) throw e; fail(`repair ${a.clip.id}`, e) }
    }
    if (second.length) await observe(second)
    await save('repairs.json', repairs)
    await rm(tmp, { recursive: true, force: true }).catch(() => undefined)

    // Bester Versuch je Clip (Reparatur nur, wenn nicht schlechter)
    const best = new Map<string, Attempt>()
    for (const a of attempts) { const b = best.get(a.clip.id); if (!b || (a.audit && (!b.audit || rankStatus(a.audit.status) < rankStatus(b.audit.status)))) best.set(a.clip.id, a) }
    await save('audits.json', attempts.map((a) => ({ attemptId: a.attemptId, clipId: a.clip.id, round: a.round, sha256: a.sha256, inputFingerprint: a.inputFingerprint, plan: a.plan.fingerprint, path: a.path, audit: a.audit ?? null, chosen: best.get(a.clip.id) === a })))
    await save('evidence.json', [...evidence.values()])

    // ------------------------------------------------------------------------------------------------ Auswahl & Ausgabe
    // redaktionell beste brauchbare zuerst: geprüft vor „bitte prüfen“, abgelehnte nicht veröffentlicht; Reserven nur zum Auffüllen der Wunschzahl
    const usable = planned.map((p) => ({ p, a: best.get(p.clip.id) })).filter((x): x is { p: Planned; a: Attempt } => !!x.a?.audit && x.a.audit.status !== 'rejected')
    const chosen = [...usable.filter((x) => x.a.audit!.status === 'verified'), ...usable.filter((x) => x.a.audit!.status === 'needs-review')].slice(0, wanted)
    chosen.sort((x, y) => (x.a.audit!.status === y.a.audit!.status ? x.p.rank - y.p.rank : rankStatus(x.a.audit!.status) - rankStatus(y.a.audit!.status)))
    const clips: ShortmeClip[] = chosen.map(({ p, a }, n) => {
      const au = a.audit!
      const st = (id: string): number => ({ pass: 5, unknown: 3, 'not-applicable': 3, fail: 1 }[au.criteria.find((c) => c.id === id)?.state ?? 'unknown'] ?? 3)
      const weak = au.criteria.filter((c) => c.state === 'fail' || c.state === 'unknown')
      return {
        ...a.clip, id: a.clip.id, runId: req.runId, engine: 'engine6', source: 'v6',
        // Titel stand vor dem Render fest (er gehört zur geprüften Datei); der Prüftitel wird nur protokolliert
        title: a.clip.title,
        // Rangwert (keine Qualitätsnote): 100 für Rang 1, je Rang −4
        score: Math.max(1, 100 - 4 * n),
        criteria: { hook: st('hook'), payoff: st('payoff'), quotable: st('standalone'), standalone: st('standalone'), density: st('dead-air') },
        reason: `Rang ${n + 1}: ${p.decision?.reason ?? 'wortloser Kandidat nach Untersuchung'}`,
        v2: { eventId: p.cand.eventGroupId, variantId: a.attemptId, kind: 'sonstiges' as never, summary: p.decision?.reason ?? '', verification: au.status === 'verified' ? 'verified' : 'needs-review', evidenceIds: (groupOf.get(p.cand.id)?.seeds.flatMap((s) => s.evidenceIds) ?? []).slice(0, 40), modalities: [...new Set(p.cand.lanes.map((l) => (l === 'speech' ? 'text' : l === 'cross-modal' ? 'visual' : l)))], eventNote: `Engine 6 · Lanes ${p.cand.lanes.join('+')} · Rang ${n + 1} · ${au.coverage.packets} Prüfpakete · Ausgabe ${a.sha256.slice(0, 12)}${a.round ? ' · repariert' : ''}`, uncertainty: weak.map((c) => `${c.id}: ${c.state} – ${c.reason}`).slice(0, 6) },
        v6: { editorialRank: n + 1, rankReason: p.decision?.reason ?? '', decision: p.decision?.decision ?? 'investigate', comparisons: (ranking!.rounds as Array<{ round: string; order: string[] }>).filter((r) => r.order.includes(p.cand.id)).map((r) => r.round), reserve: p.reserve, planFingerprint: a.plan.fingerprint, attemptId: a.attemptId, artifact: { path: a.path, sha256: a.sha256, inputFingerprint: a.inputFingerprint }, audit: { status: au.status, technical: au.technicalStatus, editorial: au.editorialStatus, revision: au.auditRevision, coverage: au.coverage }, ...(p.decision?.question ? { question: p.decision.question } : {}) }
      } as ShortmeClip
    })
    const shortfall = Math.max(0, wanted - clips.length)
    await save('selection.json', { wanted, delivered: clips.length, shortfall, verified: clips.filter((c) => c.v6?.audit.status === 'verified').length, chosen: clips.map((c) => ({ clipId: c.id, rank: c.v6!.editorialRank, status: c.v6!.audit.status, artifact: c.v6!.artifact })), reservesUnused: reserveQueue.map((c) => c.id) })
    await save('model_calls.json', tracer.calls)
    prof.stop()
    manifest.profile = prof.report()
    const partial = errors.length > 0 || shortfall > 0
    manifest.finishedAt = new Date().toISOString()
    await setState(partial ? 'incomplete' : 'completed')
    if (errors.length) await save('errors.json', errors)
    return {
      clips, mode: 'v6',
      run: { status: errors.length ? 'incomplete' : 'done', modalities: { text: sentences.length ? 'checked' : 'unavailable', audio: hasAudio ? 'checked' : 'unavailable', visual: 'checked', ...(chat ? { chat: 'signal-only' as const } : {}) }, coverage: { text: deciles.speech.filter(Boolean).length / 10, audio: deciles.audio.filter(Boolean).length / 10, visual: deciles.visual.filter(Boolean).length / 10 }, models: { ...A.models }, ...(errors.length ? { error: `${errors.length} Teilfehler (errors.json)` } : shortfall ? { error: `nur ${clips.length} von ${wanted} brauchbaren Clips (Material oder Prüfung)` } : {}) }
    }
  } catch (e) {
    fail('run', e)
    prof.stop()
    manifest.profile = prof.report()
    manifest.finishedAt = new Date().toISOString()
    await setState(signal?.aborted ? 'cancelled' : 'failed').catch(() => undefined)
    throw e
  } finally {
    await vram.releaseAll().catch(() => undefined)
  }
}
