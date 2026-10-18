import { describe, expect, it } from 'vitest'
import type { AsrWord } from '../src/main/engines/asr/protocol'
import type { ShortmeShot } from '../src/shared/shortme'
import { buildPieces, JUMP_ZOOM, keepsFromCuts, planPauseCuts, TimeMap } from '../src/main/shortme/render/timeline'
import { buildFilterGraph, cropBox } from '../src/main/shortme/render/graph'
import { assColor, assOverride, assTime, buildAss } from '../src/main/shortme/render/ass'
import { BUILTIN_PRESETS } from '../src/shared/preset'
import { safeFileName, uniquePath } from '../src/main/shortme/render/profiles'
import { buildSrt, filterPath, planExport } from '../src/main/shortme/render/exporter'
import type { ShortmeClip } from '../src/shared/shortme'
import type { Transcript } from '../src/main/shortme/transcription'

const W = (w: string, start: number, end: number): AsrWord => ({ w, start, end })

describe('Pausen (Dreifach-Prüfung)', () => {
  const words = [W('a', 0, 1), W('b', 1.1, 2), W('c', 5, 6), W('d', 6.1, 7)] // Lücke 2–5 s
  it('kürzt nur, wenn keine Wörter UND still UND ohne VAD-Stimme', () => {
    const range: [number, number] = [0, 7]
    expect(planPauseCuts(range, words, [[2.05, 4.95]], [])).toEqual([[2.05 + 0.075, 4.95 - 0.075]])
    // Wellenform nicht still → nichts entfernen
    expect(planPauseCuts(range, words, [], [])).toEqual([])
    // VAD meldet Stimme in der Lücke (z. B. Husten/Lachen ohne Wort) → nichts entfernen
    expect(planPauseCuts(range, words, [[2.05, 4.95]], [[2, 5]])).toEqual([])
    // Teilweise Stimme: nur der stimmlose Rest zählt
    const cuts = planPauseCuts(range, words, [[2.05, 4.95]], [[2, 3]])
    expect(cuts).toHaveLength(1)
    expect(cuts[0][0]).toBeGreaterThanOrEqual(3)
  })
  it('lässt kurze Pausen und Randlücken unberührt, behält maxGap', () => {
    expect(planPauseCuts([0, 7], words, [[1.0, 1.1]], [])).toEqual([])
    const cuts = planPauseCuts([0, 7], words, [[2.05, 4.95]], [])
    expect(cuts[0][0] - 2.05 + (4.95 - cuts[0][1])).toBeCloseTo(0.15, 6)
    expect(planPauseCuts([-3, 7], words, [[-3, 0]], [])).toEqual([]) // Anfangslücke
  })
})

describe('TimeMap: eine zentrale Umrechnung', () => {
  const map = new TimeMap(keepsFromCuts([10, 30], [[12, 14], [20, 25]]))
  it('rechnet Quellzeit auf die gekürzte Zeitleiste um', () => {
    expect(map.duration).toBeCloseTo(20 - 2 - 5, 6)
    expect(map.toOut(10)).toBe(0)
    expect(map.toOut(11)).toBe(1)
    expect(map.toOut(14)).toBe(2) // direkt hinter dem Schnitt
    expect(map.toOut(13)).toBe(2) // in entfernter Lücke → rastet am Schnitt ein
    expect(map.toOut(19)).toBe(7)
    expect(map.toOut(26)).toBe(8 + 1)
    expect(map.toOut(30)).toBeCloseTo(13, 6)
  })
  it('Wörter bleiben nach Pausenschnitten synchron und fallen in Lücken weg', () => {
    const out = map.words([W('x', 11, 11.5), W('weg', 12.5, 13), W('y', 14.2, 14.7), W('z', 25.5, 26)])
    expect(out.map((w) => w.w)).toEqual(['x', 'y', 'z'])
    expect(out[1].start).toBeCloseTo(2.2, 6)
    expect(out[2].start).toBeCloseTo(8.5, 6)
  })
})

const SHOT = (start: number, end: number, cx = 0.5, layout: ShortmeShot['layout'] = 'smart', extra: Partial<ShortmeShot> = {}): ShortmeShot => ({ start, end, layout, cx, zoom: 1, ...extra })

