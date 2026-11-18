// Engine 4 – Schnitte nach dem jevcut-Prinzip (Design, kein Code/Dienst übernommen): Kanten aus Messungen, Kandidaten nur aus Kanten, ein lokaler Judge
// (MiniCPM-o mit Bild+Ton des Kandidatenbereichs) wählt Start-/End-Kanten-IDs aus einer endlichen Liste. Keine Sekunden vom Modell.
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { AvSession } from '../v3/avWorker'
import { enumerateEdges, latticeCandidates, validateCutJudge, type CutCandidate, type CutEdge, type CutJudgeAnswer, type EdgeInput, type EventGraph, type Span, parseModelJson } from './core'
import { avParts, cutAvMulti } from './media'
import type { Tracer } from './trace'
import { V4_PROMPT_REVISION } from './revisions'

/** Pegeltäler (lokale Minima ≤ 0,3 des Rasters) und Ränder der YAMNet-Musikabschnitte als Tonphrasen-Kanten. */
export function audioPhraseEdges(loudness: number[], music: Uint8Array | null, hop: number): number[] {
  const out: number[] = []
  for (let i = 1; i < loudness.length - 1; i++) if (loudness[i] <= 0.3 && loudness[i] < loudness[i - 1] && loudness[i] <= loudness[i + 1]) out.push(i + 0.5)
  if (music) { let on = false; for (let k = 0; k < music.length; k++) { const m = music[k] > 140; if (m !== on) { out.push(k * hop); on = m } } }
  return out
}

/** Aktionswechsel: stärkste Bildänderungen der Keyframes (Zeitpunkt des späteren Bildes). */
export function actionEdges(times: number[], diffs: number[], max: number): number[] {
  return diffs.map((d, i) => ({ d, t: times[i + 1] })).filter((x) => Number.isFinite(x.t)).sort((a, b) => b.d - a.d).slice(0, max).map((x) => x.t).sort((a, b) => a - b)
}

export function buildEdges(x: EdgeInput): CutEdge[] { return enumerateEdges(x) }

/** Quellzeit → Sekunde im zusammengesetzten Ausschnitt (Teile hintereinander); null = liegt in keinem gezeigten Teil. */
export function compositeTime(t: number, parts: Span[]): number | null {
  let off = 0
  for (const p of parts) { if (t >= p.start - 0.01 && t <= p.end + 0.01) return off + Math.min(Math.max(t, p.start), p.end) - p.start; off += p.end - p.start }
  return null
}

export function cutPrompt(g: EventGraph, parts: Span[], starts: CutEdge[], ends: CutEdge[], segs: Array<{ id: string; span: Span }>): string {
  const rel = (t: number): string => { const c = compositeTime(t, parts); return c === null ? '–' : c.toFixed(1).replace('.', ',') }
  return [
    'Du bist ein lokaler Schnitt-Prüfer. Du siehst UND hörst einen Ausschnitt aus einem langen Video; daraus soll ein eigenständig verständlicher kurzer Clip werden.',
    parts.length > 1 ? `Der Ausschnitt besteht aus ${parts.length} Teilen hintereinander (Anfang, Mitte, Ende des Kandidaten; dazwischen ist ausgelassen).` : 'Der Ausschnitt ist durchgehend.',
    `Beobachtete Rollen im Ereignis: ${g.nodes.map((n) => `${n.role} (${rel(n.span.start)}–${rel(n.span.end)} s: ${n.description})`).join('; ') || 'keine sicher beobachtet'}.`,
    `Mögliche START-Kanten (Sekunde im Ausschnitt): ${starts.map((e) => `${e.id} @${rel(e.t)} s (${e.kind})`).join(', ')}.`,
    `Mögliche END-Kanten: ${ends.map((e) => `${e.id} @${rel(e.t)} s (${e.kind})`).join(', ')}.`,
    `Belegstellen (5-s-Stücke): ${segs.map((s) => `${s.id}=${rel(s.span.start)}–${rel(s.span.end)} s`).join(', ')}. Als Beleg dürfen auch die genannten Kanten-IDs stehen.`,
    'Wähle die beste START- und END-Kante NUR aus diesen Listen. Prüfe: versteht man den Anfang ohne Vorwissen (Personen/Pronomen/Bezug)? Ist die Pointe/Reaktion enthalten? Endet es natürlich (kein abgeschnittenes Wort, kein abgeschnittener Takt)?',
    'Erfinde keine Kanten, Sekunden oder Belegstellen. Je Kriterium höchstens 3 Belegstellen, Begründung höchstens 12 Wörter. Wenn keine Kombination taugt, setze preferred=false.',
    'Antworte NUR als JSON: {"startEdgeId":"...","endEdgeId":"...","preferred":true,"reasonCode":"kurz","criteria":[{"id":"standalone","state":"pass|fail|unknown","reason":"kurz","evidenceIds":["..."]},{"id":"payoff",...},{"id":"natural-end",...},{"id":"hook",...}]}'
  ].join('\n')
}

