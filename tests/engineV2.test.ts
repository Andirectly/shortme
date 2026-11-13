import { describe, expect, it } from 'vitest'
import { autoCutsOf, bradleyTerry, checkKeep, clampRange, clusterProposals, combineOrders, isConnected, outputDuration, pickDetailSet, rankOrder, scheduleMatches, validRange, V2_LIMITS, type MatchResult, type RawProposal } from '../src/shared/engineV2'

const D = 10_800 // 3 Stunden

describe('Zeiten', () => {
  it('nur endliche, geordnete Zeiten innerhalb des Videos sind gültig', () => {
    expect(validRange(1, 5, D)).toBe(true)
    for (const [a, b] of [[NaN, 5], [1, Infinity], [5, 5], [6, 5], [-1, 5], [1, D + 10], ['1', 5]]) expect(validRange(a, b, D)).toBe(false)
    expect(clampRange(-5, 3, D)).toEqual({ start: 0, end: 3 })
    expect(clampRange(D - 0.05, D + 50, D)).toBeNull()
  })
  it('Schnittplan: Stückzahl, Reihenfolge, Überlappung; Ausgabelänge ist die Summe der Stücke', () => {
    expect(checkKeep([{ start: 10, end: 40 }], D)).toBeNull()
    expect(checkKeep([{ start: 10, end: 20 }, { start: 25, end: 40 }, { start: 50, end: 60 }], D)).toBeNull()
    expect(checkKeep([], D)).toMatch(/keine/)
    expect(checkKeep(Array.from({ length: 4 }, (_, i) => ({ start: i * 20, end: i * 20 + 10 })), D)).toMatch(/mehr als 3/)
    expect(checkKeep([{ start: 30, end: 40 }, { start: 20, end: 29 }], D)).toMatch(/vor dem vorigen/)
    expect(checkKeep([{ start: 10, end: 20 }, { start: 19, end: 30 }], D)).toMatch(/überlappt/)
    expect(checkKeep([{ start: 10, end: 11 }, { start: 20, end: 30 }], D)).toMatch(/zu kurz/)
    const keep = [{ start: 100, end: 120 }, { start: 130, end: 150 }, { start: 200, end: 210 }]
    expect(outputDuration(keep)).toBe(50) // nicht 210 − 100
    expect(autoCutsOf(keep)).toEqual([{ start: 120, end: 130 }, { start: 150, end: 200 }])
    expect(autoCutsOf([{ start: 1, end: 5 }])).toEqual([])
  })
})

describe('Ereignisse bilden', () => {
  const p = (start: number, end: number, source: RawProposal['source'], strength = 0.5, extra: Partial<RawProposal> = {}): RawProposal => ({ start, end, source, strength, ...extra })
  it('derselbe Moment aus Text, Ton und Bild wird ein Ereignis mit allen Fundquellen', () => {
    const ev = clusterProposals([p(1000, 1040, 'text', 0.7, { kind: 'witz', summary: 'Rap' }), p(1010, 1035, 'audio', 0.9), p(1020, 1030, 'visual', 0.4)], D)
    expect(ev).toHaveLength(1)
    expect(ev[0].foundBy.sort()).toEqual(['audio', 'text', 'visual'])
    expect(ev[0].kind).toBe('witz')
    expect(ev[0].start).toBe(1000); expect(ev[0].end).toBe(1040)
  })
  it('verschiedene nahe Momente werden nicht pauschal unterdrückt', () => {
    const ev = clusterProposals([p(1000, 1030, 'text'), p(1060, 1090, 'text'), p(1120, 1150, 'text')], D)
    expect(ev).toHaveLength(3)
  })
  it('ungültige Rohvorschläge fallen heraus, Ankerzeit außerhalb wird zur Mitte', () => {
    const ev = clusterProposals([p(NaN, 5, 'text'), p(50, 20, 'audio'), p(100, 140, 'audio', 0.5, { anchor: 9999 })], D)
    expect(ev).toHaveLength(1)
    expect(ev[0].anchor).toBe(120)
  })
})

