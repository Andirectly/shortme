export interface AsrWord { w: string; start: number; end: number; speaker?: number }
export interface AsrSegment { start: number; end: number; text: string; words: AsrWord[]; /** Nachträglich in einer Lücke gefunden (ohne VAD-Vorfilter). */ filled?: boolean }

/** Silero-VAD-Parameter der Transkription (Standard = Messung auf test-videos, siehe docs/PROGRESS.md). */
export interface VadParams { threshold: number; minSilence: number; minSpeech: number; maxSpeech: number; /** Polster (s) vor/hinter jedem Sprachsegment beim Dekodieren. */ pad: number }
export const VAD_DEFAULTS: VadParams = { threshold: 0.4, minSilence: 0.4, minSpeech: 0.25, maxSpeech: 20, pad: 0 }
/** Empfindliche Einstellung nur zum Aufspüren von Sprache (Lückensuche). */
export const VAD_SCAN: VadParams = { threshold: 0.25, minSilence: 0.3, minSpeech: 0.2, maxSpeech: 30, pad: 0 }

export type Range = [number, number]
export const GAP_MIN_SEC = 1.5
export const GAP_MARGIN_SEC = 0.5

/** Sortiert und verschmilzt überlappende/berührende Bereiche. */
export function mergeRanges(r: Range[], join = 0): Range[] {
  const s = [...r].sort((a, b) => a[0] - b[0])
  const out: Range[] = []
  for (const x of s) { const p = out[out.length - 1]; if (p && x[0] <= p[1] + join) p[1] = Math.max(p[1], x[1]); else out.push([x[0], x[1]]) }
  return out
}

/** Teile von `speech`, die von keinem Wort (mit `pad` Toleranz) abgedeckt sind, ab `minLen` Sekunden. */
export function findGaps(speech: Range[], words: Array<{ start: number; end: number }>, minLen = GAP_MIN_SEC, pad = 0.2): Range[] {
  const covered = mergeRanges(words.map((w) => [w.start - pad, w.end + pad] as Range), 0.4)
  const out: Range[] = []
  for (const [a, b] of mergeRanges(speech)) {
    let cur = a
    for (const [c0, c1] of covered) {
      if (c1 <= cur) continue
      if (c0 >= b) break
      if (c0 > cur) out.push([cur, Math.min(c0, b)])
      cur = Math.max(cur, c1)
      if (cur >= b) break
    }
    if (cur < b) out.push([cur, b])
  }
  return out.filter(([a, b]) => b - a >= minLen)
}

/** Zeitlich neue Wörter: nur solche, deren Mitte nicht in einem vorhandenen Wort liegt (Ränder der Lücke überlappen mit Bestehendem). */
export function newWordsOnly(candidates: AsrWord[], existing: Array<{ start: number; end: number }>): AsrWord[] {
  const sorted = [...existing].sort((a, b) => a.start - b.start)
  return candidates.filter((w) => {
    const mid = (w.start + w.end) / 2
    return !sorted.some((e) => mid >= e.start - 0.03 && mid <= e.end + 0.03) && w.end - w.start < 2.5
  })
}

/** Einteilung einer Lücke (mit Rand) in Dekodier-Stücke von höchstens `maxLen` Sekunden. */
export function chunkRange(a: number, b: number, maxLen = 20): Range[] {
  const n = Math.max(1, Math.ceil((b - a) / maxLen))
  const len = (b - a) / n
  return Array.from({ length: n }, (_, i) => [a + i * len, a + (i + 1) * len] as Range)
}
export interface SpeakerTurn { start: number; end: number; speaker: number }

export type AsrRequest =
  | { mode: 'asr'; modelDir: string; vadModel: string; wav: string; maxSeconds?: number; resumeFrom?: number; vad?: VadParams }
  /** Lücken suchen (empfindliche VAD) und ohne VAD-Vorfilter nachtranskribieren. `words` = Zeitspannen der vorhandenen Wörter. */
  | { mode: 'gaps'; modelDir: string; vadModel: string; wav: string; words: Range[]; minGap?: number; margin?: number; /** Feste Bereiche statt Lückensuche: ohne VAD, ohne Rand, in Stücken dekodieren (Testlab „zweiter Durchgang“). */ ranges?: Range[] }
  | { mode: 'diarize'; segModel: string; embModel: string; wav: string; numClusters?: number; threshold?: number }

export type AsrMessage =
  | { type: 'progress'; done: number; total: number }
  /** Ein fertig dekodiertes Sprachsegment (VAD-Grenzen); wird sofort als Checkpoint gespeichert. */
  | { type: 'segment'; segment: AsrSegment }
  | { type: 'result'; loadMs: number; decodeMs: number; audioSec: number }
  | { type: 'turns'; turns: SpeakerTurn[]; ms: number }
  /** Ergebnis der Lückensuche: gefundene Lücken (ohne Rand). */
  | { type: 'gaps'; found: Range[]; scanMs: number; decodeMs: number }
  | { type: 'error'; message: string }

/** SentencePiece-Token (▁ = Wortanfang) zu Wörtern mit Start/Ende. */
export function tokensToWords(tokens: string[], times: number[], durations: number[] | undefined, segEnd: number): AsrWord[] {
  const words: AsrWord[] = []
  let cur: AsrWord | null = null
  tokens.forEach((t, i) => {
    const start = times[i]
    const end = durations?.[i] ? start + durations[i] : (times[i + 1] ?? segEnd)
    if (!cur || t.startsWith('▁') || t.startsWith(' ')) {
      if (cur) words.push(cur)
      cur = { w: t.replace(/^[▁ ]/, ''), start, end }
    } else {
      cur.w += t
      cur.end = end
    }
  })
  if (cur) words.push(cur)
  // Ende eines Wortes nie hinter den Beginn des nächsten
  for (let i = 0; i < words.length - 1; i++) words[i].end = Math.min(words[i].end, words[i + 1].start)
  return words.filter((w) => w.w.length > 0)
}

/** Sprecher-ID je Wort: Sprecher mit der größten zeitlichen Überlappung (Wortmitte als Rückfall). */
export function assignSpeakers(words: AsrWord[], turns: SpeakerTurn[]): void {
  for (const w of words) {
    let best = -1
    let bestOv = 0
    for (const t of turns) {
      const ov = Math.min(w.end, t.end) - Math.max(w.start, t.start)
      if (ov > bestOv) { bestOv = ov; best = t.speaker }
    }
    if (best < 0) {
      const mid = (w.start + w.end) / 2
      const near = turns.reduce<SpeakerTurn | null>((a, t) => (Math.abs((t.start + t.end) / 2 - mid) < Math.abs(a ? (a.start + a.end) / 2 - mid : Infinity) ? t : a), null)
      best = near?.speaker ?? 0
    }
    w.speaker = best
  }
}
