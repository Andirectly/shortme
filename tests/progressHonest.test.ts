import { describe, expect, it } from 'vitest'
import { etaRange, fmtElapsed, measuredStep } from '../src/shared/estimate'

describe('Ehrlicher Fortschritt', () => {
  it('Zähler nur bei echtem Nenner', () => {
    expect(measuredStep('Bewerten (3/12) …')).toEqual({ done: 3, total: 12 })
    expect(measuredStep('Bild-Embeddings 64/111 Fenster …')).toEqual({ done: 64, total: 111 })
    expect(measuredStep('Kandidaten suchen …')).toBeNull()
    expect(measuredStep('x 5/0')).toBeNull()
    expect(measuredStep('x 7/3')).toBeNull()
    expect(measuredStep(undefined)).toBeNull()
  })
  it('Restzeit als Spanne, unbekannt = „Wird ermittelt“', () => {
    expect(etaRange(0)).toBe('Wird ermittelt')
    expect(etaRange(Number.NaN)).toBe('Wird ermittelt')
    expect(etaRange(30)).toBe('unter 1 Min')
    expect(etaRange(20 * 60)).toBe('ca. 16–25 Min')
    expect(etaRange(5 * 60)).toBe('ca. 4–7 Min')
    expect(etaRange(70)).toBe('unter 2 Min')
  })
  it('vergangene Zeit', () => {
    expect(fmtElapsed(45)).toBe('45 s')
    expect(fmtElapsed(12 * 60 + 5)).toBe('12 Min')
    expect(fmtElapsed(65 * 60)).toBe('1 Std 05 Min')
  })
})
