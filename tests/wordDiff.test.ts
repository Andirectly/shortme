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
