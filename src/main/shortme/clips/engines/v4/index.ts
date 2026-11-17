// Engine 4 – eigener Orchestrator (Pipeline „adaptive-event-intelligence“ 4.0). Ruft NICHT runPipeline (Engine 2/3) auf; geteilt wird nur Infrastruktur
// (Transkript, Signale, Textsuche als Sprach-Lane, Ton-Index, Embedding-Index, Python-Worker, Exporter, Layout, GPU-Sperre).
// Ablauf: S2 Probe + billige Merkmale → S3 vier Lanes + Fusion → S4 Nachuntersuchung + Ereignisgraph → S5 Kanten + Cut-Judge + Varianten
//         → S6 Render + Endprüfung am Clip + Reparatur → Auswahl. Alle Zwischenstände liegen im Lauf-Ordner (analysis/runs/<runId>/).
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { app } from 'electron'
import type { ShortmeClip } from '@shared/shortme'
import { defaultWanted } from '@shared/estimate'
import { isV3Profile, type V3Profile } from '../../../../../shared/engine'
import type { Evidence } from '../../../../../shared/engineV2'
import { vram, withLlm } from '../../../../engines'
import { CATALOG } from '../../../../engines/catalog'
import { loadMeta, projectFile } from '../../../project'
import { loadTranscript } from '../../../transcription'
import { writeFileAtomic } from '../../../atomic'
import { runDir as runDirOf } from '../state'
import { marksBySentence } from '../../audioEvents'
import { splitSentences } from '../../sentences'
import type { SelectionOutcome, SelectionRequest } from '..'
import { ensureSeries, decodeSeries } from '../v2/audioIndex'
import { frameDiffs, keyframeScan } from '../v2/visualIndex'
import { withEmbedder } from '../v3/embedWorker'
import { withAv } from '../v3/avWorker'
import { decilesCovered, fuseSeeds, rankFinal, requiredSpan, selectBalanced, type CoverageWindow, type CutCandidate, type Finalist, type Seed, type SeedGroup, type Span } from './core'
import { audioLane, crossModalLane, expandQueries, QUERY_BANK, speechLane, speechUncertainWindows, visualLane, type LaneResult } from './lanes'
import { investigateGroup, type InvestigationResult } from './investigate'
import { actionEdges, audioPhraseEdges, buildEdges, judgeCuts, makeVariants, type Variant } from './cut'
import { clipFor, firstRepairable, judgeRendered, measuredCriteria, planRepair, previewDir, renderVariant, type JudgeRound, type Rendered } from './finalize'
import { probeSource, type SourceInfo } from './media'
import { Tracer } from './trace'
import { checkpointKey, loadCheckpoint, saveCheckpoint } from './checkpoint'
import { V3_AV_MODEL } from '../v3/revisions'
import { v4MissingModels } from './models'
import { V4_ALGORITHM_REVISION, V4_EDGE_REVISION, V4_MODELS, V4_PIPELINE_VERSION, V4_PROFILES, V4_PROMPT_REVISION, V4_QUERYBANK_REVISION, v4Revisions } from './revisions'

export type V4Status = 'queued' | 'running' | 'partial' | 'completed' | 'cancelled' | 'failed'

function gitSha(): string {
  try { return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: process.cwd(), windowsHide: true, timeout: 5000 }).toString().trim() } catch { return `app-${app?.getVersion?.() ?? 'unknown'}` }
}
const sha = (x: unknown): string => createHash('sha256').update(JSON.stringify(x)).digest('hex')

