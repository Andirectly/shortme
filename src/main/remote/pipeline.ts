/** Echte ShortMe-Pipeline für Remote-Jobs: exakt die Funktionen lokaler Läufe (Import, Transkription, Analyse, Export). */
import { statfs, mkdir, copyFile } from 'node:fs/promises'
import { join } from 'node:path'
import { dataRoot } from '../engines/paths'
import { importUrl } from '../shortme/importer'
import { loadMeta, projectDir, saveMeta } from '../shortme/project'
import { loadTranscript, runTranscription } from '../shortme/transcription'
import { findClip, loadClips, runAnalysis } from '../shortme/clips/analysis'
import { missingModelsFor } from '../shortme/engineIpc'
import { isLocalEngine, loadDefaultEngine } from '../shortme/clips/engines/control'
import { setSelected } from '../shortme/clips/engines/state'
import { loadEdits } from '../shortme/edits'
import { jobs, renderClips } from '../shortme/ipc'
import { exportRoot } from '../shortme/exportDir'
import { safeFileName } from '../shortme/render/profiles'
import { probeVideo } from '../pipeline/ffmpeg'
import { addExport } from '../upload/store'
import { clipRevision } from '@shared/review'
import { ENGINE_LABEL, type SelectionEngineId } from '@shared/engine'
import type { ContentType, FrameChoice } from '@shared/videoKind'
import type { ClientStore, Pipeline, RemoteJobSettings } from './jobs'

const MIN_FREE_BYTES = 5 * 1024 ** 3
const CONTENT: ContentType[] = ['podcast', 'vlog', 'solo', 'stream', 'talk']
const FRAMES: FrameChoice[] = ['smart', 'fit', 'split', 'fixed', 'stream']

async function engineFor(s: RemoteJobSettings): Promise<SelectionEngineId> {
  return s.engine && isLocalEngine(s.engine as SelectionEngineId) ? (s.engine as SelectionEngineId) : loadDefaultEngine()
}

/** Auf einen Job im normalen Job-Queue warten (sichtbar in der Job-Liste des Workers). */
function awaitJob(id: string, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const check = (j: { id: string; state: string; error?: string }): void => {
      if (j.id !== id) return
      if (j.state === 'done') { done(); resolve() } else if (j.state === 'error' || j.state === 'stopped') { done(); reject(new Error(j.error ?? 'Analyse abgebrochen')) }
    }
    const onAbort = (): void => { jobs.stop(id); done(); reject(new Error('Abgebrochen')) }
    const done = (): void => { jobs.off('job', check); signal.removeEventListener('abort', onAbort) }
    jobs.on('job', check)
    signal.addEventListener('abort', onAbort)
    const now = jobs.get(id)
    if (now) check(now)
  })
}

export const realPipeline: Pipeline = {
  async preflight(s) {
    const engine = await engineFor(s)
    const missing = await missingModelsFor(engine)
    if (missing.length) return { ok: false, code: 'MODEL_MISSING', message: `Auf dem Worker fehlen Modelle für ${ENGINE_LABEL[engine]}: ${missing.map((m) => m.name).join(', ')}` }
    await mkdir(dataRoot(), { recursive: true })
    const fs = await statfs(dataRoot())
    if (fs.bavail * fs.bsize < MIN_FREE_BYTES) return { ok: false, code: 'INSUFFICIENT_SPACE', message: 'Auf dem Worker sind weniger als 5 GB frei' }
    return { ok: true }
  },

  async download(url, onProgress) {
    const r = await importUrl(url, (p, msg) => onProgress(p, msg))
    return { hash: r.meta.hash, projectDir: projectDir(r.meta.hash), sourcePath: r.meta.sourcePath, title: r.meta.title }
  },

  async analyze(hash, s, onProgress, signal) {
    const meta = await loadMeta(hash)
    if (!meta) throw new Error('Projekt nicht gefunden')
    const engine = await engineFor(s)
    await setSelected(hash, engine)
    const contentType = CONTENT.includes(s.contentType as ContentType) ? (s.contentType as ContentType) : undefined
    const frame = FRAMES.includes(s.frame as FrameChoice) ? (s.frame as FrameChoice) : undefined
    if (contentType) { meta.contentType = contentType; await saveMeta(meta) }
    const info = jobs.enqueue(hash, `Remote: ${meta.title}`, async ({ signal: js, report, timing }) => {
      await runTranscription(meta, { diarize: false, signal: js, onProgress: (p) => { report(p.stage, p.fraction, p.message); onProgress(`trans:${p.stage}`, p.fraction * 0.5, p.message) } })
      await runAnalysis(meta, { engine, query: s.query, contentType, frame, wanted: s.wanted, signal: js, onProgress: (st, p, m) => { report(st, p, m); onProgress(st, 0.5 + p * 0.5, m) }, timing })
    })
    await awaitJob(info.id, signal)
  },

  async clips(hash) {
    const file = await loadClips(hash)
    if (!file) return []
    const out = []
    for (const c of file.clips) {
      if (c.pending) continue
      out.push({ id: c.id, title: c.title, verdict: c.v2?.verification, start: c.start, end: c.end, revision: clipRevision(c, await loadEdits(hash, c.id)) })
    }
    return out
  },

  async render(hash, clipIds, outDir, onRendered, onProgress, signal) {
    const meta = await loadMeta(hash)
    const transcript = await loadTranscript(hash)
    if (!meta || !transcript) throw new Error('Projekt oder Transkript fehlt')
    const clips = (await Promise.all(clipIds.map((id) => findClip(hash, id)))).flatMap((f) => (f ? [f.clip] : []))
    if (!clips.length) return
    await mkdir(outDir, { recursive: true })
    await renderClips(meta, transcript, clips, outDir, { captions: true }, signal, (_st, p, m) => onProgress(p, m), (clip, exp) => onRendered(clip.id, exp.path))
  },

  async probeOk(path) {
    try { const v = await probeVideo(path); return v.durationSec > 0 && v.width > 0 } catch { return false }
  }
}

/** Client: importierte Daten landen im normalen Projekt- bzw. Exportordner. */
export function realClientStore(onImported: (hash: string) => void): ClientStore {
  return {
    projectDir,
    async onProjectImported(hash) { onImported(hash) },
    async importRender(hash, clipId, title, tmpPath) {
      const meta = hash ? await loadMeta(hash) : null
      const dir = join(await exportRoot(), safeFileName(meta?.title ?? 'Remote', 'Remote'))
      await mkdir(dir, { recursive: true })
      const dest = join(dir, `${safeFileName(title, clipId)}.mp4`)
      await copyFile(tmpPath, dest)
      const v = await probeVideo(dest).catch(() => null)
      if (hash) await addExport({ hash, clipId, title, hookText: '', path: dest, durationSec: v?.durationSec ?? 0 })
      return dest
    }
  }
}
