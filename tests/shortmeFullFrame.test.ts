import { describe, expect, it } from 'vitest'
import { planShots, type PlanInput } from '../src/shared/layoutPlan'

const mk = (centres: number[][], area: number, speaking: boolean[]): PlanInput => {
  const ticks = 40
  return {
    ticks, dt: 0.25, cuts: [], sourceAspect: 16 / 9, speech: speaking,
    tracks: centres.map((c, id) => ({ id, start: 0, centres: Array(ticks).fill(c[0]), areas: Array(ticks).fill(area), scores: Array(ticks).fill(speaking[0] && id === 0 ? 2 : -2) }))
  }
}

describe('Vollbild-Entscheidung', () => {
  it('winzige Person (Totale) → ganzes Bild', () => {
    const shots = planShots(mk([[0.5]], 0.001, Array(40).fill(true)))
    expect(shots.every((s) => s.layout === 'fit')).toBe(true)
  })
  it('große Person → Tracking', () => {
    const shots = planShots(mk([[0.5]], 0.03, Array(40).fill(true)))
    expect(shots.some((s) => s.layout === 'fit')).toBe(false)
  })
  it('Gruppe ohne Sprecher, nicht in 9:16 → ganzes Bild', () => {
    const shots = planShots(mk([[0.1], [0.5], [0.9]], 0.03, Array(40).fill(false)))
    expect(shots.every((s) => s.layout === 'fit')).toBe(true)
  })
})
