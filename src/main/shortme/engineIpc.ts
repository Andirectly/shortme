// IPC für die Engine-Wahl und den Start von Analysen. Genau ein Start je Projekt: alles läuft durch `claimProject` und die Prüfung auf aktive Jobs.
import { existsSync } from 'node:fs'
import { BrowserWindow, ipcMain } from 'electron'
import { importUrl } from './importer'
import type { JobQueue } from './jobs'
import { loadMeta, saveMeta, type ProjectMeta } from './project'
import { runAnalysis } from './clips/analysis'
import { loadProfile, rememberChoice, sourceKey } from './profiles'
import { claimProject, isLocalEngine, loadDefaultEngine, saveDefaultEngine, switchEngine, type SwitchRequest } from './clips/engines/control'
import { engineRevisions } from './clips/engines'
import { loadState, setSelected, stopStaleRuns } from './clips/engines/state'
import { v2MissingModels } from './clips/engines/v2/models'
import { v3MissingModels } from './clips/engines/v3/models'
import { v4MissingModels } from './clips/engines/v4/models'
import { mac2MissingModels } from './clips/engines/mac2/models'
import { v4Provenance } from './clips/engines/v4/provenance'
import { installAvRuntime, installRuntime, runtimeStatus } from './clips/engines/v3/runtime'
import { addOverride, addRecheck, listRechecks, addReview, clipIndex, blindPresentation, createComparison, getComparison, listComparisons } from './clips/compare'
import type { EventMatchOverride } from '../../shared/compare'
import { isV3Profile, type AnalysisState, type SelectionEngineId, type V3Profile } from '../../shared/engine'
import type { ContentType, FrameChoice } from '../../shared/videoKind'

const ACTIVE = ['queued', 'running', 'paused']

/** Fehlende Pflichtvoraussetzungen der Engine (leer = bereit). */
export const missingModelsFor = (engine: SelectionEngineId): Promise<Array<{ id: string; name: string; sizeBytes: number }>> => (engine === 'multimodal-v2' ? v2MissingModels() : engine === 'adaptive-v3' ? v3MissingModels() : engine === 'engine4' ? v4MissingModels() : engine === 'engine-mac' ? mac2MissingModels() : Promise.resolve([]))

export const hasActiveJob = (jobs: JobQueue, hash: string): boolean => jobs.list().some((j) => j.hash === hash && ACTIVE.includes(j.state))

/** Analyse in die Warteschlange legen (synchron, damit `hasActiveJob` sofort stimmt). Inhaltstyp und Ausschnitt werden wie bisher als Auswahl der Quelle gemerkt. */
export function enqueueAnalysis(jobs: JobQueue, meta: ProjectMeta, o: { engine: SelectionEngineId; query?: string; contentType: ContentType; frame: FrameChoice; wanted?: number; profile?: V3Profile }): string {
  const info = jobs.enqueue(meta.hash, meta.title, async ({ signal, report, timing }) => {
    // Quellvideo gelöscht (z. B. Speicher sparen)? Bei Links neu laden, sonst klare Meldung
    if (!existsSync(meta.sourcePath)) {
      if (!meta.sourceUrl) throw new Error('Das Quellvideo gibt es nicht mehr. Bitte die Datei erneut importieren.')
      report('audio', 0, 'Video wird neu geladen …')
      await importUrl(meta.sourceUrl, (p, message) => report('audio', p, message))
    }
    await runAnalysis(meta, { engine: o.engine, query: o.query, contentType: o.contentType, frame: o.frame, wanted: o.wanted, profile: o.profile, signal, onProgress: report, timing })
  })
  return info.id
}

