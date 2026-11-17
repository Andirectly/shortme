// Engine 4 – reine, testbare Logik (keine Modelle, keine Dateien). Portiert als Design aus docs/implementation/shortme-engine-v4/reference_core/algorithms.py
// (Seed-Fusion, lane-balancierte Auswahl, Schnittgitter aus gemessenen Kanten, eine Reparatur je Runde) und jevcut-Prinzip (Grenzen nur als Kanten-IDs).
// Zeiten sind Quellsekunden (aus Quell-PTS × Timebase der Probe, siehe probe.ts); jede Grenze, die nach außen geht, ist eine Kanten-ID.

export type Lane = 'speech' | 'audio' | 'visual' | 'cross-modal'
export const LANES: Lane[] = ['speech', 'audio', 'visual', 'cross-modal']
export interface Span { start: number; end: number }

export function validSpan(s: Span, duration: number): boolean {
  return Number.isFinite(s.start) && Number.isFinite(s.end) && s.start >= 0 && s.end > s.start && s.end <= duration + 0.05
}
const overlap = (a: Span, b: Span): number => Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start))
export const overlapRatio = (a: Span, b: Span): number => { const m = Math.min(a.end - a.start, b.end - b.start); return m > 0 ? overlap(a, b) / m : 0 }
export const iou = (a: Span, b: Span): number => { const i = overlap(a, b); const u = a.end - a.start + (b.end - b.start) - i; return u > 0 ? i / u : 0 }

// ------------------------------------------------------------------------------------------------------------------------------- Seeds und Fusion

export interface Seed { id: string; lane: Lane; laneRank: number; anchor: number; span: Span; evidenceIds: string[]; hint: string; summary: string; laneScore: number | null }
export interface SeedGroup { id: string; seeds: Seed[]; lanes: Lane[]; rrf: number; anchor: number; span: Span }

/** Gleiches Ereignis nur bei geteiltem Beleg oder sehr nahem Anker + starker Überlappung – keine pauschale 60/90-s-Sperre, keine Transitiv-Kette. */
function sameEvent(a: Seed, b: Seed): boolean {
  if (a.evidenceIds.some((e) => b.evidenceIds.includes(e))) return true
  return Math.abs(a.anchor - b.anchor) <= 4 && overlapRatio(a.span, b.span) >= 0.55
}

/** Reciprocal-Rank-Fusion je Gruppe: je Lane zählt nur ihr bester Rang (viele Treffer einer Lane verdrängen keine andere Modalität). */
export function fuseSeeds(seeds: Seed[], k = 60): SeedGroup[] {
  if (!(k > 0) || !Number.isFinite(k)) throw new Error('k muss positiv sein')
  if (new Set(seeds.map((s) => s.id)).size !== seeds.length) throw new Error('Seed-IDs müssen eindeutig sein')
  const ordered = [...seeds].sort((a, b) => a.anchor - b.anchor || a.lane.localeCompare(b.lane) || a.id.localeCompare(b.id))
  const groups: Seed[][] = []
  for (const s of ordered) {
    const hits = groups.map((g, i) => (g.some((o) => sameEvent(s, o)) ? i : -1)).filter((i) => i >= 0)
    if (hits.length === 1) groups[hits[0]].push(s) // mehrdeutig (2+ Gruppen) → eigene Gruppe statt Zusammenkleben
    else groups.push([s])
  }
  return groups.map((g, i) => {
    const best = new Map<Lane, number>()
    for (const s of g) best.set(s.lane, Math.min(best.get(s.lane) ?? 1e9, s.laneRank))
    const span = { start: Math.min(...g.map((s) => s.span.start)), end: Math.max(...g.map((s) => s.span.end)) }
    return { id: `g${i + 1}`, seeds: g, lanes: [...best.keys()].sort(), rrf: [...best.values()].reduce((n, r) => n + 1 / (k + r), 0), anchor: g.reduce((n, s) => n + s.anchor, 0) / g.length, span }
  }).sort((a, b) => b.rrf - a.rrf || a.anchor - b.anchor)
}

/**
 * Auswahl mit reservierten Lane-Budgets und Zeit-Vielfalt: zuerst je Lane die besten `perLane` Gruppen, dann je Zeit-Zehntel mindestens eine (falls vorhanden),
 * dann nach RRF auffüllen. So kann eine Lane ohne Text (Audio/Visual) nicht von einer starken Sprach-Lane verdrängt werden.
 */
