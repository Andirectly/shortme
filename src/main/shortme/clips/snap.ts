import type { AsrWord } from '../../engines/asr/protocol'
import type { Sentence } from './sentences'

// Einrasten der Clip-Grenzen in 4 Stufen (docs/PIPELINE.md §5; Reihenfolge nach clippyme cut_ops.py):
// 1. nächste Wortgrenze  2. umgebender Satz  3. Stille der Wellenform (nur Richtung Stille)  4. Kamerawechsel (≤ 0,5 s)
// Endschutz: Ende liegt am Satzende, höchstens 0,6 s Nachlauf.

export interface Range { start: number; end: number }

export interface SnapContext {
  words: AsrWord[]
  sentences: Sentence[]
  /** Stille-Intervalle aus der Wellenform. */
  silences: Array<[number, number]>
  /** Sprach-Intervalle (VAD); Ende wird an Stimmenende bestätigt. */
  speech?: Array<[number, number]>
  /** Kamerawechsel in Sekunden. */
  cuts: number[]
  durationSec: number
  /** Bereits belegte Nachbar-Clips (Überlappung verboten). */
  neighbors?: Range[]
  maxLen?: number
  minLen?: number
}

export interface SnapOptions {
  wordWindow: number
  startBackBudget: number
  endFwdBudget: number
  silenceWindow: number
  lead: number
  tail: number
  maxTail: number
  cutWindow: number
}

export const SNAP_DEFAULTS: SnapOptions = { wordWindow: 0.6, startBackBudget: 8, endFwdBudget: 6, silenceWindow: 0.35, lead: 0.04, tail: 0.08, maxTail: 0.6, cutWindow: 0.5 }

export interface SnapResult extends Range { path: string[] }

const EPS = 1e-6

/** Index des Worts, dessen Beginn `t` am nächsten liegt. */
function nearestWordStart(words: AsrWord[], t: number): number {
  let best = 0
  for (let i = 1; i < words.length; i++) if (Math.abs(words[i].start - t) < Math.abs(words[best].start - t)) best = i
  return best
}
function nearestWordEnd(words: AsrWord[], t: number): number {
  let best = 0
  for (let i = 1; i < words.length; i++) if (Math.abs(words[i].end - t) < Math.abs(words[best].end - t)) best = i
  return best
}

/** Stufe 1: Beginn → nächster Wortbeginn, Ende → nächstes Wortende (innerhalb `wordWindow`, sonst bleibt der Wert). */
export function snapToWords(r: Range, words: AsrWord[], opt: SnapOptions = SNAP_DEFAULTS): { first: number; last: number } {
  let first = nearestWordStart(words, r.start)
  let last = nearestWordEnd(words, r.end)
  if (Math.abs(words[first].start - r.start) > opt.wordWindow) {
    // außerhalb des Fensters: das erste Wort, das nach dem Rohwert beginnt
    const k = words.findIndex((w) => w.start >= r.start)
    first = k < 0 ? words.length - 1 : k
  }
  if (Math.abs(words[last].end - r.end) > opt.wordWindow) {
    let k = -1
    for (let i = words.length - 1; i >= 0; i--) if (words[i].end <= r.end) { k = i; break }
    last = k < 0 ? 0 : k
  }
  if (last < first) last = first
  return { first, last }
}

function sentenceOf(sentences: Sentence[], wordIdx: number): Sentence {
  return sentences.find((s) => s.first <= wordIdx && wordIdx <= s.last) ?? sentences[sentences.length - 1]
}

/**
 * Stufe 2: Beginn auf den Anfang, Ende auf das Ende des umgebenden Satzes; Höchstlänge und Nachbar-Clips gewinnen.
 * Rückfall-Reihenfolge wie clippyme: (Satzanfang, Satzende) → (Satzanfang, Wortende) → (Wortanfang, Satzende) → Wörter.
 */
export function snapToSentences(first: number, last: number, ctx: SnapContext, opt: SnapOptions = SNAP_DEFAULTS): { first: number; last: number; path: string } {
  const { words, sentences } = ctx
  const maxLen = ctx.maxLen ?? 90
  const sStart = sentenceOf(sentences, first)
  const sEnd = sentenceOf(sentences, last)
  const rawStart = words[first].start
  const rawEnd = words[last].end
  const nb = ctx.neighbors ?? []
  const free = (a: number, b: number): boolean => nb.every((n) => b <= n.start + EPS || a >= n.end - EPS)
  const startOk = (i: number): boolean => rawStart - words[i].start <= opt.startBackBudget
  const endOk = (i: number): boolean => words[i].end - rawEnd <= opt.endFwdBudget
  const cand: Array<[number, number, string]> = [
    [startOk(sStart.first) ? sStart.first : first, endOk(sEnd.last) ? sEnd.last : last, 'sentence'],
    [startOk(sStart.first) ? sStart.first : first, last, 'sentence_start'],
    [first, endOk(sEnd.last) ? sEnd.last : last, 'sentence_end']
  ]
  for (const [f, l, path] of cand) {
    const dur = words[l].end - words[f].start
    if (dur <= maxLen && l >= f && free(words[f].start, words[l].end)) return { first: f, last: l, path }
  }
  // Länge/Nachbarn verletzt: Ende nach hinten auf das letzte Satzende ziehen, das noch passt
  for (let li = sEnd.index; li >= sStart.index; li--) {
    const l = sentences[li].last
    if (l >= first && words[l].end - words[first].start <= maxLen && free(words[first].start, words[l].end)) return { first, last: l, path: 'shrunk' }
  }
  return { first, last, path: 'word' }
}

