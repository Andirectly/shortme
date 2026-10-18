import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { runInference } from '../../inference/client'
import { assetDir } from '../../engines/paths'
import { writeFileAtomic } from '../atomic'
import { projectFile } from '../project'
import type { Sentence } from './sentences'

/** Audio-Ereignisse aus YAMNet (AudioSet, 521 Klassen) + Sprechpausen aus der VAD – als Markierungen im Transkript für das LLM. */
export type EventKind = 'laugh' | 'applause' | 'loud' | 'pause'
export interface AudioEvent { kind: EventKind; start: number; end: number; score: number }

export const YAMNET_ASSET = 'yamnet'
export const yamnetPath = (): string => join(assetDir(YAMNET_ASSET), 'yamnet.onnx')
export const yamnetAvailable = (): boolean => existsSync(yamnetPath())

/** AudioSet-Klassenindizes aus yamnet_class_map.csv. */
const CLASSES: Record<Exclude<EventKind, 'pause'>, number[]> = { laugh: [13, 14, 15, 17, 18], applause: [58, 61, 62], loud: [6, 9, 11] }
const THRESHOLD: Record<Exclude<EventKind, 'pause'>, number> = { laugh: 0.35, applause: 0.35, loud: 0.3 }
const MIN_SEC: Record<EventKind, number> = { laugh: 0.45, applause: 0.9, loud: 0.9, pause: 2 }
const HOP = 0.48
const CHUNK_SEC = 120
export const MARK: Record<EventKind, string> = { laugh: '[lacht]', applause: '[Applaus]', loud: '[laut]', pause: '[Pause]' }

/** Rohe Frame-Werte → zusammenhängende Ereignisse (Lücken ≤ 1 Frame überbrückt, Mindestlänge je Art). */
export function framesToEvents(scores: Float32Array, frames: number): AudioEvent[] {
  const out: AudioEvent[] = []
  for (const kind of Object.keys(CLASSES) as Array<keyof typeof CLASSES>) {
    const v = new Float32Array(frames)
    for (let t = 0; t < frames; t++) { let m = 0; for (const c of CLASSES[kind]) m = Math.max(m, scores[t * 521 + c]); v[t] = m }
    let t = 0
    while (t < frames) {
      if (v[t] < THRESHOLD[kind]) { t++; continue }
      let e = t, gap = 0, peak = v[t]
      for (let k = t + 1; k < frames; k++) { if (v[k] >= THRESHOLD[kind]) { e = k; gap = 0; peak = Math.max(peak, v[k]) } else if (++gap > 1) break }
      const start = t * HOP, end = (e + 2) * HOP // Fensterlänge 0,96 s
      if (end - start >= MIN_SEC[kind]) out.push({ kind, start, end, score: +peak.toFixed(2) })
      t = e + 1
    }
  }
  return out.sort((a, b) => a.start - b.start)
}

/** Lange Stille: Lücke zwischen Sprach-Intervallen (VAD) ≥ 2 s. */
export function pauseEvents(speech: Array<[number, number]>, minSec = MIN_SEC.pause): AudioEvent[] {
  const out: AudioEvent[] = []
  for (let i = 1; i < speech.length; i++) if (speech[i][0] - speech[i - 1][1] >= minSec) out.push({ kind: 'pause', start: speech[i - 1][1], end: speech[i][0], score: 1 })
  return out
}

export async function detectAudioEvents(wavPath: string, speech: Array<[number, number]>, signal?: AbortSignal): Promise<AudioEvent[]> {
  const events = pauseEvents(speech)
  if (!yamnetAvailable()) return events.sort((a, b) => a.start - b.start)
  const buf = await readFile(wavPath)
  const total = Math.floor((buf.length - 44) / 2)
  const chunk = CHUNK_SEC * 16000
  for (let off = 0; off < total; off += chunk) {
    signal?.throwIfAborted()
    const n = Math.min(chunk, total - off)
    if (n < 16000) break
    const wave = new Float32Array(n)
    for (let i = 0; i < n; i++) wave[i] = buf.readInt16LE(44 + (off + i) * 2) / 32768
    const out = await runInference(yamnetPath(), { waveform: { data: wave, dims: [n] } }, signal)
    const sc = out.output_0
    const frames = sc.dims[0]
    for (const e of framesToEvents(sc.data as Float32Array, frames)) events.push({ ...e, start: e.start + off / 16000, end: e.end + off / 16000 })
  }
  return events.sort((a, b) => a.start - b.start)
}

const eventsFile = (hash: string): string => projectFile(hash, 'events.json')
export async function loadEvents(hash: string): Promise<AudioEvent[] | null> {
  try { return JSON.parse(await readFile(eventsFile(hash), 'utf8')) as AudioEvent[] } catch { return null }
}
export const saveEvents = (hash: string, e: AudioEvent[]): Promise<void> => writeFileAtomic(eventsFile(hash), JSON.stringify(e))

/** Markierungen je Satz: Ereignis gehört zu dem Satz, in dem es beginnt (oder dem davor, wenn es in einer Lücke liegt). */
export function marksBySentence(sentences: Sentence[], events: AudioEvent[]): Map<number, string[]> {
  const out = new Map<number, string[]>()
  let si = 0
  for (const ev of events) {
    while (si + 1 < sentences.length && sentences[si + 1].start <= ev.start) si++
    if (ev.start > sentences[si].end + 6 && ev.kind !== 'pause') continue // Ereignis weit nach dem letzten Satz
    const list = out.get(si) ?? []
    if (!list.includes(MARK[ev.kind])) list.push(MARK[ev.kind])
    out.set(si, list)
  }
  return out
}
