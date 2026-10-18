import { createHash } from 'node:crypto'
import { open, readFile, rm, stat, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { dataRoot } from '../engines/paths'
import { writeFileAtomic } from './atomic'
import type { TwitchMeta } from '../../shared/twitch'

export interface ProjectMeta {
  hash: string
  title: string
  sourcePath: string
  durationSec: number
  width: number
  height: number
  fps: number
  sizeBytes: number
  hasAudio: boolean
  created: string
  /** Fertige Stufen (Checkpoints) → Wiederaufnahme nach Absturz. */
  stages: Record<string, { done: boolean; at?: string }>
  /** Nur bei Twitch-Importen. */
  twitch?: TwitchMeta
}

const SAMPLE = 4 * 1024 * 1024

/** Schneller Datei-Hash (Größe + 3 × 4 MB: Anfang, Mitte, Ende); für Cache-Schlüssel, nicht für Sicherheit. */
export async function fileHash(path: string): Promise<string> {
  const { size } = await stat(path)
  const h = createHash('sha256').update(`shortme1|${size}|`)
  const fh = await open(path, 'r')
  try {
    const offsets = size <= SAMPLE * 3 ? [0] : [0, Math.floor((size - SAMPLE) / 2), size - SAMPLE]
    for (const off of offsets) {
      const len = size <= SAMPLE * 3 ? size : SAMPLE
      const buf = Buffer.alloc(len)
      const { bytesRead } = await fh.read(buf, 0, len, off)
      h.update(buf.subarray(0, bytesRead))
    }
  } finally { await fh.close() }
  return h.digest('hex').slice(0, 32)
}

export const projectsRoot = (): string => join(dataRoot(), 'projects')
export const projectDir = (hash: string): string => join(projectsRoot(), hash)
export const projectFile = (hash: string, name: string): string => join(projectDir(hash), name)

export async function loadMeta(hash: string): Promise<ProjectMeta | null> {
  try { return JSON.parse(await readFile(projectFile(hash, 'project.json'), 'utf8')) as ProjectMeta } catch { return null }
}

export async function saveMeta(meta: ProjectMeta): Promise<void> {
  await mkdir(projectDir(meta.hash), { recursive: true })
  await writeFileAtomic(projectFile(meta.hash, 'project.json'), JSON.stringify(meta, null, 1))
}

export async function markStage(hash: string, stage: string, done: boolean): Promise<void> {
  const meta = await loadMeta(hash)
  if (!meta) return
  meta.stages[stage] = { done, at: new Date().toISOString() }
  await saveMeta(meta)
}

export async function discardProject(hash: string): Promise<void> {
  await rm(projectDir(hash), { recursive: true, force: true })
}
