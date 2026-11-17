import { describe, expect, it } from 'vitest'
import {
  FINAL_CRITERIA, buildGraph, chooseRepair, decide, decilesCovered, enumerateEdges, firstRepairable, fuseSeeds, latticeCandidates, rankFinal, requiredSpan,
  selectBalanced, validateCutJudge, validateFinal, validateInvestigator, type Criterion, type Seed
} from '../src/main/shortme/clips/engines/v4/core'

const seed = (id: string, lane: Seed['lane'], rank: number, anchor: number, ev: string[] = [`ev-${id}`]): Seed => ({ id, lane, laneRank: rank, anchor, span: { start: anchor - 5, end: anchor + 5 }, evidenceIds: ev, hint: 'x', summary: id, laneScore: null })

describe('V4 Fusion und Auswahl (V4-021)', () => {
  it('nahe, eigenständige Ereignisse bleiben getrennt; gleicher Beleg wird zusammengeführt', () => {
    const g = fuseSeeds([seed('a', 'speech', 0, 100), seed('b', 'audio', 0, 130), seed('c', 'visual', 1, 101, ['ev-a'])])
    expect(g).toHaveLength(2)
    expect(g.find((x) => x.seeds.some((s) => s.id === 'a'))!.lanes).toEqual(['speech', 'visual'])
  })
  it('viele Treffer einer Lane verdrängen keine andere Modalität (reservierte Budgets)', () => {
    const speech = Array.from({ length: 20 }, (_, i) => seed(`s${i}`, 'speech', i, 30 + i * 40))
    const g = fuseSeeds([...speech, seed('v', 'visual', 0, 2000), seed('au', 'audio', 0, 2400)])
    const pick = selectBalanced(g, 6, 2, 3000)
    expect(pick.some((x) => x.lanes.includes('visual'))).toBe(true)
    expect(pick.some((x) => x.lanes.includes('audio'))).toBe(true)
  })
  it('doppelte Seed-IDs sind ein Fehler', () => { expect(() => fuseSeeds([seed('a', 'speech', 0, 1), seed('a', 'audio', 0, 50)])).toThrow() })
})

describe('V4 Abdeckung (V4-010)', () => {
  it('jedes Zehntel muss geprüft sein, auch das letzte', () => {
    const w = Array.from({ length: 9 }, (_, i) => ({ lane: 'audio' as const, startSeconds: i * 360, endSeconds: i * 360 + 30, status: 'inspected' as const, source: 'x' }))
    expect(decilesCovered(w, 3600).filter(Boolean)).toHaveLength(9)
    expect(decilesCovered([...w, { lane: 'audio', startSeconds: 3590, endSeconds: 3600, status: 'inspected', source: 'x' }], 3600).every(Boolean)).toBe(true)
  })
})

describe('V4 Schnittkanten und Gitter (V4-028/029/030)', () => {
  const edges = enumerateEdges({ duration: 100, words: [{ w: 'Hallo.', start: 9, end: 10 }, { w: 'und', start: 30, end: 30.4 }, { w: 'fertig!', start: 59, end: 60 }], silences: [[20, 21], [61, 61.1]], shots: [40, 40.02], actions: [70], audioPhrases: [] })
  it('nur gemessene Kanten mit Belegen, Duplikate zusammengefasst, Quellgrenzen dabei', () => {
    expect(edges.map((e) => e.kind)).toEqual(['source-boundary', 'sentence', 'pause', 'shot', 'sentence', 'action', 'source-boundary'])
    expect(edges.every((e) => e.isMeasured && e.evidenceIds.length)).toBe(true)
    expect(edges.find((e) => e.kind === 'shot')!.evidenceIds).toHaveLength(2)
  })
  it('Kandidaten enthalten den Pflichtbereich und bestehen nur aus vorhandenen Kanten', () => {
    const c = latticeCandidates(edges, { start: 25, end: 55 }, 100, { minSec: 15, maxSec: 75, limit: 4 })
    expect(c.length).toBeGreaterThan(1)
    const ids = new Set(edges.map((e) => e.id))
    for (const x of c) { expect(ids.has(x.startEdgeId) && ids.has(x.endEdgeId)).toBe(true); expect(x.span.start).toBeLessThanOrEqual(25); expect(x.span.end).toBeGreaterThanOrEqual(55) }
    expect(new Set(c.map((x) => x.id)).size).toBe(c.length)
  })
  it('Reparatur: Kontext fehlt → früherer Start; Pointe fehlt → späteres Ende; sonst nichts erfinden', () => {
    const cur = latticeCandidates(edges, { start: 25, end: 55 }, 100, { minSec: 15, maxSec: 75, limit: 1 })[0]
    const a = chooseRepair(cur, edges, 'standalone', { minSec: 15, maxSec: 75 })!
    expect(a.span.start).toBeLessThan(cur.span.start); expect(a.endEdgeId).toBe(cur.endEdgeId)
    const b = chooseRepair(cur, edges, 'payoff', { minSec: 15, maxSec: 75 })!
    expect(b.span.end).toBeGreaterThan(cur.span.end); expect(b.startEdgeId).toBe(cur.startEdgeId)
    expect(chooseRepair(cur, edges, 'crop-safety', { minSec: 15, maxSec: 75 })).toBeNull()
  })
})

