import { describe, expect, it } from 'vitest'
import { activeSpeakers, cropWidth, facePenalty, faceRatio, planShots, type PlanInput, type PlanTrack } from '../src/main/shortme/layout/plan'

const DT = 0.2
const ticks = (sec: number): number => Math.round(sec / DT)

/** Track, der in [from,to) sichtbar ist; `speak(i)` liefert den ASD-Logit. */
function track(id: number, cx: number, from: number, to: number, speak: (i: number) => number, area = 0.1): PlanTrack {
  const n = ticks(to - from)
  return { id, start: ticks(from), centres: Array(n).fill(cx), areas: Array(n).fill(area), scores: Array.from({ length: n }, (_, k) => speak(ticks(from) + k)) }
}
const base = (tracks: PlanTrack[], sec: number, cuts: number[] = []): PlanInput => ({ tracks, ticks: ticks(sec), dt: DT, cuts, sourceAspect: 16 / 9 })

const coverage = (shots: Array<{ start: number; end: number }>, sec: number): void => {
  expect(shots[0].start).toBeCloseTo(0, 6)
  expect(shots[shots.length - 1].end).toBeCloseTo(sec, 6)
  for (let i = 1; i < shots.length; i++) expect(shots[i].start).toBeCloseTo(shots[i - 1].end, 6)
}

describe('Sprecherwechsel', () => {
  // A (links) spricht 0–10 s und 20–30 s, B (rechts) 10–20 s
  const A = track(1, 0.3, 0, 30, (i) => (i < ticks(10) || i >= ticks(20) ? 3 : -3))
  const B = track(2, 0.7, 0, 30, (i) => (i >= ticks(10) && i < ticks(20) ? 3 : -3))

  it('wechselt als harter Schnitt zum neuen Sprecher (nach ≥ 1 s Führung)', () => {
    const shots = planShots(base([A, B], 30))
    coverage(shots, 30)
    expect(shots.map((s) => s.layout)).toEqual(['smart', 'smart', 'smart'])
    expect(shots[0].cx).toBeLessThan(0.5)
    expect(shots[1].cx).toBeGreaterThan(0.5)
    expect(shots[1].start).toBeGreaterThanOrEqual(10)
    expect(shots[1].start).toBeLessThan(11.6)
    expect(shots[2].start).toBeGreaterThanOrEqual(20)
    expect(shots[2].start).toBeLessThan(21.6)
  })

  it('Ausschnitt ist je Einstellung fest (cx konstant) und im Bild', () => {
    const w = cropWidth(16 / 9)
    for (const s of planShots(base([A, B], 30))) {
      expect(s.cx - w / 2).toBeGreaterThanOrEqual(-1e-9)
      expect(s.cx + w / 2).toBeLessThanOrEqual(1 + 1e-9)
      expect(s.zoom).toBe(1)
    }
  })

  it('Hysterese: Herausforderer < 1,25× oder < 1 s Führung löst keinen Wechsel aus', () => {
    const a = track(1, 0.3, 0, 20, () => 4)
    const b = track(2, 0.7, 0, 20, (i) => (i >= ticks(5) ? 4.5 : -3)) // nur 1,125×
    expect(new Set(activeSpeakers(base([a, b], 20)))).toEqual(new Set([1]))
    const c = track(2, 0.7, 0, 20, (i) => (i >= ticks(5) && i < ticks(5.6) ? 9 : -3)) // 0,6 s stark
    expect(new Set(activeSpeakers(base([a, c], 20)))).toEqual(new Set([1]))
  })

  it('kein Ping-Pong: schnelle Wechsel ergeben ein Split-Fenster statt vieler Schnitte', () => {
    const turn = ticks(1.5)
    const a = track(1, 0.3, 0, 30, (i) => (Math.floor(i / turn) % 2 === 0 ? 5 : -5))
    const b = track(2, 0.7, 0, 30, (i) => (Math.floor(i / turn) % 2 === 1 ? 5 : -5))
    const shots = planShots(base([a, b], 30))
    coverage(shots, 30)
    expect(shots.some((s) => s.layout === 'split')).toBe(true)
    const split = shots.find((s) => s.layout === 'split')!
    expect(split.cx).toBeLessThan(split.cx2!)
    expect(shots.length).toBeLessThanOrEqual(4)
  })

  it('ignoriert Hintergrundgesichter (< 10 % der größten Fläche)', () => {
    const main = track(1, 0.4, 0, 10, () => 1, 0.1)
    const bg = track(2, 0.9, 0, 10, () => 8, 0.005)
    expect(new Set(activeSpeakers(base([main, bg], 10)))).toEqual(new Set([1]))
  })
})

