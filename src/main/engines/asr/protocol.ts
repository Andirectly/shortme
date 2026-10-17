export interface AsrWord { w: string; start: number; end: number }
export interface AsrSegment { start: number; end: number; text: string; words: AsrWord[] }
export interface AsrRequest { modelDir: string; vadModel: string; wav: string; maxSeconds?: number }
export type AsrMessage =
  | { type: 'progress'; done: number; total: number }
  | { type: 'result'; segments: AsrSegment[]; loadMs: number; decodeMs: number; audioSec: number }
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
