import { describe, expect, it } from 'vitest'
import { coverCrop, defaultGame, defaultStream, fitGame, planStream, streamDest, streamSeamY, type StreamLayout } from '../src/shared/streamLayout'
import { pickStableFace, refineCam } from '../src/shared/camEdges'
import { guessKind, sanitizeProfile } from '../src/shared/videoKind'
import { mergeStreamScenes, scenesOf } from '../src/main/shortme/layout/streamShots'
import { applyStreamOps, effectiveClip, baseState, reduce } from '../src/shared/edits'
import { planShots, type PlanInput } from '../src/shared/layoutPlan'
import { videoChain } from '../src/main/shortme/render/graph'
import { drawLayout, sourceRects } from '../src/shared/previewDraw'
import type { ShortmeClip, ShortmeShot } from '../src/shared/shortme'

const SRC = { width: 1920, height: 1080 }
const CAM = { x: 0.697, y: 0, w: 0.303, h: 0.3 }

describe('Facecam + Gameplay: Geometrie', () => {
  it('Zielbereiche: oben 1/3 zu 2/3, 50:50, unten, Fenster; Abstand', () => {
    const t = streamDest('top', 0)
    expect(t.cam).toMatchObject({ y: 0, h: 640 })
    expect(t.game).toMatchObject({ y: 640, h: 1280 })
    expect(t.seam).toBeCloseTo(640 / 1920, 3)
    expect(streamDest('half', 0).cam.h).toBe(960)
    const b = streamDest('bottom', 0)
    expect(b.game.y).toBe(0)
    expect(b.cam.y).toBe(b.game.h)
    const g = streamDest('top', 20)
    expect(g.cam.h + 20 + g.game.h).toBe(1920)
    expect(g.game.y).toBe(g.cam.h + 20)
    const p = streamDest('pip', 0)
    expect(p.game).toMatchObject({ w: 1080, h: 1920 })
    expect(p.seam).toBeNull()
  })
  it('Gameplay-Rahmen hat das Zielseitenverhältnis und bleibt im Bild', () => {
    const g = fitGame(SRC, { x: 0.9, y: 0, w: 0.5, h: 1 }, 1080 / 1280)
    expect((g.w * SRC.width) / (g.h * SRC.height)).toBeCloseTo(1080 / 1280, 2)
    expect(g.x + g.w).toBeLessThanOrEqual(1 + 1e-9)
    const c = coverCrop(SRC, CAM, 1080 / 640)
    expect(c.w / c.h).toBeCloseTo(1080 / 640, 1)
    expect(c.x + c.w).toBeLessThanOrEqual(SRC.width)
  })
  it('Standard-Gameplay weicht Facecam und Chat darunter aus', () => {
    const g = defaultGame(SRC, 'top', 0, CAM)
    expect(g.x + g.w).toBeLessThanOrEqual(CAM.x + 0.01)
    const none = defaultGame(SRC, 'top', 0, null)
    expect(none.x + none.w / 2).toBeCloseTo(0.5, 1)
  })
  it('Plan: Quellausschnitte gerade, Naht für Untertitel', () => {
    const s = defaultStream(SRC, CAM)
    const p = planStream(SRC, s)
    for (const v of [p.cam.crop, p.game.crop]) { expect(v.w % 2).toBe(0); expect(v.h % 2).toBe(0) }
    expect(streamSeamY([{ start: 0, end: 10, layout: 'stream', stream: s }, { start: 10, end: 12, layout: 'smart' }], SRC)).toBeCloseTo(1 / 3, 2)
    expect(streamSeamY([{ start: 0, end: 10, layout: 'smart' }], SRC)).toBeNull()
  })
})

