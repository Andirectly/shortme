import { describe, expect, it } from 'vitest'
import { heatBonus, heatPeaks, heatScore, heatStats } from '../src/main/shortme/clips/heat'

const curve = [0.2, 0.3, 1, 0.4, 0.3, 0.9, 0.2].map((value, i) => ({ start: i * 10, end: i * 10 + 10, value }))

describe('Most replayed', () => {
  it('Mittel und Spitze über einen Bereich', () => {
    const s = heatStats(curve, 15, 35)
    expect(s.peak).toBe(1)
    expect(s.mean).toBeCloseTo((0.3 * 5 + 1 * 10 + 0.4 * 5) / 20, 5)
  })
  it('Spitzen sind lokale Maxima ≥ 0,75', () => { expect(heatPeaks(curve).map((p) => p.start)).toEqual([20, 50]) })
  it('Bonus: Spitze belohnt, Flaute bestraft, begrenzt', () => {
    expect(heatBonus(heatScore(curve, 20, 30))).toBeGreaterThan(8)
    expect(heatBonus(heatScore(curve, 60, 70))).toBeLessThan(0)
    expect(heatBonus(2)).toBeLessThanOrEqual(16)
    expect(heatBonus(-1)).toBeGreaterThanOrEqual(-8)
  })
})
