import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app } from 'electron'
import { dataRoot } from '../engines/paths'
import { assets } from '../engines'
import { writeFileAtomic } from '../shortme/atomic'
import { MAX_ALTERNATIVES, type CatalogModel, type CatalogSlot, type Measured, type ModelStatus, type ModelsView, type ModelView } from '../../shared/models'

interface Catalog { _info?: string; slots: CatalogSlot[]; models: CatalogModel[] }
interface State {
  /** Aktives Modell je Platz (Entscheidung im Testlab). */
  active: Record<string, string>
  /** Zum Entfernen markierte Modelle. */
  remove: string[]
  measured: Record<string, Measured>
}

const stateFile = (): string => join(dataRoot(), 'models-state.json')
export const catalogPath = (): string => (app?.isPackaged ? join(process.resourcesPath, 'models-catalog.json') : join(process.env.SHORTME_PROMPTS ?? process.cwd(), 'resources/models-catalog.json'))

export async function loadCatalog(): Promise<Catalog> { return JSON.parse(await readFile(catalogPath(), 'utf8')) as Catalog }
export async function loadState(): Promise<State> {
  try { const s = JSON.parse(await readFile(stateFile(), 'utf8')) as Partial<State>; return { active: s.active ?? {}, remove: s.remove ?? [], measured: s.measured ?? {} } } catch { return { active: {}, remove: [], measured: {} } }
}
const saveState = (s: State): Promise<void> => writeFileAtomic(stateFile(), JSON.stringify(s, null, 1))

/** Wirksamer Status eines Modells: aktiv (Entscheidung oder Katalog-Grundzustand), zum Entfernen, Test (integrierte Alternative) oder Kandidat. */
export function effectiveStatus(m: CatalogModel, active: Record<string, string>, remove: string[], catalog: CatalogModel[]): ModelStatus {
  const act = active[m.slot] ?? catalog.find((x) => x.slot === m.slot && x.status === 'aktiv')?.id
  if (act === m.id) return 'aktiv'
  if (remove.includes(m.id)) return 'entfernen'
  return m.integrated ? 'test' : 'kandidat'
}

export async function modelsView(): Promise<ModelsView> {
  const [cat, st] = await Promise.all([loadCatalog(), loadState()])
  const active: Record<string, string> = {}
  for (const s of cat.slots) active[s.id] = st.active[s.id] ?? cat.models.find((m) => m.slot === s.id && m.status === 'aktiv')?.id ?? ''
  const models: ModelView[] = await Promise.all(cat.models.map(async (m) => ({ ...m, effective: effectiveStatus(m, st.active, st.remove, cat.models), measured: st.measured[m.id], installed: !m.assets?.length || (await Promise.all(m.assets.map((a) => assets.isInstalled(a).catch(() => false)))).every(Boolean) })))
  return { slots: cat.slots, models, active }
}

/** Aktives Modell eines Platzes – die Pipeline nutzt immer dieses. Ohne Katalog/Zustand: Standard. */
export async function activeModelId(slot: string): Promise<string> { try { return (await modelsView()).active[slot] ?? '' } catch { return '' } }

export async function recordMeasured(modelId: string, m: Measured): Promise<void> {
  const st = await loadState()
  st.measured[modelId] = m
  await saveState(st)
}

/** „Links/Rechts behalten“: `keep` wird aktiv, `drop` zum Entfernen markiert. Löscht keinen Code. */
export async function decide(slot: string, keep: string, drop: string): Promise<ModelsView> {
  const cat = await loadCatalog()
  const k = cat.models.find((m) => m.id === keep && m.slot === slot)
  const d = cat.models.find((m) => m.id === drop && m.slot === slot)
  if (!k?.integrated || !d || keep === drop) throw new Error('Ungültige Auswahl')
  const st = await loadState()
  st.active[slot] = keep
  st.remove = [...new Set([...st.remove.filter((x) => x !== keep), drop])]
  await saveState(st)
  await syncFiles().catch((e) => console.error('Katalog/Doku nachtragen:', e))
  return modelsView()
}

/** Höchstens zwei integrierte Alternativen je Platz (neben dem aktiven Modell). */
export function alternativesOk(models: CatalogModel[], slot: string, active: string): boolean {
  return models.filter((m) => m.slot === slot && m.integrated && m.id !== active).length <= MAX_ALTERNATIVES
}

const STATUS_DE: Record<ModelStatus, string> = { aktiv: 'aktiv', test: 'Test', entfernen: 'zum Entfernen', kandidat: 'Kandidat (nicht integriert)' }

/** docs/MODELS.md aus Katalog + Entscheidungen erzeugen. */
export function modelsMarkdown(cat: Catalog, st: State): string {
  const out = ['# Modelle und Plätze', '', 'Wird vom Testlab bzw. `scripts/sync-models-docs.ts` erzeugt – nicht von Hand ändern. Pro Platz ein aktives Modell, höchstens zwei integrierte Alternativen; die Pipeline nutzt immer das aktive Modell. „Zum Entfernen“ heißt: markiert, der Code ist noch da (Entfernen nur gezielt, nach Absprache).', '']
  for (const s of cat.slots) {
    out.push(`## ${s.name} (\`${s.id}\`)`, '', '| Modell | Zweck | Status |', '|---|---|---|')
    for (const m of cat.models.filter((x) => x.slot === s.id)) out.push(`| ${m.name} | ${m.short} | ${STATUS_DE[effectiveStatus(m, st.active, st.remove, cat.models)]} |`)
    out.push('')
  }
  return out.join('\n')
}

/** Entscheidungen in resources/models-catalog.json (Status) und docs/MODELS.md nachtragen – nur in der Entwicklungsumgebung (installierte App: nur Zustandsdatei). */
export async function syncFiles(root = process.cwd()): Promise<void> {
  if (app?.isPackaged) return
  const cat = await loadCatalog()
  const st = await loadState()
  for (const m of cat.models) m.status = effectiveStatus(m, st.active, st.remove, cat.models)
  await writeFile(join(root, 'resources/models-catalog.json'), JSON.stringify(cat, null, 2) + '\n', 'utf8')
  await writeFile(join(root, 'docs/MODELS.md'), modelsMarkdown(cat, st), 'utf8')
}