describe('Facecam-Erkennung (Kanten)', () => {
  // 192×108 Bild: Facecam rechts oben (x 140–192, y 0–32); links Spiel (bewegtes Muster); darunter „Chat“-Zeilen
  const W = 192, H = 108
  const frames = Array.from({ length: 6 }, (_, k) => {
    const f = new Uint8Array(W * H)
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const game = 90 + 60 * Math.sin((x + k * 7) * 0.5) * Math.cos((y - k * 3) * 0.4)
      f[y * W + x] = x >= 140 && y < 32 ? 200 + 20 * Math.sin(x * 0.2 + k) : game
    }
    for (let y = 40; y < 100; y += 6) for (let x = 142; x < 188; x += 2) if ((x + y + k) % 5 < 2) f[y * W + x] = 255 // Chat-Text
    return f
  })
  it('findet die tatsächlichen Kanten, nicht den Chat darunter', () => {
    const r = refineCam(frames, W, H, { x1: 155 / W, y1: 6 / H, x2: 175 / W, y2: 24 / H })
    expect(r.cam.x * W).toBeGreaterThan(134)
    expect(r.cam.x * W).toBeLessThan(146)
    expect(r.cam.x + r.cam.w).toBeCloseTo(1, 2)
    expect(r.cam.y).toBe(0)
    expect((r.cam.y + r.cam.h) * H).toBeGreaterThan(26)
    expect((r.cam.y + r.cam.h) * H).toBeLessThan(40)
  })
  it('ortsfestes kleines Gesicht gewinnt, großes Gesicht nicht', () => {
    const small = { x1: 0.8, y1: 0.07, x2: 0.84, y2: 0.17 }
    expect(pickStableFace([[small], [small], [small], [{ ...small, x1: 0.801 }]])?.share).toBe(1)
    const big = { x1: 0.2, y1: 0.1, x2: 0.7, y2: 0.8 }
    expect(pickStableFace([[big], [big]])).toBeNull()
    expect(pickStableFace([[small], [], [], []])).toBeNull()
  })
})

describe('Inhaltstyp', () => {
  it('Einschätzung', () => {
    expect(guessKind({ facecam: false, oneFace: 0, twoFaces: 0, cutsPerMin: 0, twitch: true }).kind).toBe('stream')
    expect(guessKind({ facecam: true, oneFace: 0, twoFaces: 0, cutsPerMin: 0, twitch: false }).kind).toBe('stream')
    expect(guessKind({ facecam: false, oneFace: 0.2, twoFaces: 0.7, cutsPerMin: 2, twitch: false }).kind).toBe('podcast')
    expect(guessKind({ facecam: false, oneFace: 0.9, twoFaces: 0, cutsPerMin: 2, twitch: false }).kind).toBe('solo')
    expect(guessKind({ facecam: false, oneFace: 0.9, twoFaces: 0, cutsPerMin: 12, twitch: false }).kind).toBe('vlog')
    expect(guessKind({ facecam: false, oneFace: 0, twoFaces: 0, cutsPerMin: 1, twitch: false }).kind).toBe('talk')
  })
  it('Profile werden abgesichert', () => {
    const p = sanitizeProfile({ frame: 'kaputt', ranking: { signal: 'x', heat: 3 }, marks: ['laugh', 5] }, 'stream')
    expect(p.frame).toBe('smart')
    expect(p.ranking).toEqual({ signal: 5, heat: 3, chat: 1 })
    expect(p.marks).toEqual(['laugh'])
  })
})

describe('Szenen ohne Facecam', () => {
  const base = defaultStream(SRC, CAM)
  const planned: ShortmeShot[] = [{ start: 0, end: 30, layout: 'smart', cx: 0.4, zoom: 1 }]
  it('Szenen aus Kamerawechseln, kurze werden zugeschlagen', () => {
    expect(scenesOf(100, 130, [110, 110.5, 120])).toEqual([{ start: 100, end: 110.5 }, { start: 110.5, end: 120 }, { start: 120, end: 130 }])
  })
  it('Stream-Szenen mit Facecam, übrige Smart (harter Schnitt)', () => {
    const shots = mergeStreamScenes(100, 130, planned, [{ start: 100, end: 112, cam: true }, { start: 112, end: 120, cam: false }, { start: 120, end: 130, cam: true }], base)
    expect(shots.map((s) => s.layout)).toEqual(['stream', 'smart', 'stream'])
    expect(shots[0].start).toBe(0)
    expect(shots[2].end).toBe(30)
    expect(shots[1]).toMatchObject({ start: 12, end: 20 })
  })
})

