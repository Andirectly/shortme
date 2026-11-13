// IPC für die Engine-Wahl und den Start von Analysen. Genau ein Start je Projekt: alles läuft durch `claimProject` und die Prüfung auf aktive Jobs.
import { existsSync } from 'node:fs'
import { ipcMain } from 'electron'
import { importUrl } from './importer'
import type { JobQueue } from './jobs'
import { loadMeta, saveMeta, type ProjectMeta } from './project'
import { runAnalysis } from './clips/analysis'
import { loadProfile, rememberChoice, sourceKey } from './profiles'
import { claimProject, loadDefaultEngine, saveDefaultEngine, switchEngine, type SwitchRequest } from './clips/engines/control'
import { engineRevisions } from './clips/engines'
import { loadState, setSelected, stopStaleRuns } from './clips/engines/state'
import { v2MissingModels } from './clips/engines/v2/models'
import { ENGINE_IDS, type AnalysisState, type SelectionEngineId } from '../../shared/engine'
import type { ContentType, FrameChoice } from '../../shared/videoKind'

const ACTIVE = ['queued', 'running', 'paused']

export const hasActiveJob = (jobs: JobQueue, hash: string): boolean => jobs.list().some((j) => j.hash === hash && ACTIVE.includes(j.state))

/** Analyse in die Warteschlange legen (synchron, damit `hasActiveJob` sofort stimmt). Inhaltstyp und Ausschnitt werden wie bisher als Auswahl der Quelle gemerkt. */
export function enqueueAnalysis(jobs: JobQueue, meta: ProjectMeta, o: { engine: SelectionEngineId; query?: string; contentType: ContentType; frame: FrameChoice; wanted?: number }): string {
  const info = jobs.enqueue(meta.hash, meta.title, async ({ signal, report }) => {
    // Quellvideo gelöscht (z. B. Speicher sparen)? Bei Links neu laden, sonst klare Meldung
    if (!existsSync(meta.sourcePath)) {
      if (!meta.sourceUrl) throw new Error('Das Quellvideo gibt es nicht mehr. Bitte die Datei erneut importieren.')
      report('audio', 0, 'Video wird neu geladen …')
      await importUrl(meta.sourceUrl, (p, message) => report('audio', p, message))
    }
    await runAnalysis(meta, { engine: o.engine, query: o.query, contentType: o.contentType, frame: o.frame, wanted: o.wanted, signal, onProgress: report })
  })
  return info.id
}

export function registerEngineControlIpc(jobs: JobQueue): void {
  ipcMain.handle('shortme:engineDefault', () => loadDefaultEngine())
  ipcMain.handle('shortme:engineSetDefault', (_e, engine: SelectionEngineId) => saveDefaultEngine(engine))
  ipcMain.handle('shortme:engineMissing', (_e, engine: SelectionEngineId) => (engine === 'multimodal-v2' ? v2MissingModels() : []))

  /** Zustand für die Oberfläche: Auswahl, angezeigter Lauf, Läufe, ob gerade ein Job läuft. */
  ipcMain.handle('shortme:engineState', async (_e, hash: string): Promise<{ state: AnalysisState; busy: boolean }> => {
    const busy = hasActiveJob(jobs, hash)
    return { state: busy ? await loadState(hash) : await stopStaleRuns(hash), busy }
  })

  ipcMain.handle('shortme:engineSelect', (_e, req: SwitchRequest) => switchEngine(req, {
    hasActiveJob: (h) => hasActiveJob(jobs, h),
    missingModels: async (e) => (e === 'multimodal-v2' ? v2MissingModels() : []),
    revisions: engineRevisions,
    start: (r, meta) => {
      const kind = r.contentType as ContentType
      meta.contentType = kind
      void saveMeta(meta)
      void rememberChoice(sourceKey({ channel: meta.twitch?.channel, url: meta.sourceUrl, path: meta.sourcePath }), { kind, frame: r.frame as FrameChoice })
      return enqueueAnalysis(jobs, meta, { engine: r.engine, query: r.query, contentType: kind, frame: r.frame as FrameChoice, wanted: r.wanted ?? undefined })
    }
  }))

  ipcMain.handle('shortme:recompute', (_e, hash: string, o: RecomputeOptions) => recomputeProject(jobs, hash, o))
}

export interface RecomputeOptions { query?: string; contentType?: ContentType; frame?: FrameChoice; wanted?: number; engine?: SelectionEngineId }
export type RecomputeResult = { jobId: string; missing?: undefined } | { jobId: null; missing: Array<{ id: string; name: string; sizeBytes: number }> }

/** Neu berechnen mit der gewählten Engine und den tatsächlich aktuellen Werten (Suchwunsch, Typ, Ausschnitt, Anzahl). Erzeugt immer einen neuen Lauf. */
export async function recomputeProject(jobs: JobQueue, hash: string, o: RecomputeOptions): Promise<RecomputeResult> {
  const release = claimProject(hash)
  if (!release) throw new Error('Für dieses Projekt wird gerade eine Analyse gestartet.')
  try {
    if (hasActiveJob(jobs, hash)) throw new Error('Für dieses Projekt läuft schon eine Analyse. „Stoppen & behalten“ beendet sie.')
    const meta = await loadMeta(hash)
    if (!meta) throw new Error('Projekt nicht gefunden')
    await stopStaleRuns(hash)
    const engine = o.engine && ENGINE_IDS.includes(o.engine) ? o.engine : (await loadState(hash)).selected
    await setSelected(hash, engine)
    if (engine === 'multimodal-v2') { const missing = await v2MissingModels(); if (missing.length) return { jobId: null, missing } }
    const kind = (o.contentType ?? meta.contentType ?? 'podcast') as ContentType
    const frame = o.frame ?? (await loadProfile(kind)).frame
    meta.contentType = kind
    await saveMeta(meta)
    await rememberChoice(sourceKey({ channel: meta.twitch?.channel, url: meta.sourceUrl, path: meta.sourcePath }), { kind, frame })
    return { jobId: enqueueAnalysis(jobs, meta, { engine, query: o.query, contentType: kind, frame, wanted: o.wanted }) }
  } finally { release() }
}
