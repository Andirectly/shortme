// Engine 6 – Schnittplan (Kap. 4/12): Grenzen kommen aus Satz-/Wort-IDs, der Host rechnet die Quellzeit (keine Modellsekunden). Halboffene Spannen [start, end).
// Ein zu langer Gedankengang wird NICHT mechanisch gekürzt: der Plan ist dann ungültig (Reserve wählen oder manuell prüfen).
import { createHash } from 'node:crypto'
import type { Sentence } from '../../sentences'
import type { CutCandidate, CutEdge, Span } from '../v4/core'

export const V6_PLAN_REVISION = 'plan-v1'

export interface V6CutPlan {
  candidateId: string
  /** geordnete Quellspannen (Cold Opener fügt der bestehende Export als zusätzliche Spanne hinzu) */
  segments: Span[]
  firstWord: number
  lastWord: number
  /** Hook = erster, Payoff = letzter Satz; dazwischen erforderlicher Kontext – darf kein späterer Schritt entfernen */
  protectedSentenceIds: number[]
  hookSentenceId: number | null
  payoffSentenceId: number | null
  /** Ausgabezeit ↔ Quellzeit (je Segment Startoffset in der Ausgabe) */
  timeMap: Array<{ out: number; src: Span }>
  planRevision: string
  fingerprint: string
  extendedBy: number
  wordless: boolean
}

export type PlanResult = { ok: true; plan: V6CutPlan } | { ok: false; reason: string }

interface W { start: number; end: number }

const PRE = 0.12, POST = 0.25

/** Rand eines Satzes: knapp vor das erste Wort, nie in das vorige Wort; knapp nach das letzte Wort, nie in das nächste. */
export function sentenceEdges(words: W[], firstWord: number, lastWord: number): Span {
  const prevEnd = firstWord > 0 ? words[firstWord - 1].end : 0
  const nextStart = lastWord + 1 < words.length ? words[lastWord + 1].start : Infinity
  const start = Math.max(prevEnd + 0.02, words[firstWord].start - PRE, 0)
  const end = Math.min(nextStart - 0.02, words[lastWord].end + POST)
  return { start: Math.min(start, words[firstWord].start), end: Math.max(end, words[lastWord].end) }
}

export const planFingerprint = (p: Omit<V6CutPlan, 'fingerprint'>): string => createHash('sha256').update(JSON.stringify([p.segments, p.firstWord, p.lastWord, p.protectedSentenceIds, p.planRevision])).digest('hex').slice(0, 16)

/** Sprachclip aus Satzgrenzen. Zu kurz → um ganze Folgesätze (dann Vorsätze) erweitern, solange ≤ maxSec. Zu lang → ungültig. */
export function planSpeech(candidateId: string, sentences: Sentence[], words: W[], first: number, last: number, o: { minSec: number; maxSec: number }): PlanResult {
  const a = sentences.findIndex((s) => s.index === first), b = sentences.findIndex((s) => s.index === last)
  if (a < 0 || b < 0 || b < a) return { ok: false, reason: `Satzgrenzen S${first}–S${last} ungültig` }
  let i = a, j = b
  const len = (): number => { const e = sentenceEdges(words, sentences[i].first, sentences[j].last); return e.end - e.start }
  if (len() > o.maxSec) return { ok: false, reason: `Gedankengang ${Math.round(len())} s > ${o.maxSec} s – nicht mechanisch gekürzt` }
  let extended = 0
  while (len() < o.minSec) {
    const canNext = j + 1 < sentences.length && sentenceEdges(words, sentences[i].first, sentences[j + 1].last).end - sentenceEdges(words, sentences[i].first, sentences[j + 1].last).start <= o.maxSec
    const canPrev = i > 0 && sentenceEdges(words, sentences[i - 1].first, sentences[j].last).end - sentenceEdges(words, sentences[i - 1].first, sentences[j].last).start <= o.maxSec
    if (canNext) j++; else if (canPrev) i--; else return { ok: false, reason: `zu kurz (${Math.round(len())} s) und nicht vollständig erweiterbar` }
    extended++
  }
  const span = sentenceEdges(words, sentences[i].first, sentences[j].last)
  const ids = sentences.slice(i, j + 1).map((s) => s.index)
  const base = { candidateId, segments: [span], firstWord: sentences[i].first, lastWord: sentences[j].last, protectedSentenceIds: sentences.slice(a, b + 1).map((s) => s.index), hookSentenceId: ids[0], payoffSentenceId: sentences[b].index, timeMap: [{ out: 0, src: span }], planRevision: V6_PLAN_REVISION, extendedBy: extended, wordless: false }
  return { ok: true, plan: { ...base, fingerprint: planFingerprint(base) } }
}

/** Wortloser Clip aus einer geprüften Schnittkante (Cut-Judge/Kantengitter der Engine 4). Wörter darin werden nicht angeschnitten. */
export function planWordless(candidateId: string, cut: CutCandidate, words: W[], o: { minSec: number; maxSec: number }): PlanResult {
  const d = cut.span.end - cut.span.start
  if (d < o.minSec - 0.5 || d > o.maxSec + 0.5) return { ok: false, reason: `Kante ergibt ${Math.round(d)} s` }
  const inside = words.map((w, k) => ({ w, k })).filter(({ w }) => w.end > cut.span.start && w.start < cut.span.end)
  if (inside.some(({ w }) => w.start < cut.span.start || w.end > cut.span.end)) return { ok: false, reason: 'Kante schneidet ein Wort an' }
  const base = { candidateId, segments: [cut.span], firstWord: inside[0]?.k ?? 0, lastWord: inside.length ? inside[inside.length - 1].k : -1, protectedSentenceIds: [], hookSentenceId: null, payoffSentenceId: null, timeMap: [{ out: 0, src: cut.span }], planRevision: V6_PLAN_REVISION, extendedBy: 0, wordless: inside.length === 0 }
  return { ok: true, plan: { ...base, fingerprint: planFingerprint(base) } }
}

/** Bestehende Kanten am Rand (für Belege/Prüfung): nächste gemessene Kante je Grenze und Abstand. */
export function nearestEdges(span: Span, edges: CutEdge[]): { start: CutEdge | null; end: CutEdge | null } {
  const near = (t: number): CutEdge | null => edges.reduce<CutEdge | null>((b, e) => (!b || Math.abs(e.t - t) < Math.abs(b.t - t) ? e : b), null)
  return { start: near(span.start), end: near(span.end) }
}