export function selectBalanced(groups: SeedGroup[], limit: number, perLane: number, duration: number): SeedGroup[] {
  if (limit <= 0 || !groups.length) return []
  const picks: SeedGroup[] = []
  const add = (g: SeedGroup | undefined): void => { if (g && !picks.includes(g) && picks.length < limit) picks.push(g) }
  for (const lane of LANES) groups.filter((g) => g.lanes.includes(lane)).slice(0, perLane).forEach(add)
  for (let d = 0; d < 10; d++) add(groups.find((g) => !picks.includes(g) && g.anchor >= (d * duration) / 10 && g.anchor < ((d + 1) * duration) / 10))
  groups.forEach(add)
  return picks.slice(0, limit)
}

// ------------------------------------------------------------------------------------------------------------------------------- Abdeckung

export interface CoverageWindow { lane: 'speech' | 'audio' | 'visual' | 'cross-modal'; startSeconds: number; endSeconds: number; status: 'inspected' | 'partial' | 'failed' | 'skipped'; reason?: string; source: string }

/** Erreicht die geprüfte Abdeckung jedes Zehntel der Quelle? (gleiche Regel wie tools/v4_gate.py) */
export function decilesCovered(windows: CoverageWindow[], duration: number): boolean[] {
  return Array.from({ length: 10 }, (_, i) => {
    const lo = (i * duration) / 10, hi = ((i + 1) * duration) / 10
    return windows.some((w) => w.status === 'inspected' && w.startSeconds < hi && w.endSeconds > lo && w.endSeconds <= duration + 0.01 && w.startSeconds >= 0)
  })
}

// ------------------------------------------------------------------------------------------------------------------------------- Schnittkanten

export type EdgeKind = 'sentence' | 'pause' | 'speaker' | 'shot' | 'audio-phrase' | 'action' | 'reaction' | 'source-boundary' | 'manual'
export interface CutEdge { id: string; t: number; kind: EdgeKind; isMeasured: boolean; evidenceIds: string[] }

export interface EdgeInput {
  duration: number
  words: Array<{ w: string; start: number; end: number }>
  silences: Array<[number, number]>
  shots: number[]
  actions: number[]
  audioPhrases: number[]
}

/**
 * Alle gemessenen Kanten der Quelle: Satzenden (Wortende mit Satzzeichen), Sprechpausen (Mitte der Stille ≥ 0,3 s), Kamerawechsel, Aktionswechsel
 * (Bildänderungs-Spitzen), Tonphrasen (Pegeltäler/Klassenwechsel) und die Quellgrenzen. Gleiche Zeit (±0,05 s) und Art → eine Kante.
 */
