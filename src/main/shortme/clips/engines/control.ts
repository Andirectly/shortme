// Steuerung der Engine-Wahl im Main-Prozess: Standard für neue Projekte, Fingerabdruck der Eingaben und die Entscheidung „anzeigen / starten / blockieren“.
// Der Renderer zeigt nur an; hier wird entschieden, damit mehrere Fenster, Doppelklicks und IPC-Wiederholungen keine konkurrierenden Analysen erzeugen.
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { dataRoot } from '../../../engines/paths'
import { writeFileAtomic } from '../../atomic'
import { loadMeta, type ProjectMeta } from '../../project'
import { ENGINE_IDS, LEGACY_RUN_ID, enginesFor, V2_ENGINE_VERSION, fingerprintOf, type AnalysisState, type EngineSwitchResult, type SelectionEngineId } from '../../../../shared/engine'
import { clipsPathFor, loadState, setSelected, showRun, stopStaleRuns } from './state'
import { existsSync } from 'node:fs'
import { loadProfile } from '../../profiles'
import type { ContentType } from '../../../../shared/videoKind'

const defaultFile = (): string => join(dataRoot(), 'engine-default.json')

/** Standard-Engine für neue Projekte (zunächst Engine 3, bis der Nutzer etwas anderes wählt). */
/** Nur die Engines dieses Systems (Windows: 1–4, Mac: Engine Mac) – die Grenze gilt auch im Hauptprozess, nicht nur in der Oberfläche. */
export const isLocalEngine = (e: unknown): e is SelectionEngineId => enginesFor(process.platform).includes(e as SelectionEngineId)

export async function loadDefaultEngine(): Promise<SelectionEngineId> {
  // Mac: Engine Mac bleibt Standard, eine ausdrücklich gespeicherte Wahl (z. B. Engine 6) wird aber nicht still überschrieben
  const fallback: SelectionEngineId = process.platform === 'darwin' ? 'engine-mac' : 'adaptive-v3'
  try { const e = (JSON.parse(await readFile(defaultFile(), 'utf8')) as { engine?: unknown }).engine; return isLocalEngine(e) ? e : fallback } catch { return fallback }
}
export async function saveDefaultEngine(engine: SelectionEngineId): Promise<SelectionEngineId> {
  if (!isLocalEngine(engine)) throw new Error('Diese Engine läuft auf diesem System nicht')
  await writeFileAtomic(defaultFile(), JSON.stringify({ engine }))
  return engine
}

export interface FingerprintInput {
  hash: string
  engine: SelectionEngineId
  transcriptVersion: number
  wordCount: number
  asrModel: string
  query?: string
  contentType?: string | null
  frame?: string | null
  wanted?: number | null
  /** Modelle, Projektoren, Runtime und Promptrevisionen der Engine. */
  revisions?: string[]
}

/** Eingabefingerabdruck: Medienidentität, Transkript, Optionen, Engine-/Prompt-/Modellversionen. Ändert sich ein Teil, passt ein altes Ergebnis nicht mehr. */
export const analysisFingerprint = (i: FingerprintInput): string =>
  fingerprintOf([i.hash, i.transcriptVersion, i.wordCount, i.asrModel, i.engine, i.engine === 'legacy' ? '' : V2_ENGINE_VERSION, i.query ?? '', i.contentType ?? '', i.frame ?? '', i.wanted ?? '', ...(i.revisions ?? [])])

export interface SwitchRequest {
  hash: string
  engine: SelectionEngineId
  query?: string
  contentType?: string | null
  frame?: string | null
  wanted?: number | null
  /** Nur Engine 3: Profil für einen neuen Lauf. */
  profile?: string | null
}

