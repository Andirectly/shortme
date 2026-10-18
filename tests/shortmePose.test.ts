import { describe, expect, it } from 'vitest'
import { decodePose, mergeFacesAndHeads } from '../src/main/pipeline/pose'

/** Ein Treffer in der YOLO-Ausgabe [56, N] (N = 1), Koordinaten im 640er-Letterbox-Raum (scale 1, kein Padding). */
function out(kps: Record<number, [number, number, number]>): Float32Array {
  const a = new Float32Array(56)
  a[0] = 320; a[1] = 320; a[2] = 200; a[3] = 400; a[4] = 0.9
  for (const [k, [x, y, c]] of Object.entries(kps)) { a[5 + +k * 3] = x; a[6 + +k * 3] = y; a[7 + +k * 3] = c }
  return a
}
const lb = { scale: 1, padX: 0, padY: 0 }

describe('Pose', () => {
  it('Kopfbox aus Nase und Ohren', () => {
    const [p] = decodePose(out({ 0: [320, 200, 0.9], 3: [290, 205, 0.9], 4: [350, 205, 0.9] }), 1, lb, 640, 640)
    expect(p.source).toBe('face-points')
    expect(p.head!.x1).toBeLessThan(0.5)
    expect(p.head!.x2).toBeGreaterThan(0.5)
  })
  it('Profil ohne Gesichtspunkte: Kopf über den Schultern', () => {
    const [p] = decodePose(out({ 5: [260, 300, 0.9], 6: [380, 300, 0.9] }), 1, lb, 640, 640)
    expect(p.source).toBe('shoulders')
    expect(p.noseVisible).toBe(false)
    expect(p.head!.y2).toBeLessThan(300 / 640)
  })
  it('Pose-Kopf ergänzt nur Personen ohne Gesicht', () => {
    const [p] = decodePose(out({ 5: [260, 300, 0.9], 6: [380, 300, 0.9] }), 1, lb, 640, 640)
    expect(mergeFacesAndHeads([], [p])).toHaveLength(1)
    const face = { x1: 0.45, y1: 0.2, x2: 0.55, y2: 0.3, score: 0.9 }
    expect(mergeFacesAndHeads([face], [p])).toHaveLength(1)
  })
})
