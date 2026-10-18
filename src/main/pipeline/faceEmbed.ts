import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { runInference } from '../inference/client'
import { assetDir } from '../engines/paths'
import type { FaceBox } from './speaker'

export const EMBED_ASSET = 'face-embed'
const SIZE = 112
export const embedModelPath = (): string => join(assetDir(EMBED_ASSET), 'w600k_mbf.onnx')
export const embedAvailable = (): boolean => existsSync(embedModelPath())

/** Gesichtsausschnitt (Box um 25 % erweitert, quadratisch) → 112×112 RGB, normiert (x − 127,5) / 127,5, NCHW. Auch als rohes RGB für Vorschaubilder. */
export function cropFaceForEmbed(rgb: Buffer, width: number, height: number, box: FaceBox): { tensor: Float32Array; raw: Buffer } {
  const cx = ((box.x1 + box.x2) / 2) * width, cy = ((box.y1 + box.y2) / 2) * height
  const side = Math.max((box.x2 - box.x1) * width, (box.y2 - box.y1) * height) * 1.25
  const plane = SIZE * SIZE
  const tensor = new Float32Array(plane * 3)
  const raw = Buffer.alloc(plane * 3)
  for (let y = 0; y < SIZE; y++) {
    const sy = Math.min(height - 1, Math.max(0, Math.round(cy - side / 2 + ((y + 0.5) / SIZE) * side)))
    for (let x = 0; x < SIZE; x++) {
      const sx = Math.min(width - 1, Math.max(0, Math.round(cx - side / 2 + ((x + 0.5) / SIZE) * side)))
      const s = (sy * width + sx) * 3
      for (let k = 0; k < 3; k++) { const v = rgb[s + k]; tensor[k * plane + y * SIZE + x] = (v - 127.5) / 127.5; raw[(y * SIZE + x) * 3 + k] = v }
    }
  }
  return { tensor, raw }
}

export const normalize = (v: Float32Array): Float32Array => { let n = 0; for (const x of v) n += x * x; n = Math.sqrt(n) || 1; return v.map((x) => x / n) }
export const cosine = (a: ArrayLike<number>, b: ArrayLike<number>): number => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s }

export async function embedFace(tensor: Float32Array, signal?: AbortSignal): Promise<Float32Array> {
  const out = await runInference(embedModelPath(), { 'input.1': { data: tensor, dims: [1, 3, SIZE, SIZE] } }, signal)
  return normalize(Object.values(out)[0].data as Float32Array)
}