describe('V4 Modellantworten (V4-029/034/026)', () => {
  const known = new Set(['f1', 'a1'])
  it('Cut-Judge: erfundene Kanten-ID oder Beleg-ID wird abgelehnt', () => {
    const ok = { startEdgeId: 'E2', endEdgeId: 'E5', preferred: true, reasonCode: 'ok', criteria: [{ id: 'standalone', state: 'pass', reason: 'r', evidenceIds: ['f1'] }] }
    expect(validateCutJudge(ok, ['E2'], ['E5'], known).startEdgeId).toBe('E2')
    expect(() => validateCutJudge({ ...ok, startEdgeId: 'E99' }, ['E2'], ['E5'], known)).toThrow()
    expect(() => validateCutJudge({ ...ok, criteria: [{ id: 'standalone', state: 'pass', reason: 'r', evidenceIds: ['zz'] }] }, ['E2'], ['E5'], known)).toThrow()
    expect(() => validateCutJudge({ ...ok, start: 12.5 }, ['E2'], ['E5'], known)).toThrow()
  })
  const all = (state: Criterion['state'] = 'pass'): Criterion[] => FINAL_CRITERIA.map((id) => ({ id, state, reason: 'r', evidenceIds: state === 'pass' ? ['f1'] : [] }))
  it('Endprüfung: genau 10 Kriterien, Entscheidung aus den Kriterien abgeleitet', () => {
    const j = validateFinal({ criteria: all(), decision: 'reject' }, { variantId: 'v', outputSha256: 'a'.repeat(64), hasAudio: true, hasCaptions: true, known })
    expect(j.decision).toBe('acceptable')
    expect(() => validateFinal({ criteria: all().slice(1) }, { variantId: 'v', outputSha256: 'a'.repeat(64), hasAudio: true, hasCaptions: true, known })).toThrow()
  })
  it('not-applicable für Ton nur, wenn die Ausgabe wirklich keinen Ton hat', () => {
    const c = all().map((x) => (x.id === 'audio-seam' ? { ...x, state: 'not-applicable' as const, evidenceIds: [] } : x))
    expect(() => validateFinal({ criteria: c }, { variantId: 'v', outputSha256: 'a'.repeat(64), hasAudio: true, hasCaptions: true, known })).toThrow()
    expect(validateFinal({ criteria: c }, { variantId: 'v', outputSha256: 'a'.repeat(64), hasAudio: false, hasCaptions: true, known }).decision).toBe('acceptable')
  })
  it('abgeschnittene Pointe → reject und Reparaturgrund „payoff“; unklar → needs-review', () => {
    const c = all().map((x) => (x.id === 'payoff' ? { ...x, state: 'fail' as const, evidenceIds: [] } : x))
    expect(decide(c)).toBe('reject'); expect(firstRepairable(c)).toBe('payoff')
    expect(decide(all().map((x) => (x.id === 'hook' ? { ...x, state: 'unknown' as const, evidenceIds: [] } : x)))).toBe('needs-review')
  })
  it('Investigator: Segment-IDs nur aus dem Fenster, unbekannte Operation → stop, „observed“ ohne Fundstelle → unknown', () => {
    expect(() => validateInvestigator({ observations: [{ role: 'payoff', segmentIds: ['S9'], state: 'observed' }] }, ['S1', 'S2'])).toThrow()
    const a = validateInvestigator({ observations: [{ role: 'reaction', segmentIds: [], state: 'observed', description: 'x' }], nextAction: { op: 'rm -rf' } }, ['S1'])
    expect(a.next.op).toBe('stop'); expect(a.observations[0].state).toBe('unknown')
  })
})

describe('V4 Ereignisgraph (V4-024/026)', () => {
  it('Knoten nur mit Beleg; Ursache nur als „inferred“', () => {
    const g = buildGraph('g', ['s'], [
      { id: 'n1', role: 'trigger', span: { start: 10, end: 12 }, state: 'observed', evidenceIds: ['e1'], description: '' },
      { id: 'n2', role: 'reaction', span: { start: 13, end: 15 }, state: 'observed', evidenceIds: ['e2'], description: '' },
      { id: 'n3', role: 'payoff', span: { start: 20, end: 22 }, state: 'observed', evidenceIds: [], description: '' }
    ], false)
    expect(g.nodes.map((n) => n.id)).toEqual(['n1', 'n2'])
    expect(g.relations.find((r) => r.kind === 'caused')!.state).toBe('inferred')
    expect(g.unknownRoles).toContain('payoff')
    expect(requiredSpan(g, { start: 0, end: 1 })).toEqual({ start: 10, end: 15 })
  })
})

describe('V4 Endauswahl (V4-036/037)', () => {
  it('reject fällt weg, fast gleiche Clips nur einmal, null Clips möglich', () => {
    const r = rankFinal([
      { id: 'a', span: { start: 0, end: 30 }, decision: 'acceptable', passes: 9, eventId: 'e1' },
      { id: 'b', span: { start: 2, end: 31 }, decision: 'acceptable', passes: 8, eventId: 'e2' },
      { id: 'c', span: { start: 100, end: 130 }, decision: 'reject', passes: 3, eventId: 'e3' }
    ], 5)
    expect(r.map((x) => x.id)).toEqual(['a'])
    expect(rankFinal([{ id: 'c', span: { start: 0, end: 30 }, decision: 'reject', passes: 1, eventId: 'e' }], 5)).toEqual([])
    // halber Clip gemeinsam (IoU nur 0,34) → doppelt, nicht vielfältig
    const d = rankFinal([
      { id: 'x', span: { start: 671, end: 722 }, decision: 'acceptable', passes: 9, eventId: 'e1' },
      { id: 'y', span: { start: 695.5, end: 749.5 }, decision: 'acceptable', passes: 9, eventId: 'e2' },
      { id: 'z', span: { start: 715, end: 760 }, decision: 'acceptable', passes: 8, eventId: 'e3' }
    ], 5)
    expect(d.map((x) => x.id)).toEqual(['x', 'z'])
  })
})
