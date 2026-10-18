// Layout „Facecam + Gameplay“ (Hochformat aus Landscape-Stream): reine Geometrie für Export (FFmpeg) UND Editor-Vorschau (Canvas).
// Vorbild: Twitch „Portrait Version“ beim Clip-Erstellen. Alle Rechtecke der Quelle sind normiert (0..1 von Breite/Höhe der Quelle).

import { OUT_H, OUT_W, even } from './framing'

export interface NRect { x: number; y: number; w: number; h: number }
export interface PxRect { x: number; y: number; w: number; h: number }

export type StreamPreset = 'top' | 'half' | 'bottom' | 'pip'

export const STREAM_PRESETS: Array<{ id: StreamPreset; label: string }> = [
  { id: 'top', label: 'Facecam oben' },
  { id: 'half', label: '50 : 50' },
  { id: 'bottom', label: 'Facecam unten' },
  { id: 'pip', label: 'Kleines Fenster' }
]

export interface StreamLayout {
  preset: StreamPreset
  /** Facecam-Rahmen in der Quelle. */
  cam: NRect
  /** Gameplay-Rahmen in der Quelle (Seitenverhältnis wird beim Rendern an das Ziel angepasst, siehe `fitGame`). */
  game: NRect
  /** Dünner Abstand zwischen Facecam und Gameplay in Ausgabepixeln (0 = keiner). */
  gap: number
}

export const DEFAULT_GAP = 0
const PIP_W = 432
const PIP_MARGIN = 36
const PIP_TOP = 120

const clamp = (v: number, a: number, b: number): number => Math.min(b, Math.max(a, v))

/** Zielrechtecke (Ausgabepixel, 1080×1920) von Facecam und Gameplay. `camAspect` = Breite/Höhe des Facecam-Rahmens (nur für „Kleines Fenster“). */
export function streamDest(preset: StreamPreset, gap: number, camAspect = 16 / 9): { cam: PxRect; game: PxRect; seam: number | null } {
  const g = Math.round(clamp(gap, 0, 60) / 2) * 2
  if (preset === 'pip') {
    const h = even(Math.round(PIP_W / camAspect))
    return { cam: { x: OUT_W - PIP_W - PIP_MARGIN, y: PIP_TOP, w: PIP_W, h }, game: { x: 0, y: 0, w: OUT_W, h: OUT_H }, seam: null }
  }
  const camH = even(Math.round((OUT_H - g) / (preset === 'half' ? 2 : 3)))
  const gameH = OUT_H - g - camH
  if (preset === 'bottom') return { cam: { x: 0, y: gameH + g, w: OUT_W, h: camH }, game: { x: 0, y: 0, w: OUT_W, h: gameH }, seam: (gameH + g / 2) / OUT_H }
  return { cam: { x: 0, y: 0, w: OUT_W, h: camH }, game: { x: 0, y: camH + g, w: OUT_W, h: gameH }, seam: (camH + g / 2) / OUT_H }
}

/** Gameplay-Rahmen auf das Zielseitenverhältnis bringen: Mitte und Höhe bleiben, die Breite folgt (und wird in das Bild geschoben/begrenzt). */
export function fitGame(src: { width: number; height: number }, game: NRect, destAspect: number): NRect {
  const k = src.height / src.width
  let h = clamp(game.h, 0.1, 1)
  let w = h * destAspect * k
  if (w > 1) { w = 1; h = w / (destAspect * k) }
  const cx = game.x + game.w / 2
  const cy = game.y + game.h / 2
  return { x: clamp(cx - w / 2, 0, 1 - w), y: clamp(cy - h / 2, 0, 1 - h), w, h }
}

/** Quellausschnitt (Pixel, gerade Werte) für einen Rahmen, der ein Ziel mit Seitenverhältnis `destAspect` ausfüllt (Mitte bleibt, überstehende Seite wird abgeschnitten). */
export function coverCrop(src: { width: number; height: number }, r: NRect, destAspect: number): PxRect {
  let w = r.w * src.width
  let h = r.h * src.height
  if (w / h > destAspect) w = h * destAspect
  else h = w / destAspect
  const cx = (r.x + r.w / 2) * src.width
  const cy = (r.y + r.h / 2) * src.height
  const W = Math.min(src.width, even(w))
  const H = Math.min(src.height, even(h))
  return { w: W, h: H, x: even(clamp(cx - W / 2, 0, src.width - W)), y: even(clamp(cy - H / 2, 0, src.height - H)) }
}

export interface StreamPlan { cam: { crop: PxRect; dest: PxRect }; game: { crop: PxRect; dest: PxRect }; seam: number | null; pip: boolean }