const firstJson = parseModelJson

export interface JudgedCut { cand: CutCandidate; answer: CutJudgeAnswer | null; chosen: CutCandidate | null; error?: string; tracePath: string }

/** Kandidaten eines Ereignisses am echten Ausschnitt prüfen lassen (je Kandidat ein Aufruf, höchstens `limit`). */
export async function judgeCuts(s: AvSession, g: EventGraph, required: Span, edges: CutEdge[], o: { video: string; hasAudio: boolean; duration: number; minSec: number; maxSec: number; limit: number; tmpDir: string; tracer: Tracer; signal?: AbortSignal }): Promise<{ candidates: CutCandidate[]; judged: JudgedCut[] }> {
  const candidates = latticeCandidates(edges, required, o.duration, { minSec: o.minSec, maxSec: o.maxSec, limit: o.limit })
  await mkdir(o.tmpDir, { recursive: true })
  const byId = new Map(edges.map((e) => [e.id, e]))
  const judged: JudgedCut[] = []
  for (const c of candidates) {
    o.signal?.throwIfAborted()
    const s0 = byId.get(c.startEdgeId)!, e0 = byId.get(c.endEdgeId)!
    // Alternativen rund um die Kandidatengrenzen (je 2 davor/danach), damit der Judge zwischen echten Kanten wählen kann
    const near = (t: number, pred: (e: CutEdge) => boolean): CutEdge[] => edges.filter((e) => pred(e) && Math.abs(e.t - t) <= 7).sort((a, b) => Math.abs(a.t - t) - Math.abs(b.t - t)).slice(0, 5).sort((a, b) => a.t - b.t)
    const starts = near(s0.t, (e) => e.t <= required.start + 0.01 && e.kind !== 'source-boundary' || e.id === s0.id)
    const ends = near(e0.t, (e) => e.t >= required.end - 0.01 && (e.kind !== 'source-boundary' || e.t >= o.duration - 0.1) || e.id === e0.id)
    if (!starts.some((e) => e.id === s0.id)) starts.push(s0)
    if (!ends.some((e) => e.id === e0.id)) ends.push(e0)
    const preview = { start: Math.min(...starts.map((e) => e.t)), end: Math.min(o.duration, Math.max(...ends.map((e) => e.t)) + 0.5) }
    // höchstens 40 s Bild+Ton je Aufruf: lange Kandidaten als Anfang + Mitte + Ende
    const parts = avParts(preview)
    const segs: Array<{ id: string; span: Span }> = []
    let k = 1
    for (const p of parts) for (let t = p.start; t < p.end - 0.2; t += 5) segs.push({ id: `P${k++}`, span: { start: t, end: Math.min(p.end, t + 5) } })
    const known = new Set([...segs.map((x) => x.id), ...g.nodes.flatMap((n) => n.evidenceIds), ...starts.flatMap((e) => [e.id, ...e.evidenceIds]), ...ends.flatMap((e) => [e.id, ...e.evidenceIds])])
    const file = join(o.tmpDir, `cut-${c.id}.mp4`)
    const prompt = cutPrompt(g, parts, starts, ends, segs)
    const t1 = Date.now()
    let raw = '', ans: CutJudgeAnswer | null = null, err = ''
    try {
      await cutAvMulti(o.video, parts, file, o.hasAudio, o.signal)
      for (let attempt = 0; attempt < 2 && !ans; attempt++) {
        const r = await s.worker.request<{ text: string }>('analyze_av', { path: file, prompt: attempt ? `${prompt}\nDeine letzte Antwort war ungültig (${err}). Nur gültige IDs, nur JSON.` : prompt, maxNewTokens: 520, temperature: attempt ? 0.4 : 0 }, { runId: s.runId, timeoutMs: 240_000, signal: o.signal })
        raw = r.text
        try { ans = validateCutJudge(firstJson(raw), starts.map((e) => e.id), ends.map((e) => e.id), known) } catch (e) { err = String(e instanceof Error ? e.message : e).slice(0, 140) }
      }
    } catch (e) { if (o.signal?.aborted) throw e; err = String(e instanceof Error ? e.message : e).slice(0, 200) } finally { await rm(file, { force: true }).catch(() => undefined) }
    const call = await o.tracer.record({ role: 'local_cut_judge', modelRevision: `${s.modelId}@${s.revision}`, promptRevision: V4_PROMPT_REVISION.cutJudge, realInputModalities: o.hasAudio ? ['video', 'audio'] : ['video'], actualMediaWindowIds: [`${g.id}:${c.id}`], windowId: `${g.id}:${c.id}`, success: !!ans, validatedOutput: !!ans, wallClockMs: Date.now() - t1, status: ans ? `${ans.startEdgeId}→${ans.endEdgeId} preferred=${ans.preferred}` : `ungültig: ${err}`, input: { preview, parts, startEdges: starts.map((e) => e.id), endEdges: ends.map((e) => e.id), candidate: c }, rawOutput: raw, output: ans, ...(ans ? {} : { error: err }) })
    const chosen = ans ? { id: `${ans.startEdgeId}__${ans.endEdgeId}`, startEdgeId: ans.startEdgeId, endEdgeId: ans.endEdgeId, span: { start: byId.get(ans.startEdgeId)!.t, end: byId.get(ans.endEdgeId)!.t }, prefilter: c.prefilter } : null
    // gewählte Kombination muss die Längengrenzen und den Pflichtbereich einhalten, sonst gilt der ursprüngliche Kandidat
    const valid = chosen && chosen.span.end - chosen.span.start >= o.minSec && chosen.span.end - chosen.span.start <= o.maxSec && chosen.span.end > chosen.span.start ? chosen : null
    judged.push({ cand: c, answer: ans, chosen: valid, ...(ans ? {} : { error: err }), tracePath: call.tracePath })
  }
  return { candidates, judged }
}

