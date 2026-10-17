import { open, mkdir, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { ShortmeClip } from '@shared/shortme'
import { runFfmpeg } from '../pipeline/ffmpeg'
import { writeFileAtomic } from './atomic'
import { projectFile, type ProjectMeta } from './project'

export const PEAK_STEP = 0.1
export const STRIP_FRAMES = 14

/** Byte-Offset der PCM-Daten in einer WAV-Datei (der Header kann Zusatz-Chunks enthalten). */
export function wavDataOffset(head: Buffer): number {
  let off = 12
  while (off + 8 <= head.length) {
    const id = head.toString('ascii', off, off + 4)
    const size = head.readUInt32LE(off + 4)
    if (id === 'data') return off + 8
    off += 8 + size + (size % 2)
  }
  return 44
}

/** Wellenform: Spitzenwert (0..1) je 0,1 s für [start,end] aus der 16-kHz-Mono-WAV (s16le). */
export async function wavePeaks(wavPath: string, start: number, end: number): Promise<number[]> {
  const fh = await open(wavPath, 'r')
  try {
    const head = Buffer.alloc(4096)
    await fh.read(head, 0, 4096, 0)
    const base = wavDataOffset(head)
    const perStep = Math.round(16000 * PEAK_STEP)
    const n = Math.max(1, Math.ceil((end - start) / PEAK_STEP))
    const buf = Buffer.alloc(n * perStep * 2)
    const { bytesRead } = await fh.read(buf, 0, buf.length, base + Math.max(0, Math.floor(start * 16000)) * 2)
    const peaks: number[] = []
    for (let i = 0; i < n; i++) {
      let max = 0
      const from = i * perStep * 2
      const to = Math.min(bytesRead, from + perStep * 2)
      for (let b = from; b + 1 < to; b += 2) { const v = Math.abs(buf.readInt16LE(b)); if (v > max) max = v }
      peaks.push(max / 32768)
    }
    return peaks
  } finally { await fh.close() }
}

/** Filmstreifen: gleichmäßig verteilte Bilder des Clips (cached unter edit/<clip>/strip-N.jpg), als Data-URLs. */
export async function filmstrip(meta: ProjectMeta, clip: Pick<ShortmeClip, 'id' | 'start' | 'end'>, frames = STRIP_FRAMES): Promise<string[]> {
  const dir = projectFile(meta.hash, join('edit', clip.id.replace(/[^\w.-]/g, '_')))
  await mkdir(dir, { recursive: true })
  const out: string[] = []
  for (let i = 0; i < frames; i++) {
    const f = join(dir, `strip-${clip.start.toFixed(1)}-${frames}-${i}.jpg`)
    if (!existsSync(f)) {
      const t = clip.start + ((clip.end - clip.start) * (i + 0.5)) / frames
      await runFfmpeg(['-y', '-ss', Math.min(t, meta.durationSec - 0.1).toFixed(2), '-i', meta.sourcePath, '-frames:v', '1', '-vf', 'scale=160:-2', '-q:v', '5', f])
    }
    out.push(`data:image/jpeg;base64,${(await readFile(f)).toString('base64')}`)
  }
  return out
}

export interface EditorAssets { peaks: number[]; step: number; strip: string[] }

export async function editorAssets(meta: ProjectMeta, clip: Pick<ShortmeClip, 'id' | 'start' | 'end'>): Promise<EditorAssets> {
  const cache = projectFile(meta.hash, join('edit', `${clip.id.replace(/[^\w.-]/g, '_')}-peaks-${clip.start.toFixed(1)}-${clip.end.toFixed(1)}.json`))
  let peaks: number[]
  if (existsSync(cache)) peaks = JSON.parse(await readFile(cache, 'utf8')) as number[]
  else {
    await mkdir(projectFile(meta.hash, 'edit'), { recursive: true })
    peaks = await wavePeaks(projectFile(meta.hash, 'audio.wav'), clip.start, clip.end)
    await writeFileAtomic(cache, JSON.stringify(peaks.map((p) => Math.round(p * 1000) / 1000)))
  }
  return { peaks, step: PEAK_STEP, strip: await filmstrip(meta, clip) }
}
