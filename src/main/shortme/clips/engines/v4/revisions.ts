// Engine 4: Versionen (gehen in Fingerabdruck und Run-Manifest ein) und Profilbudgets. Budgets sind Startwerte, nicht als optimal behauptet.
import type { V3Profile } from '../../../../../shared/engine'
import { V3_AV_MODEL, V3_EMBED_MODEL, V3_PROFILE_CONFIG, type V3ProfileConfig } from '../v3/revisions'
import { V2_MODELS, V2_PROMPT_REVISION } from '../v2/revisions'

export const V4_PIPELINE_VERSION = '4.0'
export const V4_ALGORITHM_REVISION = 'v4-algo-2'
export const V4_QUERYBANK_REVISION = 'v4-queries-1'
export const V4_PROMPT_REVISION = { investigator: 'v4-inv-3', cutJudge: 'v4-cut-2', finalJudge: 'v4-final-2' } as const
export const V4_EDGE_REVISION = 'v4-edges-1'

export interface V4Profile {
  /** Embedding-Index (Qwen3-VL-Embedding-2B), gleiche Fensterwerte wie Engine 3 → gemeinsamer, versionierter Cache. */
  embed: V3ProfileConfig
  /** Rohkandidaten je Suchweg (reserviert) und gesamt. */
  perLane: number
  seedsMax: number
  /** Nachuntersuchung: höchstens so viele Modellaufrufe je Seed; Zeitbudget je Seed. */
  investigatorCalls: number
  investigatorSecPerSeed: number
  /** Schnitt-Kandidaten je Ereignis, die der lokale Cut-Judge am echten Ausschnitt prüft. */
  cutCandidates: number
  /** Ereignisse, die gerendert und am fertigen Clip geprüft werden. */
  finalists: number
  /** Reparaturrunden je Clip (höchstens 2 laut Spezifikation). */
  repairs: number
}

export const V4_PROFILES: Record<V3Profile, V4Profile> = {
  fast: { embed: V3_PROFILE_CONFIG.fast, perLane: 3, seedsMax: 12, investigatorCalls: 2, investigatorSecPerSeed: 90, cutCandidates: 2, finalists: 6, repairs: 1 },
  balanced: { embed: V3_PROFILE_CONFIG.balanced, perLane: 5, seedsMax: 24, investigatorCalls: 4, investigatorSecPerSeed: 150, cutCandidates: 3, finalists: 10, repairs: 2 },
  deep: { embed: V3_PROFILE_CONFIG.deep, perLane: 8, seedsMax: 40, investigatorCalls: 5, investigatorSecPerSeed: 240, cutCandidates: 4, finalists: 16, repairs: 2 }
}

export const V4_MODELS = {
  asr: 'parakeet-v3 (sherpa-onnx, vorhandene Shortme-Transkription)',
  audioEvents: V2_MODELS.audioEvents,
  embedding: `${V3_EMBED_MODEL.id}@${V3_EMBED_MODEL.revision}`,
  av: `${V3_AV_MODEL.id}@${V3_AV_MODEL.revision}`,
  speechLane: `qwen3-14b llama-server (Textsuche ${V2_PROMPT_REVISION})`,
  fallbackVision: V2_MODELS.vision,
  fallbackAudio: V2_MODELS.audio
} as const

export const v4Revisions = (profile: V3Profile): string[] => [
  `pipeline:${V4_PIPELINE_VERSION}`, V4_ALGORITHM_REVISION, V4_QUERYBANK_REVISION, V4_EDGE_REVISION, ...Object.values(V4_PROMPT_REVISION), `profile:${profile}`,
  `embed:${V3_EMBED_MODEL.id}@${V3_EMBED_MODEL.revision.slice(0, 8)}`, `av:${V3_AV_MODEL.id}@${V3_AV_MODEL.revision.slice(0, 8)}`, `speech:${V2_PROMPT_REVISION}`, V2_MODELS.audioEvents
]