describe('Stücke und Sprung-Zoom', () => {
  it('schneidet behaltene Abschnitte mit Shots, Zoom 1,0 ↔ 1,08 am entfernten Schnitt', () => {
    const map = new TimeMap(keepsFromCuts([100, 120], [[105, 108], [112, 114]]))
    const p = buildPieces(map, [SHOT(0, 20)], 100)
    expect(p.map((x) => [x.src0, x.src1, x.zoom])).toEqual([[100, 105, 1], [108, 112, JUMP_ZOOM], [114, 120, 1]])
    expect(p[1].out0).toBeCloseTo(5, 6)
    expect(p[2].out0).toBeCloseTo(9, 6)
  })
  it('teilt Stücke an Shot-Grenzen und lässt kein fit-Stück zoomen', () => {
    const map = new TimeMap(keepsFromCuts([0, 20], [[8, 10]]))
    const p = buildPieces(map, [SHOT(0, 12), SHOT(12, 20, 0.5, 'fit')], 0)
    expect(p.map((x) => [x.src0, x.src1, x.shot.layout, x.zoom])).toEqual([[0, 8, 'smart', 1], [10, 12, 'smart', JUMP_ZOOM], [12, 20, 'fit', 1]])
  })
})

describe('Filter-Graph', () => {
  const src = { width: 1920, height: 1080 }
  it('Zuschnitt: 9:16 aus 16:9, Mitte folgt dem Sprecher, bleibt im Bild und gerade', () => {
    const c = cropBox(src, 0.3, 9 / 16, 1)
    expect(c.h).toBe(1080)
    expect(c.w).toBe(608)
    expect(c.x % 2).toBe(0)
    expect(c.x).toBeCloseTo(0.3 * 1920 - 304, -1)
    expect(cropBox(src, 0.0, 9 / 16, 1).x).toBe(0)
    expect(cropBox(src, 1.0, 9 / 16, 1).x + 608).toBeLessThanOrEqual(1920)
    expect(cropBox(src, 0.5, 9 / 16, 1.08).h).toBe(1000)
  })
  it('baut Video-/Audio-Ketten je Stück und concat', () => {
    const map = new TimeMap(keepsFromCuts([0, 20], [[8, 10]]))
    const pieces = buildPieces(map, [SHOT(0, 10, 0.3), SHOT(10, 14, 0.5, 'fit'), SHOT(14, 20, 0.3, 'split', { cx2: 0.7 })], 0)
    const g = buildFilterGraph(pieces, { src, base: 0, audioFilter: 'loudnorm=I=-14', fadeOutSec: 0.25, duration: 15, videoPost: "ass='x.ass'" })
    expect(g).toContain('concat=n=3:v=1:a=1[vc][ac]')
    expect(g).toContain('[vc]ass=\'x.ass\'[v]')
    expect(g).toContain('[ac]loudnorm=I=-14,afade=t=out:st=14.750:d=0.25[a]')
    expect(g).toContain('vstack')
    expect(g).toContain('gblur')
    expect(g.match(/trim=start/g)!.length).toBe(6)
    for (const k of [0, 1, 2]) { expect(g).toContain(`[v${k}]`); expect(g).toContain(`[a${k}]`) }
  })
})

describe('ASS-Untertitel', () => {
  it('Zeit- und Farbformat', () => {
    expect(assTime(3725.456)).toBe('1:02:05.46')
    expect(assColor('#FFD400')).toBe('&H0000D4FF')
    expect(assOverride('#FFD400')).toBe('&H00D4FF&')
  })
  it('ein Dialogue je Wortzustand (plus Schatten-Ebene), Zeiten aus der gekürzten Zeitleiste', () => {
    const words = [{ w: 'Hallo', start: 0.5, end: 0.9 }, { w: 'du', start: 1, end: 1.2 }, { w: 'da', start: 1.3, end: 1.6, tag: 'emphasis' as const }, { w: 'Welt', start: 2.0, end: 2.4 }]
    const style = { ...BUILTIN_PRESETS.find((p) => p.id === 'impact')!.caption, glow: { enabled: false, strength: 0, color: 'white' as const, activeBoost: false } }
    const ass = buildAss(words, { width: 1080, height: 1920, style })
    const ev = ass.split('\n').filter((l) => l.startsWith('Dialogue'))
    const text = ev.filter((l) => l.startsWith('Dialogue: 2'))
    expect(text).toHaveLength(4)
    expect(ev.filter((l) => l.startsWith('Dialogue: 0'))).toHaveLength(4) // Schatten
    expect(text[0]).toContain('0:00:00.50,0:00:01.00')
    expect(text[0]).toContain('HALLO')
    expect(text[2]).toContain('0:00:01.30,0:00:01.85')
    expect(text[3]).toContain('WELT')
    expect(ass).toContain('PlayResX: 1080')
  })
  it('Glow Karaoke: Glow-Ebene (weichgezeichnete Kontur) nur wenn eingeschaltet', () => {
    const words = [{ w: 'Hallo', start: 0.5, end: 0.9 }, { w: 'du', start: 1, end: 1.2 }]
    const on = buildAss(words, { width: 1080, height: 1920, style: BUILTIN_PRESETS.find((p) => p.id === 'glow-karaoke')!.caption })
    expect(on.split('\n').filter((l) => l.startsWith('Dialogue: 1')).length).toBeGreaterThan(0)
    expect(on).toContain('\\blur')
    const off = buildAss(words, { width: 1080, height: 1920, style: { ...BUILTIN_PRESETS.find((p) => p.id === 'glow-karaoke')!.caption, glow: { enabled: false, strength: 50, color: 'white', activeBoost: false } } })
    expect(off.split('\n').filter((l) => l.startsWith('Dialogue: 1')).length).toBe(0)
  })
})

