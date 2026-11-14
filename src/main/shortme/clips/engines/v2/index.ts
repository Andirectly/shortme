// Neue Auswahl-Engine (multimodal): Quellen vorbereiten → Ereignisse suchen (Text, Ton, Bild, Chat) → Bild/Ton wirklich prüfen → bewerten → Schnitte planen
// und prüfen → global vergleichen → Titel/Untertitel-Schlüsselwörter. Jede Modellphase erwirbt ihre GPU-Ressource selbst (kein verschachteltes use()).
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { ShortmeClip } from '@shared/shortme'
import { defaultWanted } from '@shared/estimate'
import { withAudio, withLlm, withVision } from '../../../../engines'
import { projectFile } from '../../../project'
import { runFile } from '../state'
import { marksBySentence } from '../../audioEvents'
import { heatPeaks } from '../../heat'
import { chatJson, int, isObj, loadPrompt, str } from '../../llm'
import { proofreadWords, resolveTags } from '../../select'
import { splitSentences, type Sentence } from '../../sentences'
import type { SelectionOutcome, SelectionRequest } from '..'
import type { ModalityStatus } from '../../../../../shared/engine'
import { v2ClipId } from '../../../../../shared/engine'
import { V2_LIMITS, autoCutsOf, clusterProposals, outputDuration, pickDetailSet, type Evidence, type HighlightEvent, type Piece, type RawProposal } from '../../../../../shared/engineV2'
import { audioProposals, decodeSeries, ensureSeries } from './audioIndex'
import { compareAll, type CompareCand } from './compare'
import { evidenceLines, fuseEvent, qualityHistogram, QUALITY_LABEL, rateEvent, type Judged, type Quality } from './judge'
import { checkSeam, observeAudio, observeVision } from './observe'
import { baselineKeep, checkVariant, evidenceInKeep, keptText, planVariants, verifyKeep, type PlanContext, type Variant } from './plan'
import { v2MissingModels } from './models'
import { V2_MODELS, v2Revisions } from './revisions'
import { textSearch } from './search'
import { changeProposals, frameDiffs, keyframeScan, sweep } from './visualIndex'

type Mod = 'text' | 'audio' | 'visual' | 'chat'
interface Ev extends HighlightEvent { strength: Partial<Record<Mod, number>> }

const TIER: Record<Quality, number> = { aussergewoehnlich: 3, stark: 2, solide: 1, ungeprueft: 0.5, schwach: 0 }
const BASE_SCORE: Record<Quality, number> = { aussergewoehnlich: 92, stark: 80, solide: 65, ungeprueft: 50, schwach: 30 }
const SWEEP_MAX_FRAMES = 240

/** Zeitraum, der in `ranges` liegt (Vereinigung, in Sekunden). */
const covered = (ranges: Array<[number, number]>): number => { let t = 0, end = -1; for (const [a, b] of [...ranges].sort((x, y) => x[0] - y[0])) { const s = Math.max(a, end); if (b > s) { t += b - s; end = b } } return t }

