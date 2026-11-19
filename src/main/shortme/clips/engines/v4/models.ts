// Pflichtvoraussetzungen der Engine 4 (keine stille Rückstufung): Python-Umgebungen, Embedding-Modell, MiniCPM-o, YAMNet, LLM für die Sprach-Lane.
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { assets } from '../../../../engines'
import { dataRoot } from '../../../../engines/paths'
import { CATALOG } from '../../../../engines/catalog'
import { avRuntimeStatus, runtimeStatus } from '../v3/runtime'
import { V3_AV_ASSET, V3_PYTHON_ASSET } from '../v3/models'

const REQUIRED = ['qwen3-vl-embedding-2b', 'minicpm-o-4_5', 'yamnet', 'llama-server', 'qwen3-14b']

/** Abschaltbar (V4-002): SHORTME_ENGINE4=off oder Datei <Daten>/engine4.disabled. */
export function engine4Enabled(): boolean {
  return process.env.SHORTME_ENGINE4 !== 'off' && !existsSync(join(dataRoot(), 'engine4.disabled'))
}

export async function v4MissingModels(): Promise<Array<{ id: string; name: string; sizeBytes: number }>> {
  const out: Array<{ id: string; name: string; sizeBytes: number }> = []
  if (!engine4Enabled()) out.push({ id: 'engine4-disabled', name: 'Engine 4 ist ausgeschaltet (SHORTME_ENGINE4=off oder engine4.disabled)', sizeBytes: 0 })
  const rt = await runtimeStatus()
  if (rt.state !== 'ready') out.push({ id: V3_PYTHON_ASSET, name: `Python-Laufzeit (Embedding) – ${rt.detail}`, sizeBytes: 0 })
  const av = await avRuntimeStatus()
  if (av.state !== 'ready') out.push({ id: V3_AV_ASSET, name: `AV-Laufzeit (MiniCPM-o) – ${av.detail}`, sizeBytes: 0 })
  for (const id of REQUIRED) {
    const sp = CATALOG.find((c) => c.id === id)
    if (!sp) { out.push({ id, name: id, sizeBytes: 0 }); continue }
    if (!(await assets.isInstalled(id))) out.push({ id, name: sp.name, sizeBytes: sp.files.reduce((n, f) => n + f.size, 0) })
  }
  return out
}

