// Ansatz übernommen von: clips-studio/video/tracker.py (YOLOv8n-Pose, Kopfbox aus Keypoints 0–4, Greedy-IoU-Tracking)
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { runInference } from '../inference/client'
import { assetDir } from '../engines/paths'
import { iou, type FaceBox } from './speaker'

export const POSE_ASSET = 'yolov8n-pose'
const MODEL_FILE = 'yolov8n-pose.onnx'
const SIZE = 640
const KP_CONF = 0.5
const PERSON_CONF = 0.4

export const poseModelPath = (): string => join(assetDir(POSE_ASSET), MODEL_FILE)
export const poseAvailable = (): boolean => existsSync(poseModelPath())

export interface PosePerson {
  /** Personenbox (normiert). */
  box: FaceBox
  /** Kopfbox (normiert, quadratisch in Pixeln) – aus Nase/Augen/Ohren, sonst aus den Schultern. */
  head: FaceBox | null
  /** Woher die Kopfposition stammt. */
  source: 'face-points' | 'shoulders' | 'none'
  /** Nase sichtbar? (Profil/abgewandt: nein) */
  noseVisible: boolean
}

/** RGB-Frame → 640×640-Letterbox (Grau 114), NCHW float 0..1. */
export function letterbox(rgb: Buffer, width: number, height: number): { data: Float32Array; scale: number; padX: number; padY: number } {
  const scale = Math.min(SIZE / width, SIZE / height)
  const nw = Math.round(width * scale), nh = Math.round(height * scale)
  const padX = Math.floor((SIZE - nw) / 2), padY = Math.floor((SIZE - nh) / 2)
  const plane = SIZE * SIZE
  const data = new Float32Array(plane * 3).fill(114 / 255)
  for (let y = 0; y < nh; y++) {
    const sy = Math.min(height - 1, Math.floor(y / scale))
    for (let x = 0; x < nw; x++) {
      const sx = Math.min(width - 1, Math.floor(x / scale))
      const s = (sy * width + sx) * 3, t = (y + padY) * SIZE + x + padX
      data[t] = rgb[s] / 255
      data[plane + t] = rgb[s + 1] / 255
      data[2 * plane + t] = rgb[s + 2] / 255
    }
  }
  return { data, scale, padX, padY }
}

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v))

/** Quadratische Kopfbox (in Pixeln quadratisch) um Mitte (cx, cy) und Breite hw, normiert. */
function squareHead(cx: number, cy: number, hw: number, width: number, height: number, score: number): FaceBox {
  const hx = hw / width / 2, hy = hw / height / 2
  return { x1: clamp01(cx / width - hx), y1: clamp01(cy / height - hy), x2: clamp01(cx / width + hx), y2: clamp01(cy / height + hy), score }
}

/**
 * YOLOv8-Pose-Ausgabe [1, 56, N] (cx, cy, w, h, score, 17×(x, y, conf)) → Personen mit Kopfbox.
 * Kopf: Mittelwert der Keypoints 0–4 (conf > 0,5), Breite = max(x-Spanne × 1,6, Personenhöhe × 0,12);
 * ohne Gesichtspunkte aus den Schultern (5, 6): Kopf über der Schultermitte, Breite ≈ 0,55 × Schulterbreite.
 */
export function decodePose(out: Float32Array, n: number, lb: { scale: number; padX: number; padY: number }, width: number, height: number, conf = PERSON_CONF): PosePerson[] {
  const at = (r: number, i: number): number => out[r * n + i]
  const cand: Array<{ i: number; score: number; box: FaceBox }> = []
  for (let i = 0; i < n; i++) {
    const score = at(4, i)
    if (score < conf) continue
    const cx = (at(0, i) - lb.padX) / lb.scale, cy = (at(1, i) - lb.padY) / lb.scale, w = at(2, i) / lb.scale, h = at(3, i) / lb.scale
    cand.push({ i, score, box: { x1: clamp01((cx - w / 2) / width), y1: clamp01((cy - h / 2) / height), x2: clamp01((cx + w / 2) / width), y2: clamp01((cy + h / 2) / height), score } })
  }
  const kept: typeof cand = []
  for (const c of cand.sort((a, b) => b.score - a.score)) if (kept.every((k) => iou(k.box, c.box) < 0.5)) kept.push(c)
  return kept.map((c) => {
    const kp = (k: number): { x: number; y: number; c: number } => ({ x: (at(5 + k * 3, c.i) - lb.padX) / lb.scale, y: (at(6 + k * 3, c.i) - lb.padY) / lb.scale, c: at(7 + k * 3, c.i) })
    const face = [0, 1, 2, 3, 4].map(kp).filter((p) => p.c > KP_CONF)
    const personH = (c.box.y2 - c.box.y1) * height
    const noseVisible = kp(0).c > KP_CONF
    if (face.length) {
      const cx = face.reduce((s, p) => s + p.x, 0) / face.length, cy = face.reduce((s, p) => s + p.y, 0) / face.length
      const span = Math.max(...face.map((p) => p.x)) - Math.min(...face.map((p) => p.x))
      return { box: c.box, head: squareHead(cx, cy, Math.max(span * 1.6, personH * 0.12), width, height, c.score), source: 'face-points' as const, noseVisible }
    }
    const l = kp(5), r = kp(6)
    if (l.c > KP_CONF && r.c > KP_CONF) {
      const sw = Math.abs(l.x - r.x)
      const hw = Math.max(sw * 0.55, personH * 0.12)
      return { box: c.box, head: squareHead((l.x + r.x) / 2, Math.min(l.y, r.y) - sw * 0.35, hw, width, height, c.score * 0.8), source: 'shoulders' as const, noseVisible }
    }
    return { box: c.box, head: null, source: 'none' as const, noseVisible }
  })
}

export async function detectPose(rgb: Buffer, width: number, height: number, signal?: AbortSignal): Promise<PosePerson[]> {
  const lb = letterbox(rgb, width, height)
  const outputs = await runInference(poseModelPath(), { images: { data: lb.data, dims: [1, 3, SIZE, SIZE] } }, signal)
  const o = Object.values(outputs)[0]
  return decodePose(o.data as Float32Array, o.dims[2], lb, width, height)
}

const cxOf = (b: FaceBox): number => (b.x1 + b.x2) / 2
const cyOf = (b: FaceBox): number => (b.y1 + b.y2) / 2

/**
 * Gesichter (YuNet) + Pose-Köpfe → eine Liste pro Frame: wo ein Gesicht in/auf dem Pose-Kopf liegt, gilt das Gesicht
 * (bester Ausschnitt für LR-ASD); Personen ohne Gesicht (Profil, abgewandt) bleiben mit ihrer Pose-Kopfbox erhalten.
 */
export function mergeFacesAndHeads(faces: FaceBox[], people: PosePerson[]): FaceBox[] {
  const out = [...faces]
  for (const p of people) {
    if (!p.head) continue
    const h = p.head
    const covered = faces.some((f) => iou(f, h) > 0.15 || (cxOf(f) >= p.box.x1 && cxOf(f) <= p.box.x2 && cyOf(f) >= p.box.y1 && cyOf(f) <= p.box.y1 + (p.box.y2 - p.box.y1) * 0.5))
    if (!covered) out.push({ ...h, score: Math.min(h.score, 0.6) })
  }
  return out
}
