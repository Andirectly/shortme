# 05 — Model roles, realistic candidates and data contracts

## Candidate matrix (not installed, not performance tested)

| Task | First Mac candidate | Reason / boundary | 16 GiB rule |
|---|---|---|---|
| ASR DE+EN | [FluidAudio](https://github.com/FluidInference/FluidAudio), **Parakeet Ultra** (Core ML) first; v3/Redux challengers | Native Swift; Sep. 2026 Ultra improved published FLEURS aggregate WER vs v3; verify DE/EN on creator audio and word timing rather than assume perfect alignment | stream audio, unload prior to VLM |
| ASR alternative | [Argmax WhisperKit](https://github.com/argmaxinc/argmax-oss-swift) compressed large-v3 Turbo; incremental audio loading | Mature local Apple path; benchmark DE/EN proper nouns, speech overlap, word timestamps | prefer incremental disk-backed transcribe; one model |
| Speech activity/diarization | FluidAudio VAD and diarizer only if required | Diarization varies by model and license; don't infer speaker from face alone | VAD cheap; diarization on demand |
| Semantic video retrieval **strict V4 path** | [Qwen3-VL-Embedding-2B](https://github.com/QwenLM/Qwen3-VL-Embedding) via [mlx-swift-Qwen3-VL-Embedding](https://github.com/mnmly/mlx-swift-Qwen3-VL-Embedding); fallback [mlx-embeddings](https://github.com/Blaizzy/mlx-embeddings) | Exact checkpoint has an existing third-party native Swift/MLX port (and Python MLX loader). **Compatibility, correctness and memory are not yet verified on a real 16 GiB Mac**; temporal video retrieval still needs timestamped-frame tests | Prove actual image embeddings, query similarity, measured 16 GiB peak, full-video timestamp retrieval and load/unload; else block strict V4 parity |
| Local semantic text + cut judge | [MLX Swift LM](https://github.com/ml-explore/mlx-swift-lm) with suitable quantized 2–4B **if empirically admitted** | Local schema-constrained decisions; model choice by tests, not parameter count alone | bounded KV context, release model after stage |
| Visual context judge | [MLX Swift VLM](https://github.com/ml-explore/mlx-swift-examples), e.g. compatible 2–3B quantized VLM **if tested** | Look at actual frames/short clips; log frame references. Not all models support full native video encoding | serial frame batches, true decoded images |
| Audio+visual verification | tested native audio event adapter + true video inspector, with temporal matching | Two modalities separately = `dual-modality-verification`; **not** a single end-to-end audio-video foundation model | keep no huge 9B AV model as default |
| Tracking/reframe | Apple Vision + Core Image/AVFoundation | Full native pipeline, crop ROI and safe zone tests | bounded frames, render via encoder |
| Media | AVFoundation, VideoToolbox, optional licensed pinned FFmpeg/ffprobe | Handle timestamps, VFR, multiple streams and actual A/V pass | don't decode hour-long source fully to RAM |

Avoid claiming "larger model = more viral". Model scoring is a relative internal ranking, not an objective virality prediction. User's Mac chip exact M-family isn't known; 16 GiB alone does not certify any checkpoint.

## Common schema elements (mirror existing repo where possible)

```ts
type MacEngineId = 'macNative'; // final value must follow actual registry conventions
type RunKind = 'full-source-analysis' | 'clip-recheck';
type Profile = 'auto' | 'fast' | 'balanced' | 'deep';
type CoverageState = 'inspected' | 'partial' | 'failed' | 'skipped';

interface MachineSample {
  appleSilicon: boolean; physicalMemoryBytes: string;
  metalName?: string; metalRecommendedWorkingSetBytes?: string;
  metalCurrentAllocatedBytes?: string;
  pressure: 'unknown'|'normal'|'warning'|'critical';
  thermal: 'unknown'|'nominal'|'fair'|'serious'|'critical';
  lowPower: boolean; sampledAt: string;
}
interface ModelDescriptor {
  modelId: string; sourceUrl: string; revision: string; weightSha256: string;
  codeLicense: string; weightLicense: string; modality: ('speech'|'audio'|'video'|'text')[];
  backend: 'coreml'|'mlx-swift'|'mlx-python'|'vision'|'traditional';
  observedPeakBytes?: string; testedHardware?: string;
}
interface MacRun {
  runId: string; projectId: string; engineId: MacEngineId;
  pipelineFamily: 'adaptive-event-intelligence'; pipelineVersion: string;
  runKind: RunKind; sourceSha256: string;
  source: {durationPts:string; timebaseNum:number; timebaseDen:number; mediaId:string};
  machine: MachineSample; selectedProfile: Profile; effectiveProfile: Exclude<Profile,'auto'>;
  modelSnapshots: ModelDescriptor[];
  status: 'queued'|'running'|'partial'|'paused'|'completed'|'cancelled'|'failed';
  parity: 'verified-v4'|'degraded'|'unverified';
}
interface SourceSpan {startPts:string; endPts:string; timebaseId:string}
interface Evidence {
  id:string; runId:string; modality:'speech'|'audio'|'video'|'chat'|'metadata';
  span:SourceSpan; state:'observed'|'inferred'|'unknown';
  framePts?:string[]; audioSampleRange?:[number,number]; wordIds?:string[];
  featureRevision:string; observation:string; modelId:string;
}
interface CandidateSeed {
  id:string; lane:'speech'|'audio'|'visual'|'cross-modal';
  anchorPts:string; span:SourceSpan; evidenceIds:string[];
}
interface CutEdge {id:string;pts:string;kind:string;evidenceIds:string[];isMeasured:boolean}
interface CutVariant {id:string;eventId:string;startEdgeId:string;endEdgeId:string;
  sourceTimeMapId:string; outputPts:string}
```

**Invariants:** `startPts < endPts` rational source time, no ungrounded `observed` evidence, no text-generated free timestamps, no fabricated evidence IDs, invalid structured model response → `unknown`/retry then fail clearly. Partial result explicitly recorded. Final AV judge must read actual encoded output file and output hash. User edits are not silently replaced.

## Local model installation / trust

- Installation is opt-in, in UI or explicit setup button; show download size, estimated memory, purpose, source/revision/license and disk footprint before downloading.
- Verify exact SHA256; signature/checkpoint trust policy; don't enable arbitrary downloaded Python model code without auditing/pinning. Mac app analyzers offline by default with network blocked test.
- License matrix must cover source code, weights, model card, data/terms, conversion/runtime, downloadable ffmpeg binary and assets, not merely GitHub root LICENSE. Shortcast/Clipmunk source licenses and every weight checkpoint need separate verification; **official Gemma 4 E2B/E4B model weights are Apache-2.0** (https://huggingface.co/google/gemma-4-E4B-it), unlike some earlier Gemma generations.
- A model can be technically compatible but not legally distributable; never bundle blocked/unclear weights in a commercial installer.