describe('Bearbeitung des Facecam-Layouts', () => {
  const s0 = defaultStream(SRC, CAM)
  const shots: ShortmeShot[] = [{ start: 0, end: 10, layout: 'stream', cx: 0.5, zoom: 1, stream: s0 }, { start: 10, end: 20, layout: 'stream', cx: 0.5, zoom: 1, stream: s0 }]
  it('Clip-weit und pro Szene', () => {
    const out = applyStreamOps(shots, [{ t: 'stream', patch: { gap: 12 } }, { t: 'stream', patch: { preset: 'half' }, at: 15 }], s0)
    expect(out[0].stream).toMatchObject({ gap: 12, preset: 'top' })
    expect(out[1].stream).toMatchObject({ gap: 12, preset: 'half' })
  })
  it('ohne Layout kein Stream-Bild; volles Layout aus der Operation reicht', () => {
    expect(applyStreamOps([{ ...shots[0], stream: undefined }], [], undefined)[0].layout).toBe('fixed')
    expect(applyStreamOps([{ ...shots[0], stream: undefined }], [{ t: 'stream', patch: s0 }], undefined)[0].layout).toBe('stream')
  })
  it('Operationen laufen durch reduce/effectiveClip', () => {
    const st = reduce(baseState({ start: 0, end: 20, hookText: '' }), [{ t: 'stream', patch: { gap: 8 } }])
    expect(st.streamOps).toHaveLength(1)
    const eff = effectiveClip({ start: 0, end: 20, firstWord: 0, lastWord: 0, shots, hookText: '', stream: s0 } as unknown as ShortmeClip, [{ start: 0, end: 1 }], st)
    expect(eff.shots?.[0].stream?.gap).toBe(8)
  })
})

describe('Planer nach Profil', () => {
  const ticks = 50
  it('Vlog/Solo bleiben bei der Hauptperson, ohne Split', () => {
    const inp: PlanInput = {
      ticks, dt: 0.2, cuts: [], sourceAspect: 16 / 9,
      tracks: [
        { id: 0, start: 0, centres: Array(ticks).fill(0.3), areas: Array(ticks).fill(0.05), scores: Array.from({ length: ticks }, (_, i) => (i < 25 ? 2 : -2)) },
        { id: 1, start: 0, centres: Array(ticks).fill(0.7), areas: Array(ticks).fill(0.03), scores: Array.from({ length: ticks }, (_, i) => (i < 25 ? -2 : 2)) }
      ]
    }
    const opts = { switchRatio: 1.25, minSpeakSec: 1, ignoreAreaRatio: 0.1, moveLimit: 0.06, noSpeakerSec: 3, minShotSec: 0.8, pingPongSwitches: 3, pingPongWindowSec: 6 }
    const speaker = planShots(inp)
    const main = planShots(inp, { ...opts, follow: 'main', allowSplit: false })
    expect(new Set(speaker.map((s) => Math.round(s.cx * 10))).size).toBeGreaterThan(1)
    expect(main.every((s) => s.layout === 'smart' && Math.abs(s.cx - 0.3) < 0.1)).toBe(true)
  })
})

describe('Export-Filter und Vorschau', () => {
  const s = defaultStream(SRC, CAM, 'top', 10)
  const piece = (st: StreamLayout) => ({ src0: 0, src1: 5, zoom: 1, shot: { start: 0, end: 5, layout: 'stream' as const, cx: 0.5, zoom: 1, stream: st } })
  it('top: Facecam gepolstert über Gameplay, vstack', () => {
    const f = videoChain(piece(s) as never, 0, SRC, 0)
    expect(f).toMatch(/pad=1080:\d+:0:0:color=black\[pc0\];\[pc0\]\[tg0\]vstack=inputs=2/)
    expect(f).toContain('split=2[sc0][sg0]')
  })
  it('bottom und pip', () => {
    expect(videoChain(piece({ ...s, preset: 'bottom' }) as never, 1, SRC, 0)).toMatch(/\[pg1\]\[tc1\]vstack/)
    expect(videoChain(piece({ ...s, preset: 'pip' }) as never, 2, SRC, 0)).toMatch(/\[tg2\]\[tc2\]overlay=\d+:\d+/)
  })
  it('Vorschau zeichnet Gameplay und Facecam und liefert beide Rahmen für die Quellansicht', () => {
    const calls: number[][] = []
    const ctx = { filter: '', clearRect: () => undefined, save: () => undefined, restore: () => undefined, drawImage: (_v: unknown, ...a: number[]) => { calls.push(a) } }
    drawLayout(ctx, {}, SRC, { layout: 'stream', cx: 0.5, stream: s }, 1, 540, 960)
    expect(calls).toHaveLength(2)
    expect(calls[1][5]).toBe(0) // Facecam zuletzt, oben
    const r = sourceRects(SRC, { layout: 'stream', cx: 0.5, stream: s }, 1)
    expect(r.map((x) => x.kind)).toEqual(['game', 'cam'])
  })
})
