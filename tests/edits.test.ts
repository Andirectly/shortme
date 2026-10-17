import { describe, expect, it } from 'vitest'
import { applyLayoutOps, baseState, canRedo, canUndo, effectiveClip, emptyLog, push, redo, reduce, sanitizeLog, stateOf, undo, type EditLog, type Op } from '../src/shared/edits'
import type { ShortmeShot } from '../src/shared/shortme'

const clip = { start: 100, end: 120, firstWord: 10, lastWord: 49, hookText: 'Hook', shots: [{ start: 0, end: 10, layout: 'smart', cx: 0.3, zoom: 1 }, { start: 10, end: 20, layout: 'smart', cx: 0.7, zoom: 1 }] as ShortmeShot[] }
// 60 Wörter: Wort i beginnt bei 95 + i*0.5 (Wort 10 bei 100, Wort 49 bei 119,5)
const words = Array.from({ length: 60 }, (_, i) => ({ start: 95 + i * 0.5, end: 95 + i * 0.5 + 0.4 }))
const base = baseState(clip)

describe('Operationslog', () => {
  it('Undo/Redo bewegen nur den Cursor; neue Operation verwirft den Redo-Zweig', () => {
    let log = emptyLog('c')
    log = push(log, { t: 'hook', text: 'A' })
    log = push(log, { t: 'hook', text: 'B' })
    expect(stateOf(base, log).hook.text).toBe('B')
    log = undo(log)
    expect(stateOf(base, log).hook.text).toBe('A')
    expect(canRedo(log)).toBe(true)
    log = redo(log)
    expect(stateOf(base, log).hook.text).toBe('B')
    log = undo(undo(log))
    expect(stateOf(base, log)).toEqual(base)
    expect(canUndo(log)).toBe(false)
    log = push(log, { t: 'hook', text: 'C' })
    expect(log.ops).toHaveLength(1)
    expect(canRedo(log)).toBe(false)
    expect(undo(emptyLog('c')).cursor).toBe(0)
  })

  it('Eigenschaft: jede Operationsfolge ist vollständig rückgängig machbar', () => {
    const ops: Op[] = [
      { t: 'trim', start: 102, end: 118 }, { t: 'cutWords', words: [12, 13], cut: true }, { t: 'hook', text: 'X' }, { t: 'caption', patch: { presetId: 'pop', scale: 1.2, y: 0.5 } },
      { t: 'follow', at: 105, cx: 0.4 }, { t: 'layout', at: 112, layout: 'fit' }, { t: 'cutWords', words: [12], cut: false }
    ]
    let log: EditLog = emptyLog('c')
    for (const o of ops) log = push(log, o)
    const full = stateOf(base, log)
    expect(full.start).toBe(102)
    expect(full.cutWords).toEqual([13])
    expect(full.caption).toMatchObject({ presetId: 'pop', scale: 1.2, y: 0.5, highlight: true })
    for (let i = ops.length; i > 0; i--) { log = undo(log); expect(log.cursor).toBe(i - 1) }
    expect(stateOf(base, log)).toEqual(base)
    for (let i = 0; i < ops.length; i++) log = redo(log)
    expect(stateOf(base, log)).toEqual(full)
  })

  it('stellt nach „Neustart“ (JSON-Roundtrip) denselben Stand her; Defektes wird abgefangen', () => {
    let log = emptyLog('c')
    log = push(push(log, { t: 'trim', start: 101, end: 119 }), { t: 'cutWords', words: [20], cut: true })
    log = undo(log)
    const restored = sanitizeLog(JSON.parse(JSON.stringify(log)), 'c')
    expect(stateOf(base, restored)).toEqual(stateOf(base, log))
    expect(restored.cursor).toBe(1)
    expect(sanitizeLog('müll', 'c')).toEqual(emptyLog('c'))
    expect(sanitizeLog({ version: 1, ops: [{ t: 'hook', text: 'ok' }, 5, null], cursor: 99 }, 'c')).toMatchObject({ ops: [{ t: 'hook', text: 'ok' }], cursor: 1 })
  })

  it('Caption-Patch ignoriert undefined-Felder', () => {
    const s = reduce(base, [{ t: 'caption', patch: { scale: 1.5, y: undefined } }])
    expect(s.caption.y).toBe(0.68)
    expect(s.caption.scale).toBe(1.5)
  })
})

describe('wirksamer Clip', () => {
  it('Beschnitt bestimmt Wortgrenzen neu, Shots beziehen sich auf den neuen Beginn', () => {
    const st = reduce(base, [{ t: 'trim', start: 103, end: 115 }])
    const e = effectiveClip(clip, words, st)
    expect(e.start).toBe(103)
    expect(words[e.firstWord].start).toBeGreaterThanOrEqual(103)
    expect(words[e.firstWord - 1].start).toBeLessThan(103)
    expect(words[e.lastWord].end).toBeLessThanOrEqual(115)
    expect(e.shots![0].start).toBe(0)
    expect(e.shots![e.shots!.length - 1].end).toBeCloseTo(12, 6)
    expect(e.shots!.map((s) => s.cx)).toEqual([0.3, 0.7]) // Grenze bei 110 s bleibt
    expect(e.shots![0].end).toBeCloseTo(7, 6)
  })

  it('herausgeschnittene Wörter werden als Zeitbereiche gemeldet', () => {
    const e = effectiveClip(clip, words, reduce(base, [{ t: 'cutWords', words: [12, 13, 5, 70], cut: true }]))
    expect(e.removed).toEqual([[words[12].start, words[12].end], [words[13].start, words[13].end]])
  })
})

describe('Layout-Überschreibungen', () => {
  const abs: ShortmeShot[] = [{ start: 100, end: 110, layout: 'smart', cx: 0.3, zoom: 1 }, { start: 110, end: 120, layout: 'smart', cx: 0.7, zoom: 1 }]
  it('Person anklicken: ab hier fester Ausschnitt auf cx, Einstellung wird geteilt', () => {
    const r = applyLayoutOps(abs, [{ t: 'follow', at: 104, cx: 0.55 }], 100, 120)
    expect(r.map((s) => [s.start, s.end, s.layout, s.cx])).toEqual([[100, 104, 'smart', 0.3], [104, 110, 'smart', 0.55], [110, 120, 'smart', 0.7]])
    for (let i = 1; i < r.length; i++) expect(r[i].start).toBe(r[i - 1].end)
  })
  it('Layout-Wechsel (z. B. fit) ab Zeitpunkt; letzte Operation gewinnt', () => {
    const r = applyLayoutOps(abs, [{ t: 'layout', at: 115, layout: 'fit' }, { t: 'layout', at: 115, layout: 'fixed' }], 100, 120)
    expect(r[r.length - 1]).toMatchObject({ start: 115, end: 120, layout: 'fixed' })
  })
  it('Beschnitt über die Shots hinaus ergibt lückenlose Abdeckung; ohne Shots: mittig fest', () => {
    const r = applyLayoutOps(abs, [], 98, 125)
    expect(r[0].start).toBe(98)
    expect(r[r.length - 1].end).toBe(125)
    expect(applyLayoutOps([], [], 0, 10)).toEqual([{ start: 0, end: 10, layout: 'fixed', cx: 0.5, zoom: 1 }])
  })
})
