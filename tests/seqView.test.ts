import { describe, expect, it } from 'vitest'
import { seqView } from '../src/shared/seqView'

describe('Sequenzansicht', () => {
  it('ohne Plan = Quellzeit', () => {
    const v = seqView([], 100)
    expect([v.a0, v.a1, v.fwd(42), v.inv(42)]).toEqual([0, 100, 42, 42])
  })
  it('Gelöschtes schließt sich, Ränder zum Verlängern', () => {
    // Clip 60–90 mit gelöschtem Stück 70–80 → 20 s Export
    const v = seqView([[60, 70], [80, 90]], 150)
    expect(v.len).toBe(20)
    expect([v.a0, v.a1]).toEqual([-4, 24])
    expect(v.fwd(65)).toBe(5)
    expect(v.fwd(75)).toBe(10) // im gelöschten Stück → Anschlussstelle
    expect(v.fwd(85)).toBe(15)
    expect(v.fwd(90)).toBe(20)
    expect(v.fwd(58)).toBe(-2) // Rand vorn
    expect(v.inv(12)).toBe(82)
    expect(v.inv(-1)).toBe(59)
    expect(v.inv(22)).toBe(92)
  })
  it('verschobenes Stück steht vorn', () => {
    const v = seqView([[80, 90], [60, 80]], 150)
    expect(v.fwd(85)).toBe(5)
    expect(v.fwd(60)).toBe(10)
    expect(v.inv(15)).toBe(65)
  })
})