export async function selectV2(req: SelectionRequest): Promise<SelectionOutcome> {
  const { input, project, signal } = req
  const dur = project.durationSec
  const hash = project.hash
  const T0 = Date.now()
  const missing = await v2MissingModels()
  if (missing.length) throw new Error(`Für die neue Engine fehlen Modelle: ${missing.map((m) => m.name).join(', ')}. Im Modell-Manager installieren.`)
  const minSec = req.options.minSec ?? V2_LIMITS.minClipSec, maxSec = req.options.maxSec ?? V2_LIMITS.maxClipSec
  const wanted = req.options.wanted ?? defaultWanted(dur)
  const query = req.options.query
  const wav = projectFile(hash, 'audio.wav')
  const report = (stage: string, f: number, msg: string): void => req.report(stage, Math.max(0, Math.min(1, f)), msg)
  const diag: Record<string, unknown> = { engine: 'multimodal-v2', revisions: v2Revisions(), durationSec: dur, wanted, minSec, maxSec, limits: V2_LIMITS, vramPeak: 'nicht gemessen', stageSec: {} as Record<string, number> }
  const stageSec = diag.stageSec as Record<string, number>
  const stage = async <T>(name: string, fn: () => Promise<T>): Promise<T> => { const t = Date.now(); try { return await fn() } finally { stageSec[name] = Math.round((Date.now() - t) / 100) / 10 } }
  const modalities: Partial<Record<Mod, ModalityStatus>> = {}
  const problems: string[] = []

  // Sätze samt Ton-Markierungen (Legacy-Ereignisse nur als Hinweis im Text)
  const sentences: Sentence[] = splitSentences(input.words)
  if (input.events?.length && sentences.length) for (const [i, m] of marksBySentence(sentences, input.events)) sentences[i].ev = m

  const evidence = new Map<string, Evidence>()
  const addEv = (list: Evidence[]): void => { for (const e of list) evidence.set(e.id, e) }
  const raw: RawProposal[] = []

  // ---------------------------------------------------------------------------------------------------------------------------------- 1. Quellen
  report('signals', 0, 'Quellen vorbereiten …')
  let seriesCached = false
  if (project.hasAudio) {
    const r = await stage('ton-index', () => ensureSeries(hash, wav, signal, (f) => report('signals', 0.05 + 0.4 * f, 'Ton-Klassen auswerten …')))
    seriesCached = r.cached
    if (r.series) { const p = audioProposals(decodeSeries(r.series), dur); raw.push(...p.proposals); addEv(p.evidence); modalities.audio = 'signal-only'; diag.audioSignals = p.proposals.length } else { modalities.audio = 'unavailable'; problems.push('YAMNet nicht installiert: keine Ton-Signale') }
  } else modalities.audio = 'unavailable'
  try {
    const scan = await stage('keyframes', () => keyframeScan(project.sourcePath, signal))
    const changes = changeProposals(scan.times, frameDiffs(scan.frames), dur)
    raw.push(...changes.proposals); addEv(changes.evidence)
    diag.keyframes = scan.times.length
  } catch (e) { if (signal?.aborted) throw e; problems.push(`Bildänderungen nicht auswertbar: ${e instanceof Error ? e.message.slice(0, 100) : e}`) }
  if (input.chat?.length || input.heat?.length) {
    modalities.chat = 'signal-only'
    let n = 0
    for (const [pts, src, note] of [[input.chat, 'chat', 'Chat-Aktivität, Zeitversatz möglich'], [input.heat, 'heat', 'Wiedergabekurve (grob, Minutenraster)']] as const) {
      for (const p of (pts ? heatPeaks(pts, 0.6) : []).slice(0, 12)) {
        const id = `ch${++n}`
        addEv([{ id, modality: 'chat', state: 'signal-only', source: src, start: p.start, end: p.end, observation: `${note}, Stärke ${p.value.toFixed(2)}`, uncertainty: note }])
        raw.push({ start: Math.max(0, p.start - 20), end: Math.min(dur, p.end + 12), anchor: (p.start + p.end) / 2, source: 'chat', summary: note, strength: p.value, evidenceIds: [id] })
      }
    }
  }
  report('signals', 1, 'Quellen bereit')

  // ---------------------------------------------------------------------------------------------------------------------------------- 2. Textsuche
  report('candidates', 0, 'Ereignisse im Text suchen …')
  const failedRanges: Array<[number, number]> = []
  if (sentences.length) {
    await stage('textsuche', () => withLlm(async (url) => {
      const r = await textSearch(url, sentences, { query, modelRev: v2Revisions().join('+'), signal, onProgress: (f) => report('candidates', f * 0.9, 'Ereignisse im Text suchen …') })
      raw.push(...r.proposals); addEv(r.evidence); failedRanges.push(...r.failedRanges)
      diag.textWindows = r.windows; diag.textWindowsFailed = r.failedWindows; diag.textProposals = r.proposals.length
    }))
    modalities.text = failedRanges.length ? 'failed' : 'checked'
    if (failedRanges.length) problems.push(`${failedRanges.length} Textfenster fehlgeschlagen`)
  } else { modalities.text = 'unavailable'; problems.push('kein Transkript-Text') }

  // ---------------------------------------------------------------------------------------------------------------------------------- 3. Bild-Rundgang, Ereignisse bilden, Bildprüfung
  const stream = req.contentType === 'stream'
  const sweepCov: Array<[number, number]> = []
  let picked: Ev[] = []
  let events: Ev[] = []
  const visionRan = new Set<string>()
  const needsVision = (e: Ev): boolean => stream || e.kind === 'gameplay' || e.foundBy.includes('visual')
  const needsAudio = (e: Ev): boolean => project.hasAudio && (stream || e.foundBy.includes('audio') || ['performance', 'witz', 'reaktion', 'konflikt'].includes(e.kind))
  report('rate', 0, 'Bild prüfen …')
  try {
    await stage('bild', () => withVision(async (url) => {
      const sw = await stage('bild-rundgang', () => sweep(project.sourcePath, url, dur, { maxFrames: SWEEP_MAX_FRAMES, signal, modelRev: V2_MODELS.vision, onProgress: (f) => report('rate', f * 0.15, 'Bild-Rundgang …') }))
      raw.push(...sw.proposals); addEv(sw.evidence)
      for (let i = 0; i < sw.sampled; i++) sweepCov.push([(i + 0.5) * sw.step - sw.step / 2, (i + 0.5) * sw.step + sw.step / 2])
      diag.sweep = { sampled: sw.sampled, failed: sw.failed, stepSec: Math.round(sw.step), calls: sw.calls, proposals: sw.proposals.length }
      modalities.visual = sw.failed === 0 ? 'checked' : sw.failed >= sw.sampled ? 'failed' : 'checked'
      if (sw.failed) problems.push(`Bild-Rundgang: ${sw.failed}/${sw.sampled} Bilder nicht geprüft`)
      // Ereignisse bilden und für die Detailprüfung auswählen (reine Logik)
      events = clusterProposals(raw, dur) as Ev[]
      events.forEach((e) => { e.requiredModalities = [] })
      const pick = pickDetailSet(events, dur, V2_LIMITS.detailMax, V2_LIMITS.reservePerSource)
      picked = pick.picked
      diag.events = { raw: raw.length, clustered: events.length, picked: picked.length, timeBinsCovered: `${pick.binsCovered}/${pick.bins}`, skipped: pick.skipped.length }
      let i = 0
      for (const ev of picked.filter(needsVision)) {
        report('rate', 0.15 + 0.5 * (i++ / Math.max(1, picked.filter(needsVision).length)), `Bild prüfen (${i}/${picked.filter(needsVision).length}) …`)
        const o = await observeVision(url, project.sourcePath, ev, `vo-${ev.id}`, V2_MODELS.vision, signal)
        addEv([o]); ev.evidenceIds.push(o.id); visionRan.add(ev.id)
      }
    }))
  } catch (e) {
    if (signal?.aborted) throw e
    modalities.visual = 'failed'; problems.push(`Bildmodell nicht nutzbar: ${e instanceof Error ? e.message.slice(0, 140) : e}`)
    if (!events.length) { events = clusterProposals(raw, dur) as Ev[]; events.forEach((x) => { x.requiredModalities = [] }); picked = pickDetailSet(events, dur, V2_LIMITS.detailMax, V2_LIMITS.reservePerSource).picked }
  }
  if (!picked.length) {
    diag.note = 'keine Ereignisse gefunden'
    await persist(hash, req.runId, { diag, evidence, events: [], variants: [], judgements: [] })
    return { clips: [], mode: 'v2', run: { status: problems.length ? 'incomplete' : 'done', modalities, coverage: { text: 1, audio: 0, visual: 0 }, models: { vision: V2_MODELS.vision, audio: V2_MODELS.audio } } }
  }

  // ---------------------------------------------------------------------------------------------------------------------------------- 4. Tonprüfung
  report('rate', 0.65, 'Ton prüfen …')
  const audioTargets = picked.filter(needsAudio)
  let audioOk = 0, audioFailed = 0
  if (audioTargets.length) {
    try {
      await stage('ton', () => withAudio(async (url) => {
        for (let i = 0; i < audioTargets.length; i++) {
          report('rate', 0.65 + 0.35 * (i / audioTargets.length), `Ton prüfen (${i + 1}/${audioTargets.length}) …`)
          const ev = audioTargets[i]
          const o = await observeAudio(url, wav, ev, `ao-${ev.id}`, V2_MODELS.audio, signal)
          addEv([o]); ev.evidenceIds.push(o.id)
          if (o.state === 'observed') audioOk++; else audioFailed++
        }
      }))
      modalities.audio = audioOk > 0 ? 'checked' : audioFailed ? 'failed' : modalities.audio
      if (audioFailed) problems.push(`Tonprüfung: ${audioFailed}/${audioTargets.length} Ereignisse nicht geprüft`)
    } catch (e) {
      if (signal?.aborted) throw e
      modalities.audio = 'failed'; problems.push(`Tonmodell nicht nutzbar: ${e instanceof Error ? e.message.slice(0, 140) : e}`)
    }
  }
  diag.audioObserved = { ok: audioOk, failed: audioFailed, targets: audioTargets.length }

  // ---------------------------------------------------------------------------------------------------------------------------------- 5. Fusion, Bewertung, Schnittplanung
  const ctx: PlanContext = { words: input.words, sentences, silences: input.signals.silences, cuts: input.cuts, durationSec: dur }
  const lim = { minSec, maxSec }
  const judged: Judged[] = []
  const variants = new Map<string, Variant[]>()
  const dropped: Array<{ eventId: string; reason: string }> = []
  const fusedById = new Map<string, Judged>()
  await stage('bewerten+planen', () => withLlm(async (url) => {
    for (let i = 0; i < picked.length; i++) {
      report('snap', 0.45 * (i / picked.length), `Ereignisse bewerten (${i + 1}/${picked.length}) …`)
      const fused = { ...(await fuseEvent(url, picked[i], evidence, sentences, signal)), strength: picked[i].strength } as Ev
      const j = await rateEvent(url, fused, evidence, sentences, req.contentType, signal)
      judged.push(j); fusedById.set(fused.id, j)
    }
    diag.qualityHistogram = qualityHistogram(judged)
    // Finalisten: gute Ereignisse zuerst, ungeprüfte nichtsprachliche nur als kleine Reserve (nie wegen „keiner Textnote“ verworfen)
    const ranked = judged.filter((j) => j.rating.quality !== 'schwach').sort((a, b) => TIER[b.rating.quality] - TIER[a.rating.quality] || Math.max(...Object.values((b.event as Ev).strength).map((v) => v ?? 0), 0) - Math.max(...Object.values((a.event as Ev).strength).map((v) => v ?? 0), 0))
    const unchecked = ranked.filter((j) => j.rating.quality === 'ungeprueft').slice(0, 4)
    const finalists = [...ranked.filter((j) => j.rating.quality !== 'ungeprueft').slice(0, V2_LIMITS.finalists - unchecked.length), ...unchecked]
    for (const j of judged) if (!finalists.includes(j)) dropped.push({ eventId: j.event.id, reason: j.rating.quality === 'schwach' ? 'Qualität schwach' : 'nicht unter den Finalisten (Budget)' })
    for (let i = 0; i < finalists.length; i++) {
      report('snap', 0.45 + 0.4 * (i / finalists.length), `Schnitte planen (${i + 1}/${finalists.length}) …`)
      const ev = finalists[i].event
      const perf = ev.evidenceIds.map((id) => evidence.get(id)?.performance).find((p) => !!p) ?? null
      // Gespräch (kein Stream): Aussagen und Geschichten brauchen Kontext → längere Mindestlänge als reine Pointen
      const evLim = req.contentType !== 'stream' && ev.kind !== 'performance' && ev.kind !== 'gameplay' ? { ...lim, minSec: Math.max(lim.minSec, ev.kind === 'witz' || ev.kind === 'reaktion' ? 22 : 28) } : lim
      const base = baselineKeep(ev, perf, ctx, evLim)
      const bad = checkVariant(base, dur, evLim)
      const list: Variant[] = []
      if (bad) { dropped.push({ eventId: ev.id, reason: `Grundvariante ungültig: ${bad}` }); continue }
      list.push({ eventId: ev.id, variantId: `${ev.id}-b`, keep: base, reason: 'zusammenhängender Ausschnitt', verification: 'needs-review', kind: 'baseline', notes: [] })
      try {
        const hints = ev.evidenceIds.map((id) => evidence.get(id)).filter((e): e is Evidence => !!e && e.state === 'observed' && e.modality !== 'text').map((e) => `${e.modality}: ${e.observation}`).join('\n')
        const pv = await planVariants(url, ev, base, ctx, evLim, hints, signal)
        pv.keeps.forEach((k, n) => list.push({ eventId: ev.id, variantId: `${ev.id}-c${n + 1}`, keep: k.keep, reason: k.reason, verification: 'needs-review', kind: 'cut', notes: [] }))
        if (pv.rejected.length) diag.rejectedVariants = [...((diag.rejectedVariants as string[] | undefined) ?? []), ...pv.rejected.map((r) => `${ev.id}: ${r}`)]
      } catch (e) { if (signal?.aborted) throw e; problems.push(`Schnittvarianten für ${ev.id} nicht erzeugt`) }
      variants.set(ev.id, list)
    }
  }))

  // Nähte am zusammengesetzten Ton prüfen; nicht bestätigte Kürzungen verwerfen (die zusammenhängende Variante bleibt)
  const cutVariants = [...variants.values()].flat().filter((v) => v.kind === 'cut')
  if (cutVariants.length) {
    const drop = (v: Variant, why: string): void => { variants.set(v.eventId, (variants.get(v.eventId) ?? []).filter((x) => x !== v)); dropped.push({ eventId: `${v.variantId}`, reason: why }) }
    if (!project.hasAudio) cutVariants.forEach((v) => drop(v, 'Kürzung ohne Ton nicht prüfbar'))
    else {
      try {
        await stage('nahtpruefung', () => withAudio(async (url) => {
          for (let i = 0; i < cutVariants.length; i++) {
            report('snap', 0.85 + 0.15 * (i / cutVariants.length), `Schnittnähte hören (${i + 1}/${cutVariants.length}) …`)
            const v = cutVariants[i]
            let ok = true
            for (let k = 1; k < v.keep.length && ok; k++) {
              const r = await checkSeam(url, wav, v.keep[k - 1].end, v.keep[k].start, signal)
              if (!r.confirmed) { ok = false; drop(v, `Naht ${k} nicht bestätigt: ${r.reason}`) }
            }
          }
        }))
      } catch (e) { if (signal?.aborted) throw e; cutVariants.forEach((v) => drop(v, 'Nahtprüfung nicht möglich')); problems.push('Nahtprüfung nicht möglich: Kürzungen verworfen') }
    }
  }

  // ---------------------------------------------------------------------------------------------------------------------------------- 6. Prüfung, Vergleich, Titel
  const chosen: Array<{ v: Variant; j: Judged; rank: number }> = []
  let compareInfo: Record<string, unknown> = {}
  let judgementsLog: unknown[] = []
  const clips: ShortmeClip[] = []
  await stage('pruefen+vergleichen', () => withLlm(async (url) => {
    // Prüfung am tatsächlich erhaltenen Material
    const all = [...variants.values()].flat()
    for (let i = 0; i < all.length; i++) {
      report('compare', 0.3 * (i / Math.max(1, all.length)), `Schnitte prüfen (${i + 1}/${all.length}) …`)
      const v = all[i]
      const j = fusedById.get(v.eventId)!
      try {
        const r = await verifyKeep(url, v.keep, evidence, j.event.evidenceIds, sentences, signal)
        v.verification = r.verification; v.notes = r.notes
      } catch (e) { if (signal?.aborted) throw e; v.verification = 'needs-review'; v.notes = ['Prüfung fehlgeschlagen'] }
      // Nur bestätigte Kürzungen bleiben; die Grundvariante darf „zu prüfen“ sein, aber nicht „gescheitert“
      if (v.verification === 'failed' || (v.kind === 'cut' && v.verification !== 'verified')) { variants.set(v.eventId, (variants.get(v.eventId) ?? []).filter((x) => x !== v)); dropped.push({ eventId: v.variantId, reason: `Prüfung: ${v.verification}${v.notes.length ? ` (${v.notes.join('; ')})` : ''}` }) }
    }
    // Kandidaten des Vergleichs: je Ereignis höchstens Grundvariante + eine bestätigte Kürzung
    const cands: Array<{ v: Variant; j: Judged }> = []
    for (const [eid, list] of variants) {
      const j = fusedById.get(eid)!
      const base = list.find((x) => x.kind === 'baseline'), cut = list.find((x) => x.kind === 'cut')
      for (const v of [base, cut]) if (v) cands.push({ v, j })
    }
    cands.sort((a, b) => TIER[b.j.rating.quality] - TIER[a.j.rating.quality])
    const cap = cands.slice(0, V2_LIMITS.finalists)
    const cmpCands: CompareCand[] = cap.map(({ v, j }) => ({ id: v.variantId, kind: j.event.kind, durationSec: outputDuration(v.keep), text: keptText(v.keep, sentences).slice(0, 1400) || '(keine Sprache)', evidence: evidenceLines(j.event.evidenceIds.filter((id) => { const e = evidence.get(id); return e && evidenceInKeep(e, v.keep) }), evidence).slice(0, 700) }))
    report('compare', 0.3, 'Vorschläge vergleichen …')
    const cmp = await compareAll(url, cmpCands, { matches: V2_LIMITS.matches, k: wanted, signal, onProgress: (f) => report('compare', 0.3 + 0.7 * f, 'Vorschläge vergleichen …') })
    compareInfo = { candidates: cmpCands.length, judgements: cmp.judgements.length, modelCalls: cmp.calls, failedCalls: cmp.failedCalls, connected: cmp.connected, ranked: cmp.strength !== null }
    judgementsLog = cmp.judgements.map((x) => ({ a: cmpCands[x.a].id, b: cmpCands[x.b].id, ab: x.ab, ba: x.ba, outcome: x.outcome, reason: x.reason }))
    if (!cmp.strength && cmpCands.length > 1) problems.push('Vergleich unvollständig: keine gemeinsame Rangordnung, Reihenfolge nach Ereignisqualität')
    // Auswahl: nach Vergleichsrang, ein Clip je Ereignis, keine zeitliche Überlappung, Gleichstände/„beide schwach“ nicht aufwerten
    const weak = (idx: number): boolean => { const mine = cmp.judgements.filter((x) => x.a === idx || x.b === idx); return mine.length >= 2 && mine.filter((x) => x.outcome === 'bothWeak').length >= mine.length / 2 }
    const takenEv = new Set<string>(), taken: Piece[] = []
    for (const idx of cmp.order) {
      if (chosen.length >= wanted) break
      const { v, j } = cap[idx]
      const a = v.keep[0].start, b = v.keep[v.keep.length - 1].end
      if (takenEv.has(v.eventId) || weak(idx) || taken.some((t) => a < t.end + 20 && b > t.start - 20)) continue
      takenEv.add(v.eventId); taken.push({ start: a, end: b }); chosen.push({ v, j, rank: chosen.length })
    }
    diag.selectedCount = chosen.length
    // Titel, Hook und Schlüsselwörter erst für die endgültigen Vorschläge
    for (let i = 0; i < chosen.length; i++) {
      report('proofread', i / chosen.length, `Titel und Untertitel (${i + 1}/${chosen.length}) …`)
      clips.push(await buildClip(url, chosen[i], req, sentences, evidence, signal))
    }
  }))

  // ---------------------------------------------------------------------------------------------------------------------------------- Abschluss
  const textCov = failedRanges.length ? Math.max(0, 1 - covered(failedRanges) / dur) : sentences.length ? 1 : 0
  const visCov = modalities.visual === 'failed' ? 0 : Math.min(1, covered(sweepCov) / dur)
  const audCov = modalities.audio === 'unavailable' ? 0 : seriesCached || modalities.audio !== 'failed' ? 1 : 0
  diag.coverage = { text: textCov, audio: audCov, visual: visCov }
  diag.notExamined = { visualSweepStepSec: (diag.sweep as { stepSec?: number } | undefined)?.stepSec ?? null, detailBudgetEvents: V2_LIMITS.detailMax, eventsWithoutDetail: Math.max(0, events.length - picked.length), note: 'Ereignisse außerhalb der Detailprüfung wurden nicht weiter bewertet' }
  diag.problems = problems; diag.compare = compareInfo; diag.dropped = dropped; diag.totalSec = Math.round((Date.now() - T0) / 1000)
  await persist(hash, req.runId, { diag, evidence, events: events.map((e) => ({ ...e })), variants: [...variants.values()].flat(), judgements: judgementsLog, ratings: judged.map((j) => ({ eventId: j.event.id, ...j.rating })) })
  const incomplete = problems.length > 0 || textCov < 0.95
  const run: NonNullable<SelectionOutcome['run']> = { status: incomplete ? 'incomplete' : 'done', modalities, coverage: { text: textCov, audio: audCov, visual: visCov }, models: { vision: V2_MODELS.vision, audio: V2_MODELS.audio, audioEvents: V2_MODELS.audioEvents } }
  if (incomplete) run.error = problems.slice(0, 3).join(' · ')
  return { clips, mode: 'v2', run }
}

