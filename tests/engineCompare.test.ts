import { describe, expect, it } from 'vitest'
import { blindOrder, clipPieces, matchEvents, sourceToOutputTime, type CmpClip, type CmpRun } from '../src/shared/compare'

const clip = (id: string, start: number, end: number, eventId?: string, autoCuts?: Array<{ start: number; end: number }>): CmpClip => ({ id, start, end, title: id, score: 50, autoCuts, v2: eventId ? { eventId } : undefined })
const run = (runId: string, engineId: CmpRun['engineId'], clips: CmpClip[]): CmpRun => ({ runId, engineId, clips })

describe('Engine-Vergleich', () => {
  it('CMP-01: gleiches Ereignis mit anderem Clipanfang = ein Match', () => {
    const m = matchEvents([run('a', 'multimodal-v2', [clip('a1', 100, 130, 'e1')]), run('b', 'adaptive-v3', [clip('b1', 108, 138, 'x9')])])
    expect(m).toHaveLength(1)
    expect(m[0].kind).toBe('shared-event')
  })
  it('CMP-02: Anker liegt im Fenster der anderen Engine → Match trotz kleiner IoU', () => {
    const m = matchEvents([run('a', 'multimodal-v2', [clip('a1', 2200, 2260, 'e1')]), run('b', 'adaptive-v3', [clip('b1', 2230, 2236, 'x1')])])
    expect(m.map((x) => x.kind)).toEqual(['shared-event'])
  })
  it('CMP-03: Ereignis nur in einer Engine = engine-exclusive', () => {
    const m = matchEvents([run('a', 'multimodal-v2', [clip('a1', 10, 30, 'e1')]), run('b', 'adaptive-v3', [clip('b1', 10, 30, 'x1'), clip('b2', 500, 520, 'x2')])])
    expect(m.filter((x) => x.kind === 'engine-exclusive')).toHaveLength(1)
    expect(m.find((x) => x.kind === 'engine-exclusive')!.members[0].runId).toBe('b')
  })
  it('CMP-04: zwei getrennte kurze Ereignisse in Nähe werden nicht zusammengeklappt', () => {
    const m = matchEvents([run('a', 'legacy', [clip('a1', 100, 115), clip('a2', 140, 155)]), run('b', 'adaptive-v3', [clip('b1', 101, 116, 'x1')])])
    expect(m).toHaveLength(2)
    expect(m.find((x) => x.members.length === 2)!.members.some((x) => x.eventId === 'a1')).toBe(true)
  })
  it('Varianten desselben Ereignisses einer Engine bleiben ein Ereignis', () => {
    const m = matchEvents([run('a', 'multimodal-v2', [clip('a1', 100, 120, 'e1'), clip('a2', 104, 126, 'e1')])])
    expect(m).toHaveLength(1)
    expect(m[0].members[0].clipIds).toEqual(['a1', 'a2'])
  })
  it('CMP-06: Override (merge/split) wirkt dauerhaft und bleibt als Eintrag erhalten', () => {
    const runs = [run('a', 'multimodal-v2', [clip('a1', 10, 20, 'e1')]), run('b', 'adaptive-v3', [clip('b1', 400, 420, 'x1')])]
    const base = matchEvents(runs)
    expect(base).toHaveLength(2)
    const merged = matchEvents(runs, [{ createdAt: 'x', action: 'merge', memberRefs: [{ runId: 'a', eventId: 'e1' }, { runId: 'b', eventId: 'x1' }] }])
    expect(merged).toHaveLength(1)
    expect(merged[0].confidenceLabel).toBe('manual-match')
    const split = matchEvents([run('a', 'multimodal-v2', [clip('a1', 10, 30, 'e1')]), run('b', 'adaptive-v3', [clip('b1', 10, 30, 'x1')])], [{ createdAt: 'x', action: 'split', memberRefs: [{ runId: 'a', eventId: 'e1' }] }])
    expect(split).toHaveLength(2)
  })
  it('CMP-07: ausgeschnittene Quellzeit = omitted', () => {
    const p = clipPieces({ start: 100, end: 130, autoCuts: [{ start: 110, end: 115 }] })
    expect(p).toEqual([{ start: 100, end: 110 }, { start: 115, end: 130 }])
    expect(sourceToOutputTime(p, 105)).toBe(5)
    expect(sourceToOutputTime(p, 112)).toBe('omitted')
    expect(sourceToOutputTime(p, 120)).toBe(15)
  })
  it('CMP-09: Blindreihenfolge ist deterministisch, vollständig und variiert mit der Seed', () => {
    const ids = ['a', 'b', 'c']
    expect(blindOrder(ids, 's1')).toEqual(blindOrder(ids, 's1'))
    expect([...blindOrder(ids, 's1')].sort()).toEqual(ids)
    const orders = new Set(Array.from({ length: 12 }, (_, i) => blindOrder(ids, `m${i}`).join('')))
    expect(orders.size).toBeGreaterThan(1)
  })
})
