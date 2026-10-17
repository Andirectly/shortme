import { existsSync } from 'node:fs'
import { mkdir, rename } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { freeDiskGb } from '../engines/hardware'
import { dataRoot } from '../engines/paths'
import { probeVideo, runFfmpeg } from '../pipeline/ffmpeg'
import { downloadUrlVideo, ensureYtDlp, fetchUrlMeta } from '../pipeline/ytdlp'
import { fileHash, loadMeta, projectDir, projectFile, saveMeta, type ProjectMeta } from './project'
import { preflight, type PreflightResult } from './preflight'

export interface ImportResult { meta: ProjectMeta; preflight: PreflightResult; cached: boolean }

/** Standbild (scharf: poster.jpg) und stark weichgezeichnete Variante (ambient.jpg, vorberechnet – kein Live-Blur). */
export async function makeStills(meta: ProjectMeta): Promise<void> {
  const at = Math.max(0, Math.min(meta.durationSec * 0.1, meta.durationSec - 1))
  const base = ['-y', '-ss', at.toFixed(2), '-i', meta.sourcePath, '-frames:v', '1']
  await runFfmpeg([...base, '-vf', 'scale=640:-2', '-q:v', '4', projectFile(meta.hash, 'poster.jpg')])
  await runFfmpeg([...base, '-vf', 'scale=96:-2,gblur=sigma=2,scale=960:-2:flags=bicubic', '-q:v', '5', projectFile(meta.hash, 'ambient.jpg')])
}

/** Datei importieren: Vorabprüfung, Projektordner (Hash), Standbilder. Gleiche Datei → bestehendes Projekt (Cache). */
export async function importFile(path: string): Promise<ImportResult> {
  const info = await probeVideo(path)
  const free = await freeDiskGb(dataRoot())
  const pf = preflight({ durationSec: info.durationSec, sizeBytes: info.sizeBytes, hasAudio: info.hasAudio }, free)
  const hash = await fileHash(path)
  const existing = await loadMeta(hash)
  if (existing) {
    // Quelle evtl. verschoben: Pfad aktualisieren
    if (existing.sourcePath !== path) { existing.sourcePath = path; await saveMeta(existing) }
    return { meta: existing, preflight: pf, cached: true }
  }
  if (!pf.ok) return { meta: blankMeta(hash, path, info), preflight: pf, cached: false }
  await mkdir(projectDir(hash), { recursive: true })
  const meta = blankMeta(hash, path, info)
  await saveMeta(meta)
  await makeStills(meta).catch(() => undefined)
  return { meta, preflight: pf, cached: false }
}

function blankMeta(hash: string, path: string, info: Awaited<ReturnType<typeof probeVideo>>): ProjectMeta {
  return { hash, title: basename(path, extname(path)), sourcePath: path, durationSec: info.durationSec, width: info.width, height: info.height, fps: info.fps, sizeBytes: info.sizeBytes, hasAudio: info.hasAudio, created: new Date().toISOString(), stages: {} }
}

/** URL importieren (yt-dlp, gebündelt/selbst-aktualisierend); Download landet im Datenordner, danach wie eine Datei. */
export async function importUrl(url: string, onProgress: (p: number, message: string) => void): Promise<ImportResult> {
  const bin = await ensureYtDlp((p) => onProgress(p.progress, p.message))
  const meta = await fetchUrlMeta(bin, url)
  const dir = join(dataRoot(), 'downloads')
  await mkdir(dir, { recursive: true })
  const safe = meta.id.replace(/[^\w.-]/g, '_')
  const target = join(dir, `${safe}.mp4`)
  if (!existsSync(target)) {
    const part = join(dir, `${safe}.part.mp4`)
    await downloadUrlVideo(bin, meta.webpageUrl, part, (p) => onProgress(p.progress, p.message))
    await rename(part, target)
  }
  const res = await importFile(target)
  if (!res.cached && res.meta.title === safe) { res.meta.title = meta.title; await saveMeta(res.meta) }
  return res
}
