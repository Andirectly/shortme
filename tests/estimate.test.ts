import { describe, expect, it } from 'vitest'
import { STAGES, estimateStages, fmtEta, fractionOf, remainingSec, spans, totalSec } from '../src/shared/estimate'

describe('Dauer-Schätzung', () => {
  it('Referenz: 1 h 47 mit 1 Clip ≈ 25 min (5 Transkription, 10 Kamerawechsel, 3 KI-Teil)', () => {
    const e = estimateStages(6420, 1)
    expect(e.asr / 60).toBeGreaterThan(4.5); expect(e.asr / 60).toBeLessThan(6)
    expect(e.shots / 60).toBeGreaterThan(9); expect(e.shots / 60).toBeLessThan(11)
    expect(totalSec(e) / 60).toBeGreaterThan(20); expect(totalSec(e) / 60).toBeLessThan(30)
  })
  it('lange VOD mit 50 Clips dauert länger als kurzes Video, `scale` rechnet linear um', () => {
    const short = totalSec(estimateStages(1200))
    const vod = totalSec(estimateStages(3 * 3600, 50))
    expect(vod).toBeGreaterThan(short * 5)
    expect(totalSec(estimateStages(3 * 3600, 50, 2))).toBeCloseTo(vod * 2, 5)
  })
  it('Spannen sind lückenlos, zeitgewichtet und decken 0…1 ab', () => {
    const { stage, row } = spans(estimateStages(3 * 3600, 50))
    expect(stage[STAGES[0]][0]).toBe(0)
    expect(stage[STAGES[STAGES.length - 1]][1]).toBeCloseTo(1, 10)
    for (let i = 1; i < STAGES.length; i++) expect(stage[STAGES[i]][0]).toBeCloseTo(stage[STAGES[i - 1]][1], 10)
    expect(row[0][0]).toBe(0); expect(row[2][1]).toBeCloseTo(1, 10)
    expect(row[0][1]).toBeCloseTo(row[1][0], 10); expect(row[1][1]).toBeCloseTo(row[2][0], 10)
  })
  it('Themenkarte und Untertitel-Prüfung springen nicht mehr zurück; unbekannte Stufe → null', () => {
    const { stage } = spans(estimateStages(7200))
    const topics = fractionOf('topics', 0.5, stage)!
    const proof = fractionOf('proofread', 0.5, stage)!
    expect(topics).toBeGreaterThan(0.3)
    expect(proof).toBeGreaterThan(topics)
    expect(fractionOf('llm', 0, stage)).toBe(stage.topics[0])
    expect(fractionOf('export', 0.5, stage)).toBeNull()
  })
  it('Restzeit: am Anfang Schätzung × Tempo, später gemessenes Tempo seit dem ersten Stand', () => {
    const e = estimateStages(3600)
    const t = totalSec(e)
    expect(remainingSec(e, 0, 0, 0, 1)).toBeCloseTo(t, 5)
    expect(remainingSec(e, 0, 0, 0, 2)).toBeCloseTo(t * 2, 5)
    // 50 % in 2·t/2 Sekunden → Tempo 2 → noch t Sekunden
    expect(remainingSec(e, 0.5, 0, t, 1)).toBeCloseTo(t, 5)
    // schon fertige Stufen (Start bei 0,4) verfälschen das Tempo nicht
    expect(remainingSec(e, 0.7, 0.4, 0.3 * t, 1)).toBeCloseTo(0.3 * t, 5)
  })
  it('Zeitformat', () => {
    expect(fmtEta(30)).toBe('unter 1 Min')
    expect(fmtEta(7 * 60)).toBe('7 Min')
    expect(fmtEta(32 * 60)).toBe('30 Min')
    expect(fmtEta(75 * 60)).toBe('1 Std 15 Min')
    expect(fmtEta(120 * 60)).toBe('2 Std')
  })
})
