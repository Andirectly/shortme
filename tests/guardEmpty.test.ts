import { describe, expect, it } from 'vitest'
import { guardEmptyShots, type PlanInput } from '../src/shared/layoutPlan'
import type { ShortmeShot } from '../src/shared/shortme'

const mk = (centres: Array<number | null>): PlanInput => ({
  ticks: centres.length, dt: 0.2, cuts: [], sourceAspect: 16 / 9,
  tracks: [{ id: 0, start: 0, centres: centres.map((c) => c ?? 0.5), areas: centres.map(() => 0.01), scores: centres.map(() => 1) }]
})

describe('Sicherheitsnetz: keine Person im Ausschnitt', () => {
  const center: ShortmeShot = { start: 0, end: 4, layout: 'fixed', cx: 0.5, zoom: 1 }
  it('Person außerhalb des Ausschnitts (> 0,5 s) → Ganzes Bild, markiert', () => {
    const out = guardEmptyShots([center], mk(Array(20).fill(0.27)))
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ layout: 'fit', auto: 'empty', start: 0, end: 4 })
  })
  it('Person im Ausschnitt → unverändert; kurze Lücke ≤ 0,5 s bleibt', () => {
    expect(guardEmptyShots([center], mk(Array(20).fill(0.55)))).toEqual([center])
    const c = Array(20).fill(0.5); c[8] = 0.1; c[9] = 0.1 // 0,4 s leer
    expect(guardEmptyShots([center], mk(c))).toEqual([center])
  })
  it('nur der leere Abschnitt wird umgestellt, Rest bleibt', () => {
    const c = [...Array(10).fill(0.5), ...Array(6).fill(0.9), ...Array(4).fill(0.5)] // 2,0–3,2 s leer
    const out = guardEmptyShots([center], mk(c))
    expect(out.map((s) => s.layout)).toEqual(['fixed', 'fit', 'fixed'])
    expect(out[1]).toMatchObject({ start: 2, auto: 'empty' })
    expect(out[1].end).toBeCloseTo(3.2, 5)
  })
  it('Split, Ganzes Bild und Stream bleiben unberührt', () => {
    const others: ShortmeShot[] = [{ start: 0, end: 4, layout: 'split', cx: 0.3, cx2: 0.7, zoom: 1 }, { start: 4, end: 5, layout: 'fit', cx: 0.5, zoom: 1 }]
    expect(guardEmptyShots(others, mk(Array(25).fill(0.9)))).toEqual(others)
  })
})

import { planShots } from '../src/shared/layoutPlan'
describe('Rückfall ohne Sprecher: nie die Bildmitte', () => {
  const mk2 = (n: number): PlanInput => ({
    ticks: n, dt: 0.2, cuts: [], sourceAspect: 16 / 9,
    tracks: [0.27, 0.7].map((c, id) => ({ id, start: 0, centres: Array(n).fill(c), areas: Array(n).fill(0.01), scores: Array(n).fill(-3) }))
  })
  it('zwei Personen links/rechts, keiner spricht → Split statt Mitte', () => {
    const shots = planShots(mk2(60))
    expect(shots.some((s) => s.layout === 'fixed')).toBe(false)
    expect(shots.every((s) => s.layout === 'split' || s.layout === 'smart')).toBe(true)
  })
  it('keine Person sichtbar → Vollbild', () => {
    const inp: PlanInput = { ticks: 30, dt: 0.2, cuts: [], sourceAspect: 16 / 9, tracks: [] }
    expect(planShots(inp).every((s) => s.layout === 'fit')).toBe(true)
  })
})
