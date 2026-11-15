// Versionen der Engine 3: gehen in den Eingabefingerabdruck ein. Ändert sich Modell, Anfragen, Prompts oder Algorithmus, passt ein altes Ergebnis nicht mehr.
import { V2_ALGORITHM_REVISION, V2_MODELS, V2_PROMPT_REVISION } from '../v2/revisions'
import type { V3Profile } from '../../../../../shared/engine'

export const V3_ALGORITHM_REVISION = 'algo-3.0'
export const V3_QUERYSET_REVISION = 'queries-v1'
export const V3_EXTRACTOR_REVISION = 'frames-v1'
/** Fest gebundene Revision des Embedding-Modells (Katalog: src/main/engines/catalog.ts). */
export const V3_EMBED_MODEL = { id: 'qwen3-vl-embedding-2b', revision: '9f2f7e710d6d81056aa5c0a4f04764fec6bb7bda', license: 'Apache-2.0 (Modellkarte)' } as const
export const V3_EMBED_CODE = { repo: 'https://github.com/QwenLM/Qwen3-VL-Embedding', commit: '393e2978d27852b0d0230d6994f37f9c15bed73c', license: 'Apache-2.0' } as const

/** Abtast- und Budgetgrenzen je Profil (Startwerte, nicht als optimal behauptet). */
export interface V3ProfileConfig { windowSec: number; hopSec: number; frames: number; frameWidth: number; queries: number; detailMax: number; finalists: number }
export const V3_PROFILE_CONFIG: Record<V3Profile, V3ProfileConfig> = {
  fast: { windowSec: 12, hopSec: 12, frames: 4, frameWidth: 448, queries: 6, detailMax: 24, finalists: 14 },
  balanced: { windowSec: 8, hopSec: 8, frames: 4, frameWidth: 448, queries: 10, detailMax: 50, finalists: 24 },
  deep: { windowSec: 8, hopSec: 4, frames: 6, frameWidth: 448, queries: 14, detailMax: 80, finalists: 32 }
}

export const v3Revisions = (profile: V3Profile): string[] => [
  V3_ALGORITHM_REVISION, V3_QUERYSET_REVISION, V3_EXTRACTOR_REVISION, `embed:${V3_EMBED_MODEL.id}@${V3_EMBED_MODEL.revision.slice(0, 8)}`, `profile:${profile}`,
  // Redaktioneller Teil und Prüfer sind die von Engine 2 (transparent als Kompatibilitätspfad geführt)
  `compat:${V2_ALGORITHM_REVISION}`, `compat:${V2_PROMPT_REVISION}`, V2_MODELS.vision, V2_MODELS.audio, V2_MODELS.audioEvents
]
