// Engine Mac 2: Versionen und Modelle (gehen in Fingerabdruck und Run-Manifest ein). Leichtes Modul, damit der Dispatcher nicht den ganzen Ablauf lädt.
import { V3_EMBED_MODEL, MAC_AV_MODEL } from '../v3/revisions'
import { SOUND_REVISION } from '../mac/sound'
import { MAC_LFM, MAC_QWEN, MLX_RUNTIME } from './mlxServer'
import { OBSERVE_PROMPT_REVISION } from './observe'
import { DIRECTOR_PROMPT_REVISION } from './director'

export const MAC2_PIPELINE_VERSION = 'mac-2.0'
export const MAC2_ALGORITHM_REVISION = 'mac2-algo-1'
export const MAC2_MODELS = {
  asr: 'parakeet-v3 (sherpa-onnx, vorhandene Shortme-Transkription)',
  audioEvents: `apple-soundanalysis ${SOUND_REVISION}`,
  embedding: `${V3_EMBED_MODEL.id}@${V3_EMBED_MODEL.revision} (PyTorch MPS)`,
  observer: `${MAC_LFM.repo}@${MAC_LFM.revision} (${MLX_RUNTIME})`,
  director: `${MAC_QWEN.repo}@${MAC_QWEN.revision} (${MLX_RUNTIME})`,
  fallback: `${MAC_AV_MODEL.id}@${MAC_AV_MODEL.revision} (nur gezielte Rückfragen)`
} as const
export const mac2Revisions = (): string[] => [`pipeline:${MAC2_PIPELINE_VERSION}`, MAC2_ALGORITHM_REVISION, OBSERVE_PROMPT_REVISION, DIRECTOR_PROMPT_REVISION, `observer:${MAC_LFM.revision.slice(0, 8)}`, `director:${MAC_QWEN.revision.slice(0, 8)}`, `embed:${V3_EMBED_MODEL.revision.slice(0, 8)}`, SOUND_REVISION]

