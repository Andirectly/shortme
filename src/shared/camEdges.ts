// Facecam-Rahmen an den tatsächlichen Kanten des Kamera-Overlays ausrichten (Kantenerkennung über mehrere Bilder).
// Ein Gesicht, das über viele Bilder an derselben kleinen Stelle sitzt, gibt die Lage; die Ränder liegen dort, wo über ALLE Zeilen (bzw. Spalten)
// des Rahmens ein starker, zeitlich beständiger Helligkeitssprung besteht. Median statt Mittelwert: einzelne Texturkanten (Chat-Text, Gitarre,
// Spielgrafik) zählen nicht – nur eine durchgehende Linie. Overlays direkt daneben (Chat, Alerts) gehören dadurch nicht in den Rahmen.

import type { NRect } from './streamLayout'

export interface FaceN { x1: number; y1: number; x2: number; y2: number }

export interface CamResult { cam: NRect; /** Wie viele der vier Kanten wirklich gefunden wurden (0–4). */ edges: number }

const median = (v: number[]): number => { const s = [...v].sort((a, b) => a - b); return s[Math.floor(s.length / 2)] ?? 0 }

/** Mittlerer Betrag des Gradienten über die Bilder: dir 'x' = Sprung zwischen links/rechts, 'y' = oben/unten. */
function profile(frames: Uint8Array[], W: number, H: number, dir: 'x' | 'y', lo: number, hi: number, cross0: number, cross1: number): number[] {
  const out: number[] = []
  for (let p = lo; p <= hi; p++) {
    const perLine: number[] = []
    for (let c = cross0; c <= cross1; c++) {
      let s = 0
      for (const f of frames) {
        const a = dir === 'x' ? f[c * W + Math.max(0, p - 1)] : f[Math.max(0, p - 1) * W + c]
        const b = dir === 'x' ? f[c * W + Math.min(W - 1, p + 1)] : f[Math.min(H - 1, p + 1) * W + c]
        s += Math.abs(a - b)
      }
      perLine.push(s / frames.length)
    }
    out.push(median(perLine))
  }
  return out
}

/** Bildrand als Kante: Kameras sitzen sehr oft in einer Ecke, dort gibt es keinen Sprung im Bild. */
const BOUNDARY = 0.8
interface Cand { pos: number; strength: number }

/** Alle starken Spitzen eines Profils (absolute Position, Stärke 0..1 relativ zur stärksten). */
function peaksOf(prof: number[], lo: number): Cand[] {
  const strongest = Math.max(...prof)
  if (!prof.length || strongest < 10) return []
  const base = median(prof)
  if (strongest < base * 2) return []
  const thr = Math.max(12, strongest * 0.35)
  const out: Cand[] = []
  for (let i = 0; i < prof.length; i++) if (prof[i] >= thr && prof[i] >= (prof[i - 1] ?? 0) && prof[i] >= (prof[i + 1] ?? 0)) out.push({ pos: lo + i, strength: Math.min(1, prof[i] / 30) })
  return out
}

