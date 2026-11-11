import { describe, expect, it } from 'vitest'
import { peakCandidate, signalPeaks } from '../src/main/shortme/clips/peaks'
import type { Signals } from '../src/main/shortme/clips/signals'
import type { Sentence } from '../src/main/shortme/clips/sentences'

const sig = (n: number): Signals => ({ loudness: new Array(n).fill(0), rate: new Array(n).fill(0), burst: new Array(n).fill(0), silence: new Array(n).fill(0), silences: [], noiseFloorDb: -60 })
const sentences = (n: number, len = 5): Sentence[] => Array.from({ length: n }, (_, i) => ({ index: i, first: i * 3, last: i * 3 + 2, start: i * len, end: i * len + len - 0.2, text: `Satz ${i}.` }))

describe('Signal-Spitzen', () => {
  it('findet Lach-/Chat-Ereignisse und hält Abstand', () => {
    const p = signalPeaks(sig(1000), [{ kind: 'laugh', start: 200, end: 204, score: 1 }, { kind: 'laugh', start: 230, end: 233, score: 1 }, { kind: 'chat', start: 700, end: 703, score: 1 }], null, 1000, 5)
    expect(p).toHaveLength(2) // 200 und 230 liegen < 90 s auseinander → nur eine Spitze
    expect(p[0]).toBeGreaterThanOrEqual(198); expect(p[0]).toBeLessThanOrEqual(206)
    expect(p[1]).toBeGreaterThanOrEqual(698); expect(p[1]).toBeLessThanOrEqual(705)
  })
  it('schwache Signale ergeben keine Spitze, Anzahl begrenzt', () => {
    const quiet = sig(600); quiet.loudness.fill(0.3)
    expect(signalPeaks(quiet, [], null, 600, 5)).toEqual([])
    const ev = Array.from({ length: 10 }, (_, i) => ({ kind: 'applause' as const, start: i * 100, end: i * 100 + 3, score: 1 }))
    expect(signalPeaks(sig(1000), ev, null, 1000, 3)).toHaveLength(3)
  })
  it('Chat-Kurve zählt mit', () => {
    const p = signalPeaks(sig(500), null, [{ start: 300, end: 310, value: 0.9 }, { start: 310, end: 320, value: 0.9 }], 500, 2)
    expect(p).toHaveLength(1)
    expect(p[0]).toBeGreaterThanOrEqual(298); expect(p[0]).toBeLessThanOrEqual(322)
  })
})

describe('Kandidat um eine Spitze', () => {
  it('25 s Aufbau davor, 15 s danach, an Satzgrenzen', () => {
    const s = sentences(100)
    const c = peakCandidate(s, 250)!
    expect(s[c.first].start).toBeGreaterThanOrEqual(225 - 5); expect(s[c.first].start).toBeLessThanOrEqual(225)
    expect(s[c.last].end).toBeLessThanOrEqual(265); expect(s[c.last].end).toBeGreaterThanOrEqual(250)
  })
  it('am Anfang und Ende des Transkripts', () => {
    const s = sentences(20)
    expect(peakCandidate(s, 2)!.first).toBe(0)
    expect(peakCandidate(s, 9999)).toBeNull()
  })
})
