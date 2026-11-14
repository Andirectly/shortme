import { describe, expect, it } from 'vitest'
import { mergeShortShots } from '../src/shared/shots'

const sh = (start: number, end: number, layout: string): { start: number; end: number; layout: string } => ({ start, end, layout })
describe('Zu kurze Einstellungen', () => {
  it('Blitz-Einstellung (0,11 s) geht in die vorige über, ohne Lücke', () => {
    const r = mergeShortShots([sh(0, 2.49, 'stream'), sh(2.49, 2.6, 'fit'), sh(2.6, 5.89, 'smart')])
    expect(r.map((s) => s.layout)).toEqual(['stream', 'smart'])
    expect(r[0].end).toBeCloseTo(2.6, 6); expect(r[1].start).toBeCloseTo(2.6, 6)
  })
  it('kurze erste Einstellung geht in die folgende; lange bleiben; einzelne bleibt', () => {
    expect(mergeShortShots([sh(0, 0.3, 'a'), sh(0.3, 5, 'b')]).map((s) => [s.layout, s.start])).toEqual([['b', 0]])
    expect(mergeShortShots([sh(0, 3, 'a'), sh(3, 6, 'b')])).toHaveLength(2)
    expect(mergeShortShots([sh(0, 0.2, 'a')])).toHaveLength(1)
  })
})

import { snapShotsToCuts } from '../src/shared/shots'
import { exactCut } from '../src/main/shortme/clips/scenes'
describe('Layout-Wechsel am Videoschnitt', () => {
  it('rastet Grenzen im 0,35-s-Umfeld exakt auf den Schnitt, andere bleiben', () => {
    const r = snapShotsToCuts([sh(0, 4.2, 'a'), sh(4.2, 9, 'b'), sh(9, 12, 'c')], 100, [104.1333, 190])
    expect(r[0].end).toBeCloseTo(4.1333, 4); expect(r[1].start).toBeCloseTo(4.1333, 4)
    expect(r[1].end).toBe(9); expect(r[2].start).toBe(9) // kein Schnitt in der Nähe
  })
  it('staucht keine Einstellung auf null', () => {
    const r = snapShotsToCuts([sh(0, 0.3, 'a'), sh(0.3, 5, 'b')], 0, [0.05])
    expect(r[1].start).toBe(0.3)
  })
  it('findet den Sprung zwischen zwei Originalbildern (Mitte zwischen alt und neu)', () => {
    const dark = new Uint8Array(100).fill(20), light = new Uint8Array(100).fill(200)
    const times = [10.0, 10.0333, 10.0667, 10.1, 10.1333, 10.1667]
    const frames = [dark, dark, dark, light, light, light]
    expect(exactCut(times, frames, 10.09)).toBeCloseTo((10.0667 + 10.1) / 2, 4)
    expect(exactCut(times, [dark, dark, dark, dark, dark, dark], 10.09)).toBe(10.09) // kein klarer Sprung
  })
})
