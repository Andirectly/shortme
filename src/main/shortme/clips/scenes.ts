import { execFile } from 'node:child_process'
import { join } from 'node:path'
import { FFMPEG_PATH } from '../../pipeline/ffmpeg'
import { runInference } from '../../inference/client'
import { assetDir } from '../../engines/paths'

// TransNetV2 (ONNX): 25 fps, 48×27 RGB, Fenster 100 Bilder, 25 Kontext je Seite, Schritt 50 (Muster: hotclip/src/core/shots.ts).
export const TN_FPS = 25
const FRAME_BYTES = 48 * 27 * 3
const WINDOW = 100
const CONTEXT = 25
const STRIDE = 50
export const SHOT_THRESHOLD = 0.5
const CHUNK_SEC = 300

/** Läufe von Frames mit p ≥ Schwelle → je Lauf der Peak; Schnittzeit = (Peak+1)/fps. */
export function decodeBoundaries(probs: ArrayLike<number>, fps = TN_FPS, threshold = SHOT_THRESHOLD): number[] {
  const out: number[] = []
  let i = 0
  while (i < probs.length) {
    if (probs[i] >= threshold) {
      let peak = i
      let j = i
      while (j < probs.length && probs[j] >= threshold) { if (probs[j] > probs[peak]) peak = j; j++ }
      out.push((peak + 1) / fps)
      i = j
    } else i++
  }
  return out
}

function extractFrames(videoPath: string, start: number, dur: number, signal?: AbortSignal): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    execFile(FFMPEG_PATH, ['-hide_banner', '-v', 'error', '-ss', start.toFixed(3), '-i', videoPath, '-t', dur.toFixed(3), '-vf', `fps=${TN_FPS},scale=48:27`, '-an', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'],
      { encoding: 'buffer', maxBuffer: 256 * 1024 * 1024, windowsHide: true, signal }, (err, stdout) => (err ? reject(err) : resolve(stdout)))
  })
}

async function chunkProbs(frames: Buffer, modelPath: string, signal?: AbortSignal): Promise<Float32Array> {
  const n = Math.floor(frames.length / FRAME_BYTES)
  const probs = new Float32Array(n)
  if (n < 2) return probs
  for (let winStart = 0; winStart < n; winStart += STRIDE) {
    signal?.throwIfAborted()
    const input = new Float32Array(WINDOW * FRAME_BYTES)
    for (let k = 0; k < WINDOW; k++) {
      const idx = Math.min(n - 1, Math.max(0, winStart - CONTEXT + k))
      const src = idx * FRAME_BYTES
      for (let b = 0; b < FRAME_BYTES; b++) input[k * FRAME_BYTES + b] = frames[src + b]
    }
    const out = await runInference(modelPath, { input: { data: input, dims: [1, WINDOW, 27, 48, 3] } }, signal)
    const pred = (out['534'] ?? Object.values(out).find((t) => t.dims.length === 3 && t.dims[2] === 1) ?? Object.values(out)[0]).data
    for (let k = CONTEXT; k < CONTEXT + STRIDE; k++) {
      const pos = winStart - CONTEXT + k
      if (pos >= 0 && pos < n) probs[pos] = pred[k]
    }
  }
  return probs
}

/** Kamerawechsel (Sekunden, absolut) mit TransNetV2; Video wird in 5-Minuten-Stücken verarbeitet. */
export async function detectShots(videoPath: string, durationSec: number, signal?: AbortSignal, onProgress?: (f: number) => void): Promise<number[]> {
  const model = join(assetDir('transnetv2'), 'transnetv2.onnx')
  const cuts: number[] = []
  for (let start = 0; start < durationSec; start += CHUNK_SEC) {
    const dur = Math.min(CHUNK_SEC, durationSec - start)
    const frames = await extractFrames(videoPath, start, dur, signal)
    const probs = await chunkProbs(frames, model, signal)
    for (const c of decodeBoundaries(probs)) {
      const t = start + c
      // Stückgrenzen: Duplikate/Randartefakte (< 0.2 s Abstand) verwerfen
      if (cuts.length === 0 || t - cuts[cuts.length - 1] > 0.2) cuts.push(t)
    }
    onProgress?.(Math.min(1, (start + dur) / durationSec))
  }
  return cuts.filter((t) => t > 0.2 && t < durationSec - 0.2)
}
