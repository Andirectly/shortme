// Worker der AV-Umgebung (Lighthouse, MiniCPM-o) als Residents im vorhandenen VramSequencer (einzige übergreifende GPU-Sperre): je Modell ein Resident,
// `use()` entlädt vorher alles andere (auch den Embedding-Worker), lädt Python + Modell und entlädt es danach wieder (unload_model, dann Prozess beenden).
import { assetDir, modelsRoot } from '../../../../engines/paths'
import { vram } from '../../../../engines'
import { projectsRoot } from '../../../project'
import { PyWorker } from './pyWorker'
import { avPythonExe, workerScript } from './runtime'

export interface AvSession { worker: PyWorker; runId: string; modelId: string; loadInfo: Record<string, unknown>; health: Record<string, unknown> }

function resident(name: string, modelId: string, loadTimeoutMs: number): <T>(runId: string, fn: (s: AvSession) => Promise<T>) => Promise<T> {
  let session: AvSession | null = null
  let currentRun = 'idle'
  vram.register({
    name,
    load: async () => {
      const worker = new PyWorker({ python: avPythonExe(), script: workerScript(), allowedRoots: [projectsRoot()], modelRoots: [modelsRoot()] })
      try {
        await worker.start()
        const health = await worker.request<Record<string, unknown>>('health', {}, { runId: currentRun, timeoutMs: 60_000 })
        const loadInfo = await worker.request<Record<string, unknown>>('load_model', { modelId, modelDir: assetDir(modelId) }, { runId: currentRun, timeoutMs: loadTimeoutMs })
        session = { worker, runId: currentRun, modelId, loadInfo, health }
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
  return (runId, fn) => { currentRun = runId; return vram.use(name, () => fn(session!)) }
}

export const withTemporal = resident('v3-temporal', 'lighthouse-cg-detr-clip', 300_000)
export const withAv = resident('v3-av', 'minicpm-o-4_5', 600_000)
