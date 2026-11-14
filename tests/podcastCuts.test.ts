import { describe, expect, it } from 'vitest'
import { alignTracksToCuts, planShots, PLAN_DEFAULTS, type PlanInput, type PlanTrack } from '../src/shared/layoutPlan'

// Podcast mit Kamerawechsel zwischen zwei Personen (nie gleichzeitig im Bild): Mann bei x≈0,40, Frau bei x≈0,65. Raster 0,2 s.
const mk = (id: number, start: number, n: number, cx: number, score: number): PlanTrack => ({ id, start, centres: Array(n).fill(cx), areas: Array(n).fill(0.025), scores: Array(n).fill(score), person: 'p1' })
const input = (cuts: number[], tracks: PlanTrack[], ticks: number): PlanInput => ({ tracks, ticks, dt: 0.2, cuts, sourceAspect: 16 / 9, speech: Array(ticks).fill(true) })
const opt = { ...PLAN_DEFAULTS, allowSplit: true, follow: 'speaker' as const }

describe('Podcast mit Schnitten zwischen den Sprechern', () => {
  // Schnitte bei Tick 10, 20, 30; Tracks ragen (wie gemessen) einen Tick in die neue Szene bzw. beginnen einen Tick danach
  const tracks = [mk(0, 0, 11, 0.4, 1.5), mk(1, 11, 11, 0.65, 1.5), mk(2, 21, 10, 0.4, 1.5), mk(3, 31, 10, 0.65, 1.5)]
  const inp = input([10, 20, 30], tracks, 41)
  it('Tracks werden am Schnitt getrennt bzw. bis zum Schnitt zurückgezogen', () => {
    const a = alignTracksToCuts(inp).tracks
    const ranges = a.map((t) => [t.start, t.start + t.centres.length]).sort((x, y) => x[0] - y[0])
    expect(ranges).toEqual([[0, 10], [10, 20], [20, 30], [30, 41]])
  })
  it('Shot-Grenzen liegen genau auf den Schnitten, jede Szene zeigt ihre eigene Person (nie die Mitte dazwischen)', () => {
    const shots = planShots(inp, opt)
    expect(shots.map((s) => [+s.start.toFixed(1), s.layout])).toEqual([[0, 'smart'], [2, 'smart'], [4, 'smart'], [6, 'smart']])
    expect(shots.map((s) => +s.cx.toFixed(2))).toEqual([0.4, 0.65, 0.4, 0.65])
  })
  it('schneller Wechsel durch Schnitte löst kein Zwei-Personen-Fenster aus', () => {
    // alle 1,4 s ein Schnitt, ein Sprecherwechsel pro Schnitt: früher „Ping-Pong“ → Mittelposition zwischen beiden
    const n = 7, tr: PlanTrack[] = [], cuts: number[] = []
    for (let k = 0; k < 8; k++) { tr.push(mk(k, k * n, n, k % 2 ? 0.65 : 0.4, 1.5)); if (k) cuts.push(k * n) }
    const shots = planShots(input(cuts, tr, 8 * n), opt)
    for (const s of shots) { expect(s.layout).toBe('smart'); expect(Math.abs(s.cx - 0.4) < 0.03 || Math.abs(s.cx - 0.65) < 0.03).toBe(true) }
  })
})
