// ReID-Merkmale (osnet_x0_25_msmt17, aus BoxMOT nach ONNX exportiert – siehe docs/MODELS.md) für BoT-SORT.
// Eingabe [N, 3, 256, 128] (RGB, /255, ImageNet-Mittel/Std), Ausgabe [N, 512].
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { runInference } from '../inference/client'
import { modelsDir } from './detect'
import type { FaceBox } from './speaker'

const W = 128
const H = 256
const MEAN = [0.485, 0.456, 0.406]
const STD = [0.229, 0.224, 0.225]
export const reidModelPath = (): string => join(modelsDir(), 'reid', 'osnet_x0_25_msmt17.onnx')
export const reidAvailable = (): boolean => existsSync(reidModelPath())

/**
 * Oberkörper unter dem Gesicht: von knapp unterhalb der Augen bis etwa 4 Gesichtshöhen, Breite ≈ 2,6 Gesichtsbreiten –
 * Kleidung/Statur bleiben erkennbar, auch wenn das Gesicht im Profil nicht mehr sichtbar ist. Pixel-Koordinaten.
 */
export function bodyRegion(face: FaceBox, width: number, height: number): { x: number; y: number; w: number; h: number } {
  const fw = (face.x2 - face.x1) * width, fh = (face.y2 - face.y1) * height
  const cx = ((face.x1 + face.x2) / 2) * width
  const y0 = face.y1 * height + 0.8 * fh
  let x = cx - 1.3 * fw, y = y0, w = 2.6 * fw, h = 3.4 * fh
  x = Math.max(0, x); y = Math.max(0, y)
  w = Math.min(width - x, w); h = Math.min(height - y, h)
  if (w < 8 || h < 8) return { x: Math.max(0, cx - fw), y: Math.max(0, face.y1 * height), w: Math.max(8, Math.min(width, 2 * fw)), h: Math.max(8, Math.min(height, fh * 1.4)) } // Gesicht am unteren Bildrand
  return { x, y, w, h }
}

/** Ausschnitt → 128×256 (bilinear), CHW, normalisiert. */
export function cropTensor(rgb: Buffer, width: number, height: number, r: { x: number; y: number; w: number; h: number }): Float32Array {
  const plane = W * H
  const out = new Float32Array(3 * plane)
  for (let y = 0; y < H; y++) {
    const sy = Math.min(height - 1.001, r.y + ((y + 0.5) / H) * r.h - 0.5)
    const y0 = Math.max(0, Math.floor(sy)), fy = Math.max(0, sy - y0)
    for (let x = 0; x < W; x++) {
      const sx = Math.min(width - 1.001, r.x + ((x + 0.5) / W) * r.w - 0.5)
      const x0 = Math.max(0, Math.floor(sx)), fx = Math.max(0, sx - x0)
      for (let c = 0; c < 3; c++) {
        const p = (yy: number, xx: number): number => rgb[(yy * width + xx) * 3 + c]
        const v = (p(y0, x0) * (1 - fx) + p(y0, x0 + 1) * fx) * (1 - fy) + (p(y0 + 1, x0) * (1 - fx) + p(y0 + 1, x0 + 1) * fx) * fy
        out[c * plane + y * W + x] = (v / 255 - MEAN[c]) / STD[c]
      }
    }
  }
  return out
}

/** Aussehens-Merkmale (L2-normiert) je Gesicht, in einem Aufruf. */
export async function embedBodies(rgb: Buffer, width: number, height: number, faces: FaceBox[], signal?: AbortSignal): Promise<Float32Array[]> {
  if (!faces.length) return []
  const n = faces.length
  const batch = new Float32Array(n * 3 * H * W)
  faces.forEach((f, i) => batch.set(cropTensor(rgb, width, height, bodyRegion(f, width, height)), i * 3 * H * W))
  const out = await runInference(reidModelPath(), { images: { data: batch, dims: [n, 3, H, W] } }, signal)
  const o = Object.values(out)[0]
  const d = o.data as Float32Array
  const dim = o.dims[1]
  return Array.from({ length: n }, (_, i) => { const v = d.slice(i * dim, (i + 1) * dim); let s = 0; for (const x of v) s += x * x; s = Math.sqrt(s) || 1; return v.map((x) => x / s) })
}
