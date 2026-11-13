// Pflicht-Modelle der neuen Engine (Katalog-IDs aus src/main/engines/catalog.ts). Fehlt eines, startet V2 nicht; die Oberfläche zeigt die Voraussetzung und führt zum Modell-Manager.
import { assets } from '../../../../engines'
import { CATALOG } from '../../../../engines/catalog'
import { V2_MODELS } from './revisions'

/** Rollen und die Assets, die sie brauchen (Modell + Projektor liegen im selben Katalog-Eintrag). */
export const V2_REQUIRED_ASSETS: string[] = [V2_MODELS.vision, V2_MODELS.audio, V2_MODELS.audioEvents, 'llama-server']

export async function v2MissingModels(): Promise<Array<{ id: string; name: string; sizeBytes: number }>> {
  const out: Array<{ id: string; name: string; sizeBytes: number }> = []
  for (const id of V2_REQUIRED_ASSETS) {
    const spec = CATALOG.find((c) => c.id === id)
    // Eintrag fehlt im Katalog (noch nicht eingerichtet) → als fehlend melden, nicht als „fertig“
    if (!spec) { out.push({ id, name: id, sizeBytes: 0 }); continue }
    if (!(await assets.isInstalled(id))) out.push({ id, name: spec.name, sizeBytes: spec.files.reduce((n, f) => n + f.size, 0) })
  }
  return out
}
