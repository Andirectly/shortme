// Dispatcher: genau eine Auswahl-Engine je Analyselauf, beim Jobstart festgelegt. Legacy ruft den bisherigen Algorithmus unverändert auf,
// die neue Engine (`v2/`) hat eigene Orchestrierung, Prompts und Datenverträge. Extraktion, Layout und Render bleiben gemeinsam.
import type { ShortmeClip } from '@shared/shortme'
import { assets, withLlm } from '../../../engines'
import { selectClips, type CandTrace, type SelectInput, type SelectOptions } from '../select'
import type { ModalityStatus, RunInfo, SelectionEngineId } from '../../../../shared/engine'
import { v2Revisions } from './v2/revisions'

export interface SelectionOutcome {
  clips: ShortmeClip[]
  mode: 'llm' | 'texttiling' | 'v2'
  /** Nur Legacy: Kandidaten-Spur für das Lernen. */
  trace?: CandTrace[]
  /** Nur V2: Angaben zum Lauf (Modalitäten, Abdeckung, Modelle). */
  run?: Partial<Pick<RunInfo, 'modalities' | 'coverage' | 'models' | 'status' | 'error'>> & { modalities?: Partial<Record<'text' | 'audio' | 'visual' | 'chat', ModalityStatus>> }
}

export interface SelectionRequest {
  engine: SelectionEngineId
  runId: string
  input: SelectInput
  options: Omit<SelectOptions, 'baseUrl'>
  noLlm?: boolean
  signal?: AbortSignal
  report: (stage: string, fraction: number, message: string) => void
  /** Projektdaten, die nur die neue Engine braucht. */
  project: { hash: string; sourcePath: string; durationSec: number; hasAudio: boolean }
}

/** Legacy: bisheriges Verfahren (LLM-Auswahl, bei fehlendem/fehlerhaftem Modell TextTiling). Ergebnis und Ablauf unverändert. */
async function selectLegacy(req: SelectionRequest): Promise<SelectionOutcome> {
  let trace: CandTrace[] = []
  const options = { ...req.options, trace: (rows: CandTrace[]) => { trace = rows } }
  const llmReady = !req.noLlm && (await assets.isInstalled('llama-server'))
  if (!llmReady) return { clips: await selectClips(req.input, { ...options, baseUrl: null }), mode: 'texttiling', trace }
  try {
    return { clips: await withLlm((url) => selectClips(req.input, { ...options, baseUrl: url })), mode: 'llm', trace }
  } catch (e) {
    if (req.signal?.aborted) throw e
    req.report('llm', 0, `KI nicht verfügbar (${e instanceof Error ? e.message.slice(0, 80) : e}) – Fallback`)
    return { clips: await selectClips(req.input, { ...options, baseUrl: null }), mode: 'texttiling', trace }
  }
}

/** Modell-/Prompt-/Algorithmusversionen der Engine für den Eingabefingerabdruck (Legacy: keine, sein Ergebnis hängt nicht an solchen Revisionen). */
export function engineRevisions(engine: SelectionEngineId): string[] {
  return engine === 'multimodal-v2' ? v2Revisions() : []
}

export async function runSelection(req: SelectionRequest): Promise<SelectionOutcome> {
  if (req.engine === 'multimodal-v2') {
    const { selectV2 } = await import('./v2')
    return selectV2(req)
  }
  return selectLegacy(req)
}
