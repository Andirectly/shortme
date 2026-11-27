// Tonspuren im Editor: hineingezogene Dateien (Soundeffekte, Musik) werden in den Projektordner `media/` übernommen – als 48-kHz-Stereo-WAV,
// damit Vorschau (Chromium) jede Quelle abspielen kann und der Export ohne Formatüberraschungen mischt.
import { randomUUID } from 'node:crypto'
import { mkdir, rename, rm, stat } from 'node:fs/promises'
import { basename, extname } from 'node:path'
import { runFfmpeg } from '../pipeline/ffmpeg'
import { allowMediaPath } from '../mediaAccess'
import { projectFile } from './project'
import type { AudioClip } from '../../shared/audioMix'

export const mediaPath = (hash: string, file: string): string => projectFile(hash, `media/${basename(file)}`)

/** Datei übernehmen; `kind` aus der Länge (≥ 20 s = Musik). */
export async function importAudio(hash: string, src: string, at: number): Promise<AudioClip & { path: string }> {
  await mkdir(projectFile(hash, 'media'), { recursive: true })
  const id = randomUUID().slice(0, 8)
  const file = `${id}.wav`
  const dest = mediaPath(hash, file)
  const tmp = `${dest}.part.wav`
  try {
    await runFfmpeg(['-y', '-i', src, '-vn', '-ac', '2', '-ar', '48000', '-c:a', 'pcm_s16le', tmp])
  } catch {
    await rm(tmp, { force: true })
    throw new Error('Datei enthält keinen lesbaren Ton')
  }
  await rename(tmp, dest)
  const dur = Math.max(0, ((await stat(dest)).size - 44) / (48000 * 4))
  if (dur < 0.02) { await rm(dest, { force: true }); throw new Error('Datei enthält keinen Ton') }
  allowMediaPath(dest)
  const name = basename(src, extname(src)).slice(0, 80) || 'Ton'
  return { id, file, name, at, dur, gainDb: dur >= 20 ? -12 : 0, kind: dur >= 20 ? 'music' : 'sfx', path: dest }
}

/** Absolute Pfade der Tonspuren für die Vorschau freigeben. */
export function audioPaths(hash: string, files: string[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const f of files) { const p = mediaPath(hash, f); allowMediaPath(p); out[f] = p }
  return out
}
