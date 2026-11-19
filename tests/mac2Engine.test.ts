import { describe, expect, it, vi } from 'vitest'
vi.mock('electron', () => ({ app: { isPackaged: false, getPath: () => '/tmp', getVersion: () => 'test' } }))
import { coldOpenFromObs, coverageOf, packetsFor } from '../src/main/shortme/clips/engines/mac2/observe'
import { validatePlan, edgesNear } from '../src/main/shortme/clips/engines/mac2/director'
import { candidateLimits, decideExtraInvestigation, mayRequestInspection } from '../src/main/shortme/clips/engines/mac2/runtimePolicy'
import { Ledger, etaText } from '../src/main/shortme/clips/engines/mac2/ledger'
import { spokenBlocks, typeQueries } from '../src/main/shortme/clips/engines/mac2'
import type { CutEdge } from '../src/main/shortme/clips/engines/v4/core'

describe('Engine Mac 2 – Pakete und Abdeckung', () => {
  it('teilt in Pakete ≤ 30 s mit 10-s-Segmenten, lückenlos', () => {
    const p = packetsFor('k1', { start: 100, end: 165 })
    expect(p).toHaveLength(3)
    expect(p.every((x) => x.span.end - x.span.start <= 30.01)).toBe(true)
    expect(p[0].span.start).toBe(100); expect(p[2].span.end).toBe(165)
    expect(p[0].segments.map((s) => s.id)).toEqual(['k1.p1.s1', 'k1.p1.s2', 'k1.p1.s3'])
    expect(packetsFor('r', { start: 0, end: 12 })).toHaveLength(1)
  })
  it('Abdeckung nur aus erfolgreichen Paketen (Host-Daten); Lücke = unvollständig', () => {
    const p = packetsFor('r', { start: 0, end: 60 })
    expect(coverageOf({ start: 0, end: 60 }, p).complete).toBe(true)
    const part = coverageOf({ start: 0, end: 60 }, [p[0]])
    expect(part.complete).toBe(false)
    expect(part.missing).toEqual([{ start: 30, end: 60 }])
  })
})

describe('Engine Mac 2 – Schnittplan', () => {
  const e = (id: string, t: number, kind: CutEdge['kind'] = 'sentence'): CutEdge => ({ id, t, kind, isMeasured: true, evidenceIds: [] })
  const edges = new Map([e('E1', 10), e('E2', 40), e('E3', 120), e('E4', 20), e('E5', 24)].map((x) => [x.id, x]))
  const base = { decision: 'use', reason: 'gut', kind: 'witz', startEdge: 'E1', endEdge: 'E2', title: 'Brot ist zu trocken', summary: 's', coldOpenStart: 'none', coldOpenEnd: 'none' }
  const o = { candidateId: 'k1', edges, minSec: 15, maxSec: 75 }
  it('gültiger Plan: Spanne aus gemessenen Kanten', () => {
    expect(validatePlan(base, o)).toMatchObject({ span: { start: 10, end: 40 }, title: 'Brot ist zu trocken', coldOpen: null })
  })
  it('korrigiert die Länge auf die nächste erlaubte Endkante statt abzulehnen', () => {
    const ends = [e('E4', 20), e('E5', 24), e('E2', 40), e('E3', 120)]
    // 10 → 20 s ist zu kurz (min 15, 1 s Spielraum): Ende auf die erste passende Kante (E5 bei 24 s = 14 s)
    expect(validatePlan({ ...base, endEdge: 'E4' }, { ...o, ends }).span).toEqual({ start: 10, end: 24 })
    // 10 → 120 s zu lang: letzte passende Kante
    expect(validatePlan({ ...base, endEdge: 'E3' }, { ...o, ends }).span).toEqual({ start: 10, end: 40 })
  })
  it('lehnt zu lange Clips und Platzhalter-Titel ab', () => {
    expect(() => validatePlan({ ...base, endEdge: 'E3' }, o)).toThrow(/Länge/)
    expect(() => validatePlan({ ...base, title: 'Kurzer deutscher Titel' }, o)).toThrow(/Titel/)
    expect(() => validatePlan({ ...base, title: '<3–7 Wörter>' }, o)).toThrow(/Titel/)
  })
  it('Cold Opener aus beobachteten Ereignissen: Reaktion vor Handlung, ≥ 3 s nach Start, ≤ 6 s', () => {
    const p = packetsFor('k1', { start: 100, end: 130 })
    const obs = [{ packet: p[0], segments: p[0].segments.map((s) => ({ id: s.id, span: s.span, visual: '', audio: '' })), ms: 0, frames: [], audioSec: 30, events: [
      { role: 'action' as const, segmentIds: ['k1.p1.s2'], state: 'observed' as const, description: 'beißt ab' },
      { role: 'reaction' as const, segmentIds: ['k1.p1.s3'], state: 'observed' as const, description: 'lacht' },
      { role: 'reaction' as const, segmentIds: ['k1.p1.s1'], state: 'observed' as const, description: 'am Anfang' } ] }]
    expect(coldOpenFromObs(obs, { start: 100, end: 130 })).toEqual({ start: 120, end: 126 })
    expect(coldOpenFromObs(obs, { start: 100, end: 119 })).toEqual({ start: 110, end: 116 }) // Reaktion außerhalb → Handlung
    expect(coldOpenFromObs([{ ...obs[0], events: obs[0].events.map((e) => ({ ...e, state: 'inferred' as const })) }], { start: 100, end: 130 })).toBeNull()
  })
  it('Kanten nahe am Kandidaten, Satz-/Pausenkanten bevorzugt', () => {
    const list = [e('a', 5, 'shot'), e('b', 6), e('c', 50), e('d', 200)]
    expect(edgesNear(list, { start: 10, end: 40 }, 15, 2).map((x) => x.id)).toEqual(['b', 'c'])
  })
})