export function registerEngineControlIpc(jobs: JobQueue): void {
  ipcMain.handle('shortme:engineDefault', () => loadDefaultEngine())
  ipcMain.handle('shortme:engineSetDefault', (_e, engine: SelectionEngineId) => saveDefaultEngine(engine))
  ipcMain.handle('shortme:engineMissing', (_e, engine: SelectionEngineId) => missingModelsFor(engine))
  ipcMain.handle('shortme:v3RuntimeStatus', () => runtimeStatus())
  ipcMain.handle('shortme:compareCreate', (_e, hash: string, runIds: string[]) => createComparison(hash, runIds))
  ipcMain.handle('shortme:compareRechecks', (_e, hash: string, id: string) => listRechecks(hash, id))
  ipcMain.handle('shortme:compareRecheck', (_e, hash: string, id: string, clipId: string, engine: 'multimodal-v2' | 'legacy' | 'engine4' | 'engine-mac') => addRecheck(hash, id, clipId, engine))
  ipcMain.handle('shortme:v4Provenance', (_e, hash: string, runId: string, clipId: string) => v4Provenance(hash, runId, clipId))
  ipcMain.handle('shortme:compareList', (_e, hash: string) => listComparisons(hash))
  ipcMain.handle('shortme:compareGet', async (_e, hash: string, id: string) => { const c = await getComparison(hash, id); return c ? { c, clips: await clipIndex(hash, c), sourcePath: (await loadMeta(hash))?.sourcePath ?? null } : null })
  ipcMain.handle('shortme:compareOverride', (_e, hash: string, id: string, o: Omit<EventMatchOverride, 'createdAt'>) => addOverride(hash, id, o))
  ipcMain.handle('shortme:compareBlind', async (_e, hash: string, id: string, matchId: string) => { const c = await getComparison(hash, id); return c ? blindPresentation(c, matchId) : [] })
  ipcMain.handle('shortme:compareReview', (_e, hash: string, id: string, r: { matchId: string; choice: 'a' | 'b' | 'c' | 'd' | 'tie' | 'all-weak'; reasonTags: string[] }) => addReview(hash, id, { ...r, reviewerSessionId: 'local' }))
  /** Python-Laufzeit von Engine 3 installieren/reparieren (Modell-Manager-Aktion); Fortschrittszeilen gehen als Ereignis an alle Fenster. */
  let installing: Promise<unknown> | null = null
  ipcMain.handle('shortme:v3RuntimeInstall', async () => {
    if (installing) throw new Error('Die Installation läuft schon.')
    const send = (line: string): void => { for (const w of BrowserWindow.getAllWindows()) w.webContents.send('shortme:v3-runtime-progress', line.slice(0, 300)) }
    installing = (async () => { await installRuntime(send); return installAvRuntime(send) })()
    try { return await installing } finally { installing = null }
  })

  /** Zustand für die Oberfläche: Auswahl, angezeigter Lauf, Läufe, ob gerade ein Job läuft. */
  ipcMain.handle('shortme:engineState', async (_e, hash: string): Promise<{ state: AnalysisState; busy: boolean }> => {
    const busy = hasActiveJob(jobs, hash)
    return { state: busy ? await loadState(hash) : await stopStaleRuns(hash), busy }
  })

  ipcMain.handle('shortme:engineSelect', (_e, req: SwitchRequest) => switchEngine(req, {
    hasActiveJob: (h) => hasActiveJob(jobs, h),
    missingModels: missingModelsFor,
    revisions: (e) => engineRevisions(e),
    start: (r, meta) => {
      const kind = r.contentType as ContentType
      meta.contentType = kind
      void saveMeta(meta)
      void rememberChoice(sourceKey({ channel: meta.twitch?.channel, url: meta.sourceUrl, path: meta.sourcePath }), { kind, frame: r.frame as FrameChoice })
      return enqueueAnalysis(jobs, meta, { engine: r.engine, query: r.query, contentType: kind, frame: r.frame as FrameChoice, wanted: r.wanted ?? undefined, profile: isV3Profile(r.profile) ? r.profile : undefined })
    }
  }))

  ipcMain.handle('shortme:recompute', (_e, hash: string, o: RecomputeOptions) => recomputeProject(jobs, hash, o))
}

export interface RecomputeOptions { query?: string; contentType?: ContentType; frame?: FrameChoice; wanted?: number; engine?: SelectionEngineId; profile?: V3Profile }
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
    const sel = (await loadState(hash)).selected
    const engine = o.engine && isLocalEngine(o.engine) ? o.engine : isLocalEngine(sel) ? sel : await loadDefaultEngine()
    await setSelected(hash, engine)
    { const missing = await missingModelsFor(engine); if (missing.length) return { jobId: null, missing } }
    const kind = (o.contentType ?? meta.contentType ?? 'podcast') as ContentType
    const frame = o.frame ?? (await loadProfile(kind)).frame
    meta.contentType = kind
    await saveMeta(meta)
    await rememberChoice(sourceKey({ channel: meta.twitch?.channel, url: meta.sourceUrl, path: meta.sourcePath }), { kind, frame })
    return { jobId: enqueueAnalysis(jobs, meta, { engine, query: o.query, contentType: kind, frame, wanted: o.wanted, profile: isV3Profile(o.profile) ? o.profile : undefined }) }
  } finally { release() }
}
