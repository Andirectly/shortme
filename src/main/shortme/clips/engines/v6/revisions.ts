// Engine 6 – eingefrorene Revisionen (Fingerabdruck der Läufe, Cache-Schlüssel). Ändert sich eine, passt ein altes Ergebnis nicht mehr.
import { V2_PROMPT_REVISION } from '../v2/revisions'
import { V3_AV_MODEL, V3_EMBED_MODEL, MAC_AV_MODEL } from '../v3/revisions'
import { V6_RANK_PROMPT } from './editorial'
import { V6_PLAN_REVISION } from './plan'
import { V6_AUDIT_REVISION } from './audit'
import { V6_EXTRACTOR_REVISION, V6_SIGNATURE_REVISION } from './visualIndex'

export const V6_PIPELINE_VERSION = '6.0'
export const V6_ALGORITHM_REVISION = 'v6-alg-1'

/** Zentrale Budgets (Startprofil für 5 Wunsch-Clips, skaliert mit der Wunschzahl); im Manifest und in den Schlüsseln erfasst. */
export const V6_BUDGET = {
  poolMin: 15, poolMax: 24, poolPerWanted: 3,
  reserves: 2, wordlessSlots: 2,
  invCallsPerCandidate: 2, invSecPerCandidate: 120,
  repairsPerClip: 1, repairsGlobalPerWanted: 1,
  rankGroup: 6, rankMaxChars: 22000,
  cutCandidates: 2
}

/** Redundanzreduktion in den AV-Prüfpaketen (P0-Mechanismus): Standard nur nach Messung aktiv (docs/ENGINE_V6_DECISIONS.md). */
export const V6_AV_DEDUPE: { threshold: number; maxGapSec: number } | null = null

/** Bildindex: Einzeldecode, 448 px (gemessen: 320 px spart keine Zeit und verschlechtert Treffer), Redundanzreduktion AUS (gemessen: schlechtere Treffer). */
export const V6_INDEX = { windowSec: 8, hopSec: 8, frames: 4, frameWidth: 448, dedupe: false, sameThreshold: 0.035, maxGapSec: 40 }

export const v6Revisions = (platform: string = process.platform): string[] => [
  `pipeline:${V6_PIPELINE_VERSION}`, V6_ALGORITHM_REVISION, V6_RANK_PROMPT, V6_PLAN_REVISION, V6_AUDIT_REVISION, V6_EXTRACTOR_REVISION, V6_SIGNATURE_REVISION,
  `speech:${V2_PROMPT_REVISION}`, `embed:${V3_EMBED_MODEL.id}@${V3_EMBED_MODEL.revision.slice(0, 8)}`,
  platform === 'darwin' ? `av:${MAC_AV_MODEL.id}@${MAC_AV_MODEL.revision.slice(0, 8)}` : `av:${V3_AV_MODEL.id}@${V3_AV_MODEL.revision.slice(0, 8)}`,
  `index:${V6_INDEX.frameWidth}/${V6_INDEX.dedupe ? 'dedupe' : 'full'}`, `avdedupe:${V6_AV_DEDUPE ? JSON.stringify(V6_AV_DEDUPE) : 'off'}`, `budget:${JSON.stringify(V6_BUDGET)}`
]
