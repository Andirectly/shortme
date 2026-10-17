import type { ShortmeShot } from '@shared/shortme'
import type { AsrWord } from '../../engines/asr/protocol'

// Zeitachse eines Clips (docs/PIPELINE.md §7): Pausen entfernen (Dreifach-Prüfung) und ALLE Zeitachsen
// (Wörter, Shots, Zoom) über EINE zentrale Funktion `TimeMap` auf die gekürzte Zeitleiste umrechnen.

export type Interval = [number, number]

export interface CutOptions { maxGap: number; minRemove: number }
export const CUT_DEFAULTS: CutOptions = { maxGap: 0.15, minRemove: 0.2 }

const clip = (a: Interval, b: Interval): Interval | null => { const s = Math.max(a[0], b[0]); const e = Math.min(a[1], b[1]); return e > s ? [s, e] : null }

/** `iv` minus `sub` (beide sortiert/disjunkt nicht nötig) → Reststücke. */
function subtract(iv: Interval, sub: Interval[]): Interval[] {
  let rest: Interval[] = [iv]
  for (const s of sub) {
    const next: Interval[] = []
    for (const r of rest) {
      if (s[1] <= r[0] || s[0] >= r[1]) { next.push(r); continue }
      if (s[0] > r[0]) next.push([r[0], s[0]])
      if (s[1] < r[1]) next.push([s[1], r[1]])
    }
    rest = next
  }
  return rest
}

/**
 * Zu entfernende Pausen. Eine Lücke wird nur gekürzt, wenn ALLES zutrifft:
 * (1) keine Wörter, (2) laut Wellenform still, (3) laut VAD keine Stimme. Es bleibt `maxGap` Sekunden Pause erhalten.
 */
export function planPauseCuts(range: Interval, words: AsrWord[], silences: Interval[], speech: Interval[], opt: CutOptions = CUT_DEFAULTS): Interval[] {
  const inRange = words.filter((w) => w.end > range[0] && w.start < range[1]).sort((a, b) => a.start - b.start)
  const gaps: Interval[] = []
  let prev = range[0]
  for (const w of inRange) { if (w.start > prev) gaps.push([prev, w.start]); prev = Math.max(prev, w.end) }
  if (range[1] > prev) gaps.push([prev, range[1]])
  const out: Interval[] = []
  for (const g of gaps) {
    // Randlücken (Anfang/Ende des Clips) nicht kürzen: dort liegen Vor-/Nachlauf-Puffer aus dem Einrasten
    if (g[0] <= range[0] + 1e-6 || g[1] >= range[1] - 1e-6) continue
    const quiet = silences.map((s) => clip(g, s)).filter((x): x is Interval => !!x)
    const pieces = quiet.flatMap((q) => subtract(q, speech))
    if (pieces.length === 0) continue
    const best = pieces.reduce((a, b) => (b[1] - b[0] > a[1] - a[0] ? b : a))
    const len = best[1] - best[0]
    if (len < opt.maxGap + opt.minRemove) continue
    // maxGap bleibt erhalten: je die Hälfte vor/nach dem entfernten Stück
    out.push([best[0] + opt.maxGap / 2, best[1] - opt.maxGap / 2])
  }
  return out.sort((a, b) => a[0] - b[0])
}

export interface Keep { src0: number; src1: number; out0: number }

/** Behaltene Abschnitte (Quellzeit) und ihre Position in der gekürzten Zeitleiste. */
export function keepsFromCuts(range: Interval, cuts: Interval[]): Keep[] {
  const keeps: Keep[] = []
  let at = range[0]
  let out = 0
  for (const c of cuts) {
    if (c[0] > at + 1e-9) { keeps.push({ src0: at, src1: c[0], out0: out }); out += c[0] - at }
    at = Math.max(at, c[1])
  }
  if (range[1] > at + 1e-9) keeps.push({ src0: at, src1: range[1], out0: out })
  return keeps
}

/** Die zentrale Umrechnung Quellzeit ↔ gekürzte Zeit; Zeiten in entfernten Pausen rasten am Schnitt ein. */
export class TimeMap {
  constructor(readonly keeps: Keep[]) {}
  get duration(): number { const k = this.keeps[this.keeps.length - 1]; return k ? k.out0 + (k.src1 - k.src0) : 0 }
  toOut(src: number): number {
    for (let i = 0; i < this.keeps.length; i++) {
      const k = this.keeps[i]
      if (src < k.src0) return k.out0 // in entfernter Lücke → Beginn des nächsten Abschnitts
      if (src <= k.src1) return k.out0 + (src - k.src0)
    }
    return this.duration
  }
  /** Index des Abschnitts, der Quellzeit `src` enthält (oder des nächsten). */
  keepIndex(src: number): number {
    const i = this.keeps.findIndex((k) => src < k.src1)
    return i < 0 ? this.keeps.length - 1 : i
  }
  words<T extends { start: number; end: number }>(ws: T[]): T[] {
    return ws.filter((w) => this.keeps.some((k) => w.end > k.src0 && w.start < k.src1)).map((w) => ({ ...w, start: this.toOut(w.start), end: this.toOut(w.end) }))
  }
}

export interface Piece { src0: number; src1: number; out0: number; shot: ShortmeShot; zoom: number; keep: number }

export const JUMP_ZOOM = 1.08

/**
 * Stücke = behaltene Abschnitte ∩ Shots (Shots sind clip-relativ → Quellzeit = clipStart + t).
 * Sprung-Zoom: jeder zweite behaltene Abschnitt (1,0 ↔ 1,08) – an einem entfernten Pausenschnitt wirkt das wie ein gewollter Zoom-Schnitt.
 */
export function buildPieces(map: TimeMap, shots: ShortmeShot[], clipStart: number): Piece[] {
  const pieces: Piece[] = []
  map.keeps.forEach((k, ki) => {
    for (const sh of shots) {
      const a = Math.max(k.src0, clipStart + sh.start)
      const b = Math.min(k.src1, clipStart + sh.end)
      if (b - a < 1e-3) continue
      const zoom = ki % 2 === 1 && sh.layout !== 'fit' ? JUMP_ZOOM : 1
      pieces.push({ src0: a, src1: b, out0: k.out0 + (a - k.src0), shot: sh, zoom, keep: ki })
    }
  })
  return pieces
}
