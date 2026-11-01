// yt-dlp-/FFmpeg-Helfer der Werkbank: nur öffentliche YouTube-Daten über yt-dlp, kein anderer externer Dienst.
import { spawn } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { ensureYtDlp, runYtDlp } from '../pipeline/ytdlp'
import { FFMPEG_PATH } from '../pipeline/ffmpeg'
import { features } from '../../shared/audioMatch'
import { learnFile, readJson } from './store'
import { writeFileAtomic } from '../shortme/atomic'
import { ratios } from '../../shared/workbench'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function ytJson(args: string[]): Promise<any> {
  const bin = await ensureYtDlp(() => undefined)
  return JSON.parse(await runYtDlp(bin, ['-J', '--no-warnings', ...args]))
}

export const isChannelUrl = (u: string): boolean => /youtube\.com\/(@|channel\/|c\/|user\/)/.test(u)
export const channelBase = (u: string): string => u.replace(/[?#].*$/, '').replace(/\/(videos|shorts|featured|streams|live)\/?$/, '').replace(/\/$/, '')
const isoDate = (d?: string): string => (d && /^\d{8}$/.test(d) ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` : '')

/** PCM 8 kHz mono aus einer beliebigen Audio-/Videodatei. */
export function pcm8k(file: string): Promise<Int16Array> {
  return new Promise((resolve, reject) => {
    const p = spawn(FFMPEG_PATH, ['-v', 'error', '-i', file, '-vn', '-ac', '1', '-ar', '8000', '-f', 's16le', 'pipe:1'], { windowsHide: true })
    const bufs: Buffer[] = []
    let err = ''
    p.stdout.on('data', (d: Buffer) => bufs.push(d))
    p.stderr.on('data', (d: Buffer) => { err += d.toString() })
    p.on('error', reject)
    p.on('close', (code) => {
      if (code !== 0) return reject(new Error(`ffmpeg: ${err.slice(0, 200)}`))
      const b = Buffer.concat(bufs)
      resolve(new Int16Array(b.buffer, b.byteOffset, b.length >> 1))
    })
  })
}

/** Merkmale einer Datei, zwischengespeichert als rohe Float32 (klein: ca. 19 KB je Minute). */
export async function cachedFeatures(file: string, cache: string): Promise<Float32Array> {
  if (existsSync(cache)) { const b = await readFile(cache); return new Float32Array(b.buffer, b.byteOffset, b.length >> 2) }
  const f = features(await pcm8k(file))
  await mkdir(dirname(cache), { recursive: true })
  await writeFile(cache, Buffer.from(f.buffer, f.byteOffset, f.byteLength))
  return f
}

/** Nur die Tonspur laden (viel kleiner als das Video); gibt den Dateipfad zurück. */
export async function downloadAudio(url: string, outBase: string): Promise<string> {
  const bin = await ensureYtDlp(() => undefined)
  await mkdir(dirname(outBase), { recursive: true })
  const out = await runYtDlp(bin, ['-f', 'ba/b', '-o', `${outBase}.%(ext)s`, '--no-progress', '--quiet', '--no-warnings', '--print', 'after_move:filepath', url])
  return out.trim().split('\n').pop()!.trim()
}

export interface ShortRow { id: string; title: string; views: number; likes: number; comments: number; date: string; durationSec: number; fetchedAt: string }
interface ShortsCache { channelUrl: string; shorts: ShortRow[] }
const REFRESH_DAYS = 14

/** Shorts eines Kanals ab `since` (ISO-Datum, leer = alle) mit Aufrufen, Likes, Kommentaren, Datum (zwischengespeichert; Zahlen werden nach 14 Tagen erneuert). */
export async function channelShorts(channelUrl: string, since = '', onMsg: (m: string) => void = () => undefined): Promise<ShortRow[]> {
  const base = channelBase(channelUrl)
  const file = learnFile(`shorts-${base.replace(/[^\w@-]/g, '_').slice(-60)}.json`)
  const cache = await readJson<ShortsCache>(file, { channelUrl: base, shorts: [] })
  const list = (await ytJson(['--flat-playlist', `${base}/shorts`]).catch(() => ({ entries: [] }))).entries as Array<{ id: string }>
  const have = new Map(cache.shorts.map((s) => [s.id, s]))
  const stale = cache.shorts.filter((s) => s.date >= since && Date.now() - Date.parse(s.fetchedAt) > REFRESH_DAYS * 86_400_000).map((s) => s.id)
  const todo = [...list.map((e) => e.id).filter((id) => !have.has(id)), ...stale]
  let n = 0, older = 0
  for (const id of todo) {
    // Liste ist neueste zuerst: nach 3 Shorts vor `since` ist der Rest für dieses Langvideo irrelevant (Zwischenspeicher füllt sich später weiter)
    if (since && older >= 3) break
    onMsg(`Shorts des Kanals lesen (${++n}/${todo.length}) …`)
    try {
      const d = await ytJson(['--no-playlist', `https://www.youtube.com/shorts/${id}`])
      have.set(id, { id, title: String(d.title ?? ''), views: d.view_count ?? 0, likes: d.like_count ?? 0, comments: d.comment_count ?? 0, date: isoDate(d.upload_date), durationSec: d.duration ?? 0, fetchedAt: new Date().toISOString() })
      if (since && have.get(id)!.date < since) older++; else older = 0
    } catch (e) { console.error('Short', id, e) }
    if (n % 20 === 0) await writeFileAtomic(file, JSON.stringify({ channelUrl: base, shorts: [...have.values()] }))
  }
  const shorts = [...have.values()]
  await writeFileAtomic(file, JSON.stringify({ channelUrl: base, shorts }))
  return shorts
}

export const shortRatios = (shorts: ShortRow[]): Record<string, number | null> => ratios(shorts.filter((s) => s.date))
export { isoDate }
export const shortFeatureFile = (id: string): string => learnFile(`sf/${id}.f32`)
export const shortUrl = (id: string): string => `https://www.youtube.com/shorts/${id}`
export const tmpAudioBase = (id: string): string => join(learnFile('tmp'), id)