describe('Layouts', () => {
  it('ohne Gesichter nie ein leerer Ausschnitt: ganzes Bild (fit)', () => {
    const shots = planShots(base([], 12, [20]))
    coverage(shots, 12)
    expect(shots.every((s) => s.layout === 'fit')).toBe(true)
    expect(faceRatio(shots, base([], 12))).toBe(0)
    expect(facePenalty(0)).toBe(20)
  })

  it('Kamerawechsel mit anderem Bildinhalt erzeugt einen neuen Shot, mit gleichem Ausschnitt nicht', () => {
    const t1 = track(1, 0.3, 0, 6, () => 3)
    const t2 = track(2, 0.7, 6, 12, () => 3)
    const shots = planShots(base([t1, t2], 12, [ticks(6)]))
    expect(shots.length).toBe(2)
    expect(shots[1].start).toBeCloseTo(6, 6)
    expect(planShots(base([track(1, 0.3, 0, 12, () => 3)], 12, [ticks(6)])).length).toBe(1)
  })

  it('fragmentierte Tracks derselben Person ergeben kein Split und kein Flackern', () => {
    // zwei Tracks an fast gleicher Stelle, die sich im Sekundentakt abwechseln
    const turn = ticks(1)
    const a = track(1, 0.5, 0, 20, (i) => (Math.floor(i / turn) % 2 === 0 ? 5 : -5))
    const b = track(2, 0.52, 0, 20, (i) => (Math.floor(i / turn) % 2 === 1 ? 5 : -5))
    const shots = planShots(base([a, b], 20))
    expect(shots.some((s) => s.layout === 'split')).toBe(false)
    expect(shots.length).toBe(1)
  })

  it('kurzer Gesichts-Aussetzer (< 1,5 s) wird nicht zu fit', () => {
    const t1 = track(1, 0.4, 0, 6, () => 3)
    const t2 = track(1, 0.4, 7, 14, () => 3)
    const merged: PlanTrack = { id: 1, start: 0, centres: [...t1.centres, ...Array(ticks(1)).fill(0), ...t2.centres], areas: [...t1.areas, ...Array(ticks(1)).fill(0), ...t2.areas], scores: [...t1.scores, ...Array(ticks(1)).fill(0), ...t2.scores] }
    void merged
    const shots = planShots(base([t1, t2], 14))
    expect(shots.some((s) => s.layout === 'fit')).toBe(false)
    coverage(shots, 14)
  })

  it('wandert das Subjekt > 12 %, folgt kein Schwenk, sondern ein weiterer fester Ausschnitt', () => {
    const n = ticks(12)
    const t: PlanTrack = { id: 1, start: 0, centres: Array.from({ length: n }, (_, i) => (i < n / 2 ? 0.3 : 0.5)), areas: Array(n).fill(0.1), scores: Array(n).fill(3) }
    const shots = planShots(base([t], 12))
    coverage(shots, 12)
    expect(shots.length).toBe(2)
    expect(shots[0].cx).toBeCloseTo(0.3, 2)
    expect(shots[1].cx).toBeCloseTo(0.5, 2)
    const drift = planShots(base([{ ...t, centres: t.centres.map((_, i) => 0.3 + (i / n) * 0.06) }], 12))
    expect(drift.length).toBe(1)
  })

  it('kein Sprecher > 3 s: mittiger fester Ausschnitt', () => {
    const t = track(1, 0.3, 0, 20, (i) => (i < ticks(5) || i >= ticks(14) ? 3 : -3))
    const shots = planShots(base([t], 20))
    coverage(shots, 20)
    const quiet = shots.find((s) => s.layout === 'fixed')!
    expect(quiet.cx).toBe(0.5)
    expect(quiet.start).toBeGreaterThanOrEqual(5)
    expect(quiet.end).toBeLessThanOrEqual(14.01)
  })
})

describe('Gesichtsquote', () => {
  it('misst, wie lange ein Gesicht im Ausschnitt ist, und bestraft < 60 %', () => {
    const a = track(1, 0.3, 0, 10, () => 3)
    const inp = base([a], 20) // Gesicht nur in der ersten Hälfte
    const shots = planShots(inp)
    const r = faceRatio(shots, inp)
    expect(r).toBeGreaterThan(0.45)
    expect(r).toBeLessThan(0.55)
    expect(facePenalty(0.8)).toBe(0)
    expect(facePenalty(0.5)).toBe(4)
    expect(facePenalty(0.1)).toBe(20)
  })
})
