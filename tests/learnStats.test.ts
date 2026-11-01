import { describe, expect, it } from 'vitest'
import { applyRules, calibration, counts, patterns, suggestRules } from '../src/shared/learnStats'
import type { CandRecord, Pair } from '../src/shared/learnData'
import type { MomentEval } from '../src/shared/workbench'

const rec = (id: string, o: Partial<CandRecord> = {}): CandRecord => ({ id, vid: 'v', source: 'shortme', contentType: null, start: 0, end: 30, transcript: '', marks: [], rubric: null, heat: null, rating: null, corrections: null, exported: false, playedSec: 0, split: 'train', ...o })
const corr = (endShift: number, startShift = 0) => ({ startShift, endShift, cutText: [], framing: false })
const hit = (d: number, e: number): MomentEval => ({ shortId: 's', source: 'creator', start: 0, end: 30, ratio: 1, overlap: 1, hit: true, startDelta: d, endDelta: e, clipId: 'c', lost: null })

describe('Lernen', () => {
  const cands = [rec('a', { corrections: corr(2) }), rec('b', { corrections: corr(2.5) }), rec('c', { corrections: corr(1.8) }), rec('d', { corrections: corr(2.2) }), rec('e', { corrections: corr(2.0, -1) }),
    rec('f', { rating: { level: 'bad', reasons: ['Ende abgeschnitten'] } }), rec('g', { rating: { level: 'bad', reasons: ['Ende abgeschnitten', 'Langweilig'] } })]
  it('Zähler', () => {
    const pairs: Pair[] = [{ a: 'a', b: 'b', source: 'rating', weight: 1, vid: 'v', split: 'train' }]
    expect(counts(cands, pairs)).toMatchObject({ candidates: 7, corrections: 5, ratings: { bad: 2, mid: 0, strong: 0 }, pairs: { rating: 1, creator: 0 } })
  })
  it('Muster in Klartext', () => {
    const p = patterns(cands, [hit(2.8, 0), hit(3, 0), hit(2.6, 0)])
    expect(p).toContain('Enden verlängerst du im Schnitt um 2,1 s (5 Korrekturen).')
    expect(p).toContain('Häufigster Grund für „schlecht“: Ende abgeschnitten (2×).')
    expect(p).toContain('Creator beginnen im Schnitt 2,8 s früher als Shortme (3 Treffer).')
  })
  it('Regel-Vorschläge brauchen Belege', () => {
    expect(suggestRules(cands, []).map((r) => r.id)).toEqual(['end-user'])
    expect(suggestRules(cands.slice(0, 3), [])).toEqual([])
    const r = suggestRules([], Array.from({ length: 10 }, () => hit(2.8, -1.5)))
    expect(r.map((x) => [x.id, x.seconds])).toEqual([['start-creator', -2.8], ['end-creator', 1.5]])
  })
  it('Eichung: Übereinstimmung mit Bewertung, Test-Menge zuerst', () => {
    const rub = (n: number) => ({ hook: n, payoff: n, quotable: n, standalone: n, density: n })
    const cs = [rec('s', { rubric: rub(9), rating: { level: 'strong', reasons: [] } }), rec('b', { rubric: rub(5), rating: { level: 'bad', reasons: [] } })]
    const pairs: Pair[] = [{ a: 's', b: 'b', source: 'rating', weight: 1, vid: 'v', split: 'test' }, { a: 'b', b: 's', source: 'rating', weight: 1, vid: 'v', split: 'train' }]
    expect(calibration(cs, pairs, []).ratings).toEqual({ rate: 1, n: 1, scope: 'Test' })
  })
  it('Regeln verschieben Grenzen und rasten auf Wörter ein', () => {
    const words = Array.from({ length: 100 }, (_, i) => ({ start: i, end: i + 0.8 }))
    const c = applyRules({ start: 10, end: 40, firstWord: 10, lastWord: 39 }, words, [{ id: 'x', kind: 'end', seconds: 2.1, text: '' }], 100)
    expect(c).toMatchObject({ firstWord: 10, lastWord: 41, end: 41.8 })
    expect(applyRules({ start: 10, end: 40, firstWord: 10, lastWord: 39 }, words, [{ id: 'y', kind: 'end', seconds: -30, text: '' }], 100).end).toBe(40)
  })
})