export interface Variant { id: string; eventId: string; style: 'context-safe' | 'hook-first' | 'natural-payoff' | 'judge-choice'; cut: CutCandidate; fromJudge: boolean; criteria: CutJudgeAnswer['criteria'] }

/** 2–3 Varianten mit unterschiedlichen echten Grenzen: Judge-Wahl, frühester Start (Kontext), spätester Start (Hook), spätestes Ende (Pointe). */
export function makeVariants(eventId: string, judged: JudgedCut[]): Variant[] {
  // ohne gültige Judge-Antwort bleibt der Gitter-Kandidat (ungeprüft) im Pool; das Endurteil fällt ohnehin am gerenderten Clip
  const pool: Array<{ cut: CutCandidate; ans: CutJudgeAnswer | null }> = judged.flatMap((j) => (j.chosen ? [{ cut: j.chosen, ans: j.answer }] : j.answer ? [] : [{ cut: j.cand, ans: null }]))
  const good = pool.filter((p) => !p.ans || (p.ans.preferred && !p.ans.criteria.some((c) => (c.id === 'standalone' || c.id === 'payoff') && c.state === 'fail')))
  const src = good.length ? good : []
  const out: Variant[] = []
  const add = (style: Variant['style'], p: (typeof src)[number] | undefined): void => {
    if (!p || out.some((v) => v.cut.startEdgeId === p.cut.startEdgeId && v.cut.endEdgeId === p.cut.endEdgeId)) return
    out.push({ id: `${eventId}-v${out.length + 1}`, eventId, style, cut: p.cut, fromJudge: !!p.ans, criteria: p.ans?.criteria ?? [] })
  }
  const passes = (p: (typeof src)[number]): number => p.ans?.criteria.filter((c) => c.state === 'pass').length ?? 0
  add('judge-choice', [...src].sort((a, b) => passes(b) - passes(a))[0])
  add('context-safe', [...src].sort((a, b) => a.cut.span.start - b.cut.span.start)[0])
  add('hook-first', [...src].sort((a, b) => b.cut.span.start - a.cut.span.start)[0])
  add('natural-payoff', [...src].sort((a, b) => b.cut.span.end - a.cut.span.end)[0])
  return out.slice(0, 3)
}