async function persist(hash: string, runId: string, d: { diag: Record<string, unknown>; evidence: Map<string, Evidence>; events: unknown[]; variants: unknown[]; judgements: unknown[]; ratings?: unknown[] }): Promise<void> {
  const write = async (name: string, data: unknown): Promise<void> => { const p = runFile(hash, runId, name); await mkdir(dirname(p), { recursive: true }); await writeFile(p, JSON.stringify(data, null, 1)) }
  await write('diagnostics.json', d.diag); await write('evidence.json', [...d.evidence.values()]); await write('events.json', d.events); await write('variants.json', d.variants); await write('comparisons.json', d.judgements); if (d.ratings) await write('ratings.json', d.ratings)
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// Clip bauen

const FIN_SCHEMA = { type: 'object', additionalProperties: false, required: ['title', 'hook_text', 'tags'], properties: { title: { type: 'string' }, hook_text: { type: 'string' }, tags: { type: 'array', maxItems: 8, items: { type: 'object', additionalProperties: false, required: ['sentence', 'word', 'kind'], properties: { sentence: { type: 'integer' }, word: { type: 'string' }, kind: { type: 'string', enum: ['emphasis', 'entity', 'hook'] } } } } } }

async function buildClip(url: string, c: { v: Variant; j: Judged; rank: number }, req: SelectionRequest, sentences: Sentence[], evidence: Map<string, Evidence>, signal?: AbortSignal): Promise<ShortmeClip> {
  const { v, j } = c
  const words = req.input.words
  const keep = v.keep
  const start = keep[0].start, end = keep[keep.length - 1].end
  const inKeep = (w: { start: number; end: number }): boolean => keep.some((p) => w.start >= p.start - 0.06 && w.end <= p.end + 0.06)
  const kept: number[] = []
  words.forEach((w, i) => { if (inKeep(w)) kept.push(i) })
  const wordless = kept.length === 0
  const fw = wordless ? Math.max(0, words.findIndex((w) => w.start >= end)) : kept[0]
  const firstWord = wordless ? (fw < 0 ? words.length : fw) : fw
  const lastWord = wordless ? firstWord - 1 : kept[kept.length - 1]
  const keptSentences = sentences.filter((s) => keep.some((p) => s.start >= p.start - 0.3 && s.end <= p.end + 0.3))
  const ev = j.event
  const keptEv = ev.evidenceIds.map((id) => evidence.get(id)).filter((e): e is Evidence => !!e && evidenceInKeep(e, keep))
  const text = keptSentences.length ? keptSentences.map((s) => `S${s.index}: ${s.text}`).join('\n') : `(keine Sprache) ${evidenceLines(keptEv.map((e) => e.id), evidence)}`
  let title = ev.summary.slice(0, 70) || 'Moment', hook = title
  let tags: ShortmeClip['tags'] = []
  try {
    const prompt = await loadPrompt('v2/finalize', { kind: ev.kind, summary: ev.summary, text })
    const f = await chatJson<{ title: string; hook: string; tags: Array<{ sentence: number; word: string; kind: 'emphasis' | 'entity' | 'hook' }> }>(url, prompt, {
      schema: FIN_SCHEMA, maxTokens: 500, temperature: 0.3, signal,
      validate: (x) => {
        if (!isObj(x) || !Array.isArray(x.tags)) throw new Error('tags fehlt')
        const tg = x.tags.flatMap((t) => (isObj(t) && ['emphasis', 'entity', 'hook'].includes(t.kind as string) && typeof t.word === 'string' ? [{ sentence: int(t.sentence, 0, 1e9, 'sentence'), word: t.word, kind: t.kind as 'emphasis' | 'entity' | 'hook' }] : []))
        return { title: str(x.title, 90, 'title'), hook: str(x.hook_text, 90, 'hook_text'), tags: tg }
      }
    })
    title = f.title; hook = f.hook
    if (keptSentences.length) tags = resolveTags(f.tags, sentences, words, keptSentences[0].index, keptSentences[keptSentences.length - 1].index).filter((t) => kept.includes(t.word))
  } catch (e) { if (signal?.aborted) throw e }
  // Untertitel-Korrektur nur für erhaltene Wörter (wie in der bisherigen Engine als Vorbelegung)
  let corrections: Record<number, string> | undefined
  if (kept.length) {
    const local = await proofreadWords(url, kept.map((i) => words[i].w), signal)
    const abs: Record<number, string> = {}
    for (const [k, val] of Object.entries(local)) abs[kept[Number(k)]] = val
    if (Object.keys(abs).length) corrections = abs
  }
  const observed = [...new Set(keptEv.filter((e) => e.state === 'observed').map((e) => e.modality))]
  const modalities = [...new Set([...(kept.length ? (['text'] as const) : []), ...observed])]
  const uncertainty = [...j.rating.uncertain, ...v.notes, ...keptEv.filter((e) => e.uncertainty).map((e) => `${e.modality}: ${e.uncertainty}`)].slice(0, 6)
  const cuts = autoCutsOf(keep)
  return {
    id: v2ClipId(req.runId, c.rank + 1), start, end, firstWord, lastWord, score: BASE_SCORE[j.rating.quality] - c.rank * 0.01,
    criteria: { hook: 0, payoff: 0, quotable: 0, standalone: 0, density: 0 }, title, hookText: hook, reason: j.rating.reasons || ev.summary, tags,
    source: 'v2', engine: 'multimodal-v2', runId: req.runId, snap: ['v2'], extended: 0, ...(wordless ? { wordless: true } : {}), ...(cuts.length ? { autoCuts: cuts } : {}), ...(corrections ? { corrections } : {}),
    v2: { eventId: ev.id, variantId: v.variantId, kind: ev.kind, summary: ev.summary, verification: v.verification, evidenceIds: keptEv.map((e) => e.id), modalities, eventNote: `Ereignisqualität: ${QUALITY_LABEL[j.rating.quality]}`, uncertainty }
  } satisfies ShortmeClip
}

