// SCRFD-10G (InsightFace Buffalo_L, det_10g.onnx) – Dekodierung nach insightface/python-package/insightface/model_zoo/scrfd.py
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { runInference } from '../inference/client'
import { assetDir } from '../engines/paths'
import { iou, type FaceBox } from './speaker'

export const SCRFD_ASSET = 'scrfd-10g'
const SIZE = 640
const STRIDES = [8, 16, 32]
const ANCHORS = 2
export const scrfdModelPath = (): string => join(assetDir(SCRFD_ASSET), 'det_10g.onnx')
export const scrfdAvailable = (): boolean => existsSync(scrfdModelPath())

/** RGB-Frame → 640×640 (oben links eingepasst, Rest 0), (x − 127,5) / 128, NCHW. */
export function scrfdInput(rgb: Buffer, width: number, height: number): { data: Float32Array; scale: number } {
  const scale = Math.min(SIZE / width, SIZE / height)
  const nw = Math.round(width * scale), nh = Math.round(height * scale)
  const plane = SIZE * SIZE
  const data = new Float32Array(plane * 3).fill((0 - 127.5) / 128)
  for (let y = 0; y < nh; y++) {
    const sy = Math.min(height - 1, Math.floor(y / scale))
    for (let x = 0; x < nw; x++) {
      const sx = Math.min(width - 1, Math.floor(x / scale))
      const s = (sy * width + sx) * 3, t = y * SIZE + x
      data[t] = (rgb[s] - 127.5) / 128
      data[plane + t] = (rgb[s + 1] - 127.5) / 128
      data[2 * plane + t] = (rgb[s + 2] - 127.5) / 128
    }
  }
  return { data, scale }
}

/** Ausgaben [scores×3, bbox×3, kps×3] (je Stride 8/16/32) → normierte Boxen nach NMS. */
export function decodeScrfd(scores: ArrayLike<number>[], boxes: ArrayLike<number>[], scale: number, width: number, height: number, threshold = 0.5, nms = 0.4): FaceBox[] {
  const cand: FaceBox[] = []
  STRIDES.forEach((stride, k) => {
    const cells = SIZE / stride
    const sc = scores[k], bb = boxes[k]
    for (let i = 0; i < sc.length; i++) {
      if (sc[i] < threshold) continue
      const cell = Math.floor(i / ANCHORS)
      const cx = (cell % cells) * stride, cy = Math.floor(cell / cells) * stride
      const x1 = (cx - bb[i * 4] * stride) / scale, y1 = (cy - bb[i * 4 + 1] * stride) / scale
      const x2 = (cx + bb[i * 4 + 2] * stride) / scale, y2 = (cy + bb[i * 4 + 3] * stride) / scale
      const clamp = (v: number): number => Math.max(0, Math.min(1, v))
      const box = { x1: clamp(x1 / width), y1: clamp(y1 / height), x2: clamp(x2 / width), y2: clamp(y2 / height), score: sc[i] }
      if (box.x2 > box.x1 && box.y2 > box.y1) cand.push(box)
    }
  })
  const kept: FaceBox[] = []
  for (const b of cand.sort((a, c) => c.score - a.score)) if (kept.every((o) => iou(o, b) < nms)) kept.push(b)
  return kept
}

export async function detectFacesScrfd(rgb: Buffer, width: number, height: number, signal?: AbortSignal): Promise<FaceBox[]> {
  const inp = scrfdInput(rgb, width, height)
  const out = await runInference(scrfdModelPath(), { 'input.1': { data: inp.data, dims: [1, 3, SIZE, SIZE] } }, signal)
  // Ausgabereihenfolge laut Modell: Scores 8/16/32, Boxen 8/16/32, Punkte 8/16/32
  const vals = Object.values(out)
  const byLen = (n: number): Float32Array[] => vals.filter((v) => v.dims[1] === n).map((v) => v.data as Float32Array)
  const scores = byLen(1).sort((a, b) => b.length - a.length)
  const boxes = byLen(4).sort((a, b) => b.length / 4 - a.length / 4)
  return decodeScrfd(scores, boxes, inp.scale, width, height)
}
