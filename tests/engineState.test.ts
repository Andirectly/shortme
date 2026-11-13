import { describe, expect, it } from 'vitest'
import { displayedRunId, emptyAnalysisState, engineOfRun, findReusableRun, fingerprintOf, isSafeRunId, newRunId, sanitizeAnalysisState, v2ClipId, type RunInfo } from '../src/shared/engine'

const run = (runId: string, over: Partial<RunInfo> = {}): RunInfo => ({ runId, engineId: 'multimodal-v2', engineVersion: '2.0.0', schema: 1, createdAt: '2026-11-13T10:00:00Z', status: 'done', fingerprint: 'fp1', options: { query: '', contentType: null, frame: null, wanted: null, minSec: 15, maxSec: 75 }, models: {}, modalities: {}, ...over })

describe('Analyse-Zustand', () => {
  it('ohne Datei oder mit Müll gilt Legacy, angezeigt wird das bisherige Ergebnis', () => {
    for (const bad of [null, undefined, 5, 'x', {}, { selected: 'unbekannt' }]) {
      const s = sanitizeAnalysisState(bad)
      expect(s.selected).toBe('legacy')
      expect(displayedRunId(s)).toBe('legacy')
    }
  })
  it('Auswahl und angezeigter Lauf bleiben beim Laden erhalten, unbekannte Läufe werden verworfen', () => {
    const r = run('v2-abc-12345')
    const s = sanitizeAnalysisState({ version: 1, selected: 'multimodal-v2', shown: r.runId, view: { legacy: 'legacy', 'multimodal-v2': r.runId }, runs: [r, { runId: '../evil', engineId: 'legacy', status: 'done', fingerprint: 'x' }, { runId: 'ok', engineId: 'foo', status: 'done', fingerprint: 'x' }] })
    expect(s.selected).toBe('multimodal-v2')
    expect(displayedRunId(s)).toBe(r.runId)
    expect(engineOfRun(s, r.runId)).toBe('multimodal-v2')
    expect(engineOfRun(s, 'legacy')).toBe('legacy')
    expect(s.runs).toHaveLength(1)
  })
  it('Auswahl und Anzeige sind getrennt: V2 gewählt, solange kein Lauf fertig ist, bleibt das bisherige Ergebnis sichtbar', () => {
    const s = sanitizeAnalysisState({ selected: 'multimodal-v2', shown: 'legacy', view: { 'multimodal-v2': null }, runs: [] })
    expect(s.selected).toBe('multimodal-v2')
    expect(displayedRunId(s)).toBe('legacy')
  })
  it('Anzeige eines Laufs, den es nicht gibt, fällt auf das bisherige Ergebnis zurück', () => {
    const s = sanitizeAnalysisState({ selected: 'multimodal-v2', shown: 'v2-weg', view: { 'multimodal-v2': 'v2-weg' }, runs: [] })
    expect(displayedRunId(s)).toBe('legacy')
    expect(s.view['multimodal-v2']).toBeNull()
  })
})

describe('Wiederverwendung', () => {
  it('nur fertige Läufe derselben Engine mit gleichem Fingerabdruck, der jüngste gewinnt', () => {
    const s = emptyAnalysisState()
    s.runs = [run('a', { createdAt: '2026-11-01T00:00:00Z' }), run('b', { createdAt: '2026-11-02T00:00:00Z' }), run('c', { status: 'failed', createdAt: '2026-11-03T00:00:00Z' }), run('d', { fingerprint: 'anders', createdAt: '2026-11-04T00:00:00Z' }), run('e', { status: 'incomplete', createdAt: '2026-11-05T00:00:00Z' })]
    expect(findReusableRun(s, 'multimodal-v2', 'fp1')?.runId).toBe('b')
    expect(findReusableRun(s, 'legacy', 'fp1')).toBeNull()
    expect(findReusableRun(s, 'multimodal-v2', 'gibt-es-nicht')).toBeNull()
  })
  it('Fingerabdruck ändert sich mit jedem Eingabeteil und ist stabil', () => {
    const a = fingerprintOf(['h', 1, 'frage', null])
    expect(fingerprintOf(['h', 1, 'frage', null])).toBe(a)
    expect(fingerprintOf(['h', 2, 'frage', null])).not.toBe(a)
    expect(fingerprintOf(['h', 1, 'frage2', null])).not.toBe(a)
    expect(fingerprintOf(['h1', '', ''])).not.toBe(fingerprintOf(['h', '1', '']))
  })
})

describe('IDs', () => {
  it('Lauf- und Clip-IDs sind sicher und kollisionsfrei gegenüber alten IDs', () => {
    const ids = new Set(Array.from({ length: 500 }, () => newRunId()))
    expect(ids.size).toBe(500)
    for (const id of ids) expect(isSafeRunId(id)).toBe(true)
    const rid = newRunId()
    expect(v2ClipId(rid, 3)).not.toMatch(/^clip-/)
    expect(v2ClipId(rid, 3)).toBe(`${rid}-c3`)
    expect(isSafeRunId('legacy')).toBe(true)
    for (const bad of ['', '../x', 'a/b', 'A', 'x'.repeat(60), 'a b']) expect(isSafeRunId(bad)).toBe(false)
  })
})
