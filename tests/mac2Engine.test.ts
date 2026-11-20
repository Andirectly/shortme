import { describe, expect, it, vi } from 'vitest'
vi.mock('electron', () => ({ app: { isPackaged: false, getPath: () => '/tmp', getVersion: () => 'test' } }))
import { coldOpenFromObs, coverageOf, packetsFor } from '../src/main/shortme/clips/engines/mac2/observe'
import { planFromSentences } from '../src/main/shortme/clips/engines/mac2/director'
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

describe('Engine Mac 2 – Schnittplan über Satznummern', () => {
  const e = (id: string, t: number, kind: CutEdge['kind'] = 'sentence'): CutEdge => ({ id, t, kind, isMeasured: true, evidenceIds: [] })
  const sentences = [{ index: 1, start: 10, end: 14, text: 'a' }, { index: 2, start: 14.5, end: 20, text: 'b' }, { index: 3, start: 20.5, end: 30, text: 'c.' }, { index: 4, start: 31, end: 100, text: 'lang' }]
  const edges = [e('E1', 9.8), e('E2', 30.1), e('E3', 70)]
  const base = { kind: 'witz', startSentence: 'S1', endSentence: 'S3', title: 'Brot ist zu trocken', summary: 's' }
  const o = { candidateId: 'k1', sentences, edges, minSec: 15, maxSec: 75 }
  it('Satzanfang bis Satzende, Kanten-IDs der nächsten gemessenen Kante', () => {
    const p = validate(base)
    expect(p.span.start).toBeCloseTo(9.85, 2); expect(p.span.end).toBeCloseTo(30.15, 2)
    expect([p.startEdge, p.endEdge]).toEqual(['E1', 'E2'])
  })
  it('zu kurz → Ende satzweise verlängert; vertauschte Sätze werden sortiert', () => {
    expect(validate({ ...base, endSentence: 'S2' }).span.end).toBeCloseTo(30.15, 2) // S1–S2 = 10 s < 15 → bis S3
    expect(validate({ ...base, startSentence: 'S3', endSentence: 'S1' }).span.start).toBeCloseTo(9.85, 2)
  })
  it('Puffer reicht nie in den Nachbarsatz (kein „Das“ des Folgesatzes am Ende)', () => {
    const tight = [{ index: 1, start: 10, end: 20, text: 'a.' }, { index: 2, start: 20.1, end: 30, text: 'b.' }, { index: 3, start: 30.06, end: 31, text: 'Das' }]
    const p = planFromSentences({ ...base, startSentence: 'S2', endSentence: 'S2' }, { ...o, sentences: tight, minSec: 5 })
    expect(p.span.start).toBeCloseTo(20.05, 2); expect(p.span.end).toBeCloseTo(30.03, 2)
  })
  it('zu lang → Ende früher; Platzhalter-Titel und unbekannte Sätze abgelehnt', () => {
    expect(validate({ ...base, endSentence: 'S4' }).span.end).toBeCloseTo(30.15, 2) // S1–S4 = 90 s > 75 → S3
    expect(() => validate({ ...base, title: 'Kurzer deutscher Titel' })).toThrow(/Titel/)
    expect(() => validate({ ...base, startSentence: 'S9' })).toThrow(/Satz/)
  })
  function validate(x: typeof base) { return planFromSentences(x, o) }
})

describe('Engine Mac 2 – Cold Opener', () => {
  it('aus beobachteten Ereignissen: Reaktion vor Handlung, ≥ 3 s nach Start, ≤ 6 s', () => {
    const p = packetsFor('k1', { start: 100, end: 130 })
    const obs = [{ packet: p[0], segments: p[0].segments.map((s) => ({ id: s.id, span: s.span, visual: '', audio: '' })), ms: 0, frames: [], audioSec: 30, events: [
      { role: 'action' as const, segmentIds: ['k1.p1.s2'], state: 'observed' as const, description: 'beißt ab' },
      { role: 'reaction' as const, segmentIds: ['k1.p1.s3'], state: 'observed' as const, description: 'lacht' },
      { role: 'reaction' as const, segmentIds: ['k1.p1.s1'], state: 'observed' as const, description: 'am Anfang' } ] }]
    expect(coldOpenFromObs(obs, { start: 100, end: 130 })).toEqual({ start: 120, end: 126 })
    expect(coldOpenFromObs(obs, { start: 100, end: 119 })).toEqual({ start: 110, end: 116 })
    expect(coldOpenFromObs([{ ...obs[0], events: obs[0].events.map((e) => ({ ...e, state: 'inferred' as const })) }], { start: 100, end: 130 })).toBeNull()
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
  it('Restzeit: Rendern läuft parallel zur Planung und zählt nur, soweit es länger dauert', () => {
    const L = new Ledger({ plan: 20, render: 2 })
    L.set('plan', 5) // 100 s
    L.set('render', 30) // 60 s, versteckt sich hinter der Planung
    expect(L.remainingSeconds()).toBe(100)
    L.set('render', 80) // 160 s → 60 s über die Planung hinaus
    expect(L.remainingSeconds()).toBe(160)
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

describe('decideMac2', () => {
  const c = (m: Record<string, string>) => ['hook', 'standalone', 'payoff', 'natural-end', 'essential-event'].map((id) => ({ id, state: (m[id] ?? 'pass') as 'pass', reason: '', evidenceIds: [] }))
  it('standalone allein → prüfen, Pointe fehlt → ablehnen, 3 Kernfehler → ablehnen', async () => {
    const { decideMac2 } = await import('../src/main/shortme/clips/engines/mac2')
    expect(decideMac2(c({}))).toBe('acceptable')
    expect(decideMac2(c({ standalone: 'fail', hook: 'fail' }))).toBe('needs-review')
    expect(decideMac2(c({ payoff: 'fail' }))).toBe('reject')
    expect(decideMac2(c({ hook: 'fail', standalone: 'fail', 'natural-end': 'fail' }))).toBe('reject')
  })
})
