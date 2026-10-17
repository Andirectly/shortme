import { readFile } from 'node:fs/promises'
import type { AsrWord } from '../../engines/asr/protocol'

export interface Signals {
  /** Sekundenraster, je Wert 0..1 (innerhalb des Videos normalisiert). */
  loudness: number[]
  rate: number[]
  /** Lachen/Applaus-artige Spitzen: laut, aber kaum Wörter. */
  burst: number[]
  /** Anteil Stille je Sekunde (0..1). */
  silence: number[]
  /** Stille-Intervalle aus der Wellenform (≥ minSilence), absolute Sekunden. */
  silences: Array<[number, number]>
  noiseFloorDb: number
}

export const FRAME_SEC = 0.02

/** Liest 16-kHz-Mono-s16le-WAV und liefert RMS-dB je 20-ms-Frame. */
export function frameDb(buf: Buffer, sampleRate = 16000): Float32Array {
  // 'data'-Chunk suchen (Header kann Zusatz-Chunks enthalten)
  let off = 12
  let dataStart = 44
  let dataLen = buf.length - 44
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4)
    const size = buf.readUInt32LE(off + 4)
    if (id === 'data') { dataStart = off + 8; dataLen = Math.min(size, buf.length - dataStart); break }
    off += 8 + size + (size % 2)
  }
  const frame = Math.round(sampleRate * FRAME_SEC)
  const n = Math.floor(dataLen / 2 / frame)
  const out = new Float32Array(n)
  for (let f = 0; f < n; f++) {
    let sum = 0
    const base = dataStart + f * frame * 2
    for (let i = 0; i < frame; i++) { const s = buf.readInt16LE(base + i * 2) / 32768; sum += s * s }
    out[f] = 10 * Math.log10(sum / frame + 1e-10)
  }
  return out
}

export function percentile(values: ArrayLike<number>, p: number): number {
  const a = Array.from(values).sort((x, y) => x - y)
  if (a.length === 0) return 0
  return a[Math.min(a.length - 1, Math.max(0, Math.floor((p / 100) * (a.length - 1))))]
}

/** Robuste Normalisierung: p5 → 0, p95 → 1, geklemmt. Leiser Podcast und lauter Stream liefern beide Spitzen. */
export function normalize(values: number[]): number[] {
  const lo = percentile(values, 5)
  const hi = percentile(values, 95)
  const span = hi - lo
  if (span < 1e-9) return values.map(() => 0)
  return values.map((v) => Math.min(1, Math.max(0, (v - lo) / span)))
}

/** Stille-Intervalle: Frames unter Rauschboden + `marginDb`, mindestens `minSilence` Sekunden lang. */
export function silentIntervals(db: Float32Array, noiseFloorDb: number, marginDb = 8, minSilence = 0.2): Array<[number, number]> {
  const thr = Math.min(noiseFloorDb + marginDb, -38)
  const out: Array<[number, number]> = []
  let start = -1
  for (let i = 0; i <= db.length; i++) {
    const quiet = i < db.length && db[i] < thr
    if (quiet && start < 0) start = i
    if (!quiet && start >= 0) {
      if ((i - start) * FRAME_SEC >= minSilence) out.push([start * FRAME_SEC, i * FRAME_SEC])
      start = -1
    }
  }
  return out
}

export function computeSignals(db: Float32Array, words: AsrWord[], durationSec: number): Signals {
  const secs = Math.max(1, Math.ceil(durationSec))
  const perSec = Math.round(1 / FRAME_SEC)
  const meanDb = new Array<number>(secs).fill(-90)
  const quietFrames = new Array<number>(secs).fill(0)
  const noise = percentile(db, 10)
  const thr = Math.min(noise + 8, -38)
  for (let s = 0; s < secs; s++) {
    let sum = 0
    let q = 0
    let c = 0
    for (let i = s * perSec; i < Math.min(db.length, (s + 1) * perSec); i++) { sum += Math.pow(10, db[i] / 10); if (db[i] < thr) q++; c++ }
    if (c > 0) { meanDb[s] = 10 * Math.log10(sum / c + 1e-10); quietFrames[s] = q / c }
  }
  // Sprechtempo: Wörter pro Sekunde, 5-s-Fenster
  const wc = new Array<number>(secs).fill(0)
  for (const w of words) { const s = Math.min(secs - 1, Math.floor(w.start)); wc[s]++ }
  const rate = wc.map((_, s) => { let t = 0; let n = 0; for (let k = s - 2; k <= s + 2; k++) if (k >= 0 && k < secs) { t += wc[k]; n++ } return t / n })
  const loud = normalize(meanDb)
  const rateN = normalize(rate)
  // Spitzen: deutlich lauter als der lokale Median (±15 s) bei wenig Sprache
  const burstRaw = meanDb.map((v, s) => {
    const win: number[] = []
    for (let k = Math.max(0, s - 15); k <= Math.min(secs - 1, s + 15); k++) win.push(meanDb[k])
    const med = percentile(win, 50)
    return Math.max(0, v - med - 4) * (1 - Math.min(1, rate[s] / 2.5))
  })
  return { loudness: loud, rate: rateN, burst: normalize(burstRaw), silence: quietFrames, silences: silentIntervals(db, noise), noiseFloorDb: noise }
}

export async function signalsFromWav(path: string, words: AsrWord[], durationSec: number): Promise<Signals> {
  return computeSignals(frameDb(await readFile(path)), words, durationSec)
}
