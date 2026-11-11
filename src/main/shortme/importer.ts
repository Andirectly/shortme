import { existsSync } from 'node:fs'
import { saveHeat } from './clips/heat'
import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { basename, extname, join, resolve } from 'node:path'
import { freeDiskGb } from '../engines/hardware'
import { allowMediaPath } from '../mediaAccess'
import { dataRoot } from '../engines/paths'
import { probeVideo, runFfmpeg } from '../pipeline/ffmpeg'
import { downloadUrlVideo, ensureYtDlp, fetchUrlMeta, withSelfUpdateRetry } from '../pipeline/ytdlp'
import { savedCookieOpts } from './ytAuth'
import { sectionArg } from '../../shared/twitch'
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
export async function importFile(input: string): Promise<ImportResult> {
  const path = resolve(input) // absolut: Projekte und media://-Freigabe hängen nicht vom Arbeitsordner ab
  allowMediaPath(path)
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
export async function importUrl(url: string, onProgress: (p: number, message: string) => void, opts: { section?: [number, number]; extraArgs?: string[]; urlLabel?: string } = {}): Promise<ImportResult> {
  onProgress(0, 'Downloader wird vorbereitet …')
  const bin = await ensureYtDlp((p) => onProgress(p.progress, p.message))
  onProgress(0, 'Video-Infos werden abgerufen …')
  // wie der alte Importpfad: bei yt-dlp-Fehlern einmal selbst aktualisieren und wiederholen (veraltete YouTube-Extraktoren)
  const progress = (p: { progress: number; message: string }): void => onProgress(p.progress, p.message)
  const meta = await withSelfUpdateRetry(bin, progress, () => fetchUrlMeta(bin, url, savedCookieOpts(), opts.extraArgs ?? []))
  const dir = join(dataRoot(), 'downloads')
  await mkdir(dir, { recursive: true })
  const safe = meta.id.replace(/[^\w.-]/g, '_')
  const tag = opts.section ? `_${opts.section[0]}-${opts.section[1]}` : ''
  const target = join(dir, `${safe}${tag}.mp4`)
  if (!existsSync(target)) {
    const part = join(dir, `${safe}${tag}.part.mp4`)
    onProgress(0, `„${meta.title}“ wird heruntergeladen …`)
    await withSelfUpdateRetry(bin, progress, () => downloadUrlVideo(bin, meta.webpageUrl, part, progress, savedCookieOpts(), [...(opts.section ? ['--download-sections', sectionArg(opts.section)] : []), ...(opts.extraArgs ?? [])]))
    await rename(part, target)
  }
  onProgress(1, 'Video wird geprüft und Vorschaubild erstellt …')
  const res = await importFile(target)
  if (meta.heatmap?.length) await saveHeat(res.meta.hash, meta.heatmap).catch((e) => console.error('Heatmap speichern:', e))
  // YouTube & Co.: das Anbieter-Thumbnail ist als Projektbild besser als ein zufälliger Screenshot
  if (meta.thumbnail && !res.cached) {
    try {
      const r = await fetch(meta.thumbnail)
      if (r.ok) {
        const raw = projectFile(res.meta.hash, 'thumb-remote.bin')
        await writeFile(raw, Buffer.from(await r.arrayBuffer()))
        await runFfmpeg(['-y', '-i', raw, '-vf', 'scale=640:-2', '-q:v', '3', projectFile(res.meta.hash, 'poster.jpg')])
        await rm(raw, { force: true })
      }
    } catch { /* Screenshot bleibt */ }
  }
  if (!res.cached && res.meta.title === safe) { res.meta.title = meta.title }
  if (!res.cached) { res.meta.sourceUrl = url; await saveMeta(res.meta) }
  return res
}
