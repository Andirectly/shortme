import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { ShortmeClip } from '@shared/shortme'
import { cropBox } from '@shared/framing'
import { runFfmpeg } from '../../pipeline/ffmpeg'
import { videoChain } from '../render/graph'
import { projectFile, type ProjectMeta } from '../project'

export const thumbPath = (hash: string, id: string): string => projectFile(hash, join('thumbs', `${id}.jpg`))

/**
 * Vorschaubild je Clip: Bild kurz nach dem Beginn, im Ausschnitt der ersten Einstellung (wie im Export) auf 9:16 zugeschnitten.
 * Fehler eines einzelnen Bildes brechen die Analyse nie ab, werden aber ins Log geschrieben.
 */
export async function makeThumbs(meta: ProjectMeta, clips: ShortmeClip[], signal?: AbortSignal): Promise<void> {
  await mkdir(projectFile(meta.hash, 'thumbs'), { recursive: true })
  for (const c of clips) {
    try {
      const at = Math.min(c.start + Math.min(2, (c.end - c.start) / 3), meta.durationSec - 0.1)
      const first = c.shots?.[0]
      const cx = first && (first.layout === 'smart' || first.layout === 'fixed') ? first.cx : 0.5
      const src = { width: meta.width, height: meta.height }
      if (first?.layout === 'stream' && first.stream) {
        // Facecam + Gameplay: dasselbe Bild wie im Export (gleiche Filterkette)
        const chain = videoChain({ src0: 0, src1: 0.2, zoom: 1, shot: first } as never, 0, src, 0)
        await runFfmpeg(['-y', '-ss', at.toFixed(2), '-i', meta.sourcePath, '-filter_complex', `${chain};[v0]scale=270:480[t]`, '-map', '[t]', '-frames:v', '1', '-q:v', '4', thumbPath(meta.hash, c.id)], { signal })
        continue
      }
      const b = cropBox(src, cx, 9 / 16, 1)
      await runFfmpeg(['-y', '-ss', at.toFixed(2), '-i', meta.sourcePath, '-frames:v', '1', '-vf', `crop=${b.w}:${b.h}:${b.x}:${b.y},scale=270:480`, '-q:v', '4', thumbPath(meta.hash, c.id)], { signal })
    } catch (e) {
      if (signal?.aborted) throw e
      console.error('Vorschaubild fehlgeschlagen:', c.id, e)
    }
  }
}
