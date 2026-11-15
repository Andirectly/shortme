// Engine-Vergleich: Ereignisse mehrerer Läufe desselben Originalvideos zuordnen (rein, testbar). Nie über Medien hinweg: Aufrufer übergibt nur Läufe EINES Projekts.
import type { SelectionEngineId } from './engine'

export type ComparisonKind = 'full-source-discovery' | 'clip-recheck'
export interface Span { start: number; end: number }

/** Minimale Sicht auf einen Clip (ShortmeClip erfüllt sie). */
export interface CmpClip { id: string; start: number; end: number; title: string; score: number; autoCuts?: Span[]; v2?: { eventId: string } }
export interface CmpRun { runId: string; engineId: SelectionEngineId; clips: CmpClip[] }

export interface CmpEvent { runId: string; eventId: string; clipIds: string[]; union: Span; anchor: number }
export interface MatchMember { runId: string; eventId: string; clipIds: string[] }
export interface EventMatch {
  matchId: string
  members: MatchMember[]
  kind: 'shared-event' | 'engine-exclusive' | 'ambiguous'
  alignment: { sourceAnchorSec: number; sourceUnion: Span; temporalIou?: number }
  confidenceLabel: 'strong-match' | 'possible-match' | 'manual-match'
}
export interface EventMatchOverride { createdAt: string; action: 'merge' | 'split'; memberRefs: Array<{ runId: string; eventId: string }>; reviewerNote?: string }
export interface BlindReview { reviewId: string; comparisonId: string; matchId: string; reviewerSessionId: string; anonymizedPresentationOrder: string[]; choice: 'a' | 'b' | 'c' | 'tie' | 'all-weak'; judgedAt: string; reasonTags: string[] }
export interface EngineComparison {
  comparisonId: string
  projectId: string
  kind: ComparisonKind
  runIds: string[]
  sourceMediaId: string
  frozenComparableOptions: Record<string, unknown>
  /** Läufe derselben Engine oder mit unterschiedlichen Optionen: gemischt statt gleich konfiguriert → UI zeigt Hinweis, mischt nie still. */
  warnings: string[]
  createdAt: string
  eventMatches: EventMatch[]
  manualOverrides: EventMatchOverride[]
  reviews: BlindReview[]
}

const len = (s: Span): number => Math.max(0, s.end - s.start)
export function iou(a: Span, b: Span): number {
  const i = Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start))
  const u = len(a) + len(b) - i
  return u > 0 ? i / u : 0
}
const inside = (t: number, s: Span): boolean => t >= s.start && t <= s.end

/** Ereignisse eines Laufs: Clips mit gleicher Ereignis-ID sind Schnittvarianten EINES Ereignisses; ohne ID (Engine 1) zählt jeder Clip als eigenes Ereignis. */
export function eventsOf(run: CmpRun): CmpEvent[] {
  const by = new Map<string, CmpClip[]>()
  for (const c of run.clips) by.set(c.v2?.eventId ?? c.id, [...(by.get(c.v2?.eventId ?? c.id) ?? []), c])
  return [...by].map(([eventId, cs]) => {
    const union = { start: Math.min(...cs.map((c) => c.start)), end: Math.max(...cs.map((c) => c.end)) }
    return { runId: run.runId, eventId, clipIds: cs.map((c) => c.id), union, anchor: (union.start + union.end) / 2 }
  })
}

/** Zwei Ereignisse gehören zusammen: zeitliche IoU ≥ 0,25 ODER der Anker des einen liegt im anderen (kurzes Ereignis in langem Fenster). Ein eigener Rohpool-Vergleich ist nicht Teil davon. */
function affinity(a: CmpEvent, b: CmpEvent): number {
  const j = iou(a.union, b.union)
  if (j >= 0.25) return j
  return inside(a.anchor, b.union) || inside(b.anchor, a.union) ? Math.max(j, 0.2) : 0
}