describe('Detailprüfung verteilen', () => {
  it('Abdeckung über die ganze Zeitachse, nicht nur das erste Drittel; jede Quelle hat ihre Reserve', () => {
    const raw: RawProposal[] = []
    // sehr viele starke Text-Treffer im ersten Drittel, wenige schwache Ton-/Bildtreffer weit hinten
    for (let i = 0; i < 300; i++) raw.push({ start: 20 + i * 11, end: 50 + i * 11, source: 'text', strength: 0.9 })
    for (let i = 0; i < 5; i++) raw.push({ start: 7000 + i * 600, end: 7030 + i * 600, source: 'audio', strength: 0.3 })
    for (let i = 0; i < 5; i++) raw.push({ start: 9000 + i * 300, end: 9030 + i * 300, source: 'visual', strength: 0.2 })
    const events = clusterProposals(raw, D)
    const r = pickDetailSet(events, D, 50, 4)
    expect(r.picked.length).toBeLessThanOrEqual(50)
    expect(r.picked.filter((e) => e.foundBy.includes('audio')).length).toBeGreaterThanOrEqual(4)
    expect(r.picked.filter((e) => e.foundBy.includes('visual')).length).toBeGreaterThanOrEqual(4)
    expect(r.skipped.every((s) => s.reason.length > 0)).toBe(true)
    expect(r.bins).toBeGreaterThan(1)
  })
  it('gleichmäßig über 3 Stunden: alle Drittel kommen vor, wenn überall Kandidaten liegen', () => {
    const raw: RawProposal[] = Array.from({ length: 360 }, (_, i) => ({ start: i * 30, end: i * 30 + 25, source: 'text' as const, strength: 0.5 + (i % 7) / 20 }))
    const r = pickDetailSet(clusterProposals(raw, D), D, 50, 0)
    const thirds = [0, 0, 0]
    for (const e of r.picked) thirds[Math.min(2, Math.floor((e.anchor / D) * 3))]++
    expect(Math.min(...thirds)).toBeGreaterThanOrEqual(10)
  })
})

describe('Globaler Vergleich', () => {
  it('Begegnungsplan: zusammenhängend, ohne Doppelungen, gewünschte Zahl (24 Finalisten, 36 Begegnungen)', () => {
    const m = scheduleMatches(24, V2_LIMITS.matches, 7)
    expect(m).toHaveLength(36)
    expect(new Set(m.map(([a, b]) => (a < b ? `${a}-${b}` : `${b}-${a}`))).size).toBe(36)
    expect(isConnected(24, m.map(([a, b]) => ({ a, b })))).toBe(true)
    expect(scheduleMatches(3, 36, 1)).toHaveLength(3) // nie mehr Paare als möglich
    expect(scheduleMatches(1, 5, 1)).toEqual([])
    expect(scheduleMatches(24, 36, 7)).toEqual(scheduleMatches(24, 36, 7)) // reproduzierbar
  })
  it('Bradley-Terry ordnet nach Stärke, Unentschieden zählt halb, „beide schwach“ gar nicht', () => {
    const results: MatchResult[] = [{ a: 0, b: 1, outcome: 'a' }, { a: 1, b: 2, outcome: 'a' }, { a: 0, b: 2, outcome: 'a' }, { a: 0, b: 1, outcome: 'a' }, { a: 3, b: 0, outcome: 'tie' }, { a: 3, b: 2, outcome: 'bothWeak' }, { a: 3, b: 1, outcome: 'a' }]
    const s = bradleyTerry(4, results)!
    const order = rankOrder(s)
    expect(order[0]).toBe(0)
    expect(order.indexOf(2)).toBeGreaterThan(order.indexOf(1))
    expect(s.reduce((a, b) => a + b, 0) / 4).toBeCloseTo(1, 5)
  })
  it('nicht zusammenhängender Graph → kein erfundener Rang', () => {
    expect(bradleyTerry(4, [{ a: 0, b: 1, outcome: 'a' }, { a: 2, b: 3, outcome: 'b' }])).toBeNull()
    // „beide schwach“ verbindet nicht
    expect(bradleyTerry(3, [{ a: 0, b: 1, outcome: 'a' }, { a: 1, b: 2, outcome: 'bothWeak' }])).toBeNull()
  })
  it('beide Reihenfolgen: Einigkeit gewinnt, Uneinigkeit ist Unentschieden (Positions-Bias)', () => {
    expect(combineOrders('A', 'B')).toBe('a') // a gewinnt in beiden Reihenfolgen
    expect(combineOrders('B', 'A')).toBe('b')
    expect(combineOrders('A', 'A')).toBe('tie') // gewinnt immer die erste Position → Bias
    expect(combineOrders('tie', 'tie')).toBe('tie')
    expect(combineOrders('bothWeak', 'bothWeak')).toBe('bothWeak')
  })
})
