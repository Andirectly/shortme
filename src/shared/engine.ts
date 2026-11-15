// Auswahl-Engines und Analyse-Läufe (Typen und reine Logik). Genau eine Engine ist je Analyselauf aktiv; die Ergebnisse jeder Engine bleiben erhalten.
// Zustand je Projekt: <Projekt>/analysis/state.json; Ergebnisse der neuen Engine je Lauf: <Projekt>/analysis/runs/<runId>/.
// Das bisherige Ergebnis (clips.json im Projektordner) gilt als Lauf `legacy` und wird von der neuen Engine nie angefasst.

export type SelectionEngineId = 'legacy' | 'multimodal-v2' | 'adaptive-v3'
export const ENGINE_IDS: SelectionEngineId[] = ['legacy', 'multimodal-v2', 'adaptive-v3']
export const ENGINE_LABEL: Record<SelectionEngineId, string> = { legacy: 'Engine 1 – Original', 'multimodal-v2': 'Engine 2 – Multimodal', 'adaptive-v3': 'Engine 3 – Adaptive AI' }
/** Kurzbeschreibung für den Erstellen-Dialog. */
export const ENGINE_BLURB: Record<SelectionEngineId, string> = {
  legacy: 'Liest das Transkript und die Ton-Markierungen (am schnellsten, keine zusätzlichen Modelle).',
  'multimodal-v2': 'Prüft Bild und Ton mit lokalen Modellen (Qwen3-VL, Voxtral) und vergleicht fertig geschnittene Varianten.',
  'adaptive-v3': 'Durchsucht das ganze Video semantisch (Bild-Embeddings), dazu Ton und Text, und prüft die Treffer wie Engine 2.'
}
/** Analyseprofile der Engine 3 (keine eigene Engine): Tiefe der Suche. */
export type V3Profile = 'fast' | 'balanced' | 'deep'
export const V3_PROFILES: V3Profile[] = ['fast', 'balanced', 'deep']
export const V3_PROFILE_LABEL: Record<V3Profile, string> = { fast: 'Schnell', balanced: 'Ausgewogen', deep: 'Gründlich' }
export const isV3Profile = (x: unknown): x is V3Profile => x === 'fast' || x === 'balanced' || x === 'deep'
export const LEGACY_RUN_ID = 'legacy'
export const V2_ENGINE_VERSION = '2.0.0'
export const V3_ENGINE_VERSION = '3.0.0'

export type RunStatus = 'running' | 'done' | 'incomplete' | 'failed' | 'stopped'

/** Zustand eines Beobachtungswegs im Lauf: wirklich geprüft, nur Signale, nicht verfügbar oder fehlgeschlagen. */
export type ModalityStatus = 'checked' | 'signal-only' | 'unavailable' | 'failed'

export interface RunInfo {
  runId: string
  engineId: SelectionEngineId
  engineVersion: string
  schema: number
  createdAt: string
  finishedAt?: string
  status: RunStatus
  /** Hash über Medienidentität, Transkript-/Signal-Revision, Optionen, Modelle und Prompt-/Algorithmusversion. */
  fingerprint: string
  /** Eingefrorene Analyseoptionen beim Jobstart. */
  options: { query: string; contentType: string | null; frame: string | null; wanted: number | null; minSec: number; maxSec: number; /** Nur Engine 3. */ profile?: V3Profile }
  /** Verwendete Modelle, Projektoren, Laufzeit und Promptrevisionen (Name → Bezeichner). */
  models: Record<string, string>
  modalities: Partial<Record<'text' | 'audio' | 'visual' | 'chat', ModalityStatus>>
  /** Anteil der Quellzeit, der tatsächlich untersucht wurde (0..1), und wie. */
  coverage?: { text: number; audio: number; visual: number }
  clipCount?: number
  error?: string
}

export interface AnalysisState {
  version: 1
  /** Gewählte Engine für den nächsten Lauf (Projektauswahl, bleibt nach dem Neustart erhalten). */
  selected: SelectionEngineId
  /** Der Lauf, dessen Clipliste gerade angezeigt wird. Getrennt von `selected` und vom laufenden Job: während ein Lauf rechnet, bleibt die bisherige Anzeige. */
  shown: string | null
  /** Zuletzt angezeigter Lauf je Engine (zum Zurückwechseln; null = noch keiner). */
  view: Record<SelectionEngineId, string | null>
  runs: RunInfo[]
}