/** Mehrseitiges Matching ohne Mehrfachzuordnung: jedes Ereignis steckt in höchstens einem Match, je Lauf höchstens ein Ereignis pro Match. Greedy nach Affinität; knappe Zweitkandidaten → ambiguous. */
export function matchEvents(runs: CmpRun[], overrides: EventMatchOverride[] = []): EventMatch[] {
  const evs = runs.flatMap(eventsOf)
  const key = (e: { runId: string; eventId: string }): string => `${e.runId}|${e.eventId}`
  const pairs: Array<{ a: CmpEvent; b: CmpEvent; s: number }> = []
  for (let i = 0; i < evs.length; i++) for (let j = i + 1; j < evs.length; j++) {
    if (evs[i].runId === evs[j].runId) continue
    const s = affinity(evs[i], evs[j])
    if (s > 0) pairs.push({ a: evs[i], b: evs[j], s })
  }
  pairs.sort((x, y) => y.s - x.s)
  const group = new Map<string, CmpEvent[]>()
  const groupOf = new Map<string, string>()
  const ambiguous = new Set<string>()
  const put = (g: string, e: CmpEvent): void => { group.set(g, [...(group.get(g) ?? []), e]); groupOf.set(key(e), g) }
  // Zweitkandidaten je Ereignis (pro anderem Lauf) für die Mehrdeutigkeit
  const best = new Map<string, number[]>()
  for (const p of pairs) for (const [x, y] of [[p.a, p.b], [p.b, p.a]]) { const k = `${key(x)}>${y.runId}`; best.set(k, [...(best.get(k) ?? []), p.s]) }
  for (const p of pairs) {
    const ka = key(p.a), kb = key(p.b)
    const ga = groupOf.get(ka), gb = groupOf.get(kb)
    if (ga && gb) continue
    if (!ga && !gb) { const g = ka; put(g, p.a); put(g, p.b) } else {
      const g = (ga ?? gb)!, add = ga ? p.b : p.a
      if ((group.get(g) ?? []).some((m) => m.runId === add.runId)) continue
      put(g, add)
    }
    for (const [x, y] of [[p.a, p.b], [p.b, p.a]]) { const sc = best.get(`${key(x)}>${y.runId}`) ?? []; if (sc.length > 1 && sc[0] - sc[1] < 0.1) ambiguous.add(groupOf.get(key(x))!) }
  }
  for (const e of evs) if (!groupOf.has(key(e))) put(key(e), e)
  let n = 0
  let out: EventMatch[] = [...group.values()].map((ms) => {
    const union = { start: Math.min(...ms.map((m) => m.union.start)), end: Math.max(...ms.map((m) => m.union.end)) }
    const gid = groupOf.get(key(ms[0]))!
    const ious = ms.flatMap((m, i) => ms.slice(i + 1).map((o) => iou(m.union, o.union)))
    const jmin = ious.length ? Math.min(...ious) : undefined
    const kind: EventMatch['kind'] = ms.length === 1 ? 'engine-exclusive' : ambiguous.has(gid) ? 'ambiguous' : 'shared-event'
    return {
      matchId: `m${++n}`, members: ms.map((m) => ({ runId: m.runId, eventId: m.eventId, clipIds: m.clipIds })), kind,
      alignment: { sourceAnchorSec: ms.reduce((a, m) => a + m.anchor, 0) / ms.length, sourceUnion: union, temporalIou: jmin },
      confidenceLabel: (kind === 'shared-event' && (jmin ?? 0) >= 0.5 ? 'strong-match' : 'possible-match') as EventMatch['confidenceLabel'],
    }
  }).sort((a, b) => a.alignment.sourceAnchorSec - b.alignment.sourceAnchorSec).map((m, i) => ({ ...m, matchId: `m${i + 1}` }))
  out = applyOverrides(out, evs, overrides)
  return out
}