describe('Engine Mac 2 – Laufzeitregeln im Ablauf', () => {
  it('Kandidatengrenzen: 2 × Wunschzahl, höchstens +4', () => {
    expect(candidateLimits(6, 30)).toEqual({ initialMaximum: 12, totalMaximum: 16 })
    expect(candidateLimits(6, 5)).toEqual({ initialMaximum: 5, totalMaximum: 5 })
  })
  it('Zusatzbudget je Kandidat: Kontext und JSON-Korrektur teilen sich eine Anfrage', () => {
    expect(mayRequestInspection({ initial: 2, context: 0, schemaRetries: 0 }, 'schemaRetry', 2, 1)).toBe(true)
    expect(mayRequestInspection({ initial: 2, context: 0, schemaRetries: 1 }, 'context', 2, 1)).toBe(false)
  })
  it('Zusatzsuche ohne Messwerte startet nicht (keine kostenlose Dauer)', () => {
    expect(decideExtraInvestigation({ elapsedMs: 1000, softBudgetMs: 1_800_000, nextTaskEstimateMs: null, reservedCompletionMs: null, startedCandidates: 4, maximumCandidates: 8 })).toMatchObject({ start: false, reason: 'completion-estimate-unknown' })
  })
  it('Aufgabenbuch: Restzeit aus Warteschlange und gemessenem Tempo; unbekannt solange ungemessen', async () => {
    const L = new Ledger()
    L.plan('observe-packet', 4)
    expect(L.remainingSeconds()).toBeNull()
    expect(etaText(null)).toBe('Zeit wird ermittelt')
    L.book({ kind: 'observe-packet', label: 'p1', reason: 'initial', ms: 10_000, ok: true, units: 1 })
    expect(L.remainingSeconds()).toBe(30)
    await expect(L.run('plan', 'x', {}, async () => { throw new Error('kaputt') })).rejects.toThrow('kaputt')
    expect(L.summary().plan).toMatchObject({ calls: 1, failed: 1 })
  })
})

describe('Engine Mac 2 – Bildsuch-Anfragen', () => {
  it('Food-Vlog bekommt Essens-Anfragen, Podcast Gesprächs-Anfragen', () => {
    expect(typeQueries('vlog', 'der Döner schmeckt richtig gut').map((q) => q.id)).toEqual(expect.arrayContaining(['t-bite', 't-taste', 't-surprise']))
    expect(typeQueries('podcast', 'wir reden über Arbeit').map((q) => q.id)).toEqual(['t-talk', 't-explain'])
  })
})

describe('Engine Mac 2 – Text für die Inhaltsprüfung', () => {
  it('fasst Wörter in 5-s-Blöcke zusammen', () => {
    expect(spokenBlocks([{ w: 'Das', start: 0.2 }, { w: 'Brot', start: 1 }, { w: 'ist', start: 6.1 }, { w: 'trocken.', start: 12 }])).toBe('[0–5 s] Das Brot\n[5–10 s] ist\n[10–15 s] trocken.')
  })
})
