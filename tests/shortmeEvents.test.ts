import { describe, expect, it } from 'vitest'
import { framesToEvents, marksBySentence, pauseEvents } from '../src/main/shortme/clips/audioEvents'
import type { Sentence } from '../src/main/shortme/clips/sentences'

const frames = (n: number, hits: Record<number, Array<[number, number]>>): Float32Array => {
  const a = new Float32Array(n * 521)
  for (const [t, list] of Object.entries(hits)) for (const [c, v] of list) a[+t * 521 + c] = v
  return a
}
const sent = (i: number, start: number, end: number): Sentence => ({ index: i, first: i, last: i, start, end, text: `s${i}` })

describe('Audio-Ereignisse', () => {
  it('Lachen ab 0,45 s, kurze Ausreißer nicht', () => {
    const sc = frames(20, { 5: [[13, 0.8]], 6: [[18, 0.6]], 12: [[13, 0.9]] })
    const ev = framesToEvents(sc, 20).filter((e) => e.kind === 'laugh')
    expect(ev).toHaveLength(2) // 5–6 überbrückt (≥ 0,45 s) und 12 allein: 0,96 s Fenster ≥ 0,45 s
    expect(ev[0].start).toBeCloseTo(5 * 0.48, 5)
  })
  it('Applaus braucht ≥ 0,9 s', () => { expect(framesToEvents(frames(10, { 3: [[62, 0.9]] }), 10).filter((e) => e.kind === 'applause')).toHaveLength(1) })
  it('Pause = Lücke ≥ 2 s zwischen Sprachabschnitten', () => {
    expect(pauseEvents([[0, 5], [6, 9], [12, 15]])).toEqual([{ kind: 'pause', start: 9, end: 12, score: 1 }])
  })
  it('Markierung am Satz, in dem das Ereignis beginnt', () => {
    const m = marksBySentence([sent(0, 0, 5), sent(1, 6, 10), sent(2, 11, 14)], [{ kind: 'laugh', start: 7, end: 8, score: 0.8 }, { kind: 'applause', start: 12, end: 14, score: 0.9 }])
    expect(m.get(1)).toEqual(['[lacht]'])
    expect(m.get(2)).toEqual(['[Applaus]'])
  })
})
