// Engine 4 – echte Ausgabe und Endprüfung: Variante → 9:16-Clip mit Bild, Ton und Untertiteln über den vorhandenen Exporter (gleicher Code wie der Export),
// Prüfung AM GERENDERTEN CLIP (MiniCPM-o sieht und hört die Datei, dazu Messungen an der Datei), danach höchstens 2 begründete Reparaturen mit erneutem Rendern.
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { ShortmeClip } from '../../../../../shared/shortme'
import type { Transcript } from '../../../transcription'
import type { ProjectMeta } from '../../../project'
import type { Signals } from '../../signals'
import { exportClip, planExport } from '../../../render/exporter'
import { layoutForClip } from '../../../layout/run'
import { seamQuiet } from '../v2/observe'
import type { AvSession } from '../v3/avWorker'
import { V3_AV_MODEL } from '../v3/revisions'
import { chooseRepair, firstRepairable, validateFinal, type Criterion, type CutCandidate, type CutEdge, type FinalJudgement, parseModelJson } from './core'
import { avParts, cutAvMulti, probeOutput, silencesIn } from './media'
import type { Tracer } from './trace'
import { V4_PROMPT_REVISION } from './revisions'

export interface Rendered { path: string; sha256: string; durationSeconds: number; streams: Array<'video' | 'audio'>; clip: ShortmeClip; trims: Array<{ start: number; end: number }>; pieces: number; faceRatio: number | null; emptyShots: number; layoutOk: boolean; captionWords: number }

/** Quellbereich → ShortmeClip (Wortbereich aus dem Transkript, keine erfundenen Wörter; ohne Wörter: wordless). */
export function clipFor(id: string, cut: CutCandidate, t: Transcript, trims: Array<{ start: number; end: number }>, base: Partial<ShortmeClip>): ShortmeClip {
  const idx = t.words.map((w, i) => ({ w, i })).filter(({ w }) => w.start >= cut.span.start - 0.05 && w.end <= cut.span.end + 0.05)
  const first = idx[0]?.i ?? 0, last = idx.length ? idx[idx.length - 1].i : first - 1
  return {
    id, start: cut.span.start, end: cut.span.end, firstWord: first, lastWord: last, score: 0, criteria: { hook: 3, payoff: 3, quotable: 3, standalone: 3, density: 3 }, title: base.title ?? 'Clip', hookText: '', reason: '', tags: [],
    source: 'v4', engine: 'engine4', snap: ['v4-edges'], extended: 0, ...(idx.length ? {} : { wordless: true }), ...base, ...(trims.length ? { autoCuts: trims } : {})
  } as ShortmeClip
}

export async function renderVariant(meta: ProjectMeta, t: Transcript, signals: Signals, shotCuts: number[], clip: ShortmeClip, outDir: string, signal?: AbortSignal): Promise<Rendered> {
  let faceRatio: number | null = null, emptyShots = 0, layoutOk = false
  try {
    const lay = await layoutForClip(meta, clip, shotCuts, signal)
    clip.shots = lay.shots; faceRatio = lay.faceRatio; emptyShots = lay.shots.filter((s) => s.auto === 'empty').length; layoutOk = true
  } catch (e) { if (signal?.aborted) throw e }
  await rm(outDir, { recursive: true, force: true }).catch(() => undefined)
  await mkdir(outDir, { recursive: true })
  const extra = (clip.autoCuts ?? []).map((c) => [c.start, c.end] as [number, number])
  const res = await exportClip(meta, clip, t, signals, { outDir, engine: 'ass', captions: true, removePauses: false, hook: false, extraCuts: extra, quality: 'standard', signal })
  const pr = await probeOutput(res.path, signal)
  return { path: res.path, sha256: pr.sha256, durationSeconds: pr.durationSeconds, streams: pr.streams, clip, trims: clip.autoCuts ?? [], pieces: planExport(clip, t, signals, false, extra).map.keeps.length, faceRatio, emptyShots, layoutOk, captionWords: res.wordsOut.length }
}