/** Stufe 3: in die nächste Stille schieben – nur Richtung Stille, nie in Sprache hinein. */
export function snapToSilence(r: Range, firstWordStart: number, lastWordEnd: number, ctx: SnapContext, opt: SnapOptions = SNAP_DEFAULTS): SnapResult {
  const path: string[] = []
  let start = r.start
  let end = r.end
  // Beginn: Stille, die vor dem ersten Wort endet
  let bestS: [number, number] | null = null
  for (const s of ctx.silences) {
    if (s[1] <= firstWordStart + EPS && firstWordStart - s[1] <= opt.silenceWindow) if (!bestS || s[1] > bestS[1]) bestS = s
  }
  if (bestS) { start = Math.min(firstWordStart, Math.max(bestS[0], bestS[1] - opt.lead)); path.push('silence_start') }
  // Ende: Stille, die nach dem letzten Wort beginnt
  let bestE: [number, number] | null = null
  for (const s of ctx.silences) {
    if (s[0] >= lastWordEnd - EPS && s[0] - lastWordEnd <= opt.silenceWindow) if (!bestE || s[0] < bestE[0]) bestE = s
  }
  if (bestE) { end = Math.max(lastWordEnd, Math.min(bestE[1], bestE[0] + opt.tail)); path.push('silence_end') }
  else end = lastWordEnd + 0.08
  // Endschutz: höchstens maxTail Nachlauf
  end = Math.min(end, lastWordEnd + opt.maxTail)
  start = Math.min(start, firstWordStart)
  return { start, end, path }
}

/** Stufe 4: auf nahe Kamerawechsel (≤ cutWindow) einrasten, ohne Sprache anzuschneiden. */
export function snapToCuts(r: Range, firstWordStart: number, lastWordEnd: number, cuts: number[], opt: SnapOptions = SNAP_DEFAULTS): SnapResult {
  const path: string[] = []
  let { start, end } = r
  let bestC: number | null = null
  for (const c of cuts) {
    // Beginn: Schnitt vor dem Beginn (Wechsel in Stille) oder zwischen Beginn und erstem Wort
    const ok = (c <= start + EPS && start - c <= opt.cutWindow) || (c > start && c <= firstWordStart + EPS && c - start <= opt.cutWindow)
    if (ok && (bestC === null || Math.abs(c - start) < Math.abs(bestC - start))) bestC = c
  }
  if (bestC !== null && bestC <= firstWordStart) { start = bestC; path.push('cut_start') }
  let bestD: number | null = null
  for (const c of cuts) {
    const ok = (c >= end - EPS && c - end <= opt.cutWindow && c - lastWordEnd <= opt.maxTail) || (c < end && c >= lastWordEnd - EPS && end - c <= opt.cutWindow)
    if (ok && (bestD === null || Math.abs(c - end) < Math.abs(bestD - end))) bestD = c
  }
  if (bestD !== null && bestD >= lastWordEnd) { end = bestD; path.push('cut_end') }
  return { start, end, path }
}

/** Gesamtablauf für einen Rohbereich (Sekunden). Liefert die Grenzen und die durchlaufenen Stufen. */
export function snapClip(raw: Range, ctx: SnapContext, opt: SnapOptions = SNAP_DEFAULTS): SnapResult {
  if (ctx.words.length === 0) return { ...raw, path: ['none'] }
  const w = snapToWords(raw, ctx.words, opt)
  const s = snapToSentences(w.first, w.last, ctx, opt)
  const fws = ctx.words[s.first].start
  const lwe = ctx.words[s.last].end
  const sil = snapToSilence({ start: fws, end: lwe }, fws, lwe, ctx, opt)
  const cut = snapToCuts(sil, fws, lwe, ctx.cuts, opt)
  let { start, end } = cut
  // Nachbarn und Videogrenzen gewinnen immer
  for (const n of ctx.neighbors ?? []) {
    if (start < n.end && end > n.start) { if (start >= n.start) start = Math.max(start, n.end); else end = Math.min(end, n.start) }
  }
  start = Math.max(0, start)
  end = Math.min(ctx.durationSec, end)
  // Wörter nie anschneiden (Sicherheitsnetz): weder die eigenen noch die angrenzenden (ASR-Zeiten sind auf ~0,1 s genau,
  // Puffer/Schnitt-Einrasten dürfen deshalb nie in das Nachbarwort laufen).
  const prevEnd = ctx.words[s.first - 1]?.end ?? 0
  const nextStart = ctx.words[s.last + 1]?.start ?? ctx.durationSec
  start = Math.max(start, Math.min(prevEnd, fws))
  end = Math.min(end, Math.max(nextStart, lwe))
  start = Math.min(start, fws)
  end = Math.max(end, lwe)
  return { start, end, path: [`word`, s.path, ...sil.path, ...cut.path] }
}
