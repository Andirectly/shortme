// Worker der AV-Umgebung (Lighthouse, MiniCPM-o) als Residents im vorhandenen VramSequencer (einzige übergreifende GPU-Sperre): je Modell ein Resident,
// `use()` entlädt vorher alles andere (auch den Embedding-Worker), lädt Python + Modell und entlädt es danach wieder (unload_model, dann Prozess beenden).
import { assetDir, modelsRoot } from '../../../../engines/paths'
import { vram } from '../../../../engines'
import { projectsRoot } from '../../../project'
import { PyWorker } from './pyWorker'
import { avPythonExe, workerScript } from './runtime'
import { MAC_AV_MODEL, V3_AV_MODEL, V3_TEMPORAL_MODEL } from './revisions'
import { delimiter, dirname } from 'node:path'
import { FFMPEG_PATH, FFPROBE_PATH } from '../../../../pipeline/ffmpeg'

/** `revision`: fest gebundene Modellrevision (geht in Spuren, Belege und Checkpoint-Schlüssel ein). */
export interface AvSession { worker: PyWorker; runId: string; modelId: string; revision: string; loadInfo: Record<string, unknown>; health: Record<string, unknown> }

function resident(name: string, modelId: string, revision: string, loadTimeoutMs: number): <T>(runId: string, fn: (s: AvSession) => Promise<T>) => Promise<T> {
  let session: AvSession | null = null
  let currentRun = 'idle'
  vram.register({
    name,
    load: async () => {
      // MiniCPM-o/Lighthouse rufen „ffmpeg“ aus dem PATH auf: das gebündelte FFmpeg voranstellen (im installierten Programm gibt es sonst keins)
      const worker = new PyWorker({ python: avPythonExe(), script: workerScript(), allowedRoots: [projectsRoot()], modelRoots: [modelsRoot()], env: { PATH: [dirname(FFMPEG_PATH), dirname(FFPROBE_PATH), process.env.PATH ?? ''].join(delimiter) } })
      try {
        await worker.start()
        const health = await worker.request<Record<string, unknown>>('health', {}, { runId: currentRun, timeoutMs: 60_000 })
        const loadInfo = await worker.request<Record<string, unknown>>('load_model', { modelId, modelDir: assetDir(modelId) }, { runId: currentRun, timeoutMs: loadTimeoutMs })
        session = { worker, runId: currentRun, modelId, revision, loadInfo, health }
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

export const withTemporal = resident('v3-temporal', V3_TEMPORAL_MODEL.id, V3_TEMPORAL_MODEL.codeCommit, 300_000)
export const withAv = resident('v3-av', V3_AV_MODEL.id, V3_AV_MODEL.revision, 600_000)
/** Mac-Engine: Gemma 4 E4B (MLX) in der Mac-AV-Umgebung, gleiche Operation `analyze_av`. */
export const withMacAv = resident('mac-av', MAC_AV_MODEL.id, MAC_AV_MODEL.revision, 300_000)
