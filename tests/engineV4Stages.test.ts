import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { QUERY_BANK, contrastScores, evenWindows, expandQueries, loudnessEvents, speechUncertainWindows } from '../src/main/shortme/clips/engines/v4/lanes'
import { makeWindow, nextWindow, plannerContextCheck } from '../src/main/shortme/clips/engines/v4/investigate'
import { actionEdges, audioPhraseEdges, compositeTime, makeVariants, type JudgedCut } from '../src/main/shortme/clips/engines/v4/cut'
import { avParts } from '../src/main/shortme/clips/engines/v4/media'
import { parseModelJson, type Seed } from '../src/main/shortme/clips/engines/v4/core'
import { TimeMap, keepsFromCuts } from '../src/main/shortme/render/timeline'
import { safeFileName } from '../src/main/shortme/render/profiles'
import { buildFilterGraph } from '../src/main/shortme/render/graph'

describe('V4 Lanes (V4-011/017/018/020/022)', () => {
  it('Pegelsprung und plötzliche Stille ohne Transkript, mit eigenem Beleg', () => {
    const loud = Array.from({ length: 120 }, (_, i) => (i === 60 ? 0.95 : i >= 80 && i < 90 ? 0.6 : 0.2))
    const sil = Array.from({ length: 120 }, (_, i) => (i >= 90 && i < 95 ? 1 : 0))
    const r = loudnessEvents({ loudness: loud, silence: sil }, 120, 5)
    expect(r.proposals.some((p) => Math.abs((p.anchor ?? 0) - 60) < 1)).toBe(true)
    expect(r.proposals.every((p) => p.source === 'audio' && p.evidenceIds?.length)).toBe(true)
    expect(r.evidence.every((e) => e.state === 'signal-only')).toBe(true)
  })
  it('Anfragebank ohne Pflicht-Genres, mit negativen Anfragen; Erweiterung aus Nutzerwunsch und Sprach-Seeds', () => {
    expect(QUERY_BANK.some((q) => q.polarity === 'neg')).toBe(true)
    const seed: Seed = { id: 's', lane: 'speech', laneRank: 0, anchor: 5, span: { start: 0, end: 10 }, evidenceIds: ['e'], hint: 'x', summary: 'Er erzählt vom Unfall mit dem Auto', laneScore: null }
    const q = expandQueries(QUERY_BANK, 'Hund', [seed])
    expect(q.map((x) => x.origin)).toEqual(expect.arrayContaining(['bank', 'user', 'speech-expansion']))
  })
  it('negative Anfragen senken den Wert (Kontrast)', () => {
    const c = contrastScores({ a: Float32Array.from([2, 2]), n: Float32Array.from([0, 3]) }, ['a'], ['n'])
    expect(c.a[0]).toBeGreaterThan(c.a[1])
  })
  it('Gesang/Musik macht ASR-Wörter unsicher (V4-012)', () => {
    const vocal = new Uint8Array(250); for (let k = 0; k < 125; k++) vocal[k] = 200
    const u = speechUncertainWindows({ vocal, music: new Uint8Array(250) }, 0.48, 120)
    expect(u).toEqual([{ start: 0, end: 60, share: 1 }])
    expect(speechUncertainWindows(null, 0.48, 120)).toEqual([])
  })
  it('Abdeckungsfenster lückenlos bis zum Ende', () => {
    const w = evenWindows('audio', 125, 60, 'x')
    expect(w[0].startSeconds).toBe(0); expect(w[w.length - 1].endSeconds).toBe(125)
  })
})

describe('V4 Investigator-Planer (V4-023/027)', () => {
  const w = makeWindow('g.w1', { start: 100, end: 130 }, 600)
  it('Segmente à 5 s mit IDs aus dem Fenster', () => { expect(w.segments.map((s) => s.id)).toEqual(['g.w1.S1', 'g.w1.S2', 'g.w1.S3', 'g.w1.S4', 'g.w1.S5', 'g.w1.S6']) })
  it('Folgefenster werden vom Planer gerechnet (vorher/nachher/verwandt), Grenzen und Wiederholung abgefangen', () => {
    expect(nextWindow('expand_before', w, [w.span], 600, [], 'g.w2')!.span.start).toBe(75)
    expect(nextWindow('expand_after', w, [w.span], 600, [], 'g.w2')!.span.end).toBe(155)
    expect(nextWindow('expand_before', makeWindow('x', { start: 0, end: 20 }, 600), [], 600, [], 'y')).toBeNull()
    expect(nextWindow('retrieve_related', w, [w.span], 600, [{ start: 400, end: 408 }], 'g.w2')!.span.start).toBe(400)
    expect(nextWindow('inspect_av', w, [w.span], 600, [], 'g.w2')).toBeNull()
  })
  it('Planer prüft Kontext selbst: fehlt die Pointe → danach, fehlt die Vorgeschichte → davor, sonst Ende', () => {
    const n = (role: string) => ({ id: role, role: role as never, span: { start: 105, end: 110 }, state: 'observed' as const, evidenceIds: ['e'], description: '' })
    expect(plannerContextCheck([n('setup')], w, 600, [w.span])).toBe('expand_after')
    expect(plannerContextCheck([n('payoff')], w, 600, [w.span])).toBe('expand_before')
    expect(plannerContextCheck([n('trigger'), n('reaction')], w, 600, [w.span])).toBeNull()
    expect(plannerContextCheck([n('setup')], w, 600, [w.span, { start: 125, end: 155 }])).toBeNull()
  })
})

