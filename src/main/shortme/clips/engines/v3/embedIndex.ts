// Versionierter Embedding-Index über die ganze Zeitachse (Engine 3). Cache unter <Projekt>/analysis/shared/embeddings/<modell>/<revision>/<fingerprint>/:
//   part-<k>.npy (je 64 Fenster, wiederaufnehmbar), meta.json (Fenster, Dimension, Abdeckung, Abtastparameter, Fingerprint; erst am Ende geschrieben).
// Der Fingerprint hängt NUR an Medium, Modell/Revision, Abtastung und Extraktorversion – nicht an Anfragen, ASR oder Optionen (Anfragen invalidieren den Index nicht).
import { execFile } from 'node:child_process'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { FFMPEG_PATH } from '../../../../pipeline/ffmpeg'
import { projectDir } from '../../../project'
import { writeFileAtomic } from '../../../atomic'
import { fingerprintOf } from '../../../../../shared/engine'
import { readNpy, type Npy2D } from './npy'
import { embedWindows, frameTimesOf, type EmbedWindow } from './search'
import { V3_EMBED_MODEL, V3_EXTRACTOR_REVISION, type V3ProfileConfig } from './revisions'
import type { EmbedSession } from './embedWorker'

const PART = 64
export interface IndexMeta { version: 1; fingerprint: string; model: string; revision: string; extractor: string; durationSec: number; cfg: Pick<V3ProfileConfig, 'windowSec' | 'hopSec' | 'frames' | 'frameWidth'>; dimension: number; windows: Array<[number, number]>; failed: Array<[number, number]>; createdAt: string; seconds: number; peakVramBytes?: number }
export interface IndexResult { meta: IndexMeta; vectors: Npy2D; wins: EmbedWindow[]; cached: boolean; dir: string }

export const indexFingerprint = (mediaHash: string, durationSec: number, cfg: V3ProfileConfig): string =>
  fingerprintOf([mediaHash, durationSec.toFixed(2), V3_EMBED_MODEL.id, V3_EMBED_MODEL.revision, V3_EXTRACTOR_REVISION, cfg.windowSec, cfg.hopSec, cfg.frames, cfg.frameWidth])

export const indexDir = (hash: string, fp: string): string => join(projectDir(hash), 'analysis', 'shared', 'embeddings', V3_EMBED_MODEL.id, V3_EMBED_MODEL.revision.slice(0, 8), fp)

function grab(video: string, t: number, out: string, width: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(FFMPEG_PATH, ['-hide_banner', '-loglevel', 'error', '-y', '-ss', Math.max(0, t).toFixed(2), '-i', video, '-frames:v', '1', '-vf', `scale=${width}:-2`, '-q:v', '4', out], { windowsHide: true, signal }, (err) => (err ? reject(err) : resolve()))
  })
}

/** Aufgaben mit begrenzter Parallelität; Abbruch über das Signal. */
async function pool<T>(items: T[], n: number, fn: (x: T) => Promise<void>, signal?: AbortSignal): Promise<void> {
  let next = 0
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { for (;;) { signal?.throwIfAborted(); const i = next++; if (i >= items.length) return; await fn(items[i]) } }))
}

/** Liegt der Index für diese Einstellungen schon vor? (nur für die Restzeit – buildIndex prüft die Teile selbst) */
export const indexCached = (hash: string, durationSec: number, cfg: V3ProfileConfig): boolean => existsSync(join(indexDir(hash, indexFingerprint(hash, durationSec, cfg)), 'meta.json'))

/**
 * Index laden oder aufbauen. Ein Teil (64 Fenster) wird erst nach erfolgreichem Embedding als Datei abgelegt; nach Abbruch/Absturz geht die Arbeit ab dem
 * ersten fehlenden Teil weiter. Fehlgeschlagene Teile werden als Lücke protokolliert (nicht als „nichts passiert“).
 */
