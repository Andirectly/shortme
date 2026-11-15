// Der Embedding-Worker als Resident im vorhandenen VramSequencer (einzige übergreifende GPU-Sperre): `use()` entlädt vorher LLM/ASR/Bild-/Tonmodell,
// lädt Python + Modell und entlädt es danach wieder (unload_model, dann Prozess beenden), bevor der nächste Resident startet.
import { assetDir, modelsRoot } from '../../../../engines/paths'
import { vram } from '../../../../engines'
import { projectsRoot } from '../../../project'
import { PyWorker } from './pyWorker'
import { pythonExe, workerScript } from './runtime'
import { V3_EMBED_MODEL } from './revisions'

export interface EmbedSession { worker: PyWorker; runId: string; loadInfo: Record<string, unknown>; health: Record<string, unknown> }
let session: EmbedSession | null = null
/** Lauf-ID für die Anfragen (vom Aufrufer vor `withEmbedder` gesetzt; verspätete Antworten anderer Läufe werden im Client verworfen). */
let currentRun = 'idle'

vram.register({
  name: 'v3-embed',
  load: async () => {
    const worker = new PyWorker({ python: pythonExe(), script: workerScript(), allowedRoots: [projectsRoot()], modelRoots: [modelsRoot()] })
    try {
      await worker.start()
      const health = await worker.request<Record<string, unknown>>('health', {}, { runId: currentRun, timeoutMs: 60_000 })
      const loadInfo = await worker.request<Record<string, unknown>>('load_model', { modelId: V3_EMBED_MODEL.id, modelDir: assetDir(V3_EMBED_MODEL.id), maxFrames: 16 }, { runId: currentRun, timeoutMs: 300_000 })
      session = { worker, runId: currentRun, loadInfo, health }
    } catch (e) { await worker.stop(); throw e }
  },
  unload: async () => {
    const s = session
    session = null
    if (!s) return
    try { await s.worker.request('unload_model', {}, { runId: s.runId, timeoutMs: 30_000 }) } catch { /* Prozess wird ohnehin beendet */ }
    await s.worker.stop()
  }
})

/** Eine Modellphase mit dem Embedding-Worker (exklusiv auf der GPU). */
export const withEmbedder = <T>(runId: string, fn: (s: EmbedSession) => Promise<T>): Promise<T> => { currentRun = runId; return vram.use('v3-embed', () => fn(session!)) }