describe('V4 Kanten, Varianten, AV-Teile (V4-013/028/030/044)', () => {
  it('Tonphrasen aus Pegeltälern und Musikgrenzen, Aktionen aus Bildänderungen', () => {
    expect(audioPhraseEdges([0.8, 0.2, 0.8, 0.9], null, 0.48)).toEqual([1.5])
    expect(audioPhraseEdges([0.5, 0.5, 0.5], Uint8Array.from([0, 200, 200, 0]), 1)).toEqual([1, 3])
    expect(actionEdges([0, 1, 2, 3], [0.1, 0.9, 0.2], 1)).toEqual([2])
  })
  it('lange Bereiche werden für das AV-Modell auf ≤ 40 s verdichtet, Zeiten bleiben zuordenbar', () => {
    const p = avParts({ start: 10, end: 80 })
    expect(p.reduce((n, x) => n + x.end - x.start, 0)).toBeCloseTo(40, 5)
    expect(p[0].start).toBe(10); expect(p[p.length - 1].end).toBe(80)
    expect(compositeTime(10, p)).toBe(0); expect(compositeTime(80, p)).toBeCloseTo(40, 5); expect(compositeTime(40, p)).toBeNull()
  })
  it('mindestens zwei Varianten mit unterschiedlichen echten Grenzen, Judge-Fehler (Pointe) ausgeschlossen', () => {
    const c = (s: string, e: string, a: number, b: number) => ({ id: `${s}__${e}`, startEdgeId: s, endEdgeId: e, span: { start: a, end: b }, prefilter: 0 })
    const j = (cut: ReturnType<typeof c>, payoff: 'pass' | 'fail'): JudgedCut => ({ cand: cut, chosen: cut, tracePath: 't', answer: { startEdgeId: cut.startEdgeId, endEdgeId: cut.endEdgeId, preferred: true, reasonCode: 'x', criteria: [{ id: 'payoff', state: payoff, reason: 'r', evidenceIds: ['P1'] }] } })
    const v = makeVariants('e', [j(c('E1', 'E9', 10, 40), 'pass'), j(c('E3', 'E9', 15, 40), 'pass'), j(c('E1', 'E5', 10, 30), 'fail')])
    expect(v.length).toBeGreaterThanOrEqual(2)
    expect(new Set(v.map((x) => x.cut.id)).size).toBe(v.length)
    expect(v.some((x) => x.cut.endEdgeId === 'E5')).toBe(false)
  })
})

describe('V4 TimeMap bei Lücken (V4-031)', () => {
  it('Wörter nach einem Lückenschnitt ohne Drift auf der Ausgabeachse', () => {
    const m = new TimeMap(keepsFromCuts([100, 160], [[120, 125]]))
    expect(m.duration).toBeCloseTo(55, 6)
    const w = m.words([{ start: 110, end: 110.5 }, { start: 130, end: 130.5 }])
    expect(w[0].start).toBeCloseTo(10, 6); expect(w[1].start).toBeCloseTo(25, 6)
  })
})

describe('V4 Sicherheit und Robustheit (V4-016/046/047)', () => {
  const py = readFileSync('resources/python/worker.py', 'utf8')
  it('Worker: offline, kein shell=True, Pfade nur aus freigegebenen Ordnern, keine Pickle-Ausgaben', () => {
    expect(py).toContain('HF_HUB_OFFLINE')
    expect(py).not.toMatch(/shell\s*=\s*True/)
    expect(py).toMatch(/def inside\(/)
    expect(py).toContain('allow_pickle=False')
    expect(py).toMatch(/inside\(p\.get\("path"\), _args\.allowed_root\)/)
  })
  it('Modelltext: Formfehler einmal bereinigt, sonst Fehler (kein Raten)', () => {
    expect(parseModelJson('x {"a":[1,2,],} y')).toEqual({ a: [1, 2] })
    expect(() => parseModelJson('kein json')).toThrow()
  })
  it('Dateinamen ohne Zeichen, die den FFmpeg-Filtergraphen brechen', () => {
    expect(safeFileName("Er singt 'Embastiana, bustisana' [live]")).toBe('Er singt Embastiana bustisana live')
  })
  it('Quelle ohne Tonspur: Filtergraph ohne Tonkette, keine erfundene Stille', () => {
    const g = buildFilterGraph([{ src0: 10, src1: 20, out0: 0, zoom: 1, keep: 0, shot: { start: 0, end: 10, layout: 'fixed', cx: 0.5, zoom: 1 } } as never], { src: { width: 1920, height: 1080 }, base: 10, duration: 10, audio: false })
    expect(g).not.toContain('[0:a]'); expect(g).toContain('a=0[v]')
    expect(buildFilterGraph([{ src0: 10, src1: 20, out0: 0, zoom: 1, keep: 0, shot: { start: 0, end: 10, layout: 'fixed', cx: 0.5, zoom: 1 } } as never], { src: { width: 1920, height: 1080 }, base: 10, duration: 10 })).toContain('[0:a]')
  })
  it('Katalog: Modelle mit fester Revision und SHA-256', () => {
    const cat = readFileSync('src/main/engines/catalog.ts', 'utf8')
    expect(cat).toMatch(/MiniCPM-o-4_5\/resolve\/fb09628e98b1f55d8d5b863e0eccfcdd11bff499/)
    expect(cat).toMatch(/Qwen3-VL-Embedding-2B\/resolve\/9f2f7e710d6d81056aa5c0a4f04764fec6bb7bda/)
  })
})
