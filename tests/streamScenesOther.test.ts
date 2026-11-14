import { describe, expect, it } from 'vitest'
import { mergeStreamScenes, sameCam } from '../src/main/shortme/layout/streamShots'
import { defaultStream } from '../src/shared/streamLayout'

const dims = { width: 1920, height: 1080 }
const base = defaultStream(dims, { x: 0.74, y: 0.55, w: 0.25, h: 0.44 })
const other = defaultStream(dims, { x: 0.02, y: 0.05, w: 0.22, h: 0.4 })
const planned = [{ start: 0, end: 30, layout: 'smart' as const, cx: 0.4, zoom: 1 }]

describe('Weitere Facecam in einer Szene (anderer Streamer)', () => {
  it('Szene mit eigener Facecam bekommt deren Layout, die übrigen die Kanal-Facecam, ohne Smart-Zwischenstück', () => {
    const shots = mergeStreamScenes(100, 130, planned, [
      { start: 100, end: 110, cam: true },
      { start: 110, end: 120, cam: true, stream: other },
      { start: 120, end: 130, cam: true }
    ], base)
    expect(shots.map((s) => s.layout)).toEqual(['stream', 'stream', 'stream'])
    expect(shots[0].stream?.cam).toEqual(base.cam)
    expect(shots[1].stream?.cam).toEqual(other.cam) // andere Kamera = eigener Shot (harter Schnitt, kein Zusammenfassen)
    expect(shots[2].stream?.cam).toEqual(base.cam)
    expect(shots[0].start).toBe(0); expect(shots[2].end).toBe(30)
  })
  it('gleiche Kamera in Folge wird zu einem Shot zusammengefasst; ohne Facecam bleibt der Smart-Plan', () => {
    const shots = mergeStreamScenes(100, 130, planned, [
      { start: 100, end: 115, cam: true, stream: other },
      { start: 115, end: 125, cam: true, stream: { ...other, cam: { ...other.cam, x: other.cam.x + 0.005 } } },
      { start: 125, end: 130, cam: false }
    ], base)
    expect(shots).toHaveLength(2)
    expect(shots[0].layout).toBe('stream'); expect(shots[0].end).toBe(25)
    expect(shots[1].layout).toBe('smart')
  })
  it('sameCam: Überdeckung entscheidet', () => {
    expect(sameCam(base.cam, { ...base.cam, x: base.cam.x + 0.004 })).toBe(true)
    expect(sameCam(base.cam, other.cam)).toBe(false)
  })
})
