import { describe, expect, it } from 'vitest'
import { pickStableFace, sameSpot, type FaceN } from '../src/shared/camEdges'

// Facecam-Gesicht (4 % der Breite, 9 % der Höhe), Kopf wandert um etwa eine Gesichtsbreite – gemessen an der Test-VOD
const face = (x1: number, y1 = 0.1): FaceN => ({ x1, y1, x2: x1 + 0.036, y2: y1 + 0.085 })

describe('Facecam-Gesicht: gleiche Stelle', () => {
  it('Kopfbewegung um eine Gesichtsbreite bleibt dieselbe Kamera (IoU wäre 0)', () => {
    expect(sameSpot(face(0.165), face(0.126))).toBe(true)
    expect(sameSpot(face(0.165), face(0.7, 0.6))).toBe(false)
  })
  it('stabiles Gesicht trotz Bewegung, anderes Gesicht im Spiel stört nicht', () => {
    const frames = [0.165, 0.161, 0.126, 0.136, 0.15, 0.14].map((x) => [face(x)])
    frames[2].push({ x1: 0.6, y1: 0.5, x2: 0.65, y2: 0.6 }) // Spielfigur
    const s = pickStableFace(frames)
    expect(s).not.toBeNull()
    expect(s!.share).toBe(1)
    expect(s!.face.x1).toBeGreaterThan(0.12); expect(s!.face.x1).toBeLessThan(0.17)
  })
  it('Gesicht, das nur in wenigen Stichproben an der Stelle ist, zählt nicht', () => {
    const frames: FaceN[][] = [[face(0.15)], [face(0.15)], [], [], [], [], []]
    expect(pickStableFace(frames)).toBeNull()
  })
})
