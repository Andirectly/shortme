export interface AsrWord { w: string; start: number; end: number; speaker?: number }
export interface AsrSegment { start: number; end: number; text: string; words: AsrWord[] }
export interface SpeakerTurn { start: number; end: number; speaker: number }

export type AsrRequest =
  | { mode: 'asr'; modelDir: string; vadModel: string; wav: string; maxSeconds?: number; resumeFrom?: number }
  | { mode: 'diarize'; segModel: string; embModel: string; wav: string; numClusters?: number; threshold?: number }

export type AsrMessage =
  | { type: 'progress'; done: number; total: number }
  /** Ein fertig dekodiertes Sprachsegment (VAD-Grenzen); wird sofort als Checkpoint gespeichert. */
  | { type: 'segment'; segment: AsrSegment }
  | { type: 'result'; loadMs: number; decodeMs: number; audioSec: number }
  | { type: 'turns'; turns: SpeakerTurn[]; ms: number }
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
