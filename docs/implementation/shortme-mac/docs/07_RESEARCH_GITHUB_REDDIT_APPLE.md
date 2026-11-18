# 07 — GitHub, Reddit and official API research

Research date: **2026-11-18**. Links verified through web search/open; **not cloned, built or run in this environment**. All are candidates; version- and weights-specific legal verification remains mandatory.

## Directly relevant open source

1. [Shortcast](https://github.com/mutonby/shortcast) — Apache-2.0 *source*, native Swift/MLX/WhisperKit/Vision/AVFoundation on-device long-video-to-shorts, face tracking and export. Single direct transcript+LLM selection design in README is weaker than required V4 multi-lane full-source investigation. Official Gemma **4** weights are Apache-2.0 (verify exact checkpoint), unlike older Gemma releases. **Good architecture reference, not a full ShortMe substitute.**
2. [Clipmunk](https://github.com/ngoldbla/clipmunk) — Apache-2.0 Shortcast fork explicitly targeting M-series Macs under 16GB, with Core ML/Parakeet primary on <=16GB, 4-bit small local director and video model. Claims one video at a time and limited history; quality and 16GB performance **not independently verified** here. **Useful reference for low-RAM scheduling and model roles.**
3. [FluidAudio](https://github.com/FluidInference/FluidAudio) — Swift/Core ML ASR, VAD, diarization with modular package traits; supports multilingual Parakeet and models for DE/EN. Model licensing, exact word timings and memory still need hands-on verification. [Readme](https://github.com/FluidInference/FluidAudio#readme).
4. [Argmax OSS / WhisperKit](https://github.com/argmaxinc/argmax-oss-swift) — Core ML WhisperKit and incremental loading option for long audio; real alternative and accuracy control. Review current README because package location evolved.
5. [MLX Swift examples](https://github.com/ml-explore/mlx-swift-examples) and [MLX Swift LM](https://github.com/ml-explore/mlx-swift-lm) — native LLM/VLM and embedding adapters, requires actual checkpoint support test.
6. [MLX Swift memory primitives](https://github.com/ml-explore/mlx-swift/blob/main/Source/MLX/Memory.swift) and [MLX memory management](https://github.com/ml-explore/mlx/blob/main/docs/src/python/memory_management.rst) — memory/cache limits; not a substitute for OS pressure monitoring.
7. [Qwen3-VL-Embedding](https://github.com/QwenLM/Qwen3-VL-Embedding) — source of strict V4 visual semantic lane, but currently **do not assume** a tested native Mac Swift adapter just because general MLX VLMs exist.
8. **[mlx-swift-Qwen3-VL-Embedding](https://github.com/mnmly/mlx-swift-Qwen3-VL-Embedding)** — particularly relevant **Swift/MLX native port of the exact `Qwen/Qwen3-VL-Embedding-2B` checkpoint**, with text/image embedding, reranking, CLI and SwiftUI sample; README describes local model snapshot loading and Xcode test commands. This is **first proof-of-concept candidate** for V4-014 on Apple Silicon. The repo is new, has a vendored modified backbone and no independent 16 GiB measured proof here. Image embedding != by itself validated temporal video retrieval. Test decoding timestamped frames, querying across source duration, model-output parity against upstream, load/unload, and real peak RAM before claiming V4 parity.
9. **[Blaizzy/mlx-embeddings](https://github.com/Blaizzy/mlx-embeddings)** — MLX Python fallback that explicitly documents `load("Qwen/Qwen3-VL-Embedding-2B")` and text/image multimodal similarity; a more directly demonstrable model-specific starting point if native Swift port fails tests. Pin Python helper and package environment if adopted.
10. **[lablup/mlxcel](https://github.com/lablup/mlxcel)** — additional MLX-based model support list that explicitly includes `Qwen/Qwen3-VL-Embedding-2B` for image/text. Review server dependency, licensing and product fit; proof-of-concept alternative only.
11. [jevcut](https://github.com/VBS2004/jevcut) / [LongVideoAgent](https://github.com/longvideoagent/LongVideoAgent) — investigated in user's V4 reference, inform measured cuts and bounded investigation. Hosted inference/unclear licenses prevent unreviewed runtime copying.

## Apple APIs (official)

- [ProcessInfo](https://developer.apple.com/documentation/foundation/processinfo): `physicalMemory`, `thermalState`, `isLowPowerModeEnabled`, cores.
- [Metal device inspection](https://developer.apple.com/documentation/metal/device-inspection): `recommendedMaxWorkingSetSize`, `currentAllocatedSize`, unified memory, device name. Do not interpret working set as free VRAM.
- [DispatchSourceMemoryPressure](https://developer.apple.com/documentation/dispatch/dispatchsourcememorypressure): event-based pressure notifications.
- [Apple Metal compute talk](https://developer.apple.com/videos/play/tech-talks/10580/): performance/memory framing.

## Reddit and fresh community caveats

- [LocalLLaMA: 16 vs 24 vs 32GB for 8B](https://www.reddit.com/r/LocalLLaMA/comments/1pa2v1w/if_i_want_to_run_llama_8b_locally_on_macbook/) — memory arithmetic discussion is illustrative, not actual ShortMe VLM throughput. Weight size alone omits KV/frames/process overhead.
- [LocalLLaMA: context size & VLM memory](https://www.reddit.com/r/LocalLLaMA/comments/1rgqfne/does_setting_a_small_context_size_let_you_run_a/) — anecdotes on 32GB VLM and context-sensitive out-of-memory. Treat as community reports, not benchmark thresholds.
- [MLX current issue re device resource limits](https://github.com/ml-explore/mlx/issues/3849) — practical pitfalls in MLX resource monitoring and buffer lifetimes; avoid unsupported `sysctl` or bypass-based memory plans.
- [MLX server OOM/kernel crash report](https://github.com/ml-explore/mlx-lm/issues/883) — anecdotal warning to bound KV/chunk/cache and avoid unbounded memory on Metal.

## License and product review to perform before code import

Review each repo's current license, subtree/vendored licenses, NOTICE and every checkpoint's weight terms, Hugging Face access conditions, CoreML conversion artifacts and FFmpeg binary redistributability. An app source license does not prove the license of bundled model weights; **official Gemma 4 E2B/E4B checkpoint licenses are Apache-2.0**, but exact conversion artifacts must be verified. Avoid noncommercial weights (e.g. VideoITG checkpoint per reviewed V4 spec), AGPL imports without legal approval, unknown permissions for LongVideoAgent. Cite license/revision in the package's model registry and build SBOM.