export function finalPrompt(d: number, segs: string[], summary: string, parts: Array<{ start: number; end: number }>): string {
  return [
    `Du siehst UND hörst einen fertig geschnittenen, ${Math.round(d)} Sekunden langen Kurzclip (9:16, mit eingebrannten Untertiteln). Das ist die tatsächliche Ausgabedatei.`,
    parts.length > 1 ? `Du bekommst daraus ${parts.length} Teile hintereinander: ${parts.map((p) => `Clipsekunde ${Math.round(p.start)}–${Math.round(p.end)}`).join(', ')} (dazwischen ausgelassen).` : 'Du bekommst den ganzen Clip.',
    `Belegstellen: ${segs.join(', ')} (je 5 s ab Clipbeginn). Worum es gehen soll (kann falsch sein): ${summary || 'auffälliger Moment'}.`,
    'Bewerte NUR diese Datei, nicht ein längeres Video:',
    'hook = die ersten Sekunden machen klar, warum man weiterschauen soll; standalone = verständlich ohne Vorwissen (wer, was, Bezüge); payoff = die Pointe/Reaktion/das Ergebnis ist enthalten;',
    'natural-end = endet natürlich (kein abgeschnittenes Wort, Takt oder Satz); essential-event = das eigentliche Ereignis ist zu sehen/hören.',
    'Zustand je Kriterium: pass, fail oder unknown. Nenne für pass/fail höchstens 3 Belegstellen (nicht alle). Begründung höchstens 12 Wörter. Erfinde nichts.',
    'Antworte NUR als JSON: {"criteria":[{"id":"hook","state":"...","reason":"kurz","evidenceIds":["O1"]},{"id":"standalone",...},{"id":"payoff",...},{"id":"natural-end",...},{"id":"essential-event",...}],"title":"kurzer deutscher Titel"}'
  ].join('\n')
}

const firstJson = parseModelJson

/** Gemessene Kriterien an der Ausgabedatei (keine Modellmeinung): Stille, Nähte, Untertitel-Zeitachse, Bildausschnitt. */
export async function measuredCriteria(r: Rendered, wav: string, hasAudio: boolean, edges: CutEdge[], signal?: AbortSignal): Promise<{ criteria: Criterion[]; evidence: Array<{ id: string; observation: string }>; silences: Array<[number, number]> }> {
  const ev: Array<{ id: string; observation: string }> = []
  const crit: Criterion[] = []
  const sil = hasAudio && r.streams.includes('audio') ? (await silencesIn(r.path, signal)).filter(([a, b]) => a > 0.3 && b < r.durationSeconds - 0.3) : []
  if (!r.streams.includes('audio')) crit.push({ id: 'dead-air', state: 'unknown', reason: 'Ausgabe ohne Tonspur – Pausen nicht messbar', evidenceIds: [] })
  else if (sil.length) { sil.forEach(([a, b], i) => ev.push({ id: `m-sil-${i + 1}`, observation: `Stille ${a.toFixed(1)}–${b.toFixed(1)} s im Clip` })); crit.push({ id: 'dead-air', state: 'fail', reason: `${sil.length} Stille(n) ≥ 1,2 s mitten im Clip`, evidenceIds: sil.map((_, i) => `m-sil-${i + 1}`) }) }
  else { ev.push({ id: 'm-sil-0', observation: 'silencedetect −40 dB/1,2 s: keine Stille im Inneren' }); crit.push({ id: 'dead-air', state: 'pass', reason: 'keine längere Stille im Clip (gemessen)', evidenceIds: ['m-sil-0'] }) }
  // Nähte: nur bei mehreren Stücken
  const seams = r.trims.flatMap((c) => [c.start, c.end])
  if (!hasAudio || !r.streams.includes('audio')) crit.push({ id: 'audio-seam', state: 'not-applicable', reason: 'keine Tonspur in der Ausgabe (ffprobe)', evidenceIds: [] })
  else if (!seams.length) { ev.push({ id: 'm-pieces', observation: `${r.pieces} Stück, keine Tonnaht` }); crit.push({ id: 'audio-seam', state: 'pass', reason: 'ein durchgehendes Stück, keine Naht', evidenceIds: ['m-pieces'] }) }
  else {
    const q = await Promise.all(seams.map((t) => seamQuiet(wav, t, signal)))
    q.forEach((ok, i) => ev.push({ id: `m-seam-${i + 1}`, observation: `Naht bei Quelle ${seams[i].toFixed(2)} s: ${ok ? 'in einer Pause' : 'mitten im Signal'}` }))
    crit.push({ id: 'audio-seam', state: q.every(Boolean) ? 'pass' : 'fail', reason: q.every(Boolean) ? 'alle Nähte liegen in Pausen (Pegelmessung)' : 'Naht mitten im Signal', evidenceIds: q.map((_, i) => `m-seam-${i + 1}`) })
  }
  if (!seams.length) { if (!ev.some((e) => e.id === 'm-pieces')) ev.push({ id: 'm-pieces', observation: `${r.pieces} Stück, keine Naht` }); crit.push({ id: 'visual-seam', state: 'pass', reason: 'ein durchgehendes Stück', evidenceIds: ['m-pieces'] }) }
  else {
    const atEdge = seams.every((t) => edges.some((e) => Math.abs(e.t - t) < 0.35 && ['shot', 'pause', 'sentence'].includes(e.kind)))
    crit.push({ id: 'visual-seam', state: atEdge ? 'pass' : 'unknown', reason: atEdge ? 'Nähte auf gemessenen Kanten' : 'Naht nicht auf einer Bild-/Sprechkante', evidenceIds: seams.map((_, i) => `m-seam-${i + 1}`) })
  }
  if (r.captionWords > 0) { ev.push({ id: 'm-cap', observation: `${r.captionWords} Untertitelwörter über dieselbe TimeMap wie der Export` }); crit.push({ id: 'caption-sync', state: 'pass', reason: 'Wortzeiten über die TimeMap des Exports abgebildet', evidenceIds: ['m-cap'] }) }
  else crit.push({ id: 'caption-sync', state: 'not-applicable', reason: 'keine Wörter im Clip, keine Untertitel gerendert', evidenceIds: [] })
  if (!r.layoutOk) crit.push({ id: 'crop-safety', state: 'unknown', reason: 'Bildausschnitt nicht berechnet', evidenceIds: [] })
  else { ev.push({ id: 'm-crop', observation: `Gesichtsquote ${(r.faceRatio ?? 0).toFixed(2)}, ${r.emptyShots} Einstellungen ohne Person` }); crit.push({ id: 'crop-safety', state: r.emptyShots ? 'fail' : 'pass', reason: r.emptyShots ? 'Einstellung ohne Person im Ausschnitt' : 'Ausschnitt enthält das Motiv (Layout-Plan)', evidenceIds: ['m-crop'] }) }
  return { criteria: crit, evidence: ev, silences: sil }
}