/** Alles, was Export und Vorschau brauchen: Quellausschnitte und Zielrechtecke. */
export function planStream(src: { width: number; height: number }, s: StreamLayout): StreamPlan {
  const camAspect = (s.cam.w * src.width) / Math.max(1, s.cam.h * src.height)
  const d = streamDest(s.preset, s.gap, camAspect)
  const game = fitGame(src, s.game, d.game.w / d.game.h)
  return {
    cam: { crop: coverCrop(src, s.cam, d.cam.w / d.cam.h), dest: d.cam },
    game: { crop: coverCrop(src, game, d.game.w / d.game.h), dest: d.game },
    seam: d.seam, pip: s.preset === 'pip'
  }
}

const overlap = (a: NRect, b: NRect): number => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y))

/** Vorschlag für den Gameplay-Rahmen: volle Höhe, mittig – seitlich so verschoben, dass Facecam (und der Platz darunter, wo meist der Chat liegt) möglichst frei bleiben. */
export function defaultGame(src: { width: number; height: number }, preset: StreamPreset, gap: number, cam: NRect | null): NRect {
  const destAspect = (() => { const d = streamDest(preset, gap); return d.game.w / d.game.h })()
  const base = fitGame(src, { x: 0, y: 0, w: 1, h: 1 }, destAspect)
  if (!cam) return base
  // Chat-Annahme: unter (oder über) der Facecam, gleiche Breite, etwa so hoch wie 1,3 × Facecam
  const chat: NRect = cam.y < 0.5 ? { x: cam.x, y: cam.y + cam.h, w: cam.w, h: Math.min(1 - cam.y - cam.h, cam.h * 1.3) } : { x: cam.x, y: Math.max(0, cam.y - cam.h * 1.3), w: cam.w, h: Math.min(cam.y, cam.h * 1.3) }
  let best = { x: base.x, cost: Infinity }
  for (let x = 0; x <= 1 - base.w + 1e-9; x += 0.005) {
    const r = { ...base, x }
    const cost = (overlap(r, cam) * 6 + overlap(r, chat) * 3) / (base.w * base.h) + Math.abs(x + base.w / 2 - 0.5) * 0.4
    if (cost < best.cost) best = { x, cost }
  }
  return { ...base, x: best.x }
}

export function defaultStream(src: { width: number; height: number }, cam: NRect, preset: StreamPreset = 'top', gap = DEFAULT_GAP): StreamLayout {
  return { preset, cam, game: defaultGame(src, preset, gap, cam), gap }
}

const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d)
const rect = (r: unknown, d: NRect): NRect => {
  const o = (r ?? {}) as Partial<NRect>
  const w = clamp(num(o.w, d.w), 0.03, 1)
  const h = clamp(num(o.h, d.h), 0.03, 1)
  return { x: clamp(num(o.x, d.x), 0, 1 - w), y: clamp(num(o.y, d.y), 0, 1 - h), w, h }
}

/** Gespeicherte/gelesene Werte absichern (defekte Dateien dürfen nie blockieren). */
export function sanitizeStream(x: unknown, fallback: StreamLayout): StreamLayout {
  const o = (x ?? {}) as Partial<StreamLayout>
  const preset = STREAM_PRESETS.some((p) => p.id === o.preset) ? (o.preset as StreamPreset) : fallback.preset
  return { preset, cam: rect(o.cam, fallback.cam), game: rect(o.game, fallback.game), gap: clamp(Math.round(num(o.gap, fallback.gap)), 0, 60) }
}

/** Zeilenhöhe-Anteil der Naht für die Standardposition der Untertitel (null: kein festes Layout, Preset-Standard bleibt). */
export const seamY = (s: StreamLayout, src: { width: number; height: number }): number | null => planStream(src, s).seam

/** Nahtstelle (Anteil der Höhe) des längsten Stream-Abschnitts der Shots – Standardposition der Untertitel. null = kein festes Layout. */
export function streamSeamY(shots: Array<{ start: number; end: number; layout: string; stream?: StreamLayout }>, src: { width: number; height: number }): number | null {
  let best: { len: number; seam: number } | null = null
  for (const sh of shots) {
    if (sh.layout !== 'stream' || !sh.stream) continue
    const seam = planStream(src, sh.stream).seam
    if (seam !== null && (!best || sh.end - sh.start > best.len)) best = { len: sh.end - sh.start, seam }
  }
  return best?.seam ?? null
}

/** Vollständiges Layout (aus „Facecam suchen“ oder Kanal-Layout) statt nur einer Änderung? */
export const isFullStream = (p: Partial<StreamLayout>): p is StreamLayout => !!p.cam && !!p.game && !!p.preset && p.gap !== undefined