/** Manuelle Korrekturen (in Reihenfolge): merge fasst die genannten Ereignisse zusammen, split löst sie aus ihren Matches. Ursprüngliche Algorithmus-Ergebnisse bleiben in `manualOverrides` nachvollziehbar. */
export function applyOverrides(matches: EventMatch[], evs: CmpEvent[], overrides: EventMatchOverride[]): EventMatch[] {
  let cur = matches.map((m) => ({ ...m, members: [...m.members] }))
  const ev = (r: { runId: string; eventId: string }): CmpEvent | undefined => evs.find((e) => e.runId === r.runId && e.eventId === r.eventId)
  const strip = (refs: Array<{ runId: string; eventId: string }>): MatchMember[] => {
    const out: MatchMember[] = []
    for (const m of cur) {
      const hit = m.members.filter((x) => refs.some((r) => r.runId === x.runId && r.eventId === x.eventId))
      out.push(...hit)
      m.members = m.members.filter((x) => !hit.includes(x))
    }
    return out
  }
  const make = (ms: MatchMember[], manual: boolean): EventMatch => {
    const es = ms.map((m) => ev(m)).filter((e): e is CmpEvent => !!e)
    const union = { start: Math.min(...es.map((e) => e.union.start)), end: Math.max(...es.map((e) => e.union.end)) }
    return { matchId: '', members: ms, kind: ms.length > 1 ? 'shared-event' : 'engine-exclusive', alignment: { sourceAnchorSec: es.reduce((a, e) => a + e.anchor, 0) / es.length, sourceUnion: union }, confidenceLabel: manual && ms.length > 1 ? 'manual-match' : 'possible-match' }
  }
  for (const o of overrides) {
    const taken = strip(o.memberRefs)
    if (!taken.length) continue
    if (o.action === 'merge') cur.push(make(taken, true))
    else for (const t of taken) cur.push(make([t], false))
    cur = cur.filter((m) => m.members.length > 0)
    // übrig gebliebene Reste eines Matches neu bewerten (ein Mitglied → exklusiv)
    cur = cur.map((m) => (m.members.length === 1 && m.kind !== 'engine-exclusive' ? make(m.members, false) : m))
  }
  return cur.sort((a, b) => a.alignment.sourceAnchorSec - b.alignment.sourceAnchorSec).map((m, i) => ({ ...m, matchId: `m${i + 1}` }))
}

/** Die tatsächlich ausgegebenen Quellabschnitte eines Clips (Clip minus automatische Schnitte). */
export function clipPieces(c: Pick<CmpClip, 'start' | 'end' | 'autoCuts'>): Span[] {
  let pieces: Span[] = [{ start: c.start, end: c.end }]
  for (const cut of [...(c.autoCuts ?? [])].sort((a, b) => a.start - b.start)) {
    pieces = pieces.flatMap((p) => (cut.end <= p.start || cut.start >= p.end ? [p] : [{ start: p.start, end: Math.max(p.start, cut.start) }, { start: Math.min(p.end, cut.end), end: p.end }].filter((x) => x.end - x.start > 0.001)))
  }
  return pieces
}

/** Quellzeit → Zeit im fertigen Clip; 'omitted', wenn diese Quellzeit nicht im Clip vorkommt (nie verschobene Scheinzeit). */
export function sourceToOutputTime(pieces: Span[], sourceSec: number): number | 'omitted' {
  let acc = 0
  for (const p of pieces) {
    if (sourceSec >= p.start && sourceSec <= p.end) return acc + (sourceSec - p.start)
    acc += p.end - p.start
  }
  return 'omitted'
}

/** Blinde Reihenfolge: deterministisch aus der Seed gemischt, Engine-Namen nur über die Rückabbildung auflösbar. */
export function blindOrder(ids: string[], seed: string): string[] {
  let h = 2166136261
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0
  const a = [...ids]
  for (let i = a.length - 1; i > 0; i--) { h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0; const j = h % (i + 1); [a[i], a[j]] = [a[j], a[i]] }
  return a
}
