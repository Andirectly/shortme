import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { ShortmeClip } from '@shared/shortme'
import { runFfmpeg } from '../../pipeline/ffmpeg'
import { projectFile, type ProjectMeta } from '../project'

export const thumbPath = (hash: string, id: string): string => projectFile(hash, join('thumbs', `${id}.jpg`))

/** Vorschaubild je Clip: Bild kurz nach dem Beginn, mittig auf 9:16 zugeschnitten (reine Übersichts-Vorschau, kein Reframe). */
export async function makeThumbs(meta: ProjectMeta, clips: ShortmeClip[], signal?: AbortSignal): Promise<void> {
  await mkdir(projectFile(meta.hash, 'thumbs'), { recursive: true })
  for (const c of clips) {
    const at = Math.min(c.start + Math.min(2, (c.end - c.start) / 3), meta.durationSec - 0.1)
    await runFfmpeg(['-y', '-ss', at.toFixed(2), '-i', meta.sourcePath, '-frames:v', '1', '-vf', 'crop=min(iw\,ih*9/16):ih,scale=270:480', '-q:v', '4', thumbPath(meta.hash, c.id)], { signal })
  }
}
