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

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// Exakte Schnittzeiten: TransNetV2 arbeitet mit 25 Bildern/s (Auflösung 40 ms), das Video hat oft 30 oder 60. Ein Layout-Wechsel „am“ Schnitt landete so ein bis
// zwei Bilder zu spät. Hier wird jeder Schnitt an den echten Bildern gesucht: größter Sprung zwischen zwei aufeinanderfolgenden Originalbildern.

/** Zwischen zwei Bildern liegt der Schnitt genau dort, wo sich das Bild am stärksten ändert: Mitte zwischen letztem alten und erstem neuen Bild (robust gegen Rundung). */
export function exactCut(times: number[], frames: Uint8Array[], approx: number): number {
  if (times.length < 4) return approx
  const d: number[] = [0]
  for (let i = 1; i < frames.length; i++) { let s = 0; for (let k = 0; k < frames[i].length; k++) s += Math.abs(frames[i][k] - frames[i - 1][k]); d.push(s / frames[i].length / 255) }
  let best = 1
  for (let i = 2; i < d.length; i++) if (d[i] > d[best]) best = i
  const rest = d.filter((_, i) => i !== best && i > 0).sort((a, b) => a - b)
  const med = rest[rest.length >> 1] ?? 0
  // nur ein klarer Sprung zählt; sonst bleibt die ungefähre Zeit
  if (d[best] < 0.04 || d[best] < 3 * Math.max(0.005, med)) return approx
  return (times[best - 1] + times[best]) / 2
}

function grayWindow(videoPath: string, start: number, dur: number, signal?: AbortSignal): Promise<{ times: number[]; frames: Uint8Array[] }> {
  const W = 64, H = 36
  return new Promise((resolve) => {
    execFile(FFMPEG_PATH, ['-hide_banner', '-ss', Math.max(0, start).toFixed(3), '-i', videoPath, '-t', dur.toFixed(3), '-an', '-vf', `scale=${W}:${H}:flags=area,showinfo,format=gray`, '-vsync', '0', '-f', 'rawvideo', 'pipe:1'], { encoding: 'buffer', maxBuffer: 1 << 24, windowsHide: true, signal }, (err, stdout, stderr) => {
      if (err) { resolve({ times: [], frames: [] }); return }
      const times = [...stderr.toString('latin1').matchAll(/pts_time:([\d.]+)/g)].map((m) => Number(m[1]))
      const frames: Uint8Array[] = []
      for (let o = 0; o + W * H <= stdout.length; o += W * H) frames.push(Uint8Array.from(stdout.subarray(o, o + W * H)))
      resolve({ times: times.slice(0, frames.length), frames: frames.slice(0, times.length) })
    })
  })
}

/** Alle Schnitte auf das echte Bildraster legen (mehrere gleichzeitig). Zeitstempel kommen relativ zum -ss-Start; `-ss` vor `-i` setzt die Zeitachse zurück auf 0. */
export async function refineCuts(videoPath: string, cuts: number[], signal?: AbortSignal, onProgress?: (f: number) => void): Promise<number[]> {
  const out = [...cuts]
  let next = 0, done = 0
  const worker = async (): Promise<void> => {
    for (;;) {
      const i = next++
      if (i >= cuts.length) return
      signal?.throwIfAborted()
      const start = Math.max(0, cuts[i] - 0.2)
      const w = await grayWindow(videoPath, start, 0.4, signal)
      out[i] = exactCut(w.times.map((t) => t + start), w.frames, cuts[i])
      onProgress?.(++done / cuts.length)
    }
  }
  await Promise.all([worker(), worker(), worker(), worker()])
  return out.sort((a, b) => a - b)
}
