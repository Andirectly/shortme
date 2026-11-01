import { describe, expect, it } from 'vitest'
import { baseState, push, emptyLog, stateOf } from '../src/shared/edits'
import { diffStates } from '../src/shared/corrections'

const words = [{ w: 'Hallo', start: 0, end: 0.5 }, { w: 'du', start: 0.5, end: 0.8 }, { w: 'da', start: 0.8, end: 1 }]

describe('Korrektur-Protokoll', () => {
  const base = baseState({ start: 0, end: 10, hookText: 'Hook' })
  it('Trim: Richtung in Sekunden', () => {
    const b = stateOf(base, push(emptyLog('c'), { t: 'trim', start: 2.5, end: 12 }))
    expect(diffStates(base, b, words)).toEqual([{ kind: 'trim', before: [0, 10], after: [2.5, 12], startShift: 2.5, endShift: 2 }])
  })
  it('Schnitt mit Text und Wiederherstellen', () => {
    const cut = stateOf(base, push(emptyLog('c'), { t: 'cutWords', words: [1, 2], cut: true }))
    expect(diffStates(base, cut, words)).toEqual([{ kind: 'cut', text: 'du da', seconds: 0.5, restored: false }])
    expect(diffStates(cut, base, words)).toEqual([{ kind: 'cut', text: 'du da', seconds: 0.5, restored: true }])
  })
  it('Hook und Bildausschnitt, sonst nichts', () => {
    const b = stateOf(base, push(push(emptyLog('c'), { t: 'hook', text: 'Neu' }), { t: 'layoutClip', layout: 'fit' }))
    expect(diffStates(base, b, words).map((e) => e.kind)).toEqual(['hook', 'framing'])
    expect(diffStates(base, base, words)).toEqual([])
  })
})