export const emptyAnalysisState = (): AnalysisState => ({ version: 1, selected: 'legacy', shown: LEGACY_RUN_ID, view: { legacy: LEGACY_RUN_ID, 'multimodal-v2': null, 'adaptive-v3': null }, runs: [] })

const RUN_STATUS: RunStatus[] = ['running', 'done', 'incomplete', 'failed', 'stopped']
const isEngine = (x: unknown): x is SelectionEngineId => x === 'legacy' || x === 'multimodal-v2' || x === 'adaptive-v3'
export const isSafeRunId = (x: unknown): x is string => typeof x === 'string' && /^[a-z0-9][a-z0-9-]{0,40}$/.test(x)

/** Gespeicherte Datei prüfen (unbekannte Engine, kaputte Läufe → verworfen). Fehlt etwas, gilt Legacy. */
export function sanitizeAnalysisState(x: unknown): AnalysisState {
  const out = emptyAnalysisState()
  const o = x as Partial<AnalysisState> | null
  if (!o || typeof o !== 'object') return out
  if (isEngine(o.selected)) out.selected = o.selected
  if (Array.isArray(o.runs)) {
    for (const r of o.runs) {
      const run = r as Partial<RunInfo> | null
      if (!run || !isSafeRunId(run.runId) || !isEngine(run.engineId) || !RUN_STATUS.includes(run.status as RunStatus) || typeof run.fingerprint !== 'string') continue
      out.runs.push(run as RunInfo)
    }
  }
  for (const e of ENGINE_IDS) {
    const v = o.view?.[e]
    if (e === 'legacy') out.view.legacy = v === null ? null : LEGACY_RUN_ID
    else out.view[e] = typeof v === 'string' && out.runs.some((r) => r.runId === v && r.engineId === e) ? v : null
  }
  const sh = o.shown
  out.shown = sh === LEGACY_RUN_ID ? LEGACY_RUN_ID : typeof sh === 'string' && out.runs.some((r) => r.runId === sh) ? sh : sh === null ? null : LEGACY_RUN_ID
  return out
}

/** Lauf, dessen Clipliste angezeigt wird (null = keine). */
export const displayedRunId = (s: AnalysisState): string | null => s.shown

/** Engine, zu der ein Lauf gehört (`legacy` ist das bisherige Ergebnis im Projektordner). */
export const engineOfRun = (s: AnalysisState, runId: string | null): SelectionEngineId | null => (runId === LEGACY_RUN_ID ? 'legacy' : s.runs.find((r) => r.runId === runId)?.engineId ?? null)

/** Passendes fertiges Ergebnis der Engine zu denselben Eingaben (jüngster Lauf). */
export function findReusableRun(s: AnalysisState, engine: SelectionEngineId, fingerprint: string): RunInfo | null {
  return [...s.runs].filter((r) => r.engineId === engine && r.status === 'done' && r.fingerprint === fingerprint).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null
}

/** Kollisionsfreie, sichere Lauf-ID (nur a–z, 0–9, Bindestrich; nie vom Modell erzeugt). */
export function newRunId(rand: () => number = Math.random, now: () => number = Date.now, prefix: 'v2' | 'v3' = 'v2'): string {
  const r = Array.from({ length: 5 }, () => 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(rand() * 36)]).join('')
  return `${prefix}-${now().toString(36)}-${r}`
}

/** Clip-IDs der neuen Engine: eindeutig gegenüber alten (`clip-<zeit>`) und anderen Läufen. */
export const v2ClipId = (runId: string, n: number): string => `${runId}-c${n}`

/** Kurzer, stabiler Textfingerabdruck (FNV-1a, 53 Bit); für Cache-Schlüssel, nicht für Sicherheit. */
export function fingerprintOf(parts: Array<string | number | null | undefined>): string {
  const s = parts.map((p) => String(p ?? '')).join('␟')
  let h1 = 0xdeadbeef ^ 0, h2 = 0x41c6ce57 ^ 0
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677) }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)
}

/** Antwort von „Engine wählen“ (Main → Renderer). */
export type EngineSwitchResult =
  | { kind: 'shown'; state: AnalysisState }
  | { kind: 'started'; state: AnalysisState; jobId: string }
  | { kind: 'needs-models'; state: AnalysisState; missing: Array<{ id: string; name: string; sizeBytes: number }> }
  | { kind: 'busy'; state: AnalysisState }