describe('Dateinamen und Pfade', () => {
  it('entfernt verbotene Zeichen und reservierte Namen', () => {
    expect(safeFileName('Was? Das: "Ding" <wow> / a\\b|c*')).toBe('Was Das Ding wow ab c'.replace('ab c', 'abc'))
    expect(safeFileName('CON')).toBe('_CON')
    expect(safeFileName('  ...  ')).toBe('Clip')
    expect(safeFileName('x'.repeat(300)).length).toBe(100)
    expect(safeFileName('Ende mit Punkt.')).toBe('Ende mit Punkt')
  })
  it('nummeriert bei vorhandenen Dateien', () => {
    const have = new Set(['C:\\o\\Clip.mp4', 'C:\\o\\Clip (2).mp4'])
    expect(uniquePath('C:\\o', 'Clip', '.mp4', (p) => have.has(p)).replace(/\\/g, '/')).toBe('C:/o/Clip (3).mp4')
  })
  it('Filterpfad: Laufwerksdoppelpunkt escapen', () => {
    expect(filterPath('C:\\Users\\a b\\x.ass')).toBe('C\\:/Users/a b/x.ass')
  })
})

describe('Export-Planung', () => {
  const words: AsrWord[] = [W('Hallo', 10, 10.5), W('Welt.', 10.6, 11), W('Neu', 14, 14.4), W('hier.', 14.5, 15)]
  const t = { words, speech: [[10, 11], [14, 15]], durationSec: 30 } as unknown as Transcript
  const clip = { id: 'c', start: 9.9, end: 15.1, firstWord: 0, lastWord: 3, tags: [{ word: 2, kind: 'entity' }], shots: [{ start: 0, end: 5.2, layout: 'smart', cx: 0.4, zoom: 1 }], title: 'T', hookText: 'H' } as unknown as ShortmeClip
  it('kürzt die Pause, mappt Wörter und Tags auf die neue Zeitleiste', () => {
    const p = planExport(clip, t, { silences: [[11.05, 13.95]] }, true)
    expect(p.cuts).toHaveLength(1)
    expect(p.duration).toBeCloseTo(5.2 - (13.95 - 11.05 - 0.15), 2)
    expect(p.words.map((w) => w.w)).toEqual(['Hallo', 'Welt.', 'Neu', 'hier.'])
    expect(p.words[2].tag).toBe('entity')
    // exakt: Ausgabezeit des Wortes = Quellzeit − entfernte Dauer davor
    const removed = p.cuts[0][1] - p.cuts[0][0]
    expect(p.words[2].start).toBeCloseTo(14 - clip.start - removed, 6)
    expect(p.words[0].start).toBeCloseTo(10 - clip.start, 6)
  })
  it('ohne Pausenentfernung bleibt alles unverändert', () => {
    const p = planExport(clip, t, { silences: [[11.05, 13.95]] }, false)
    expect(p.cuts).toHaveLength(0)
    expect(p.duration).toBeCloseTo(5.2, 6)
  })
  it('SRT-Ausgabe', () => {
    const srt = buildSrt([{ w: 'a', start: 0, end: 0.5 }, { w: 'b', start: 0.6, end: 1 }], 4)
    expect(srt).toContain('00:00:00,000 --> 00:00:01,100')
  })
})
