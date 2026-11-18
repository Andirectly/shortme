# Research 11 — 16 GiB workload selection and real engine sequencing

This extends docs/03; it does **not** replace its memory safety policy.

## Principle

At 16 GiB maximize **completeness before concurrency**. Modes control depth, frame sampling and total elapsed time without silently eliminating independent visual/audio/spoken lanes. Stream media. Cache per-interval evidence and embeddings on disk. At cold start discover physical RAM, actual OS pressure, thermal/low power status, architecture, Metal device and working set (not 'free VRAM'), CPU/GPU. Profile must be re-evaluated after each major phase. Never hardcode availableMemory=physicalMemory.

### Stages / realistic native implementation

0. `ingest`: ffprobe/AVFoundation, streams, rotation, VFR and rational source timebase, source SHA, disk budget. No full-file in-memory decode.
1. `cheap_source_scan`: AVFoundation & Accelerate for sample-level energy, silence, pitch/spectral transients, Apple SoundAnalysis for laughter/applause/noise and 0.5s/2s windows, sampling on disk; shot/motion and Vision face hints. Coverage of full source with decile audit.
2. `asr`: Core ML FluidAudio **Parakeet Ultra** first, v3 and Redux A/B; optionally SpeechAnalyzer (macOS capabilities), WhisperKit fallback. Save time-stamped original words and *verified* alignment confidence; unload model after phase.
3. `visual_recall`: full-source temporal sampling plus Qwen3-VL-Embedding-2B on quantized batches (strict V4 compatibility PoC), save searchable index. No scenario where process silently substitutes text-only retrieval.
4. `visual_perception`: test Marlin-2B on decile, scene-change, audio-signal, ASR-candidate and low-prior visual-only windows; save dense captions + exact source frame PTS. Unload afterwards. On pressure, reduce batch size and sequentialize, not skip last deciles.
5. `candidate_fusion`: deterministic multi-lane temporal union: speech, audio, visual, cross-modal; hold quotas for the 4 lanes and diverse start/end; causal hypotheses labelled observed/inferred/unknown.
6. `investigator`: locally bound adjacent windows to confirm setup→trigger→reaction→payoff; Qwen3.5 4B / Gemma 4 E4B A/B; contextual analysis on shortlisted scenes only. Avoid all-long-video context and KV explosions.
7. `edge_judge`: choose only source-observed word/audio/visual edge IDs; compare alternatives; record source time maps.
8. `render`: AVFoundation/VideoToolbox or vetted FFmpeg; captions, sound, 9:16 tracking with face/speaker evidence; immutable source timeline, files on disk.
9. `output_final_judge`: re-open actual rendered MP4 and analyze rendered audio and frames, test black frames, silence, caption timing and cut/payoff; targeted repair. LLM's imagined evaluation is insufficient.

### Profile policy — only initial hypotheses; replace after benchmark

| Device | Selection approach | Not automatic |
|---|---|---|
| 8 GiB | serial ASR + SoundAnalysis + very small visual path; disk-backed scan; clear error if strict model cannot admit | Never label missing V4 lane full parity |
| 16 GiB | `balanced` serial large-model phases; 2B video + 4B judge only as separate phases; short frame/audio chunks; disk index | Never simultaneously hold Parakeet+Marlin+E4B+Embedding |
| 24–32 GiB | consider larger visual/judge batches if live pressure is low; optional 2 persistent models after measurements | Do not auto-use huge 12B just because it downloads |
| 64 GiB+ | deeper independent investigations, more frame budget, optional verified multi-model overlap | Still respect low-power/thermal/swap and 100% source coverage |

### Admission gate and monitor

- Each model manifest stores exact source, commit/revision, SHA256, accepted license, version, runtime, measured cold/warm **peak** on recorded Mac and batch/window/context settings. Unknown peak → proof run at bounded settings, never assume compatibility.
- Reserve OS/UI/video decode/caches/swap margin; the governor decides by **live measurement and conservative fallback**. Model quantized file bytes are not a prediction of process peak.
- On `critical` memory/thermal event: stop admitting new heavy tasks, atomically checkpoint current PTS/coverage, release model/KV/cache, synchronize Metal resources, wait for recovery or offer pause/resume. Never overwrite saved clip or user's manual timeline.
- Failure mode: record `partial`/`unverified` and reason, offer reduced chunks/retry. Never claim a complete source run when portions not inspected.
- Runtime toggles: `auto|fast|balanced|deep`, optionally `more visual evidence` and `more audio reactions` as distinct *extra passes*, with reported estimated impact based on measurements.

### Comparison UI proof

Each candidate retains `evidenceIds`, source/rational PTS, modal confidence, originating adapter and model hash; separate engine result IDs allow Mac Native vs V1–4 side-by-side without editing a shared source. Clip recheck should not rerun full ASR unless its source/context changed.
