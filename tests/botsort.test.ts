import { describe, expect, it } from 'vitest'
import { associationCost, BOTSORT_DEFAULTS, buildBotSortTracks, hungarian, invert, kInit, kPredict, kUpdate, trackShot, type TDet } from '../src/main/pipeline/botsort'
import type { FaceBox } from '../src/main/pipeline/speaker'

const box = (cx: number, cy = 0.4, w = 0.1, h = 0.14, score = 0.9): FaceBox => ({ x1: cx - w / 2, y1: cy - h / 2, x2: cx + w / 2, y2: cy + h / 2, score })
const vec = (...v: number[]): Float32Array => { const n = Math.hypot(...v); return Float32Array.from(v.map((x) => x / n)) }
const A = vec(1, 0.1, 0), B = vec(0, 1, 0.1)

describe('BoT-SORT Bausteine', () => {
  it('Hungarian findet die günstigste Zuordnung (rechteckig)', () => {
    expect(hungarian([[4, 1, 3], [2, 0, 5], [3, 2, 2]]).sort()).toEqual([[0, 1], [1, 0], [2, 2]])
    expect(hungarian([[1, 9], [9, 1], [5, 5]]).sort()).toEqual([[0, 0], [1, 1]])
    expect(hungarian([])).toEqual([])
  })
  it('Matrixinversion', () => {
    const m = invert([[2, 0], [1, 3]])
    expect(m[0][0]).toBeCloseTo(0.5); expect(m[1][0]).toBeCloseTo(-1 / 6); expect(m[1][1]).toBeCloseTo(1 / 3)
  })
  it('Kalman folgt gleichmäßiger Bewegung und sagt voraus', () => {
    let k = kInit([0.3, 0.4, 0.1, 0.14])
    for (let i = 1; i <= 8; i++) { k = kPredict(k); k = kUpdate(k, [0.3 + 0.02 * i, 0.4, 0.1, 0.14]) }
    const next = kPredict(k)
    expect(next.mean[0]).toBeGreaterThan(0.3 + 0.02 * 8)
    expect(next.mean[0]).toBeLessThan(0.3 + 0.02 * 10 + 0.01)
  })
  it('Kosten: gleiche Person günstig, anderer Ort teuer; Aussehen rettet bei Positionssprung', () => {
    const p = BOTSORT_DEFAULTS
    const near = associationCost([{ box: box(0.3), feat: A }], [{ box: box(0.31), emb: A }], p)[0][0]
    const far = associationCost([{ box: box(0.3), feat: A }], [{ box: box(0.8), emb: B }], p)[0][0]
    const jumpSame = associationCost([{ box: box(0.3), feat: A }], [{ box: box(0.33), emb: A }], p)[0][0]
    expect(near).toBeLessThan(0.3)
    expect(far).toBeGreaterThan(p.matchThresh)
    expect(jumpSame).toBeLessThan(p.matchThresh)
    // ohne Überlappung (Näherungs-Schwelle) hilft das Aussehen nicht – wie in boxmot
    expect(associationCost([{ box: box(0.3), feat: A }], [{ box: box(0.6), emb: A }], p)[0][0]).toBeGreaterThan(p.matchThresh)
  })
})

describe('Spuren über eine Einstellung', () => {
  const step = (...ds: Array<[number, Float32Array]>): TDet[] => ds.map(([cx, e]) => ({ box: box(cx), emb: e }))
  it('Person verschwindet kurz (Profil) und taucht an anderer Stelle auf: gleiche Spur dank Aussehen', () => {
    const frames = [0, 5, 10, 15, 20, 25, 30, 35, 40]
    const steps = [step([0.3, A]), step([0.3, A]), step([0.3, A]), [], [], step([0.33, A]), step([0.33, A]), step([0.33, A]), step([0.33, A])]
    const t = trackShot(frames, steps, 45)
    expect(t.length).toBe(1)
    expect(t[0].detections.length).toBe(7)
  })
  it('zwei Personen tauschen den Platz: Aussehen hält die IDs (ohne ReID wäre es ein Wechsel)', () => {
    const frames = Array.from({ length: 40 }, (_, i) => i * 5)
    // A läuft von 0.2 nach 0.7, B von 0.7 nach 0.2 (kreuzen sich bei Schritt 6)
    const steps = frames.map((_, i) => step([0.2 + 0.5 * (i / 39), A], [0.7 - 0.5 * (i / 39), B]))
    const withReid = trackShot(frames, steps, 200, BOTSORT_DEFAULTS, true)
    const startsA = withReid.filter((t) => t.detections[0].box.x1 < 0.3)
    expect(startsA.length).toBe(1)
    expect(startsA[0].detections.length).toBe(40)
    expect(startsA[0].detections[39].box.x1).toBeGreaterThan(0.6) // A endet rechts
  })
  it('Kamerawechsel startet den Tracker neu: je Einstellung eigene Spuren', () => {
    const facesPerFrame: Array<FaceBox[] | null> = Array.from({ length: 80 }, (_, f) => (f % 5 === 0 ? [box(0.4)] : null))
    const emb = facesPerFrame.map((f) => (f ? [A] : null))
    const tracks = buildBotSortTracks(facesPerFrame, emb, [40], 25)
    expect(tracks.length).toBe(2)
    expect(tracks[0].start).toBe(0)
    expect(tracks[1].start).toBe(40)
  })
  it('einmalige Fehlerkennung wird keine Spur', () => {
    const frames = [0, 5, 10, 15, 20, 25]
    const steps = [step([0.3, A]), step([0.3, A], [0.9, B]), step([0.3, A]), step([0.3, A]), step([0.3, A]), step([0.3, A])]
    const t = trackShot(frames, steps, 30)
    expect(t.filter((x) => x.detections.length >= 3).length).toBe(1)
  })
})
