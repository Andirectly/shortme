// Zeitliche Verortung mit Lighthouse (CG-DETR + CLIP-ViT-B/32): lange Videos in überlappende Fenster ≤ 150 s teilen, je Fenster mit allen Anfragen abfragen,
// Zeiten in Quellsekunden zurückrechnen. Ergebnisse werden je Medium/Anfragenliste/Fensterung zwischengespeichert.
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { FFMPEG_PATH } from '../../../../pipeline/ffmpeg'
import { fingerprintOf } from '../../../../../shared/engine'
import { projectDir } from '../../../project'
import { writeFileAtomic } from '../../../atomic'
import type { AvSession } from './avWorker'
import { TEMPORAL_OVERLAP_SEC, TEMPORAL_WINDOW_SEC, pickMoments, temporalWindows, type SearchQuery, type TemporalMoment } from './search'
import { V3_TEMPORAL_MODEL, V3_TEMPORAL_REVISION } from './revisions'

interface WindowResult { startSec: number; clipLength: number; queries: Array<{ query: string; moments: Array<[number, number, number]>; saliency: number[] }> }
export interface TemporalResult { moments: TemporalMoment[]; windows: number; cached: boolean; seconds: number; failed: Array<[number, number]>; peakVramBytes?: number }

const cutLow = (video: string, start: number, dur: number, out: string, signal?: AbortSignal): Promise<void> => new Promise((resolve, reject) => {
  // kleine Vorschau ohne Ton: Lighthouse braucht nur Bilder (CLIP, 224 px)
  execFile(FFMPEG_PATH, ['-hide_banner', '-loglevel', 'error', '-y', '-ss', start.toFixed(2), '-t', dur.toFixed(2), '-i', video, '-an', '-vf', 'scale=-2:360', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '30', out], { windowsHide: true, signal }, (err) => (err ? reject(err) : resolve()))
})

export const temporalFingerprint = (mediaHash: string, durationSec: number, queries: SearchQuery[]): string =>
  fingerprintOf([mediaHash, durationSec.toFixed(2), V3_TEMPORAL_MODEL.id, V3_TEMPORAL_REVISION, TEMPORAL_WINDOW_SEC, TEMPORAL_OVERLAP_SEC, ...queries.map((q) => q.text)])

export async function groundVideo(s: AvSession, o: { hash: string; video: string; durationSec: number; queries: SearchQuery[]; topK: number; total: number; signal?: AbortSignal; onProgress?: (f: number, msg: string) => void }): Promise<TemporalResult> {
  const fp = temporalFingerprint(o.hash, o.durationSec, o.queries)
  const root = join(projectDir(o.hash), 'analysis', 'shared', 'temporal', V3_TEMPORAL_MODEL.id)
  const cache = join(root, `${fp}.json`)
  if (existsSync(cache)) {
    try { const c = JSON.parse(await readFile(cache, 'utf8')) as { moments: TemporalMoment[]; windows: number; failed: Array<[number, number]>; peakVramBytes?: number }; return { moments: pickMoments(c.moments, o.topK, o.total), windows: c.windows, cached: true, seconds: 0, failed: c.failed, peakVramBytes: c.peakVramBytes } } catch { /* neu rechnen */ }
  }
  const t0 = Date.now()
  const wins = temporalWindows(o.durationSec)
  const tmp = join(root, `tmp-${fp}`)
  await mkdir(tmp, { recursive: true })
  const all: TemporalMoment[] = []
  const failed: Array<[number, number]> = []
  let peak: number | undefined
  try {
    for (let i = 0; i < wins.length; i++) {
      o.signal?.throwIfAborted()
      o.onProgress?.(i / wins.length, `Zeitliche Verortung (${i + 1}/${wins.length}) …`)
      const w = wins[i]
      const file = join(tmp, `w${i}.mp4`)
      try {
        await cutLow(o.video, w.start, w.end - w.start, file, o.signal)
        const r = await s.worker.request<{ windows: WindowResult[]; vramPeakBytes?: number }>('temporal_ground', { windows: [{ path: file, startSec: w.start }], queries: o.queries.map((q) => q.text) }, { runId: s.runId, timeoutMs: 300_000, signal: o.signal })
        peak = r.vramPeakBytes ?? peak
        for (const wr of r.windows) for (const q of wr.queries) {
          const id = o.queries.find((x) => x.text === q.query)?.id
          if (!id) continue
          for (const [a, b, score] of q.moments) if (Number.isFinite(a) && Number.isFinite(b) && Number.isFinite(score) && b > a) all.push({ query: id, start: Math.max(0, a), end: Math.min(o.durationSec, b), score })
        }
      } catch (e) { if (o.signal?.aborted) throw e; failed.push([w.start, w.end]) } finally { await rm(file, { force: true }).catch(() => undefined) }
    }
  } finally { await rm(tmp, { recursive: true, force: true }).catch(() => undefined) }
  const seconds = (Date.now() - t0) / 1000
  if (failed.length < wins.length) await writeFileAtomic(cache, JSON.stringify({ moments: all, windows: wins.length, failed, peakVramBytes: peak }))
  return { moments: pickMoments(all, o.topK, o.total), windows: wins.length, cached: false, seconds, failed, peakVramBytes: peak }
}