export interface SwitchDeps {
  /** Läuft oder wartet für dieses Projekt ein Analysejob? */
  hasActiveJob: (hash: string) => boolean
  /** Fehlende Pflicht-Modelle der Engine (leer = bereit). */
  missingModels: (engine: SelectionEngineId) => Promise<Array<{ id: string; name: string; sizeBytes: number }>>
  /** Revisionen (Modelle/Prompts) der Engine für den Fingerabdruck. */
  revisions: (engine: SelectionEngineId) => string[]
  /** Analyse der Engine starten (synchron in die Warteschlange); liefert die Job-ID. Die Anfrage enthält die wirksamen Werte. */
  start: (req: SwitchRequest, meta: ProjectMeta) => string
}

const starting = new Set<string>()
/** Projekt für einen Start reservieren (genau ein Start gleichzeitig, auch bei Doppelklick, IPC-Wiederholung und mehreren Fenstern). `null` = schon reserviert. */
export function claimProject(hash: string): (() => void) | null {
  if (starting.has(hash)) return null
  starting.add(hash)
  return () => { starting.delete(hash) }
}

/**
 * Engine für ein Projekt wählen. Genau eine Entscheidung je Aufruf:
 * - busy: Es läuft schon etwas (Job oder gleichzeitiger Aufruf) – nichts wird verändert.
 * - shown: Passendes Ergebnis dieser Engine ist vorhanden und wird angezeigt (ohne Transkription oder Auswahl).
 * - needs-models: Pflicht-Modelle fehlen; die Auswahl bleibt gesetzt, es wird nichts gestartet und nicht still auf eine andere Engine gewechselt.
 * - started: Lauf wurde gestartet; bisherige Ergebnisse bleiben bis zu den ersten Clips des neuen Laufs sichtbar.
 */
export async function switchEngine(req: SwitchRequest, deps: SwitchDeps): Promise<EngineSwitchResult> {
  const { hash, engine } = req
  if (!ENGINE_IDS.includes(engine)) throw new Error('Unbekannte Engine')
  if (!isLocalEngine(engine)) throw new Error('Diese Engine läuft auf diesem System nicht')
  const release = claimProject(hash)
  if (!release || deps.hasActiveJob(hash)) { release?.(); return { kind: 'busy', state: await loadState(hash) } }
  try {
    const meta = await loadMeta(hash)
    if (!meta) throw new Error('Projekt nicht gefunden')
    let state: AnalysisState = await stopStaleRuns(hash) // „running“ ohne Job kann nicht stimmen (Absturz, Neustart)
    state = await setSelected(hash, engine)
    // Wirksame Werte festlegen (wie der Lauf sie benutzt): fehlender Typ/Ausschnitt = Projektwert bzw. Standard des Inhaltstyp-Profils
    const contentType = (req.contentType ?? meta.contentType ?? undefined) as ContentType | undefined
    const frame = req.frame ?? (await loadProfile(contentType)).frame
    req = { ...req, contentType: contentType ?? null, frame }
    if (engine === 'legacy') {
      if (existsSync(clipsPathFor(hash, LEGACY_RUN_ID))) return { kind: 'shown', state: await showRun(hash, LEGACY_RUN_ID) }
    } else {
      // Engine-Wechsel zeigt das zuletzt fertige Ergebnis dieser Engine an (zuerst das zuletzt angezeigte), ohne neue Berechnung.
      // Geänderte Optionen (Suchwunsch, Typ, Anzahl) wirken erst bei „Neu berechnen“, nicht beim bloßen Wechseln.
      const done = state.runs.filter((r) => r.engineId === engine && (r.status === 'done' || r.status === 'incomplete') && existsSync(clipsPathFor(hash, r.runId)))
      const run = done.find((r) => r.runId === state.view[engine]) ?? [...done].sort((x, y) => y.createdAt.localeCompare(x.createdAt))[0]
      if (run) return { kind: 'shown', state: await showRun(hash, run.runId) }
    }
    const missing = await deps.missingModels(engine)
    if (missing.length) return { kind: 'needs-models', state, missing }
    return { kind: 'started', state, jobId: deps.start(req, meta) }
  } finally { release() }
}
