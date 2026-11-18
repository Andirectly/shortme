# 02 — Proposed Mac-native architecture (adapt after source audit)

## Three layers

1. **Existing ShortMe UI & project model (reuse!)**: app shell, engine chooser, project settings, editor, original/recheck, progress, captions and export. If current UI is Electron, Tauri or another cross-platform stack, port that stack to macOS, don't duplicate in SwiftUI. If it is truly Windows-only, audit components and write a minimal Mac wrapper reusing as much shared code/data as possible.
2. **New `macNative` worker/service**: executable / bundled framework in Swift; typed, versioned JSON-RPC over stdio or authenticated existing IPC, no arbitrary shell calls. Supports `health`, `capabilities`, `hardware_snapshot`, `subscribe_pressure`, `model_install`, `model_status`, `probe_source`, `extract_observables`, `transcribe`, `align_words`, `embed_video`, `query_index`, `audio_events`, `inspect_window`, `fuse_candidates`, `propose_edges`, `judge_cut`, `render`, `judge_render`, `repair`, `cancel`, `unload`, `shutdown`. Host owns permissions, job scheduling and run state. Add actions incrementally as real implementations.
3. **Local native compute adapters**: Audio: FluidAudio/Core ML/ANE; frame/face/shot: AVFoundation/Vision/Core Image + Metal; reasoning/semantic retrieval: MLX Swift / an explicitly approved, sandboxed packaged MLX-Python helper; media: AVFoundation and/or pinned licensed FFmpeg executable. No CUDA, no Python global environment. Local-first, network-free analysis.

## Recommended runtime and library selection

- Swift preferred for hardware, audio and media management: Foundation/ProcessInfo, `MTLDevice`, Core ML, VideoToolbox/AVFoundation, Vision, Accelerate, Core Image. Use MLX Swift for supported LLM/VLM inference.
- First test the actual Apple-Silicon Swift port at https://github.com/mnmly/mlx-swift-Qwen3-VL-Embedding for exact mandatory Qwen3-VL-Embedding-2B. This is a promising existing implementation, **not verified** on the user's 16 GiB device. Check model fidelity and real timestamped visual retrieval. If that fails, test https://github.com/Blaizzy/mlx-embeddings as a packaged offline arm64 MLX Python helper with pinned environment and license vetting. Never silently swap the exact V4 checkpoint. No hidden pip/HF installs during processing.
- Direct import of an entire open-source Mac clipping app is not recommended: it may replace the current editor/UX and can miss the V4 visual/audio investigation. Borrow architecture, not an alternative entire product, unless there is a documented migration decision.
- Capabilities are data-driven: MAC host displays only actually available engines; Windows retains existing engine IDs. Persist `engineId`, `backend`, `pipelineFamily`, `pipelineVersion`, models and hardware profile in every run.

## Job model and queue

```
UI [existing project/editor]
  ↕ typed IPC, progress, cancel, resume
Mac Host / Scheduler / Resource Governor
  ↕ sequential adapter invocations on 16GiB
 [AVFoundation probe] -> [cheap source observables]
            -> [CoreML ASR/VAD] -- unload/evict
            -> [Visual embeddings + frames] -- unload/evict
            -> [audio event features] -- unload/evict
            -> [local LLM/VLM investigation] -- unload/evict
            -> [cut lattice/Judges]
            -> [render/caption/crop] -> [real output AV validation]
            -> [editor + non-destructive export]
```

Atomic run snapshots/metadata live on disk, not in all-RAM objects. Avoid triggering VLM and media transcoder concurrently on memory-constrained machines. A single worker per machine is a valid default; parallelism on 64 GB+ requires measured headroom and user's consent.

## Hardware minimum

Target Apple Silicon (M1 or newer) with Metal, macOS 14+ initially; raise min macOS only when actual chosen library requires it. Refuse unsupported Intel Mac clearly or provide a **separate, honest** CPU-lite product design if demanded; don't label unsupported Mac as full native engine.

## UX details

Provide an Auto performance switch (default), display detected RAM and selected tier, live current step, partial/failed coverage, expected resource mode ('one AI model at a time'), ability to change Fast/Balanced/Deep without erasing project, and a "reduce memory usage" action. Deep requests on 16 GB must either use validated serial-depth or transparently fall back, never force a process crash. Existing manual edits must survive re-analysis and repair.
