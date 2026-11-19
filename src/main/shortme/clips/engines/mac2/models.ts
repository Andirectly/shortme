// Engine Mac 2: Pflichtvoraussetzungen (keine stille Rückstufung auf die alte Mac-Engine). Gemma 4 ist optional (nur gezielte Rückfragen).
import { existsSync } from 'node:fs'
import { assets } from '../../../../engines'
import { CATALOG } from '../../../../engines/catalog'
import { avRuntimeStatus, runtimeStatus } from '../v3/runtime'
import { V3_AV_ASSET, V3_PYTHON_ASSET } from '../v3/models'
import { macWorkerExe } from '../mac/sound'

export const MAC2_REQUIRED = ['lfm3-omni-2b', 'qwen3.5-9b-mlx', 'qwen3-vl-embedding-2b']

export async function mac2MissingModels(): Promise<Array<{ id: string; name: string; sizeBytes: number }>> {
  const out: Array<{ id: string; name: string; sizeBytes: number }> = []
  if (process.platform !== 'darwin' || process.arch !== 'arm64') out.push({ id: 'engine-mac-platform', name: 'Engine Mac läuft nur auf einem Mac mit Apple Silicon', sizeBytes: 0 })
  if (!existsSync(macWorkerExe())) out.push({ id: 'engine-mac-worker', name: 'Mac-Helfer (shortme-mac-worker) fehlt im Programm', sizeBytes: 0 })
  const rt = await runtimeStatus()
  if (rt.state !== 'ready') out.push({ id: V3_PYTHON_ASSET, name: `Python-Laufzeit (Bildsuche, Apple-GPU) – ${rt.detail}`, sizeBytes: 0 })
  const av = await avRuntimeStatus()
  if (av.state !== 'ready') out.push({ id: V3_AV_ASSET, name: `MLX-Laufzeit (LFM3, Qwen3.5) – ${av.detail}`, sizeBytes: 0 })
  for (const id of MAC2_REQUIRED) {
    const sp = CATALOG.find((c) => c.id === id)
    if (!sp) { out.push({ id, name: id, sizeBytes: 0 }); continue }
    if (!(await assets.isInstalled(id))) out.push({ id, name: sp.name, sizeBytes: sp.files.reduce((n, f) => n + f.size, 0) })
  }
  return out
}
