// Engine 6 – Plattformadapter (Kap. 11): Textmodell, Audio/Video-Modell und Bild-Embedding über die bestehenden, getesteten Dienste.
//   Windows: Qwen3-14B (llama-server, CUDA) + MiniCPM-o 4.5 (Python, CUDA) + Qwen3-VL-Embedding-2B
//   Mac (UNTESTED in Engine 6): Qwen3.5-9B (mlx_vlm.server) + Gemma 4 E4B (Python/MLX, analyze_av) + Qwen3-VL-Embedding-2B (MPS)
// Kein stiller Ersatz: fehlt etwas, meldet `missing()` es konkret; es wird nie auf eine andere Engine oder die Cloud ausgewichen.
import { assets, hardware, withLlm } from '../../../../engines'
import { CATALOG } from '../../../../engines/catalog'
import { avRuntimeStatus, runtimeStatus } from '../v3/runtime'
import { V3_AV_MODEL, MAC_AV_MODEL, V3_EMBED_MODEL } from '../v3/revisions'
import { V3_AV_ASSET, V3_PYTHON_ASSET } from '../v3/models'
import { withAv, withMacAv, type AvSession } from '../v3/avWorker'
import { withEmbedder, type EmbedSession } from '../v3/embedWorker'
import { withQwen, MAC_QWEN } from '../mac2/mlxServer'

export type HardwareProfile = 'efficient' | 'balanced' | 'performance'

export interface V6Adapter {
  platform: 'win32' | 'darwin'
  /** Textmodell als OpenAI-kompatibler Server (llama-server / mlx_vlm.server); `model` nur für mlx_vlm nötig */
  withText: <T>(fn: (url: string, model?: string) => Promise<T>) => Promise<T>
  withAv: <T>(runId: string, fn: (s: AvSession) => Promise<T>) => Promise<T>
  withEmbedder: <T>(runId: string, fn: (s: EmbedSession) => Promise<T>) => Promise<T>
  models: Record<string, string>
  textLabel: string
  required: string[]
}

const WIN: V6Adapter = {
  platform: 'win32',
  withText: (fn) => withLlm((url) => fn(url)),
  withAv: (runId, fn) => withAv(runId, fn),
  withEmbedder: (runId, fn) => withEmbedder(runId, fn),
  models: { text: 'qwen3-14b-q4_k_m (llama-server)', av: `${V3_AV_MODEL.id}@${V3_AV_MODEL.revision.slice(0, 8)}`, embed: `${V3_EMBED_MODEL.id}@${V3_EMBED_MODEL.revision.slice(0, 8)}` },
  textLabel: 'Qwen3-14B',
  required: ['qwen3-vl-embedding-2b', 'minicpm-o-4_5', 'yamnet', 'qwen3-14b', 'llama-server']
}

const MAC: V6Adapter = {
  platform: 'darwin',
  withText: (fn) => withQwen(async (s) => fn(s.url, s.model)),
  withAv: (runId, fn) => withMacAv(runId, fn),
  withEmbedder: (runId, fn) => withEmbedder(runId, fn),
  models: { text: `${MAC_QWEN.repo}@${MAC_QWEN.revision.slice(0, 8)} (mlx_vlm.server)`, av: `${MAC_AV_MODEL.id}@${MAC_AV_MODEL.revision.slice(0, 8)} (mlx-vlm)`, embed: `${V3_EMBED_MODEL.id}@${V3_EMBED_MODEL.revision.slice(0, 8)}` },
  textLabel: 'Qwen3.5-9B',
  required: ['qwen3.5-9b-mlx', 'gemma-4-e4b-it', 'qwen3-vl-embedding-2b']
}

export const adapterFor = (platform: string = process.platform): V6Adapter => (platform === 'darwin' ? MAC : WIN)

/** Fehlende Voraussetzungen (leer = bereit). Readiness heißt: Dateien + Laufzeit da; die echte Probe (kleines Bild/Ton/Schema) macht `probeAdapters`. */
export async function v6MissingModels(platform: string = process.platform): Promise<Array<{ id: string; name: string; sizeBytes: number }>> {
  const a = adapterFor(platform)
  const out: Array<{ id: string; name: string; sizeBytes: number }> = []
  if (platform === 'darwin' && process.arch !== 'arm64') out.push({ id: 'engine6-platform', name: 'Engine 6 braucht auf dem Mac Apple Silicon', sizeBytes: 0 })
  const rt = await runtimeStatus()
  if (rt.state !== 'ready') out.push({ id: V3_PYTHON_ASSET, name: `Python-Laufzeit (Bildsuche) – ${rt.detail}`, sizeBytes: 0 })
  const av = await avRuntimeStatus()
  if (av.state !== 'ready') out.push({ id: V3_AV_ASSET, name: `AV-Laufzeit – ${av.detail}`, sizeBytes: 0 })
  for (const id of a.required) {
    const sp = CATALOG.find((c) => c.id === id)
    if (!sp) { if (!(await assets.isInstalled(id))) out.push({ id, name: id, sizeBytes: 0 }); continue }
    if (!(await assets.isInstalled(id))) out.push({ id, name: sp.name, sizeBytes: sp.files.reduce((n, f) => n + f.size, 0) })
  }
  return out
}

/** Hardwareprofil als Start-Hypothese aus gemessenem Speicher (nicht aus dem Produktnamen); Mac: Unified Memory → efficient bei ≤ 16 GB. */
export async function hardwareProfile(): Promise<{ profile: HardwareProfile; vramTotalMb: number; gpu: string | null }> {
  const h = await hardware()
  const profile: HardwareProfile = h.vramTotalMb >= 24000 ? 'performance' : h.vramTotalMb >= 15000 ? 'balanced' : 'efficient'
  return { profile, vramTotalMb: h.vramTotalMb, gpu: h.gpuName }
}
