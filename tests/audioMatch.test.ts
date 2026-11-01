import { describe, expect, it } from 'vitest'
import { features, FEAT_SR, locate, matchByText } from '../src/shared/audioMatch'

// Pseudo-Sprache: Rauschen, dessen Klangfarbe und Lautstärke sich alle ~0,2 s ändern (deterministisch)
function audio(seconds: number, seed: number): Float32Array {
  let s = seed
  const rnd = (): number => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296) - 0.5
  const out = new Float32Array(seconds * FEAT_SR)
  let tone = 0, amp = 1, f = 300
  for (let i = 0; i < out.length; i++) {
    if (i % 1600 === 0) { f = 150 + (rnd() + 0.5) * 2500; amp = 0.2 + (rnd() + 0.5) * 3 }
    tone += (2 * Math.PI * f) / FEAT_SR
    out[i] = amp * (0.7 * Math.sin(tone) + 0.6 * rnd()) * 3000
  }
  return out
}

describe('Tonabgleich', () => {
  it('findet Ausschnitt und zwei getrennte Abschnitte (mit Rauschen und Lautstärke-Änderung)', () => {
    const long = audio(240, 1)
    const cut = (a: number, b: number): Float32Array => long.slice(a * FEAT_SR, b * FEAT_SR)
    const parts = [cut(50, 70), cut(150, 166)]
    const short = new Float32Array(parts[0].length + parts[1].length)
    short.set(parts[0]); short.set(parts[1], parts[0].length)
    for (let i = 0; i < short.length; i++) short[i] = short[i] * 0.6 + (((i * 7919) % 1000) - 500) * 2
    const m = locate(features(short), features(long))
    expect(m.length).toBe(2)
    expect(m[0].start).toBeGreaterThan(48); expect(m[0].start).toBeLessThan(52); expect(m[0].end).toBeGreaterThan(68); expect(m[0].end).toBeLessThan(72)
    expect(m[1].start).toBeGreaterThan(148); expect(m[1].end).toBeLessThan(168)
  }, 30000)
  it('findet nichts bei fremdem Ton', () => {
    expect(locate(features(audio(20, 99)), features(audio(120, 1)))).toEqual([])
  }, 30000)
})

describe('Text-Rückfall', () => {
  const text = 'wir haben gestern lange über das neue projekt gesprochen und am ende war klar dass der plan nicht funktionieren kann weil das budget fehlt und niemand die verantwortung übernehmen will also haben wir neu angefangen'
  const long = text.split(' ').map((w, i) => ({ w, start: i * 0.4, end: i * 0.4 + 0.35 }))
  it('ordnet Wortfolge zu', () => {
    const m = matchByText('Am Ende war klar, dass der Plan nicht funktionieren kann, weil das Budget fehlt'.split(' '), long)
    expect(m.length).toBe(1)
    expect(m[0].start).toBeCloseTo(long[10].start, 1)
  })
  it('ignoriert Fremdes', () => { expect(matchByText('heute kochen wir eine suppe mit kartoffeln und lauch aus dem garten'.split(' '), long)).toEqual([]) })
})
