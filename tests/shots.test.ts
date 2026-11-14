import { describe, expect, it } from 'vitest'
import { mergeShortShots } from '../src/shared/shots'

const sh = (start: number, end: number, layout: string): { start: number; end: number; layout: string } => ({ start, end, layout })
describe('Zu kurze Einstellungen', () => {
  it('Blitz-Einstellung (0,11 s) geht in die vorige über, ohne Lücke', () => {
    const r = mergeShortShots([sh(0, 2.49, 'stream'), sh(2.49, 2.6, 'fit'), sh(2.6, 5.89, 'smart')])
    expect(r.map((s) => s.layout)).toEqual(['stream', 'smart'])
    expect(r[0].end).toBeCloseTo(2.6, 6); expect(r[1].start).toBeCloseTo(2.6, 6)
  })
  it('kurze erste Einstellung geht in die folgende; lange bleiben; einzelne bleibt', () => {
    expect(mergeShortShots([sh(0, 0.3, 'a'), sh(0.3, 5, 'b')]).map((s) => [s.layout, s.start])).toEqual([['b', 0]])
    expect(mergeShortShots([sh(0, 3, 'a'), sh(3, 6, 'b')])).toHaveLength(2)
    expect(mergeShortShots([sh(0, 0.2, 'a')])).toHaveLength(1)
  })
})
