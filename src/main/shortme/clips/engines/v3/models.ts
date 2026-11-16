// Pflichtvoraussetzungen der Engine 3: gemanagte Python-Laufzeit, Embedding-Modell und (Kompatibilitätspfad für die Detailprüfung) die Modelle von Engine 2.
import { assets } from '../../../../engines'
import { CATALOG } from '../../../../engines/catalog'
import { v2MissingModels } from '../v2/models'
import { V3_EMBED_MODEL } from './revisions'
import { avRuntimeStatus, runtimeStatus } from './runtime'
import { V3_PROFILE_CONFIG, V3_AV_MODEL, V3_TEMPORAL_MODEL } from './revisions'

export const V3_PYTHON_ASSET = 'python-runtime-v3'
export const V3_AV_ASSET = 'python-runtime-v3av'

export async function v3MissingModels(): Promise<Array<{ id: string; name: string; sizeBytes: number }>> {
  const out: Array<{ id: string; name: string; sizeBytes: number }> = []
  const rt = await runtimeStatus()
  if (rt.state !== 'ready') out.push({ id: V3_PYTHON_ASSET, name: `Python-Laufzeit für Engine 3 (PyTorch) – ${rt.detail}`, sizeBytes: 0 })
  const spec = CATALOG.find((c) => c.id === V3_EMBED_MODEL.id)
  if (!spec) out.push({ id: V3_EMBED_MODEL.id, name: V3_EMBED_MODEL.id, sizeBytes: 0 })
  else if (!(await assets.isInstalled(V3_EMBED_MODEL.id))) out.push({ id: spec.id, name: spec.name, sizeBytes: spec.files.reduce((n, f) => n + f.size, 0) })
  // Audio+Video-Prüfung (MiniCPM-o) und zeitliche Verortung (Lighthouse): eigene Umgebung + eigene Modelle (Pflicht; kein stiller Ersatz)
  const av = await avRuntimeStatus()
  if (av.state !== 'ready') out.push({ id: V3_AV_ASSET, name: `AV-Laufzeit für Engine 3 (MiniCPM-o, Lighthouse) – ${av.detail}`, sizeBytes: 0 })
  for (const id of [V3_AV_MODEL.id, ...(Object.values(V3_PROFILE_CONFIG).some((c) => c.temporal) ? [V3_TEMPORAL_MODEL.id] : [])]) {
    const sp = CATALOG.find((c) => c.id === id)
    if (!sp) out.push({ id, name: id, sizeBytes: 0 })
    else if (!(await assets.isInstalled(id))) out.push({ id: sp.id, name: sp.name, sizeBytes: sp.files.reduce((n, f) => n + f.size, 0) })
  }
  // Ersatzprüfer (Qwen3-VL-4B, Voxtral) und die Modelle für Text/Naht kommen von Engine 2
  out.push(...(await v2MissingModels()))
  return out
}
