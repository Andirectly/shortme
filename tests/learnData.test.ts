import { describe, expect, it } from 'vitest'
import { channelPairs, splitOf, videoPairs, type CandRecord } from '../src/shared/learnData'

const rec = (id: string, o: Partial<CandRecord> = {}): CandRecord => ({ id, vid: 'v', source: 'shortme', contentType: null, start: 0, end: 30, transcript: '', marks: [], rubric: null, heat: null, rating: null, corrections: null, exported: false, playedSec: 0, split: 'train', ...o })
const lv = (level: 'strong' | 'mid' | 'bad') => ({ level, reasons: [] })

describe('Datensatz', () => {
  it('Split ist stabil und etwa 80/20', () => {
    expect(splitOf('abc')).toBe(splitOf('abc'))
    const n = Array.from({ length: 1000 }, (_, i) => splitOf(`v${i}`)).filter((s) => s === 'test').length
    expect(n).toBeGreaterThan(150); expect(n).toBeLessThan(250)
  })
  it('Bewertungs-Paare: stark > mittel > schlecht, gleiche Stufe kein Paar', () => {
    const p = videoPairs([rec('s', { rating: lv('strong') }), rec('m', { rating: lv('mid') }), rec('b', { rating: lv('bad') }), rec('b2', { rating: lv('bad') })])
    expect(p.map((x) => `${x.a}>${x.b}`).sort()).toEqual(['m>b', 'm>b2', 's>b', 's>b2', 's>m'])
    expect(p.every((x) => x.source === 'rating' && x.weight === 1)).toBe(true)
  })
  it('Korrektur: meine Version > Vorschlag', () => {
    const p = videoPairs([rec('o'), rec('o#mine', { correctionOf: 'o' })])
    expect(p).toEqual([{ a: 'o#mine', b: 'o', source: 'correction', weight: 1, vid: 'v', split: 'train' }])
  })
  it('Creator: gewählter Abschnitt > nicht berührende Kandidaten', () => {
    const c = rec('c', { source: 'creator', start: 100, end: 130 })
    const p = videoPairs([c, rec('near', { start: 105, end: 135 }), rec('far', { start: 500, end: 530 })])
    expect(p.map((x) => `${x.a}>${x.b}`)).toEqual(['c>far'])
    expect(p[0].weight).toBe(0.6)
  })
  it('Heatmap: nur deutlicher Abstand bei ähnlicher Länge', () => {
    const h = (max: number) => ({ mean: max / 2, max })
    const p = videoPairs([rec('hi', { heat: h(0.9) }), rec('lo', { heat: h(0.5) }), rec('mid', { heat: h(0.8) }), rec('long', { heat: h(0.1), end: 90 })])
    expect(p.map((x) => `${x.a}>${x.b}`).sort()).toEqual(['hi>lo', 'mid>lo'])
  })
  it('Kanal: nur deutlich stärkerer Short, nur gleicher Split', () => {
    const cr = (id: string, ratio: number | null, split: 'train' | 'test' = 'train') => rec(id, { source: 'creator', split, creator: { channel: 'k', views: 1, likes: 1, comments: 1, date: '', ratio } })
    const p = channelPairs([cr('a', 3), cr('b', 1), cr('c', 2.5), cr('d', null), cr('e', 0.2, 'test')])
    expect(p.map((x) => `${x.a}>${x.b}`).sort()).toEqual(['a>b', 'c>b'])
  })
})
