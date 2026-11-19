// Dispatcher: genau eine Auswahl-Engine je Analyselauf, beim Jobstart festgelegt. Legacy ruft den bisherigen Algorithmus unverändert auf,
// die neue Engine (`v2/`) hat eigene Orchestrierung, Prompts und Datenverträge. Extraktion, Layout und Render bleiben gemeinsam.
import type { ShortmeClip } from '@shared/shortme'
import { assets, hardware, withLlm } from '../../../engines'
import { selectClips, type CandTrace, type SelectInput, type SelectOptions } from '../select'
import type { ModalityStatus, RunInfo, SelectionEngineId, V3Profile } from '../../../../shared/engine'
import { v2Revisions } from './v2/revisions'
import { v3Revisions } from './v3/revisions'
import { v4Revisions } from './v4/revisions'
import { mac2Revisions } from './mac2/revisions'

export interface SelectionOutcome {
  clips: ShortmeClip[]
  mode: 'llm' | 'texttiling' | 'v2' | 'v3' | 'v4'
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
  /** Nur Engine 3: Analyseprofil (Schnell/Ausgewogen/Gründlich), beim Jobstart eingefroren. */
  profile?: V3Profile
  /** Inhaltstyp des Videos (steuert u. a. die Bewertungsart der neuen Engine). */
  contentType?: string | null
  signal?: AbortSignal
  report: (stage: string, fraction: number, message: string) => void
  /** Projektdaten, die nur die neue Engine braucht. */
  project: { hash: string; sourcePath: string; durationSec: number; hasAudio: boolean }
}

/** Legacy: bisheriges Verfahren (LLM-Auswahl, bei fehlendem/fehlerhaftem Modell TextTiling). Ergebnis und Ablauf unverändert. */
async function selectLegacy(req: SelectionRequest): Promise<SelectionOutcome> {
  let trace: CandTrace[] = []
  // Qwen3-8B (16-GB-Macs, kleine GPUs) wählte bei ~3000 Wörtern je Fenster nur Stellen aus dem ersten Drittel → kürzere Fenster
  const small = (await hardware()).recommendedLlm === 'qwen3-8b'
  const options = { ...req.options, ...(small ? { windowWords: 1200 } : {}), trace: (rows: CandTrace[]) => { trace = rows } }
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
export function engineRevisions(engine: SelectionEngineId, profile: V3Profile = 'balanced'): string[] {
  return engine === 'multimodal-v2' ? v2Revisions() : engine === 'adaptive-v3' ? v3Revisions(profile) : engine === 'engine4' ? v4Revisions(profile) : engine === 'engine-mac' ? mac2Revisions() : []
}

export async function runSelection(req: SelectionRequest): Promise<SelectionOutcome> {
  if (req.engine === 'multimodal-v2') {
    const { selectV2 } = await import('./v2')
    return selectV2(req)
  }
  if (req.engine === 'adaptive-v3') {
    const { selectV3 } = await import('./v3')
    return selectV3(req)
  }
  if (req.engine === 'engine4') {
    // Eigener Orchestrator (v4/), ruft weder runPipeline (Engine 2/3) noch selectV3 auf
    const { selectV4 } = await import('./v4')
    return selectV4(req)
  }
  if (req.engine === 'engine-mac') {
    // Standard auf dem Mac: eigener Ablauf (LFM3-Omni beobachtet, Qwen3.5 plant und prüft); keine Weiterleitung an Engine 4
    const { selectMac2 } = await import('./mac2')
    return selectMac2(req)
  }
  return selectLegacy(req)
}
