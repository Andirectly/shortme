import { describe, expect, it } from 'vitest'
import { EDIT_PAD_SEC, baseState, editWindow, effectiveClip, push, emptyLog, stateOf } from '../src/shared/edits'

describe('Editor-Puffer vor/nach dem Clip', () => {
  it('Fenster = Clip ± Puffer, auf die Quelle begrenzt', () => {
    expect(editWindow(100, 130, 1000)).toEqual([100 - EDIT_PAD_SEC, 130 + EDIT_PAD_SEC])
    expect(editWindow(10, 40, 50)).toEqual([0, 50])
    expect(editWindow(10, 40, 0)).toEqual([0, 40]) // Quelldauer unbekannt: nicht über das Clip-Ende hinaus
  })
  it('Trim über den ursprünglichen Clip hinaus übernimmt die Wörter davor', () => {
    const words = Array.from({ length: 40 }, (_, i) => ({ start: i * 2, end: i * 2 + 1.5 }))
    const clip = { start: 40, end: 60, firstWord: 20, lastWord: 29, shots: [], hookText: '' }
    const st = stateOf(baseState(clip), push(emptyLog('c'), { t: 'trim', start: 30, end: 60 }))
    const eff = effectiveClip(clip, words, st)
    expect(eff.start).toBe(30)
    expect(eff.firstWord).toBe(15)
  })
})