export interface JudgeRound { round: number; variantId: string; rendered: Omit<Rendered, 'clip'>; judgement: FinalJudgement | null; modelCriteria: Criterion[]; title?: string; error?: string; tracePath: string }

export async function judgeRendered(s: AvSession, r: Rendered, o: { variantId: string; summary: string; wav: string; hasAudio: boolean; edges: CutEdge[]; tracer: Tracer; round: number; signal?: AbortSignal }): Promise<JudgeRound> {
  const m = await measuredCriteria(r, o.wav, o.hasAudio, o.edges, o.signal)
  const parts = avParts({ start: 0, end: r.durationSeconds })
  const segs = Array.from({ length: Math.max(1, Math.ceil(r.durationSeconds / 5)) }, (_, i) => `O${i + 1}`).filter((_, i) => parts.some((p) => i * 5 < p.end && (i + 1) * 5 > p.start))
  const prompt = finalPrompt(r.durationSeconds, segs, o.summary, parts)
  // Eingabe für das Modell: die Ausgabedatei selbst (≤ 40 s) bzw. Anfang/Mitte/Ende genau dieser Datei
  const input = parts.length > 1 ? r.path.replace(/\.mp4$/i, '.judge-input.mp4') : r.path
  if (parts.length > 1) await cutAvMulti(r.path, parts, input, r.streams.includes('audio'), o.signal)
  const t1 = Date.now()
  let raw = '', modelCrit: Criterion[] = [], title: string | undefined, err = ''
  const known = new Set([...segs, ...m.evidence.map((e) => e.id)])
  for (let attempt = 0; attempt < 2 && !modelCrit.length; attempt++) {
    try {
      const res = await s.worker.request<{ text: string }>('analyze_av', { path: input, prompt: attempt ? `${prompt}\nDeine letzte Antwort war ungültig (${err}).` : prompt, maxNewTokens: 600, temperature: attempt ? 0.4 : 0 }, { runId: s.runId, timeoutMs: 300_000, signal: o.signal })
      raw = res.text
      const j = firstJson(raw) as { criteria?: unknown[]; title?: unknown }
      const want = ['hook', 'standalone', 'payoff', 'natural-end', 'essential-event']
      const got = (j.criteria ?? []).map((c) => c as Record<string, unknown>).filter((c) => want.includes(String(c.id)))
      if (new Set(got.map((c) => c.id)).size !== 5) throw new Error('nicht alle 5 Inhaltskriterien')
      modelCrit = got.map((c) => {
        const st = ['pass', 'fail', 'unknown'].includes(String(c.state)) ? (c.state as Criterion['state']) : 'unknown'
        const ids = Array.isArray(c.evidenceIds) ? (c.evidenceIds as unknown[]).filter((x): x is string => typeof x === 'string' && known.has(x)) : []
        return { id: String(c.id), state: st === 'pass' && !ids.length ? 'unknown' : st, reason: typeof c.reason === 'string' && c.reason.trim() ? c.reason.slice(0, 300) : 'ohne Begründung', evidenceIds: ids }
      })
      title = typeof j.title === 'string' ? j.title.replace(/\s+/g, ' ').trim().slice(0, 80) : undefined
    } catch (e) { if (o.signal?.aborted) throw e; err = String(e instanceof Error ? e.message : e).slice(0, 160) }
  }
  let judgement: FinalJudgement | null = null
  if (modelCrit.length) {
    try { judgement = validateFinal({ criteria: [...modelCrit, ...m.criteria] }, { variantId: o.variantId, outputSha256: r.sha256, hasAudio: r.streams.includes('audio'), hasCaptions: r.captionWords > 0, known }) } catch (e) { err = String(e instanceof Error ? e.message : e) }
  }
  const call = await o.tracer.record({ role: 'rendered_output_judge', modelRevision: `${V3_AV_MODEL.id}@${V3_AV_MODEL.revision}`, promptRevision: V4_PROMPT_REVISION.finalJudge, realInputModalities: r.streams.includes('audio') ? ['video', 'audio'] : ['video'], actualMediaWindowIds: [o.variantId], windowId: `${o.variantId}#r${o.round}`, inputArtifactSha256: r.sha256, success: !!judgement, validatedOutput: !!judgement, wallClockMs: Date.now() - t1, status: judgement ? judgement.decision : `ungültig: ${err}`, input: { output: r.path, sha256: r.sha256, durationSeconds: r.durationSeconds, streams: r.streams, modelInput: input, modelInputParts: parts, measured: m.evidence }, rawOutput: raw, output: judgement, ...(judgement ? {} : { error: err }) })
  const { clip: _c, ...rest } = r
  void _c
  return { round: o.round, variantId: o.variantId, rendered: rest, judgement, modelCriteria: modelCrit, title, ...(judgement ? {} : { error: err }), tracePath: call.tracePath }
}

