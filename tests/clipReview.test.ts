import { describe, expect, it } from 'vitest'
import { clipRevision, decide, matchesFilter, nextOpenIndex, qualityOf, reviewView, sanitizeReviewFile } from '../src/shared/review'
import { emptyLog, push } from '../src/shared/edits'

const clip = { id: 'c1', start: 10, end: 40 }

describe('Review: Freigabe, KI-Status, Lernbewertung getrennt', () => {
  it('Bearbeitungsstand: gleiche Edits → gleicher Fingerabdruck, Undo zurück zum Ausgang', () => {
    const base = clipRevision(clip, emptyLog('c1'))
    const log = push(emptyLog('c1'), { t: 'trim', start: 12, end: 40 })
    const r1 = clipRevision(clip, log)
    expect(r1).not.toBe(base)
    expect(clipRevision(clip, log)).toBe(r1)
    expect(clipRevision(clip, { ...log, cursor: 0 })).toBe(base) // rückgängig gemacht
    expect(clipRevision(clip, push(emptyLog('anderer'), { t: 'trim', start: 1, end: 2 }))).toBe(base) // fremdes Log zählt nicht
  })

  it('Freigabe merkt den Stand; Bearbeitung danach → „seit Freigabe verändert“, Status bleibt freigegeben', () => {
    const e = decide(undefined, 'freigegeben', 'aaa', '2026-01-01T00:00:00Z')
    expect(e).toEqual({ status: 'freigegeben', updatedAt: '2026-01-01T00:00:00Z', approvedRevision: 'aaa' })
    expect(reviewView(e, 'aaa').changedSinceApproval).toBe(false)
    const v = reviewView(e, 'bbb')
    expect(v.status).toBe('freigegeben')
    expect(v.changedSinceApproval).toBe(true)
    expect(decide(e, 'freigegeben', 'aaa')).toBe(e) // idempotent
    expect(decide(e, 'verworfen', 'aaa', 'x')).toEqual({ status: 'verworfen', updatedAt: 'x' }) // verwerfen ≠ löschen, nur Status
  })

  it('Migration: fehlende/kaputte Einträge → offen, nie künstlich freigegeben', () => {
    expect(sanitizeReviewFile(null)).toEqual({})
    expect(sanitizeReviewFile({ a: { status: 'freigegeben', updatedAt: 't', approvedRevision: 'r' }, b: { status: 'gut', updatedAt: 't' }, c: 5 })).toEqual({ a: { status: 'freigegeben', updatedAt: 't', approvedRevision: 'r' } })
    expect(reviewView(undefined, 'r').status).toBe('offen')
  })

  it('KI-Status aus den Clipdaten; Engine 1 ohne Prüfung; laufend = ausstehend', () => {
    expect(qualityOf({}).status).toBe('nicht_durchgefuehrt')
    expect(qualityOf({ pending: true }).status).toBe('ausstehend')
    const v2 = (verification: 'verified' | 'needs-review' | 'failed') => ({ v2: { verification, uncertainty: ['payoff: unknown'] } as never })
    expect(qualityOf(v2('verified')).status).toBe('bestanden')
    expect(qualityOf(v2('needs-review')).status).toBe('bitte_pruefen')
    expect(qualityOf(v2('failed')).status).toBe('fehlgeschlagen')
    expect(qualityOf(v2('needs-review'), true)).toEqual({ status: 'bitte_pruefen', findings: ['payoff: unknown'], stale: true })
  })

  it('Filter mischen KI-Status und Freigabe nicht', () => {
    expect(matchesFilter({ status: 'freigegeben' }, 'bitte_pruefen', 'ki_pruefen')).toBe(true)
    expect(matchesFilter({ status: 'freigegeben' }, 'bitte_pruefen', 'offen')).toBe(false)
    expect(matchesFilter({ status: 'zur_pruefung' }, 'bestanden', 'offen')).toBe(true)
    expect(matchesFilter({ status: 'verworfen' }, 'bestanden', 'verworfen')).toBe(true)
  })

  it('nächster offener Clip rundum, null wenn alles entschieden', () => {
    expect(nextOpenIndex(['freigegeben', 'offen', 'verworfen', 'zur_pruefung'], 1)).toBe(3)
    expect(nextOpenIndex(['offen', 'freigegeben'], 1)).toBe(0)
    expect(nextOpenIndex(['freigegeben', 'verworfen'], 0)).toBeNull()
  })
})
