// Analyse-Zustand je Projekt (<Projekt>/analysis/state.json) und Pfade der Läufe. Lesen-Ändern-Schreiben läuft je Projekt nacheinander (keine verlorenen Updates).
import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { writeFileAtomic } from '../../atomic'
import { projectFile } from '../../project'
import { emptyAnalysisState, isSafeRunId, LEGACY_RUN_ID, sanitizeAnalysisState, type AnalysisState, type RunInfo, type SelectionEngineId } from '../../../../shared/engine'

const stateFile = (hash: string): string => projectFile(hash, 'analysis/state.json')

/** Ordner eines Laufs der neuen Engine; ungültige IDs werden nie zu Pfaden. */
export function runDir(hash: string, runId: string): string {
  if (runId === LEGACY_RUN_ID || !isSafeRunId(runId)) throw new Error(`Ungültige Lauf-ID: ${runId}`)
  return projectFile(hash, `analysis/runs/${runId}`)
}
export const runFile = (hash: string, runId: string, name: string): string => join(runDir(hash, runId), name)

/** Wo die Clipliste eines Laufs liegt: Legacy = clips.json im Projektordner, sonst im Lauf-Ordner. */
export const clipsPathFor = (hash: string, runId: string): string => (runId === LEGACY_RUN_ID ? projectFile(hash, 'clips.json') : runFile(hash, runId, 'clips.json'))

export async function loadState(hash: string): Promise<AnalysisState> {
  try { return sanitizeAnalysisState(JSON.parse(await readFile(stateFile(hash), 'utf8'))) } catch { return emptyAnalysisState() }
}

const chains = new Map<string, Promise<unknown>>()
/** Zustand atomar ändern: je Projekt nacheinander, Ergebnis wird geschrieben und zurückgegeben. */
export function updateState(hash: string, fn: (s: AnalysisState) => void): Promise<AnalysisState> {
  const prev = chains.get(hash) ?? Promise.resolve()
  const next = prev.then(async () => {
    const s = await loadState(hash)
    fn(s)
    const clean = sanitizeAnalysisState(s)
    await mkdir(join(stateFile(hash), '..'), { recursive: true })
    await writeFileAtomic(stateFile(hash), JSON.stringify(clean, null, 1))
    return clean
  })
  chains.set(hash, next.catch(() => undefined))
  return next
}

export const setSelected = (hash: string, engine: SelectionEngineId): Promise<AnalysisState> => updateState(hash, (s) => { s.selected = engine })

/** Anzeige auf einen Lauf stellen (muss es geben; `legacy` immer). Merkt ihn als „zuletzt angezeigt“ seiner Engine. */
export const showRun = (hash: string, runId: string): Promise<AnalysisState> => updateState(hash, (s) => {
  if (runId === LEGACY_RUN_ID) { s.shown = LEGACY_RUN_ID; s.view.legacy = LEGACY_RUN_ID; return }
  const r = s.runs.find((x) => x.runId === runId)
  if (!r) return
  s.shown = runId
  s.view[r.engineId] = runId
})

/** Neuen Lauf eintragen; hängengebliebene („running“ ohne laufenden Job) werden dabei als unterbrochen markiert. */
export const registerRun = (hash: string, run: RunInfo): Promise<AnalysisState> => updateState(hash, (s) => {
  for (const r of s.runs) if (r.status === 'running') { r.status = 'stopped'; r.error = 'Unterbrochen'; r.finishedAt = new Date().toISOString() }
  s.runs.push(run)
})

export const patchRun = (hash: string, runId: string, patch: Partial<RunInfo>): Promise<AnalysisState> => updateState(hash, (s) => {
  const r = s.runs.find((x) => x.runId === runId)
  if (r) Object.assign(r, patch)
})

/** Nach App-Start/ohne laufenden Job: „running“ kann nicht mehr stimmen. */
export const stopStaleRuns = (hash: string): Promise<AnalysisState> => updateState(hash, (s) => {
  for (const r of s.runs) if (r.status === 'running') { r.status = 'stopped'; r.error = 'Unterbrochen'; r.finishedAt = new Date().toISOString() }
})
