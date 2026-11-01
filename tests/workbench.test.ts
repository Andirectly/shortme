import { describe, expect, it } from 'vitest'
import { blindWinRate, evaluate, overview, ratios } from '../src/shared/workbench'
import type { CreatorShort } from '../src/shared/learnData'

const now = Date.parse('2026-06-01')
const d = (daysAgo: number): string => new Date(now - daysAgo * 86_400_000).toISOString()

describe('Leistung', () => {
  it('Median des Kanals ±60 Tage, junge Shorts ohne Wert', () => {
    const r = ratios([{ id: 'a', views: 1000, date: d(100) }, { id: 'b', views: 3000, date: d(90) }, { id: 'c', views: 2000, date: d(80) }, { id: 'old', views: 9999, date: d(400) }, { id: 'new', views: 50, date: d(5) }], now)
    expect(r.b).toBe(1.5)
    expect(r.new).toBeNull()
    expect(r.old).toBeNull() // allein in seinem Zeitfenster
  })
})

const cs = (id: string, start: number, end: number, source: 'creator' | 'reference' = 'creator'): CreatorShort => ({ id, source, title: '', views: 1, likes: 0, comments: 0, date: '', ratio: 1.2, moments: [{ start, end, score: 1 }] })
describe('Auswertung', () => {
  const clips = [{ id: 'k1', start: 98, end: 140 }]
  const trace = [{ start: 300, end: 330, fate: 'finalist' }, { start: 500, end: 530, fate: 'rated' }]
  it('Treffer mit Abweichung und Verlust-Stufen', () => {
    const e = evaluate([cs('a', 100, 140), cs('b', 300, 330), cs('c', 500, 530), cs('d', 800, 830)], clips, trace)
    expect(e[0]).toMatchObject({ hit: true, startDelta: -2, endDelta: 0, clipId: 'k1', lost: null })
    expect(e.slice(1).map((m) => m.lost)).toEqual(['Finalisten-Vergleich', 'Bewertung', 'Kandidatensuche'])
  })
  it('Übersicht zählt nur Creator', () => {
    const e = evaluate([cs('a', 100, 140), cs('b', 300, 330), cs('r', 100, 140, 'reference')], clips, trace)
    const o = overview([{ at: '2026-05-01T10:00:00Z', hash: 'h', wanted: 2, moments: e }])
    expect(o).toMatchObject({ moments: 2, hitRate: 0.5, meanStartDev: 2, lossStages: [{ stage: 'Finalisten-Vergleich', n: 1 }] })
  })
  it('Blindtest-Gewinnquote ohne Unentschieden', () => {
    const s = { kind: 'shortme' as const, id: 's' }, c = { kind: 'creator' as const, id: 'c' }
    expect(blindWinRate([{ at: '', hash: '', left: s, right: c, choice: 'left' }, { at: '', hash: '', left: s, right: c, choice: 'right' }, { at: '', hash: '', left: c, right: s, choice: 'right' }, { at: '', hash: '', left: s, right: c, choice: 'tie' }])).toEqual({ rate: 0.667, decided: 3, total: 4 })
  })
})
