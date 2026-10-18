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
      { t: 'trim', start: 102, end: 118 }, { t: 'cutWords', words: [12, 13], cut: true }, { t: 'hook', text: 'X' }, { t: 'caption', patch: { presetId: 'pop', style: { caption: { sizePx: 110, y: 0.5 } } } },
      { t: 'follow', at: 105, cx: 0.4 }, { t: 'layout', at: 112, layout: 'fit' }, { t: 'cutWords', words: [12], cut: false }
    ]
    let log: EditLog = emptyLog('c')
    for (const o of ops) log = push(log, o)
    const full = stateOf(base, log)
    expect(full.start).toBe(102)
    expect(full.cutWords).toEqual([13])
    expect(full.caption).toMatchObject({ presetId: 'pop', style: { caption: { sizePx: 110, y: 0.5 } }, highlight: true })
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

  it('Caption-Patch: Preset-Änderungen werden tief zusammengeführt, resetStyle verwirft sie', () => {
    const s1 = reduce(base, [{ t: 'caption', patch: { style: { caption: { sizePx: 110 } } } }, { t: 'caption', patch: { style: { caption: { y: 0.5 }, title: { y: 0.1 } } } }])
    expect(s1.caption.style).toEqual({ caption: { sizePx: 110, y: 0.5 }, title: { y: 0.1 } })
    const s2 = reduce(base, [{ t: 'caption', patch: { style: { caption: { sizePx: 110 } } } }, { t: 'caption', patch: { presetId: 'pop', resetStyle: true, style: {} } }])
    expect(s2.caption.presetId).toBe('pop')
    expect(s2.caption.style).toEqual({})
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

describe('Person anklicken: szenenweise konsistent', () => {
  // 40 s, 5 Ticks/s, Kamerawechsel bei 20 s. A (links) und B (rechts) wechseln sich im Sprechen ab.
  const dt = 0.2
  const n = 200
  const mk = (id: number, cx: number, speak: (i: number) => number): import('../src/shared/layoutPlan').PlanTrack => ({ id, start: 0, centres: Array(n).fill(cx), areas: Array(n).fill(0.1), scores: Array.from({ length: n }, (_, i) => speak(i)) })
  const A = mk(1, 0.3, (i) => (Math.floor(i / 40) % 2 === 0 ? 4 : -4))
  const B = mk(2, 0.7, (i) => (Math.floor(i / 40) % 2 === 1 ? 4 : -4))
  const input = { tracks: [A, B], ticks: n, dt, cuts: [100], sourceAspect: 16 / 9 }
  const auto = planShotsForTest()
  function planShotsForTest(): ShortmeShot[] {
    return [{ start: 0, end: 8, layout: 'smart', cx: 0.3, zoom: 1 }, { start: 8, end: 16, layout: 'smart', cx: 0.7, zoom: 1 }, { start: 16, end: 20, layout: 'smart', cx: 0.3, zoom: 1 }, { start: 20, end: 40, layout: 'smart', cx: 0.7, zoom: 1 }]
  }

  it('wählt die Person nächst der Klickposition und gilt für die GANZE Einstellung davor und danach', () => {
    const r = applyLayoutOps(auto, [{ t: 'follow', at: 5, cx: 0.7 }], 0, 40, { input, clipStart: 0 })
    const inScene = r.filter((s) => s.end <= 20 + 1e-6)
    expect(inScene.length).toBeGreaterThanOrEqual(1)
    for (const s of inScene) expect(s.cx).toBeCloseTo(0.7, 1) // nie zurück zu Person A
    expect(r[0].start).toBe(0)
    // nach dem Schnitt (20 s) unverändert
    expect(r.filter((s) => s.start >= 20 - 1e-6).map((s) => [s.start, s.end, s.cx])).toEqual([[20, 40, 0.7]])
    for (let i = 1; i < r.length; i++) expect(r[i].start).toBeCloseTo(r[i - 1].end, 6)
  })

  it('Klick ins Leere (zu weit von jeder Person) fällt auf das alte Verhalten zurück', () => {
    const r = applyLayoutOps(auto, [{ t: 'follow', at: 5, cx: 0.5 }], 0, 40, { input, clipStart: 0 })
    expect(r.some((s) => s.start === 5)).toBe(true)
  })

  it('Layout-Wechsel gilt ebenfalls für die ganze Kameraeinstellung', () => {
    const r = applyLayoutOps(auto, [{ t: 'layout', at: 12, layout: 'fit' }], 0, 40, { input, clipStart: 0 })
    expect(r.filter((s) => s.end <= 20 + 1e-6).every((s) => s.layout === 'fit')).toBe(true)
    expect(r.filter((s) => s.start >= 20 - 1e-6).every((s) => s.layout === 'smart')).toBe(true)
  })

  it('Lücken der Erkennung werden mit der letzten Position überbrückt (kein fit/Mitte)', () => {
    const gappy = { ...B, start: 0, centres: B.centres.map((c, i) => (i >= 20 && i < 60 ? NaN : c)) }
    const sc = { tracks: [A, { ...gappy, centres: gappy.centres.map((c) => (Number.isNaN(c) ? 0.7 : c)) }], ticks: n, dt, cuts: [100], sourceAspect: 16 / 9 }
    const r = applyLayoutOps(auto, [{ t: 'follow', at: 2, cx: 0.7 }], 0, 40, { input: sc, clipStart: 0 })
    expect(r.filter((s) => s.end <= 20 + 1e-6).every((s) => s.layout === 'smart')).toBe(true)
  })
})