export async function selectV4(req: SelectionRequest): Promise<SelectionOutcome> {
  const T0 = Date.now()
  const profileId: V3Profile = isV3Profile(req.profile) ? req.profile : 'balanced'
  const P = V4_PROFILES[profileId]
  const { project, signal } = req
  const missing = await v4MissingModels()
  if (missing.length) throw new Error(`Für Engine 4 fehlt: ${missing.map((m) => m.name).join(', ')}. Im Modell-Manager installieren.`)
  const meta = await loadMeta(project.hash)
  const t = await loadTranscript(project.hash)
  if (!meta || !t) throw new Error('Projekt oder Transkript fehlt')
  const runDir = runDirOf(project.hash, req.runId)
  await mkdir(runDir, { recursive: true })
  const report = (stage: string, f: number, m: string): void => req.report(stage, Math.max(0, Math.min(1, f)), m)
  const stageSec: Record<string, number> = {}
  const stage = async <T>(name: string, fn: () => Promise<T>): Promise<T> => { const a = Date.now(); try { return await fn() } finally { stageSec[name] = Math.round((Date.now() - a) / 100) / 10 } }
  const errors: Array<{ stage: string; error: string; at: string }> = []
  const fail = (st: string, e: unknown): void => { errors.push({ stage: st, error: e instanceof Error ? e.message.slice(0, 400) : String(e), at: new Date().toISOString() }) }
  const save = (name: string, obj: unknown): Promise<void> => writeFileAtomic(join(runDir, name), JSON.stringify(obj, null, 1))

  // ---------------------------------------------------------------------------------------------------------------- S0/S2 Probe + Manifest
  report('signals', 0, 'Quelle prüfen (ffprobe, SHA-256) …')
  const src: SourceInfo = await stage('probe', () => probeSource(project.hash, project.sourcePath, signal))
  const tracer = new Tracer(runDir, req.runId, src.sha256)
  const weightHashes = Object.fromEntries(['qwen3-vl-embedding-2b', 'minicpm-o-4_5', 'yamnet', 'qwen3-14b'].map((id) => { const c = CATALOG.find((x) => x.id === id); const big = c ? [...c.files].sort((a, b) => b.size - a.size)[0] : undefined; return [id, big?.sha256 ?? 'unbekannt'] }))
  const manifest = {
    runId: req.runId, projectId: project.hash, engineId: 'engine4' as const, kind: 'full-source-analysis' as const, pipeline: 'adaptive-event-intelligence', pipelineVersion: V4_PIPELINE_VERSION, protocolVersion: 1,
    source: { mediaId: project.hash, path: src.path, sha256: src.sha256, durationPts: src.durationPts, timebaseNum: src.timebaseNum, timebaseDen: src.timebaseDen, durationSec: src.durationSec, vfr: src.vfr, audioOffsetSec: src.audioOffsetSec, streams: src.streams.map((s) => s.type) },
    snapshot: { gitSha: gitSha(), configSha256: sha({ P, profileId }), modelRevisions: { ...V4_MODELS, asr: t.model ?? V4_MODELS.asr }, weightHashes, promptVersions: { ...V4_PROMPT_REVISION }, queryRevision: V4_QUERYBANK_REVISION, edgeRevision: V4_EDGE_REVISION, seed: 0, profile: profileId, revisions: v4Revisions(profileId), options: req.options.query ? { query: req.options.query, wanted: req.options.wanted ?? null } : { wanted: req.options.wanted ?? null } },
    status: 'running' as V4Status, createdAt: new Date().toISOString(), finishedAt: undefined as string | undefined, stageSec, errors
  }
  await save('manifest.json', manifest)
  const finish = async (status: V4Status): Promise<void> => { manifest.status = status; manifest.finishedAt = new Date().toISOString(); await save('manifest.json', manifest); if (errors.length) await save('errors.json', errors) }

  try {
    const dur = src.durationSec
    const minSec = req.options.minSec ?? 15, maxSec = Math.min(75, req.options.maxSec ?? 75)
    const wanted = req.options.wanted ?? defaultWanted(dur)
    const hasAudio = !!src.audio && project.hasAudio
    const wav = projectFile(project.hash, 'audio.wav')

    // ASR: vorhandenes, über die ganze Tonspur gelaufenes Transkript (Wortzeiten aus dem Modell)
    await tracer.record({ role: 'asr', modelRevision: t.model ?? 'parakeet-v3', realInputModalities: hasAudio ? ['audio'] : [], actualMediaWindowIds: ['audio.wav'], success: hasAudio, validatedOutput: true, wallClockMs: 0, status: `${t.words.length} Wörter (gespeichertes Transkript, Version ${t.version})`, input: { wav: 'audio.wav', durationSec: dur }, output: { words: t.words.length, speech: t.speech?.length ?? null } })
    report('signals', 0.3, 'Ton-Klassen (YAMNet) …')
    const series = hasAudio ? await stage('yamnet', async () => (await ensureSeries(project.hash, wav, signal)).series).catch((e) => { fail('yamnet', e); return null }) : null
    report('signals', 0.6, 'Bildänderungen …')
    const scan = src.video ? await stage('keyframes', () => keyframeScan(project.sourcePath, signal)).catch((e) => { fail('keyframes', e); return null }) : null
    report('signals', 1, 'Billige Merkmale fertig')

    // ---------------------------------------------------------------------------------------------------------------- S3 vier Lanes
    const sentences = splitSentences(t.words)
    if (req.input.events?.length && sentences.length) for (const [i, m] of marksBySentence(sentences, req.input.events)) sentences[i].ev = m
    report('candidates', 0, 'Sprach-Lane (lokales LLM) …')
    const speech = await stage('lane-speech', () => withLlm((url) => speechLane(url, sentences, { duration: dur, query: req.options.query, asrModel: t.model ?? 'parakeet', max: P.perLane * 4, tracer, signal, onProgress: (f) => report('candidates', 0.3 * f, 'Sprach-Lane …') })))
    report('candidates', 0.3, 'Ton-Lane …')
    const audio = await stage('lane-audio', () => audioLane(series, req.input.signals, { duration: dur, max: P.perLane * 4, tracer, hasAudio }))
    const visual = visualLane(scan, { duration: dur, max: P.perLane * 4 })
    report('candidates', 0.4, 'Video-Embedding-Index und Anfragen …')
    const queries = expandQueries(QUERY_BANK, req.options.query, speech.seeds)
    const xm = await stage('lane-cross-modal', () => withEmbedder(req.runId, (s) => crossModalLane(s, { hash: project.hash, video: project.sourcePath, duration: dur, profile: P, queries, max: P.perLane * 4, tracer, signal, onProgress: (f, m) => report('candidates', 0.4 + 0.5 * f, m) })))
    // Gesang/Musik (YAMNet) → ASR-Wörter dort unsicher: Abdeckung „partial“, Sprachbelege „unknown“ (keine Sicherheit vortäuschen)
    const unsure = series ? speechUncertainWindows(decodeSeries(series) as never, series.hop, dur) : []
    if (unsure.length) {
      for (const w of speech.coverage) if (w.source.startsWith('asr:') && unsure.some((u) => u.start < w.endSeconds && u.end > w.startSeconds)) Object.assign(w, { status: 'partial', reason: 'Gesang/Musik: ASR-Wörter unsicher' })
      for (const e of speech.evidence) if (unsure.some((u) => u.start < e.end && u.end > e.start)) Object.assign(e, { state: 'unknown', uncertainty: 'Gesang/Musik im Ton (YAMNet): Wortlaut unsicher' })
    }
    const lanes: LaneResult[] = [speech, audio, visual, xm]
    const coverage: CoverageWindow[] = lanes.flatMap((l) => l.coverage)
    const decileReport = Object.fromEntries((['speech', 'audio', 'visual', 'cross-modal'] as const).map((ln) => [ln, decilesCovered(coverage.filter((w) => w.lane === ln), dur)]))
    await save('coverage.json', { durationSec: dur, windows: coverage, deciles: decileReport, speechUncertain: unsure, note: 'speech: ASR über die ganze Tonspur + LLM-Fenster; audio: Pegel + YAMNet über die ganze Tonspur; visual: Keyframes + Embedding-Fenster über die ganze Zeitachse' })
    const evidence = new Map<string, Evidence>()
    for (const l of lanes) for (const e of l.evidence) evidence.set(e.id, e)
    const seeds: Seed[] = lanes.flatMap((l) => l.seeds)
    const groups = fuseSeeds(seeds)
    const selected = selectBalanced(groups, P.seedsMax, P.perLane, dur)
    await save('candidates.json', { lanes: Object.fromEntries(lanes.map((l) => [l.lane, { seeds: l.seeds.length, diag: l.diag }])), seeds, groups: groups.map((g) => ({ ...g, seeds: g.seeds.map((s) => s.id) })), selected: selected.map((g) => g.id), budget: { seedsMax: P.seedsMax, perLane: P.perLane } })
    report('candidates', 1, `${seeds.length} Seeds aus 4 Lanes → ${groups.length} Gruppen, ${selected.length} ausgewählt`)

    // ---------------------------------------------------------------------------------------------------------------- S4–S6 mit MiniCPM-o (eine GPU-Phase)
    // ohne Tonspur keine Ton-Kanten (Pausen/Tonphrasen wären aus einer nicht vorhandenen Spur abgeleitet)
    const edges = buildEdges({ duration: dur, words: t.words, silences: hasAudio ? req.input.signals.silences : [], shots: req.input.cuts, actions: scan ? actionEdges(scan.times, frameDiffs(scan.frames), Math.max(20, Math.round(dur / 15))) : [], audioPhrases: hasAudio ? audioPhraseEdges(req.input.signals.loudness, series ? decodeSeries(series).music ?? null : null, series?.hop ?? 0.48) : [] })
    await save('cut_edges.json', { revision: V4_EDGE_REVISION, count: edges.length, byKind: edges.reduce<Record<string, number>>((m, e) => ({ ...m, [e.kind]: (m[e.kind] ?? 0) + 1 }), {}), edges })
    const relatedFor = (g: SeedGroup): Span[] => {
      // nächste Fenster im Embedding-Raum (für retrieve_related), mindestens 30 s entfernt
      const wi = xm.wins.findIndex((w) => g.anchor >= w.start && g.anchor < w.end)
      if (wi < 0) return []
      const d = xm.vectors.cols, base = wi * d
      return xm.wins.map((w, i) => { let c = 0; for (let k = 0; k < d; k++) c += xm.vectors.data[base + k] * xm.vectors.data[i * d + k]; return { w, c } }).filter((x) => Math.abs(x.w.start - g.anchor) > 30).sort((a, b) => b.c - a.c).slice(0, 3).map((x) => ({ start: x.w.start, end: x.w.end }))
    }
    const wordsIn = (sp: Span): string => t.words.map((w, i) => ({ w, i })).filter(({ w }) => w.start >= sp.start && w.end <= sp.end).map(({ w, i }) => `[w${i}] ${w.w}`).join(' ').slice(0, 1800)
    const toInvestigate = selected.slice(0, Math.min(selected.length, P.finalists + 4))
    const investigations: Array<{ group: SeedGroup; inv: InvestigationResult }> = []
    const variantsAll: Variant[] = []
    const rounds: JudgeRound[] = []
    const repairs: Array<{ variantId: string; round: number; failure: string; op: string; reason: string; from: string; to: string }> = []
    const finals: Array<{ fin: Finalist; rendered: Rendered; variant: Variant; round: JudgeRound; group: SeedGroup; inv: InvestigationResult }> = []
    const tmp = join(runDir, 'tmp')
    const resumed: string[] = []
    await stage('av-phase', () => withAv(req.runId, async (s) => {
      // S4 Nachuntersuchung
      for (let i = 0; i < toInvestigate.length; i++) {
        const g = toInvestigate[i]
        report('rate', 0.4 * (i / toInvestigate.length), `Nachuntersuchung ${i + 1}/${toInvestigate.length} (Bild+Ton) …`)
        // Checkpoint: gleiche Quelle, gleiche Seeds, gleiches Profil/Prompt/Modell → Ergebnis aus einem früheren (abgebrochenen) Lauf übernehmen
        const key = checkpointKey([src.sha256, g.seeds.map((x) => [x.lane, x.span, x.summary]), profileId, V4_PROMPT_REVISION.investigator, V4_ALGORITHM_REVISION, V3_AV_MODEL.revision])
        const cached = await loadCheckpoint<InvestigationResult>(project.hash, 'inv', key)
        if (cached) { investigations.push({ group: g, inv: { ...cached, stopReason: `${cached.stopReason} (aus Checkpoint ${key.slice(0, 8)})` } }); resumed.push(`inv:${g.id}`); continue }
        try { const inv = await investigateGroup(s, g, { video: project.sourcePath, hasAudio, duration: dur, tmpDir: tmp, profile: P, tracer, wordsIn, related: relatedFor(g), signal }); investigations.push({ group: g, inv }); if (!inv.stopReason.startsWith('Modellantwort ungültig') && inv.calls > 0) await saveCheckpoint(project.hash, 'inv', key, inv) /* nur erfolgreiche Untersuchungen: ein Fehler darf beim Fortsetzen nicht wiederkehren */ } catch (e) { if (signal?.aborted) throw e; fail(`investigate ${g.id}`, e) }
      }
      for (const { inv } of investigations) for (const e of inv.evidence) evidence.set(e.id, e)
      await save('event_graphs.json', investigations.map(({ group, inv }) => ({ groupId: group.id, lanes: group.lanes, calls: inv.calls, secondWindow: inv.secondWindow, stopReason: inv.stopReason, windows: inv.windowsInspected.map((w) => ({ id: w.id, span: w.span })), graph: inv.graph })))
      // Ereignisse ohne beobachtete Kernrolle oder mit Widerspruch werden nicht geschnitten (unknown statt Erfindung)
      const events = investigations.filter(({ inv }) => !inv.graph.contradiction && inv.graph.nodes.some((n) => n.state === 'observed' && n.role !== 'context' && n.role !== 'unknown'))
      // S5 Schnitte
      let ei = 0
      const finalistsPool: Array<{ group: SeedGroup; inv: InvestigationResult; variants: Variant[] }> = []
      for (const { group, inv } of events.slice(0, P.finalists)) {
        report('snap', 0.5 * (ei++ / Math.max(1, Math.min(events.length, P.finalists))), `Schnittkanten prüfen (${ei}) …`)
        try {
          const req0 = requiredSpan(inv.graph, { start: Math.max(0, group.anchor - 6), end: Math.min(dur, group.anchor + 6) })
          const reqSpan = req0.end - req0.start > maxSec - 4 ? { start: req0.start, end: req0.start + maxSec - 6 } : req0
          const ckey = checkpointKey([src.sha256, inv.graph, reqSpan, V4_EDGE_REVISION, edges.length, minSec, maxSec, P.cutCandidates, V4_PROMPT_REVISION.cutJudge, V3_AV_MODEL.revision])
          const prev = await loadCheckpoint<Awaited<ReturnType<typeof judgeCuts>>>(project.hash, 'cut', ckey)
          const { judged } = prev ?? await judgeCuts(s, inv.graph, reqSpan, edges, { video: project.sourcePath, hasAudio, duration: dur, minSec, maxSec, limit: P.cutCandidates, tmpDir: tmp, tracer, signal })
          if (prev) resumed.push(`cut:${group.id}`); else if (judged.some((x) => x.answer)) await saveCheckpoint(project.hash, 'cut', ckey, { judged, candidates: [] })
          const vs = makeVariants(inv.graph.id, judged)
          variantsAll.push(...vs)
          if (vs.length) finalistsPool.push({ group, inv, variants: vs })
        } catch (e) { if (signal?.aborted) throw e; fail(`cut ${group.id}`, e) }
      }
      await save('variants.json', variantsAll)
      // S6 Render + Endprüfung + Reparatur
      let fi = 0
      for (const f of finalistsPool) {
        report('compare', fi / Math.max(1, finalistsPool.length), `Clip rendern und prüfen (${fi + 1}/${finalistsPool.length}) …`)
        fi++
        let v = f.variants[0], cut: CutCandidate = v.cut, trims: Array<{ start: number; end: number }> = []
        let best: { rendered: Rendered; round: JudgeRound } | null = null
        for (let round = 0; round <= P.repairs; round++) {
          try {
            const clip = clipFor(`${req.runId}-${v.id}-r${round}`, cut, t, trims, { title: f.group.seeds[0]?.summary?.slice(0, 60) || 'Clip', runId: req.runId })
            const rendered = await renderVariant(meta, t, req.input.signals, req.input.cuts, clip, previewDir(runDir, v.id, round), signal)
            const jr = await judgeRendered(s, rendered, { variantId: v.id, summary: f.group.seeds.map((x) => x.summary).filter(Boolean)[0] ?? '', wav, hasAudio, edges, tracer, round, signal })
            rounds.push(jr)
            if (!best || (jr.judgement && (!best.round.judgement || rankOf(jr.judgement.decision) < rankOf(best.round.judgement.decision)))) best = { rendered, round: jr }
            if (!jr.judgement || jr.judgement.decision === 'acceptable' || round === P.repairs) break
            const failure = firstRepairable(jr.judgement.criteria)
            if (!failure) break
            const silences = (await measuredCriteria(rendered, wav, hasAudio, edges, signal)).silences
            const plan = planRepair(failure, cut, edges, rendered, silences, { minSec, maxSec })
            if (!plan) { repairs.push({ variantId: v.id, round, failure, op: 'stop', reason: 'keine begründete Änderung möglich', from: cut.id, to: cut.id }); break }
            repairs.push({ variantId: v.id, round, failure, op: plan.op, reason: plan.reason, from: cut.id, to: plan.cut.id })
            cut = plan.cut; trims = plan.trims
            v = { ...v, cut }
          } catch (e) { if (signal?.aborted) throw e; fail(`render ${v.id} r${round}`, e); break }
        }
        if (best?.round.judgement) {
          const j = best.round.judgement
          finals.push({ fin: { id: best.rendered.clip.id, span: { start: best.rendered.clip.start, end: best.rendered.clip.end }, decision: j.decision, passes: j.criteria.filter((c) => c.state === 'pass').length, eventId: f.inv.graph.id }, rendered: best.rendered, variant: v, round: best.round, group: f.group, inv: f.inv })
        }
      }
    }))
    await rm(tmp, { recursive: true, force: true }).catch(() => undefined)
    await save('verdicts.json', rounds)
    if (resumed.length) await save('resumed.json', { note: 'aus Stufen-Checkpoints übernommen (gleiche Quelle/Eingabe/Revision)', steps: resumed })
    await save('repairs.json', repairs)
    await save('evidence.json', [...evidence.values()])

    // ---------------------------------------------------------------------------------------------------------------- Auswahl
    const ranked = rankFinal(finals.map((x) => x.fin), wanted)
    const clips: ShortmeClip[] = ranked.map((fin, rank) => {
      const x = finals.find((y) => y.fin.id === fin.id)!
      const j = x.round.judgement!
      const st = (id: string): number => ({ pass: 5, unknown: 3, 'not-applicable': 3, fail: 1 }[j.criteria.find((c) => c.id === id)?.state ?? 'unknown'] ?? 3)
      const weak = j.criteria.filter((c) => c.state === 'fail' || c.state === 'unknown')
      return {
        ...x.rendered.clip,
        id: `${req.runId}-c${rank + 1}`, runId: req.runId, engine: 'engine4', source: 'v4',
        title: x.round.title || x.rendered.clip.title,
        score: Math.round((100 * fin.passes) / 10), criteria: { hook: st('hook'), payoff: st('payoff'), quotable: st('standalone'), standalone: st('standalone'), density: st('dead-air') },
        reason: `Geprüft am gerenderten Clip: ${j.decision} (${fin.passes}/10 Kriterien bestanden)`,
        v2: { eventId: x.inv.graph.id, variantId: x.variant.id, kind: (x.group.seeds[0]?.hint as never) ?? 'sonstiges', summary: x.round.title || x.group.seeds[0]?.summary || '', verification: j.decision === 'acceptable' ? 'verified' : 'needs-review', evidenceIds: [...new Set(x.inv.graph.nodes.flatMap((n) => n.evidenceIds))].slice(0, 40), modalities: [...new Set(x.group.lanes.map((l) => (l === 'speech' ? 'text' : l === 'cross-modal' ? 'visual' : l)))] as Array<'text' | 'audio' | 'visual'>, eventNote: `Engine 4 · Lanes ${x.group.lanes.join('+')} · ${x.inv.calls} Untersuchungen${x.inv.secondWindow ? ' (mit Folgefenster)' : ''} · Variante ${x.variant.style} · Ausgabe ${x.rendered.sha256.slice(0, 12)}`, uncertainty: weak.map((c) => `${c.id}: ${c.state} – ${c.reason}`).slice(0, 6) }
      } as ShortmeClip
    })
    await save('selection.json', { wanted, finalists: finals.map((x) => ({ id: x.fin.id, decision: x.fin.decision, passes: x.fin.passes, output: x.rendered.path, sha256: x.rendered.sha256 })), chosen: clips.map((c, i) => ({ clipId: c.id, fromFinalist: ranked[i].id, output: finals.find((y) => y.fin.id === ranked[i].id)!.rendered.path })) })
    await save('model_calls.json', tracer.calls)
    const totalSec = (Date.now() - T0) / 1000
    stageSec.total = Math.round(totalSec * 10) / 10
    const partial = errors.length > 0
    await finish(partial ? 'partial' : 'completed')
    return {
      clips, mode: 'v4',
      run: { status: partial ? 'incomplete' : 'done', modalities: { text: speech.seeds.length || sentences.length ? 'checked' : 'unavailable', audio: hasAudio ? 'checked' : 'unavailable', visual: 'checked' }, coverage: { text: decileReport.speech.filter(Boolean).length / 10, audio: decileReport.audio.filter(Boolean).length / 10, visual: decileReport.visual.filter(Boolean).length / 10 }, models: { ...V4_MODELS }, ...(partial ? { error: `${errors.length} Teilfehler (errors.json)` } : {}) }
    }
  } catch (e) {
    fail('run', e)
    await finish(signal?.aborted ? 'cancelled' : 'failed').catch(() => undefined)
    throw e
  } finally {
    // kein GPU-Prozess bleibt nach Ende/Abbruch geladen (MiniCPM-o hält sonst 18 GB, bis eine andere Stufe die GPU braucht)
    await vram.releaseAll().catch(() => undefined)
  }
}

const rankOf = (d: string): number => ({ acceptable: 0, 'needs-review': 1, reject: 2 }[d] ?? 3)