export async function buildIndex(s: EmbedSession, o: { hash: string; video: string; durationSec: number; cfg: V3ProfileConfig; signal?: AbortSignal; onProgress?: (f: number, msg: string) => void }): Promise<IndexResult> {
  const fp = indexFingerprint(o.hash, o.durationSec, o.cfg)
  const dir = indexDir(o.hash, fp)
  const wins = embedWindows(o.durationSec, o.cfg)
  const metaPath = join(dir, 'meta.json')
  if (existsSync(metaPath)) {
    try {
      const meta = JSON.parse(await readFile(metaPath, 'utf8')) as IndexMeta
      if (meta.fingerprint === fp && meta.windows.length === wins.length) {
        const parts = await Promise.all(Array.from({ length: Math.ceil(wins.length / PART) }, (_, k) => readNpy(join(dir, `part-${k}.npy`)).catch(() => null)))
        if (parts.every((p) => p)) return { meta, vectors: concat(parts as Npy2D[], meta.dimension), wins, cached: true, dir }
      }
    } catch { /* unvollständig: neu aufbauen (fertige Teile werden wiederverwendet) */ }
  }
  await mkdir(dir, { recursive: true })
  const t0 = Date.now()
  const failed: Array<[number, number]> = []
  const parts: Array<Npy2D | null> = []
  let dim = 0, peak: number | undefined
  const nParts = Math.ceil(wins.length / PART)
  for (let k = 0; k < nParts; k++) {
    o.signal?.throwIfAborted()
    const partPath = join(dir, `part-${k}.npy`)
    const slice = wins.slice(k * PART, (k + 1) * PART)
    o.onProgress?.(k / nParts, `Bild-Embeddings ${k * PART}/${wins.length} Fenster …`)
    if (existsSync(partPath)) { try { const p = await readNpy(partPath); if (p.rows === slice.length) { parts.push(p); dim = p.cols; continue } } catch { /* neu berechnen */ } }
    const tmp = join(dir, `frames-${k}`)
    await mkdir(tmp, { recursive: true })
    try {
      const jobs = slice.flatMap((w) => frameTimesOf(w, o.cfg.frames).map((t, f) => ({ t, file: join(tmp, `w${w.index}_${f}.jpg`) })))
      await pool(jobs, 6, (j) => grab(o.video, j.t, j.file, o.cfg.frameWidth, o.signal), o.signal)
      const res = await s.worker.request<{ dimension: number; vramPeakBytes?: number }>('embed_frames', { windows: slice.map((w) => ({ id: `w${w.index}`, frames: Array.from({ length: o.cfg.frames }, (_, f) => join(tmp, `w${w.index}_${f}.jpg`)) })), outPath: partPath, batchSize: 4 }, { runId: s.runId, timeoutMs: 600_000, signal: o.signal })
      dim = res.dimension; peak = Math.max(peak ?? 0, res.vramPeakBytes ?? 0)
      parts.push(await readNpy(partPath))
    } catch (e) {
      if (o.signal?.aborted) throw e
      console.warn(`[v3] Teil ${k} fehlgeschlagen: ${e instanceof Error ? e.message.slice(0, 160) : e}`)
      failed.push([slice[0].start, slice[slice.length - 1].end]); parts.push(null)
    } finally { await rm(tmp, { recursive: true, force: true }) }
  }
  if (!dim) throw new Error('Kein Teil des Videos konnte eingebettet werden')
  const meta: IndexMeta = { version: 1, fingerprint: fp, model: V3_EMBED_MODEL.id, revision: V3_EMBED_MODEL.revision, extractor: V3_EXTRACTOR_REVISION, durationSec: o.durationSec, cfg: { windowSec: o.cfg.windowSec, hopSec: o.cfg.hopSec, frames: o.cfg.frames, frameWidth: o.cfg.frameWidth }, dimension: dim, windows: wins.map((w) => [w.start, w.end]), failed, createdAt: new Date().toISOString(), seconds: Math.round((Date.now() - t0) / 100) / 10, ...(peak ? { peakVramBytes: peak } : {}) }
  // Nur vollständige Indizes werden als solche markiert (meta.json fehlt bei Lücken nicht, enthält sie aber in `failed`); Lücken-Teile haben Nullvektoren
  const filled = parts.map((p, k) => p ?? { rows: wins.slice(k * PART, (k + 1) * PART).length, cols: dim, data: new Float32Array(wins.slice(k * PART, (k + 1) * PART).length * dim) })
  if (!failed.length) await writeFileAtomic(metaPath, JSON.stringify(meta))
  else await writeFile(join(dir, 'meta.partial.json'), JSON.stringify(meta))
  return { meta, vectors: concat(filled, dim), wins, cached: false, dir }
}

function concat(parts: Npy2D[], dim: number): Npy2D {
  const rows = parts.reduce((n, p) => n + p.rows, 0)
  const data = new Float32Array(rows * dim)
  let o = 0
  for (const p of parts) { data.set(p.data, o); o += p.data.length }
  return { rows, cols: dim, data }
}
