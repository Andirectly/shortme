import { describe, expect, it } from 'vitest'
import { alignWords, norm, similarity, substitutions } from '../src/shared/wordDiff'

const ops = (a: string[], b: string[]) => alignWords(a, b).map((o) => o.kind)

describe('Wortvergleich', () => {
  it('Normalisierung und Ähnlichkeit', () => {
    expect(norm('Gitarre,')).toBe('gitarre')
    expect(norm('Täto')).toBe('tato')
    expect(similarity('Tattoo', 'Täto')).toBeGreaterThan(0.4)
    expect(similarity('Haus', 'Zebra')).toBeLessThan(0.4)
  })
  it('Gleiches, Ersetzen, Einfügen, Löschen', () => {
    expect(ops(['ich', 'habe', 'ein', 'Täto'], ['ich', 'habe', 'ein', 'Tattoo'])).toEqual(['same', 'same', 'same', 'sub'])
    expect(ops(['a', 'b', 'c'], ['a', 'c'])).toEqual(['same', 'del', 'same'])
    expect(ops(['a', 'c'], ['a', 'b', 'c'])).toEqual(['same', 'ins', 'same'])
    expect(ops([], ['x'])).toEqual(['ins'])
    expect(ops(['x'], [])).toEqual(['del'])
  })
  it('Schreibweisen übernehmen: nur echte Wortänderungen, Indizes des Standards', () => {
    const std = ['Ich', 'habe', 'ein', 'Täto', 'gesehen', 'Bro.']
    const second = ['ich', 'habe', 'ein', 'Tattoo', 'gesehen', 'Bro,']
    expect(substitutions(std, second)).toEqual({ 3: 'Tattoo' })
  })
  it('Einfügungen und Löschungen des zweiten Durchgangs verändern nichts', () => {
    expect(substitutions(['a', 'b', 'c'], ['a', 'c'])).toEqual({})
    expect(substitutions(['a', 'c'], ['a', 'b', 'c'])).toEqual({})
  })
})

import { cleanAsrText } from '../src/main/testlab/qwenAsr'
describe('Qwen3-ASR Ausgabe', () => {
  it('Sprach-Tag und Markierungen entfernen', () => {
    expect(cleanAsrText('language German<asr_text>Hallo Welt, wie geht es?')).toBe('Hallo Welt, wie geht es?')
    expect(cleanAsrText('Hallo<asr_text> ')).toBe('Hallo')
    expect(cleanAsrText('')).toBe('')
  })
})

import { applyInserts, mergeQwenText } from '../src/shared/wordDiff'
describe('Qwen-Text mit Parakeet-Zeiten', () => {
  const orig = [{ w: 'ich', start: 0, end: 0.3 }, { w: 'habe', start: 0.4, end: 0.7 }, { w: 'Täto', start: 2.0, end: 2.4 }, { w: 'extra', start: 3, end: 3.3 }]
  it('Ersetzung nur im Text, Einfügung zwischen Nachbarn gleichmäßig, Parakeet-only bleibt', () => {
    const m = mergeQwenText(orig, ['ich', 'habe', 'schon', 'wieder', 'Tattoo'])
    expect(m.subs).toEqual({ 2: 'Tattoo' })
    expect(m.inserts).toHaveLength(1)
    expect(m.inserts[0].before).toBe(2)
    const [x, y] = m.inserts[0].words
    expect([x.w, y.w]).toEqual(['schon', 'wieder'])
    expect(x.start).toBeCloseTo(0.7, 2)
    expect(y.end).toBeCloseTo(2.0, 2)
    expect(y.start).toBeCloseTo(x.end, 3)
    // „extra“ nur bei Parakeet: nicht gelöscht (Qwen hat dort nichts erkannt)
    expect(applyInserts(orig, m.inserts).words.map((w) => w.w)).toContain('extra')
  })
  it('Einfügung am Anfang/Ende nutzt den VAD-Bereich', () => {
    const m = mergeQwenText(orig.slice(0, 2), ['also', 'ich', 'habe', 'gesagt'], [[0.0, 1.5]])
    expect(m.inserts.map((i) => i.before)).toEqual([0, 2])
    expect(m.inserts[1].words[0].start).toBeCloseTo(0.7, 2)
    expect(m.inserts[1].words[0].end).toBeLessThanOrEqual(1.55)
  })
  it('Index-Zuordnung beim Einsetzen', () => {
    const r = applyInserts([{ w: 'a', start: 0, end: 1 }, { w: 'b', start: 1, end: 2 }], [{ before: 1, words: [{ w: 'x', start: 1, end: 1.2 }, { w: 'y', start: 1.2, end: 1.4 }] }, { before: 2, words: [{ w: 'z', start: 2, end: 2.2 }] }])
    expect(r.words.map((w) => w.w)).toEqual(['a', 'x', 'y', 'b', 'z'])
    expect(r.map).toEqual([0, 3])
    expect(r.starts).toEqual([1, 4])
  })
})
