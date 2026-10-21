import { describe, expect, it } from 'vitest'
import { remapClip, remapSegments } from '../src/main/shortme/clips/remap'
import { applyInserts } from '../src/shared/wordDiff'
import type { ShortmeClip } from '../src/shared/shortme'

const w = (word: string, start: number, end: number) => ({ w: word, start, end })
const words = [w('a', 0, 1), w('b', 1, 2), w('c', 2, 3), w('d', 3, 4), w('e', 4, 5)]
const clip = { start: 1, end: 4, firstWord: 1, lastWord: 3, tags: [{ word: 2, kind: 'emphasis' }], corrections: { 3: 'D' } } as unknown as ShortmeClip

describe('Index-Umrechnung nach Einfügungen', () => {
  it('Clip, Tags und Korrekturen folgen den neuen Indizes', () => {
    const inserts = [{ before: 2, words: [w('x', 2, 2.2), w('y', 2.2, 2.4)] }]
    const r = applyInserts(words, inserts)
    expect(r.words.map((x) => x.w)).toEqual(['a', 'b', 'x', 'y', 'c', 'd', 'e'])
    const c = remapClip(clip, { ...r, inserts }, r.words.length)
    expect(c.firstWord).toBe(1)
    expect(c.lastWord).toBe(5)
    expect(c.tags[0].word).toBe(4)
    expect(c.corrections).toEqual({ 5: 'D' })
  })
  it('Einfügungen direkt vor dem ersten bzw. nach dem letzten Wort zählen, wenn sie im Clip liegen', () => {
    const inserts = [{ before: 1, words: [w('x', 1.0, 1.3)] }, { before: 4, words: [w('y', 3.9, 4.05)] }]
    const r = applyInserts(words, inserts)
    const c = remapClip(clip, { ...r, inserts }, r.words.length)
    expect(r.words.slice(c.firstWord, c.lastWord + 1).map((x) => x.w)).toEqual(['x', 'b', 'c', 'd', 'y'])
    // Einfügung vor dem Clip-Beginn gehört nicht dazu
    const far = [{ before: 1, words: [w('z', 0.2, 0.5)] }]
    const r2 = applyInserts(words, far)
    expect(r2.words.slice(remapClip(clip, { ...r2, inserts: far }, r2.words.length).firstWord)[0].w).toBe('b')
  })
  it('Segmente reichen bis vor das nächste Segment', () => {
    const inserts = [{ before: 3, words: [w('x', 3, 3.1)] }]
    const r = applyInserts(words, inserts)
    const segs = remapSegments([{ first: 0, last: 2 }, { first: 3, last: 4 }], r.map, r.words.length)
    expect(segs).toEqual([{ first: 0, last: 3 }, { first: 4, last: 5 }])
  })
})
