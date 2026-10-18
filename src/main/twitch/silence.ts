// Stumme VOD-Abschnitte: Twitch schaltet Teile mit geschützter Musik stumm (digitale Stille, kein Rauschen).
import { FFMPEG_PATH, runBinaryFull } from '../pipeline/ffmpeg'

/** Parst die Ausgabe von ffmpeg `silencedetect` zu [Start, Ende]-Paaren (ein offenes Ende läuft bis `total`). */
export function parseSilence(stderr: string, total: number, minSec: number): Array<[number, number]> {
  const out: Array<[number, number]> = []
  let start: number | null = null
  for (const line of stderr.split(/\r?\n/)) {
    const s = line.match(/silence_start:\s*(-?[\d.]+)/)
    if (s) { start = Math.max(0, Number(s[1])); continue }
    const e = line.match(/silence_end:\s*([\d.]+)/)
    if (e && start !== null) { out.push([start, Number(e[1])]); start = null }
  }
  if (start !== null) out.push([start, total])
  return out.filter(([a, b]) => b - a >= minSec).map(([a, b]) => [+a.toFixed(1), +Math.min(b, total).toFixed(1)] as [number, number])
}

/** Lange Abschnitte mit digitaler Stille (< −80 dB, ≥ `minSec`). Natürliche Pausen haben immer ein Grundrauschen darüber. */
export async function detectSilentRanges(path: string, durationSec: number, minSec = 20, signal?: AbortSignal): Promise<Array<[number, number]>> {
  const r = await runBinaryFull(FFMPEG_PATH, ['-hide_banner', '-nostats', '-i', path, '-vn', '-af', `silencedetect=noise=-80dB:d=${minSec}`, '-f', 'null', '-'], { signal })
  return parseSilence(r.stderr, durationSec, minSec)
}

/** Überlappt [a, b] stumme Abschnitte um mehr als `share` seiner Länge? */
export function overlapsSilence(silent: Array<[number, number]>, a: number, b: number, share = 0.2): boolean {
  let cover = 0
  for (const [s, e] of silent) cover += Math.max(0, Math.min(b, e) - Math.max(a, s))
  return b > a && cover / (b - a) > share
}
