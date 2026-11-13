// Medien für die Beobachtungsmodelle: einzelne Bilder (JPEG) und kurze Tonausschnitte (WAV 16 kHz mono) aus dem Originalmaterial.
import { execFile } from 'node:child_process'
import { FFMPEG_PATH } from '../../../../pipeline/ffmpeg'

const run = (args: string[], signal?: AbortSignal): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    execFile(FFMPEG_PATH, ['-hide_banner', '-loglevel', 'error', ...args], { encoding: 'buffer', maxBuffer: 1 << 26, windowsHide: true, signal }, (err, stdout, stderr) => (err ? reject(new Error(`ffmpeg: ${stderr.toString().slice(0, 200) || err.message}`)) : resolve(stdout)))
  })

/** Ein Einzelbild zur Quellzeit `t` als JPEG, auf `width` Pixel Breite verkleinert (Seitenverhältnis bleibt). */
export const grabJpeg = (video: string, t: number, width = 768, signal?: AbortSignal): Promise<Buffer> =>
  run(['-ss', Math.max(0, t).toFixed(2), '-i', video, '-frames:v', '1', '-vf', `scale=${width}:-2`, '-q:v', '4', '-f', 'image2pipe', '-vcodec', 'mjpeg', 'pipe:1'], signal)

/** Tonausschnitt [start, end] (Quellsekunden) aus der 16-kHz-Mono-Audiodatei des Projekts als WAV im Speicher. */
export const cutWav = (audioWav: string, start: number, end: number, signal?: AbortSignal): Promise<Buffer> =>
  run(['-ss', Math.max(0, start).toFixed(2), '-t', Math.max(0.2, end - start).toFixed(2), '-i', audioWav, '-ac', '1', '-ar', '16000', '-f', 'wav', 'pipe:1'], signal)

/** Gleichmäßig verteilte Zeiten in [start, end] (mindestens 1), für Bildproben. */
export function sampleTimes(start: number, end: number, n: number): number[] {
  if (n <= 1 || end <= start) return [(start + end) / 2]
  return Array.from({ length: n }, (_, i) => start + ((i + 0.5) / n) * (end - start))
}

/** Überlappende Prüffenster [start, end] der Länge `len` über [from, to]; das letzte wird auf `to` gelegt. Zeiten bleiben Quellzeiten. */
export function windowsOver(from: number, to: number, len: number, overlap: number): Array<[number, number]> {
  if (to - from <= len) return [[from, to]]
  const out: Array<[number, number]> = []
  const step = Math.max(1, len - overlap)
  for (let s = from; s < to; s += step) {
    const e = Math.min(to, s + len)
    out.push([s, e])
    if (e >= to) break
  }
  return out
}

/** Mehrere Tonstücke [start, end] (Quellsekunden) der 16-kHz-Mono-Datei lückenlos aneinandergesetzt (Nahtprüfung), WAV im Speicher. */
export const seamWav = (audioWav: string, pieces: Array<[number, number]>, signal?: AbortSignal): Promise<Buffer> => {
  const parts = pieces.map(([a, b], i) => `[0:a]atrim=start=${a.toFixed(3)}:end=${b.toFixed(3)},asetpts=PTS-STARTPTS[p${i}]`)
  const graph = `${parts.join(';')};${pieces.map((_, i) => `[p${i}]`).join('')}concat=n=${pieces.length}:v=0:a=1[o]`
  return run(['-i', audioWav, '-filter_complex', graph, '-map', '[o]', '-ac', '1', '-ar', '16000', '-f', 'wav', 'pipe:1'], signal)
}