/** Reparaturplan für einen Fehler: neue Kanten (Kontext/Pointe) oder Stille herausschneiden. null = keine begründete Änderung möglich. */
export function planRepair(failure: string, cut: CutCandidate, edges: CutEdge[], r: Rendered, silences: Array<[number, number]>, lim: { minSec: number; maxSec: number }): { op: 'move-start-edge' | 'move-end-edge' | 'trim-gap'; cut: CutCandidate; trims: Array<{ start: number; end: number }>; reason: string } | null {
  if (failure === 'dead-air') {
    // Ausgabezeit → Quellzeit über die Stücke (ohne frühere Schnitte: Quelle = Start + t)
    let off = 0
    const keeps: Array<{ src0: number; src1: number; out0: number }> = []
    let cur = cut.span.start
    for (const c of [...r.trims].sort((a, b) => a.start - b.start)) { keeps.push({ src0: cur, src1: c.start, out0: off }); off += c.start - cur; cur = c.end }
    keeps.push({ src0: cur, src1: cut.span.end, out0: off })
    const toSrc = (t: number): number => { const k = keeps.find((x) => t >= x.out0 && t <= x.out0 + (x.src1 - x.src0)) ?? keeps[keeps.length - 1]; return k.src0 + (t - k.out0) }
    const add = silences.map(([a, b]) => ({ start: toSrc(a) + 0.25, end: toSrc(b) - 0.25 })).filter((x) => x.end - x.start > 0.5)
    return add.length ? { op: 'trim-gap', cut, trims: [...r.trims, ...add].sort((a, b) => a.start - b.start), reason: `${add.length} Stille(n) herausgeschnitten` } : null
  }
  const nx = chooseRepair(cut, edges, failure, lim)
  if (!nx) return null
  return { op: nx.span.start < cut.span.start ? 'move-start-edge' : 'move-end-edge', cut: nx, trims: r.trims.filter((x) => x.start > nx.span.start && x.end < nx.span.end), reason: `${failure}: ${nx.span.start < cut.span.start ? `Start auf frühere Kante ${nx.startEdgeId}` : `Ende auf spätere Kante ${nx.endEdgeId}`}` }
}

export { firstRepairable }
export const previewDir = (runDir: string, variantId: string, round: number): string => join(runDir, 'previews', `${variantId}-r${round}`)