export function enumerateEdges(x: EdgeInput): CutEdge[] {
  const raw: Array<Omit<CutEdge, 'id'>> = [
    { t: 0, kind: 'source-boundary', isMeasured: true, evidenceIds: ['src-start'] },
    { t: x.duration, kind: 'source-boundary', isMeasured: true, evidenceIds: ['src-end'] }
  ]
  x.words.forEach((w, i) => { if (/[.!?…]["»”)]?$/.test(w.w.trim())) raw.push({ t: w.end, kind: 'sentence', isMeasured: true, evidenceIds: [`word-${i}`] }) })
  x.silences.forEach(([a, b], i) => { if (b - a >= 0.3) raw.push({ t: (a + b) / 2, kind: 'pause', isMeasured: true, evidenceIds: [`sil-${i}`] }) })
  x.shots.forEach((t, i) => raw.push({ t, kind: 'shot', isMeasured: true, evidenceIds: [`shot-${i}`] }))
  x.actions.forEach((t, i) => raw.push({ t, kind: 'action', isMeasured: true, evidenceIds: [`act-${i}`] }))
  x.audioPhrases.forEach((t, i) => raw.push({ t, kind: 'audio-phrase', isMeasured: true, evidenceIds: [`aph-${i}`] }))
  const kept: Array<Omit<CutEdge, 'id'>> = []
  for (const e of raw.filter((e) => Number.isFinite(e.t) && e.t >= 0 && e.t <= x.duration).sort((a, b) => a.t - b.t || a.kind.localeCompare(b.kind))) {
    const d = kept.find((k) => k.kind === e.kind && Math.abs(k.t - e.t) < 0.05)
    if (d) d.evidenceIds.push(...e.evidenceIds)
    else kept.push({ ...e, evidenceIds: [...e.evidenceIds] })
  }
  return kept.map((e, i) => ({ ...e, t: Math.round(e.t * 1000) / 1000, id: `E${i + 1}` }))
}

export interface CutCandidate { id: string; startEdgeId: string; endEdgeId: string; span: Span; prefilter: number }
const GOOD_START: EdgeKind[] = ['sentence', 'pause', 'shot', 'speaker', 'audio-phrase', 'source-boundary']
const GOOD_END: EdgeKind[] = ['sentence', 'pause', 'shot', 'audio-phrase', 'action', 'reaction', 'source-boundary']

/** Schnittgitter: nur Kandidaten aus vorhandenen Kanten, die den nötigen Bereich (beobachtete Ereignisrollen) vollständig enthalten. */
export function latticeCandidates(edges: CutEdge[], required: Span, duration: number, o: { minSec: number; maxSec: number; limit: number }): CutCandidate[] {
  if (!validSpan(required, duration)) throw new Error('Pflichtbereich außerhalb der Quelle')
  if (new Set(edges.map((e) => e.id)).size !== edges.length) throw new Error('doppelte Kanten-IDs')
  const starts = edges.filter((e) => e.t <= required.start + 0.01 && GOOD_START.includes(e.kind)).sort((a, b) => required.start - a.t - (required.start - b.t)).slice(0, 24)
  const ends = edges.filter((e) => e.t >= required.end - 0.01 && GOOD_END.includes(e.kind)).sort((a, b) => a.t - required.end - (b.t - required.end)).slice(0, 24)
  const out: CutCandidate[] = []
  for (const s of starts) for (const e of ends) {
    const d = e.t - s.t
    if (d < o.minSec || d > o.maxSec) continue
    const extra = required.start - s.t + (e.t - required.end)
    const bonus = (['sentence', 'pause'].includes(s.kind) ? 0.3 : 0.15) + (['sentence', 'pause', 'audio-phrase'].includes(e.kind) ? 0.3 : 0.15)
    out.push({ id: `${s.id}__${e.id}`, startEdgeId: s.id, endEdgeId: e.id, span: { start: s.t, end: e.t }, prefilter: Math.round((bonus - 0.012 * extra - (s.isMeasured && e.isMeasured ? 0 : 1)) * 1e4) / 1e4 })
  }
  out.sort((a, b) => b.prefilter - a.prefilter || a.span.end - a.span.start - (b.span.end - b.span.start) || a.id.localeCompare(b.id))
  // Vielfalt: unterschiedliche Starts/Enden bevorzugen (Hook-first vs. Context-safe)
  const picked: CutCandidate[] = []
  for (const c of out) { if (picked.length >= o.limit) break; if (!picked.some((p) => p.startEdgeId === c.startEdgeId && p.endEdgeId === c.endEdgeId)) picked.push(c) }
  return picked
}

/** Eine begründete Reparatur je Runde: Start auf frühere gemessene Kante (Kontext), Ende auf spätere (Pointe/Reaktion). Andere Gründe → eigener Weg. */
export function chooseRepair(current: CutCandidate, edges: CutEdge[], failure: string, o: { minSec: number; maxSec: number }): CutCandidate | null {
  const byId = new Map(edges.map((e) => [e.id, e]))
  const s = byId.get(current.startEdgeId), e = byId.get(current.endEdgeId)
  if (!s || !e) return null
  const mk = (a: CutEdge, b: CutEdge): CutCandidate | null => (b.t - a.t >= o.minSec && b.t - a.t <= o.maxSec ? { id: `${a.id}__${b.id}`, startEdgeId: a.id, endEdgeId: b.id, span: { start: a.t, end: b.t }, prefilter: current.prefilter } : null)
  if (['standalone', 'hook-context', 'missing_context', 'starts_mid_sentence', 'missing_referent'].includes(failure)) {
    for (const a of edges.filter((x) => x.t < s.t - 0.5 && GOOD_START.includes(x.kind)).sort((x, y) => y.t - x.t)) { const c = mk(a, e); if (c) return c }
  }
  if (['payoff', 'natural-end', 'essential-event', 'payoff_cut', 'reaction_cut', 'ending_unnatural'].includes(failure)) {
    for (const b of edges.filter((x) => x.t > e.t + 0.5 && GOOD_END.includes(x.kind)).sort((x, y) => x.t - y.t)) { const c = mk(s, b); if (c) return c }
  }
  return null
}

// ------------------------------------------------------------------------------------------------------------------------------- Modellantworten prüfen

export const FINAL_CRITERIA = ['hook', 'standalone', 'payoff', 'natural-end', 'audio-seam', 'visual-seam', 'essential-event', 'caption-sync', 'crop-safety', 'dead-air'] as const
export type FinalCriterion = (typeof FINAL_CRITERIA)[number]
export type CritState = 'pass' | 'fail' | 'unknown' | 'not-applicable'
export interface Criterion { id: string; state: CritState; reason: string; evidenceIds: string[] }

export interface CutJudgeAnswer { startEdgeId: string; endEdgeId: string; preferred: boolean; reasonCode: string; criteria: Criterion[] }
/** cut_judge.schema.json + Zusatzregeln: IDs müssen aus der erlaubten Liste stammen, Zustand pass|fail|unknown, Belege vorhanden. */
export function validateCutJudge(x: unknown, allowedStart: string[], allowedEnd: string[], knownEvidence: Set<string>): CutJudgeAnswer {
  const o = x as Record<string, unknown>
  if (!o || typeof o !== 'object' || Array.isArray(o)) throw new Error('keine Objekt-Antwort')
  const extra = Object.keys(o).filter((k) => !['startEdgeId', 'endEdgeId', 'preferred', 'criteria', 'reasonCode'].includes(k))
  if (extra.length) throw new Error(`unerlaubte Felder: ${extra.join(',')}`)
  if (typeof o.startEdgeId !== 'string' || !allowedStart.includes(o.startEdgeId)) throw new Error(`startEdgeId nicht erlaubt: ${String(o.startEdgeId)}`)
  if (typeof o.endEdgeId !== 'string' || !allowedEnd.includes(o.endEdgeId)) throw new Error(`endEdgeId nicht erlaubt: ${String(o.endEdgeId)}`)
  if (typeof o.preferred !== 'boolean') throw new Error('preferred fehlt')
  if (typeof o.reasonCode !== 'string' || !o.reasonCode) throw new Error('reasonCode fehlt')
  if (!Array.isArray(o.criteria) || !o.criteria.length) throw new Error('criteria fehlt')
  const criteria = o.criteria.map((c) => checkCrit(c, ['pass', 'fail', 'unknown'], knownEvidence))
  return { startEdgeId: o.startEdgeId, endEdgeId: o.endEdgeId, preferred: o.preferred, reasonCode: o.reasonCode.slice(0, 80), criteria }
}

function checkCrit(c: unknown, states: CritState[], known: Set<string>): Criterion {
  const k = c as Record<string, unknown>
  if (!k || typeof k.id !== 'string' || !states.includes(k.state as CritState) || typeof k.reason !== 'string' || !k.reason.trim() || !Array.isArray(k.evidenceIds)) throw new Error('Kriterium ungültig')
  const ev = (k.evidenceIds as unknown[]).filter((e): e is string => typeof e === 'string')
  const bad = ev.filter((e) => !known.has(e))
  if (bad.length) throw new Error(`erfundene Beleg-ID: ${bad[0]}`)
  // „bestanden“ ohne Beleg ist nicht beobachtet
  if (k.state === 'pass' && !ev.length) throw new Error(`Kriterium ${k.id} „pass“ ohne Beleg`)
  return { id: k.id, state: k.state as CritState, reason: k.reason.slice(0, 300), evidenceIds: ev }
}

export interface FinalJudgement { variantId: string; outputSha256: string; evaluatedRenderedOutput: true; criteria: Criterion[]; decision: 'acceptable' | 'needs-review' | 'reject' }

/**
 * final_judge.schema.json + Produktregeln: genau die 10 Kriterien je einmal; `not-applicable` nur, wenn der Stream laut ffprobe wirklich fehlt (Ton) bzw.
 * keine Untertitel existieren; die Entscheidung wird AUS den Kriterien abgeleitet (Modellvorschlag wird ignoriert).
 */
export function validateFinal(x: unknown, o: { variantId: string; outputSha256: string; hasAudio: boolean; hasCaptions: boolean; known: Set<string> }): FinalJudgement {
  const r = x as Record<string, unknown>
  if (!r || !Array.isArray(r.criteria)) throw new Error('criteria fehlt')
  const crit = (r.criteria as unknown[]).map((c) => checkCrit(c, ['pass', 'fail', 'unknown', 'not-applicable'], o.known))
  const ids = crit.map((c) => c.id)
  if (crit.length !== 10 || new Set(ids).size !== 10 || !FINAL_CRITERIA.every((id) => ids.includes(id))) throw new Error('genau die 10 Kriterien je einmal erwartet')
  for (const c of crit) {
    if (c.state !== 'not-applicable') continue
    if (c.id === 'audio-seam' && o.hasAudio) throw new Error('audio-seam not-applicable, obwohl die Ausgabe Ton hat')
    if (c.id === 'caption-sync' && o.hasCaptions) throw new Error('caption-sync not-applicable, obwohl Untertitel gerendert wurden')
    if (!['audio-seam', 'caption-sync', 'visual-seam'].includes(c.id)) throw new Error(`${c.id} darf nicht not-applicable sein`)
  }
  return { variantId: o.variantId, outputSha256: o.outputSha256, evaluatedRenderedOutput: true, criteria: crit, decision: decide(crit) }
}

/** Entscheidungsregel: Kern (standalone, payoff, essential-event) fail → reject; jede andere fail/unknown im Kern → needs-review; sonst acceptable. */
export function decide(crit: Criterion[]): FinalJudgement['decision'] {
  const st = (id: string): CritState | undefined => crit.find((c) => c.id === id)?.state
  if (['standalone', 'payoff', 'essential-event'].some((id) => st(id) === 'fail')) return 'reject'
  const core = ['hook', 'standalone', 'payoff', 'natural-end', 'essential-event']
  if (core.some((id) => st(id) !== 'pass')) return 'needs-review'
  if (crit.some((c) => c.state === 'fail')) return 'needs-review'
  return 'acceptable'
}

/** Erster behebbarer Fehler in fester Reihenfolge (eine Änderung je Runde). */
export function firstRepairable(crit: Criterion[]): string | null {
  for (const id of ['standalone', 'payoff', 'natural-end', 'essential-event', 'dead-air']) if (crit.find((c) => c.id === id)?.state === 'fail') return id
  return null
}

// ------------------------------------------------------------------------------------------------------------------------------- Investigator und Ereignisgraph

export type EventRole = 'setup' | 'trigger' | 'action' | 'reaction' | 'payoff' | 'context' | 'unknown'
export const ROLES: EventRole[] = ['setup', 'trigger', 'action', 'reaction', 'payoff', 'context', 'unknown']
export const INVESTIGATOR_OPS = ['inspect_av', 'inspect_audio', 'expand_before', 'expand_after', 'retrieve_related', 'stop'] as const
export type InvestigatorOp = (typeof INVESTIGATOR_OPS)[number]
export interface InvObservation { role: EventRole; segmentIds: string[]; state: 'observed' | 'inferred' | 'unknown'; description: string }
export interface InvAnswer { observations: InvObservation[]; next: { op: InvestigatorOp; reason: string }; confidence: 'low' | 'medium' | 'high' | 'unavailable'; contradiction: boolean }

/** Investigator-Antwort prüfen: Rollen aus der Liste, Segment-IDs aus dem gezeigten Fenster (keine freien Zeiten), Operation aus der erlaubten Liste. */
export function validateInvestigator(x: unknown, segmentIds: string[]): InvAnswer {
  const o = x as Record<string, unknown>
  if (!o || !Array.isArray(o.observations)) throw new Error('observations fehlt')
  const obs = (o.observations as Array<Record<string, unknown>>).slice(0, 12).map((b) => {
    const role = ROLES.includes(b.role as EventRole) ? (b.role as EventRole) : 'unknown'
    const seg = Array.isArray(b.segmentIds) ? (b.segmentIds as unknown[]).filter((s): s is string => typeof s === 'string') : []
    const bad = seg.filter((s) => !segmentIds.includes(s))
    if (bad.length) throw new Error(`erfundene Segment-ID: ${bad[0]}`)
    let state = (['observed', 'inferred', 'unknown'] as const).includes(b.state as 'observed') ? (b.state as InvObservation['state']) : 'unknown'
    if (state === 'observed' && !seg.length) state = 'unknown' // „beobachtet“ ohne Fundstelle zählt nicht
    return { role, segmentIds: seg, state, description: typeof b.description === 'string' ? b.description.replace(/\s+/g, ' ').trim().slice(0, 240) : '' }
  })
  const n = (o.nextAction ?? o.next) as Record<string, unknown> | undefined
  const op = n && INVESTIGATOR_OPS.includes(n.op as InvestigatorOp) ? (n.op as InvestigatorOp) : 'stop'
  const conf = (['low', 'medium', 'high', 'unavailable'] as const).includes(o.confidence as 'low') ? (o.confidence as InvAnswer['confidence']) : 'unavailable'
  return { observations: obs, next: { op, reason: typeof n?.reason === 'string' ? n.reason.slice(0, 160) : '' }, confidence: conf, contradiction: o.contradiction === true }
}

export interface GraphNode { id: string; role: EventRole; span: Span; state: 'observed' | 'inferred' | 'unknown'; evidenceIds: string[]; description: string }
export interface EventGraph { id: string; seedIds: string[]; nodes: GraphNode[]; relations: Array<{ from: string; to: string; kind: 'precedes' | 'caused'; state: 'observed' | 'inferred'; evidenceIds: string[] }>; contradiction: boolean; unknownRoles: EventRole[] }

const ORDER: EventRole[] = ['setup', 'trigger', 'action', 'reaction', 'payoff']
/** Knoten nur aus Beobachtungen mit Fundstelle; Reihenfolge-Kanten nur zwischen zeitlich geordneten Rollen; „caused“ wird nie erfunden (nur inferred, nie observed). */
export function buildGraph(id: string, seedIds: string[], nodes: GraphNode[], contradiction: boolean): EventGraph {
  const ok = nodes.filter((n) => n.state !== 'unknown' && n.evidenceIds.length && n.span.end > n.span.start)
  const relations: EventGraph['relations'] = []
  const byRole = (r: EventRole): GraphNode[] => ok.filter((n) => n.role === r).sort((a, b) => a.span.start - b.span.start)
  for (let i = 0; i < ORDER.length - 1; i++) {
    const a = byRole(ORDER[i])[0]
    const b = ORDER.slice(i + 1).map((r) => byRole(r)[0]).find(Boolean)
    if (a && b && a.span.start <= b.span.start) relations.push({ from: a.id, to: b.id, kind: 'precedes', state: 'observed', evidenceIds: [...a.evidenceIds, ...b.evidenceIds] })
  }
  const trig = byRole('trigger')[0], react = byRole('reaction')[0]
  if (trig && react && trig.span.start <= react.span.start) relations.push({ from: trig.id, to: react.id, kind: 'caused', state: 'inferred', evidenceIds: [...trig.evidenceIds, ...react.evidenceIds] })
  return { id, seedIds, nodes: ok, relations, contradiction, unknownRoles: ORDER.filter((r) => !byRole(r).length) }
}

/** Bereich, den ein Schnitt mindestens enthalten muss: alle beobachteten Kernrollen; ohne solche der Seed-Bereich. */
export function requiredSpan(g: EventGraph, fallback: Span): Span {
  const core = g.nodes.filter((n) => n.state === 'observed' && ORDER.includes(n.role))
  if (!core.length) return fallback
  return { start: Math.min(...core.map((n) => n.span.start)), end: Math.max(...core.map((n) => n.span.end)) }
}

// ------------------------------------------------------------------------------------------------------------------------------- Endauswahl

export interface Finalist { id: string; span: Span; decision: FinalJudgement['decision']; passes: number; eventId: string }
/** Nur acceptable/needs-review; fast gleiche (IoU > 0,5) zusammenlegen; Zeit-Vielfalt; Qualität vor Menge. Null Clips sind erlaubt. */
export function rankFinal(items: Finalist[], wanted: number): Finalist[] {
  const ok = items.filter((c) => c.decision !== 'reject').sort((a, b) => (a.decision === b.decision ? 0 : a.decision === 'acceptable' ? -1 : 1) || b.passes - a.passes || a.span.start - b.span.start)
  const out: Finalist[] = []
  for (const c of ok) {
    if (out.length >= wanted) break
    if (out.some((o) => o.eventId === c.eventId || iou(o.span, c.span) > 0.5)) continue
    out.push(c)
  }
  return out.sort((a, b) => a.span.start - b.span.start)
}

/** Erstes JSON-Objekt aus Modelltext; bei Syntaxfehler einmal die häufigsten Formfehler bereinigen (Komma vor Klammer, typografische Anführungszeichen). Inhalt wird danach streng geprüft. */
export function parseModelJson(text: string): unknown {
  const i = text.indexOf('{'), j = text.lastIndexOf('}')
  if (i < 0 || j <= i) throw new Error('keine JSON-Antwort')
  const raw = text.slice(i, j + 1)
  try { return JSON.parse(raw) } catch { /* bereinigen */ }
  return JSON.parse(raw.replace(/,\s*([}\]])/g, '$1').replace(/[“”„]/g, '"'))
}
