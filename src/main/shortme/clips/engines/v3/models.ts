// Pflichtvoraussetzungen der Engine 3: gemanagte Python-Laufzeit, Embedding-Modell und (Kompatibilitätspfad für die Detailprüfung) die Modelle von Engine 2.
import { assets } from '../../../../engines'
import { CATALOG } from '../../../../engines/catalog'
import { v2MissingModels } from '../v2/models'
import { V3_EMBED_MODEL } from './revisions'
import { runtimeStatus } from './runtime'

export const V3_PYTHON_ASSET = 'python-runtime-v3'

export async function v3MissingModels(): Promise<Array<{ id: string; name: string; sizeBytes: number }>> {
  const out: Array<{ id: string; name: string; sizeBytes: number }> = []
  const rt = await runtimeStatus()
  if (rt.state !== 'ready') out.push({ id: V3_PYTHON_ASSET, name: `Python-Laufzeit für Engine 3 (PyTorch) – ${rt.detail}`, sizeBytes: 0 })
  const spec = CATALOG.find((c) => c.id === V3_EMBED_MODEL.id)
  if (!spec) out.push({ id: V3_EMBED_MODEL.id, name: V3_EMBED_MODEL.id, sizeBytes: 0 })
  else if (!(await assets.isInstalled(V3_EMBED_MODEL.id))) out.push({ id: spec.id, name: spec.name, sizeBytes: spec.files.reduce((n, f) => n + f.size, 0) })
  // Detailprüfung (Bild/Ton) läuft vorerst über die Modelle von Engine 2: sie müssen vorhanden sein
  out.push(...(await v2MissingModels()))
  return out
}
