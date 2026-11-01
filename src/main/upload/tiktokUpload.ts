// Logik des Teilstück-Uploads (rein, mit austauschbaren Abhängigkeiten, damit testbar).
// Vorlage: github.com/fernandolisboa/bardo PR #102 – Fortsetzen beim letzten bestätigten Teilstück, neue Initialisierung bei
// Adresse > 1 h oder 403/404/405, höchstens zwei Initialisierungen pro Aufruf.
import type { ChunkPlan } from '../../shared/upload'

export interface Resume { publishId: string; uploadUrl: string; initAt: number; chunksDone: number }
export interface PutResult { status: number; /** letztes bestätigtes Byte laut Content-Range-Antwort (bei 416) */ received?: number }
export interface UploadDeps {
  init(plan: ChunkPlan): Promise<{ publishId: string; uploadUrl: string }>
  put(url: string, plan: ChunkPlan, index: number): Promise<PutResult>
  now(): number
  sleep(ms: number): Promise<void>
}

export const URL_MAX_AGE_MS = 3600_000
export const MAX_INITS = 2
const MAX_RETRIES = 3

export async function runUpload(plan: ChunkPlan, resume: Resume | undefined, deps: UploadDeps, onProgress: (s: Resume) => Promise<void> | void): Promise<Resume> {
  let inits = 0
  let st: Resume | undefined = resume && deps.now() - resume.initAt <= URL_MAX_AGE_MS ? { ...resume } : undefined
  const init = async (): Promise<void> => {
    if (++inits > MAX_INITS) throw new Error('TikTok hat die Upload-Adresse zweimal abgelehnt. Bitte später erneut versuchen.')
    const r = await deps.init(plan)
    st = { ...r, initAt: deps.now(), chunksDone: 0 }
    await onProgress(st)
  }
  if (!st) await init()
  let retries = 0
  while (st!.chunksDone < plan.total) {
    if (deps.now() - st!.initAt > URL_MAX_AGE_MS) { await init(); continue }
    const r = await deps.put(st!.uploadUrl, plan, st!.chunksDone)
    if (r.status === 403 || r.status === 404 || r.status === 405) { await init(); continue }
    if (r.status === 416) {
      const done = r.received === undefined ? -1 : plan.ranges.filter((x) => x[1] <= r.received!).length
      if (done > st!.chunksDone) { st!.chunksDone = done; await onProgress(st!) } else await init()
      continue
    }
    if (r.status >= 500) {
      if (++retries > MAX_RETRIES) throw new Error(`TikTok-Server meldet Fehler ${r.status}. Bitte später erneut versuchen.`)
      await deps.sleep(1000 * retries)
      continue
    }
    if (r.status !== 200 && r.status !== 201 && r.status !== 206) throw new Error(`TikTok hat ein Teilstück abgelehnt (${r.status}).`)
    retries = 0
    st!.chunksDone++
    await onProgress(st!)
  }
  return st!
}
