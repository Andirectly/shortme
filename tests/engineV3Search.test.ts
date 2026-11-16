import { describe, expect, it } from 'vitest'
import { avWindow, parseAvAnswer } from '../src/main/shortme/clips/engines/v3/avCheck'
import { QUERY_SET, fuseRrf, pickMoments, temporalProposals, temporalWindows } from '../src/main/shortme/clips/engines/v3/search'
import type { RawProposal } from '../src/shared/engineV2'

describe('Engine 3: zeitliche Verortung (Lighthouse)', () => {
  it('Fenster überlappen, bleiben ≤ 150 s und decken das ganze Video ab', () => {
    const w = temporalWindows(3 * 3600 + 17)
    expect(w[0].start).toBe(0)
    expect(w[w.length - 1].end).toBeCloseTo(3 * 3600 + 17, 3)
    for (let i = 0; i < w.length; i++) { expect(w[i].end - w[i].start).toBeLessThanOrEqual(150); if (i) expect(w[i].start).toBeLessThan(w[i - 1].end) }
  })
  it('kurzes Video = ein Fenster, zu kurzes = keines', () => {
    expect(temporalWindows(60)).toEqual([{ start: 0, end: 60 }])
    expect(temporalWindows(3)).toEqual([])
  })
  it('Dubletten aus der Fensterüberlappung fallen weg, Rang zählt, je Anfrage höchstens K', () => {
    const m = pickMoments([
      { query: 'laugh', start: 110, end: 118, score: 0.9 }, { query: 'laugh', start: 111, end: 119, score: 0.7 }, // gleiches Ereignis aus zwei Fenstern
      { query: 'laugh', start: 300, end: 308, score: 0.5 }, { query: 'laugh', start: 500, end: 508, score: 0.4 }, { query: 'fail', start: 40, end: 50, score: 0.3 }
    ], 2)
    const laugh = m.filter((x) => x.query === 'laugh')
    expect(laugh.map((x) => x.score)).toEqual([0.9, 0.5])
    expect(m.filter((x) => x.query === 'fail')).toHaveLength(1)
  })
  it('Vorschläge tragen Kanal „temporal“, Beleg ist signal-only (nicht „geprüft“)', () => {
    const { proposals, evidence } = temporalProposals([{ query: 'laugh', start: 100, end: 108, score: 0.8 }], QUERY_SET, 'm', 1000)
    expect(proposals[0].channel).toBe('temporal')
    expect(evidence[0].state).toBe('signal-only')
    expect(proposals[0].end - proposals[0].start).toBeGreaterThanOrEqual(15)
  })
  it('Rangfusion arbeitet je Kanal: Embedding und Lighthouse werden nicht in einen Rang gemischt', () => {
    const mk = (channel: string, strength: number): RawProposal => ({ start: 0, end: 20, source: 'visual', channel, strength })
    const out = fuseRrf([mk('visual-embed', 0.99), mk('visual-embed', 0.5), mk('temporal', 0.2)])
    expect(out.filter((r) => r.channel === 'temporal')[0].strength).toBe(1) // bester seines Kanals trotz kleinem Rohwert
  })
})

describe('Engine 3: Bild+Ton-Prüfung (MiniCPM-o)', () => {
  const ok = '{"visible":"Mann lacht","audible":"Gelächter","laughter":true,"music":false,"performance":false,"reaction":true,"payoff":true,"needs_setup":false,"unsure":false}'
  it('gültige Antwort wird gelesen, auch mit Text drumherum', () => {
    const a = parseAvAnswer(`Hier: ${ok} Ende`)
    expect(a.laughter).toBe(true); expect(a.visible).toBe('Mann lacht')
  })
  it('fehlende oder falsch typisierte Felder sind ein Fehler (kein stilles Ergänzen)', () => {
    expect(() => parseAvAnswer(ok.replace('"laughter":true,', ''))).toThrow()
    expect(() => parseAvAnswer(ok.replace('"music":false', '"music":"nein"'))).toThrow()
    expect(() => parseAvAnswer('kein json')).toThrow()
  })
  it('Prüffenster liegt um den Anker, ≤ 30 s, ≥ 8 s und im Video', () => {
    const w = avWindow({ start: 100, end: 400, anchor: 250 }, 1000)
    expect(w.end - w.start).toBeLessThanOrEqual(30); expect(w.start).toBeGreaterThanOrEqual(100)
    const e = avWindow({ start: 0, end: 4, anchor: 2 }, 1000)
    expect(e.end - e.start).toBeGreaterThanOrEqual(8)
    expect(avWindow({ start: 990, end: 1000, anchor: 999 }, 1000).end).toBeLessThanOrEqual(1000)
  })
})
