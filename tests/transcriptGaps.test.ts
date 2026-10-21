import { describe, expect, it } from 'vitest'
import { chunkRange, findGaps, mergeRanges, newWordsOnly, VAD_DEFAULTS, type AsrSegment } from '../src/main/engines/asr/protocol'
import { buildTranscript, mergeFilled } from '../src/main/shortme/transcription'

const w = (word: string, start: number, end: number) => ({ w: word, start, end })
const seg = (start: number, end: number, words: ReturnType<typeof w>[]): AsrSegment => ({ start, end, text: words.map((x) => x.w).join(' '), words })

describe('Lückensuche', () => {
  it('Bereiche verschmelzen', () => {
    expect(mergeRanges([[5, 6], [0, 2], [1.5, 3]])).toEqual([[0, 3], [5, 6]])
    expect(mergeRanges([[0, 1], [1.2, 2]], 0.3)).toEqual([[0, 2]])
  })
  it('Sprache ohne Wörter ab 1,5 s ist eine Lücke, Rest nicht', () => {
    const words = [w('a', 0, 1), w('b', 1.1, 2), w('c', 8, 9)]
    // Sprache 0–9; Wörter decken 0–2 und 8–9 (mit 0,2 s Toleranz) → Lücke 2,2–7,8
    const gaps = findGaps([[0, 9]], words)
    expect(gaps).toHaveLength(1)
    expect(gaps[0][0]).toBeCloseTo(2.2, 1)
    expect(gaps[0][1]).toBeCloseTo(7.8, 1)
    // zu kurz
    expect(findGaps([[0, 2.4]], [w('a', 0, 1)])).toEqual([])
    // ohne Sprache keine Lücke
    expect(findGaps([], words)).toEqual([])
  })
  it('Stück-Einteilung', () => {
    expect(chunkRange(0, 15, 20)).toEqual([[0, 15]])
    expect(chunkRange(0, 45, 20)).toHaveLength(3)
    expect(chunkRange(10, 50, 20)[1][0]).toBeCloseTo(30, 5)
  })
  it('nur zeitlich neue Wörter', () => {
    const existing = [w('x', 1, 2), w('y', 2.1, 3)]
    const cand = [w('x', 1.05, 1.95), w('neu', 3.4, 3.8), w('lang', 4, 7.5)]
    expect(newWordsOnly(cand, existing).map((c) => c.w)).toEqual(['neu'])
  })
  it('Standard-VAD: Schwelle 0,4 (gemessen, siehe PROGRESS), kein Polster', () => {
    expect(VAD_DEFAULTS).toMatchObject({ threshold: 0.4, pad: 0 })
  })
})

describe('Lücken füllen und einsetzen', () => {
  const base = [seg(0, 20, [w('eins', 1, 2), w('zwei', 2.2, 3), w('drei', 14, 15), w('vier', 15.2, 16)])]
  it('Fund innerhalb eines VAD-Segments: Wörter zeitlich korrekt dazwischen, Bericht stimmt', () => {
    const found: Array<[number, number]> = [[4, 12]]
    const filled: AsrSegment[] = [seg(3.5, 12.5, [w('zwei', 2.3, 3), w('mitte', 5, 5.5), w('wort', 6, 6.5), w('drei', 14.1, 14.9)]) ]
    const m = mergeFilled(base, found, filled)
    expect(m.report).toMatchObject({ found: 1, filled: 1, wordsAdded: 2 })
    const t = buildTranscript({ hash: 'x', durationSec: 20 }, [...base, ...m.segments], null, m.report)
    expect(t.words.map((x) => x.w)).toEqual(['eins', 'zwei', 'mitte', 'wort', 'drei', 'vier'])
    for (let i = 1; i < t.words.length; i++) expect(t.words[i].start).toBeGreaterThanOrEqual(t.words[i - 1].start)
    // Segment-Indizes decken alle Wörter lückenlos ab
    expect(t.segments.reduce((n, s) => n + (s.last - s.first + 1), 0)).toBe(t.words.length)
    expect(t.gaps?.filled).toBe(1)
  })
  it('Funde ohne neue Wörter zählen als gefunden, nicht als gefüllt', () => {
    const m = mergeFilled(base, [[4, 12]], [seg(3.5, 12.5, [])])
    expect(m.report).toMatchObject({ found: 1, filled: 0, wordsAdded: 0 })
    expect(m.segments).toEqual([])
  })
  it('ohne Funde bleibt buildTranscript wie bisher', () => {
    const t = buildTranscript({ hash: 'x', durationSec: 20 }, base, null)
    expect(t.segments).toHaveLength(1)
    expect(t.segments[0]).toMatchObject({ start: 0, end: 20, first: 0, last: 3 })
    expect(t.gaps).toBeUndefined()
  })
})