/** Rahmen der Facecam aus Graubildern (W×H, je Bild ein Uint8Array) und dem gefundenen Gesicht (normiert). */
export function refineCam(frames: Uint8Array[], W: number, H: number, face: FaceN): CamResult {
  const fx1 = Math.round(face.x1 * W), fx2 = Math.round(face.x2 * W), fy1 = Math.round(face.y1 * H), fy2 = Math.round(face.y2 * H)
  const fw = Math.max(8, fx2 - fx1), fh = Math.max(8, fy2 - fy1)
  const cx = (v: number): number => Math.max(0, Math.min(W - 1, Math.round(v)))
  const cy = (v: number): number => Math.max(0, Math.min(H - 1, Math.round(v)))
  // Das Gesicht füllt meist nur ~ 1/7 der Kamerabreite und ~ 1/3 der Höhe (Oberkörper im Bild): großzügige Suchfenster
  const rowA = cy(fy1 - fh * 0.1), rowB = cy(fy2 + fh * 0.4)
  const lLo = cx(fx1 - fw * 8), lHi = cx(fx1 - fw * 0.25)
  const rLo = cx(fx2 + fw * 0.25), rHi = cx(fx2 + fw * 8)
  const lefts = [...(lHi > lLo ? peaksOf(profile(frames, W, H, 'x', lLo, lHi, rowA, rowB), lLo) : []), { pos: 0, strength: BOUNDARY }]
  const rights = [...(rHi > rLo ? peaksOf(profile(frames, W, H, 'x', rLo, rHi, rowA, rowB), rLo) : []), { pos: W, strength: BOUNDARY }]
  const colA = cx(fx1 - fw * 1.5), colB = cx(fx2 + fw * 1.5)
  const tLo = cy(fy1 - fh * 4), tHi = cy(fy1 - fh * 0.1)
  const bLo = cy(fy2 + fh * 0.15), bHi = cy(fy2 + fh * 5)
  const tops = [...(tHi > tLo ? peaksOf(profile(frames, W, H, 'y', tLo, tHi, colA, colB), tLo) : []), { pos: 0, strength: BOUNDARY }]
  const bottoms = [...(bHi > bLo ? peaksOf(profile(frames, W, H, 'y', bLo, bHi, colA, colB), bLo) : []), { pos: H, strength: BOUNDARY }]

  // Gemeinsame Wahl: Kameras sind fast immer 16:9 oder 4:3, nicht riesig und am Rand oder frei platziert
  let best: { cost: number; l: Cand; r: Cand; t: Cand; b: Cand } | null = null
  for (const l of lefts) for (const r of rights) {
    const w = r.pos - l.pos
    if (w < fw * 1.6 || w > W * 0.6) continue
    for (const t of tops) for (const b of bottoms) {
      const h = b.pos - t.pos
      if (h < fh * 1.3 || h > H * 0.6 || t.pos > fy1 - fh * 0.05 || b.pos < fy2 + fh * 0.1) continue
      const asp = w / h
      const aspectCost = Math.min(Math.abs(Math.log(asp / (16 / 9))), Math.abs(Math.log(asp / (4 / 3))), Math.abs(Math.log(asp / 1)))
      const cost = aspectCost * 3 - (l.strength + r.strength + t.strength + b.strength) * 0.5 + (w / W) * 0.3
      if (!best || cost < best.cost) best = { cost, l, r, t, b }
    }
  }
  if (!best) {
    const w = Math.min(W, fw * 4), h = (w * 9) / 16
    const x = cx(fx1 + fw / 2 - w / 2), y = cy(fy1 + fh / 2 - h / 2)
    return { cam: { x: x / W, y: y / H, w: Math.min(w, W - x) / W, h: Math.min(h, H - y) / H }, edges: 0 }
  }
  const real = (c: Cand): number => (c.strength === BOUNDARY ? 0 : 1)
  const edges = real(best.l) + real(best.r) + real(best.t) + real(best.b)
  const snap = (v: number, max: number): number => (v < max * 0.015 ? 0 : max - v < max * 0.015 ? max : v)
  const l = snap(best.l.pos, W), r = snap(best.r.pos, W), t = snap(best.t.pos, H), b = snap(best.b.pos, H)
  return { cam: { x: l / W, y: t / H, w: (r - l) / W, h: (b - t) / H }, edges }
}

/** IoU zweier normierter Gesichtsrahmen. */
export function iouN(a: FaceN, b: FaceN): number {
  const ix = Math.max(0, Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1))
  const iy = Math.max(0, Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1))
  const inter = ix * iy
  return inter / Math.max(1e-9, (a.x2 - a.x1) * (a.y2 - a.y1) + (b.x2 - b.x1) * (b.y2 - b.y1) - inter)
}

/**
 * Facecam-Gesicht wählen: ein kleines Gesicht (< 9 % der Bildfläche), das in vielen Stichproben an (fast) derselben Stelle sitzt.
 * `perFrame[i]` = alle Gesichter der Stichprobe i. Gibt den Mittelwert-Rahmen und den Anteil der Stichproben zurück.
 */
export function pickStableFace(perFrame: FaceN[][], minShare = 0.5): { face: FaceN; share: number } | null {
  const total = perFrame.length
  if (!total) return null
  let best: { face: FaceN; share: number; n: number } | null = null
  for (const frame of perFrame) {
    for (const cand of frame) {
      const area = (cand.x2 - cand.x1) * (cand.y2 - cand.y1)
      if (area > 0.09 || area < 0.0003) continue
      const hits = perFrame.map((f) => f.find((g) => iouN(cand, g) > 0.5)).filter((g): g is FaceN => !!g)
      const share = hits.length / total
      if (share < minShare || (best && hits.length <= best.n)) continue
      const m = (k: keyof FaceN): number => hits.reduce((s, g) => s + g[k], 0) / hits.length
      best = { face: { x1: m('x1'), y1: m('y1'), x2: m('x2'), y2: m('y2') }, share, n: hits.length }
    }
  }
  return best ? { face: best.face, share: best.share } : null
}
