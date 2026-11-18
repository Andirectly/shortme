# 03 — Hardware detection, 16 GiB first, dynamic resource governor

## Device snapshot (Swift starter included)

At boot and before each heavy model load, collect:

- `ProcessInfo.processInfo.physicalMemory`, `processorCount`, `activeProcessorCount`, `.thermalState`, `.isLowPowerModeEnabled`.
- Apple Silicon check (`hw.optional.arm64`), OS version, hardware model identifier via `sysctlbyname`; do not assume `machdep.cpu.brand_string` works on all Macs.
- `MTLCreateSystemDefaultDevice()`: Metal support, name, unified memory, `recommendedMaxWorkingSetSize`, `currentAllocatedSize`.
- **Live** memory pressure via `DispatchSourceMemoryPressure` event stream, thermal and low power notifications; observe child worker RSS, allocation and swap-related symptoms. Treat pressure as event-driven signal, never a single stale measurement. Diagnostic labels should distinguish measured from estimated values.

**Crucial:** Apple's unified memory is shared by CPU/GPU; physical memory is not free memory; Metal `recommendedMaxWorkingSetSize` is a per-device recommended working set, not "free VRAM". Memory estimators can be wrong due to KV cache, input batch, decoder buffers and OS workloads. Use soft admission with measured warm runs, enforce MLX cache/memory limits where supported AND external watchdog, and checkpoint before risky loads. Never use sudo `sysctl`/`iogpu.wired_limit` tweaks as a default app requirement.

## Conservative starting profiles — UNBENCHMARKED policy

| Physical unified RAM | Default | Heavy model concurrency | Approach |
|---|---|---:|---|
| ~8 GiB | Fast | 1 | on-disk features, low-res adaptive frames, small proven checkpoints, strict chunking, no heavy VLM unless real measured headroom |
| ~16 GiB (user's Mac) | Balanced | 1 | core ASR/VAD first, unload, embed/video/visual analysis next, unload, local judge/investigator later; run full-source coverage in chunks |
| 24–32 GiB | Balanced (+optional Deep) | 1 by default | more frames/context, optional tested larger models; not guaranteed to run all together |
| 64 GiB+ | Deep | 2 maximum **after benchmarking** | larger windows, selective concurrency if pressure normal, expanded scoring and repair budget |

The Python `starter/policy/hardware_policy.py` encodes a **candidate** policy; threshold and budget factors are placeholders for calibrated device measurements, not empirically validated specifications. Its `ai_worker_budget_bytes` is a planning cap, not the operating system's enforceable maximum nor the model's actual peak. Production policy must measure device-specific peak memory for each model+input and surface downgrades. Future M chips/capacities are supported by capability negotiation, not hardcoded chip-name tables.

## Admission & safety algorithm

1. Load persisted project + available model manifest (verified hashes, validated memory footprints on this device/model/context).
2. At each stage, estimate peak = weight-residency + KV/context + frames/audio + renderer/ASR temporary + safety reserve, not merely checkpoint file size.
3. Compare with policy budget, observed GPU allocated, process RSS, recent pressure/swap/thermal. If uncertain, pick smaller input batch or measured smaller model **only when feature equivalence remains true**; otherwise mark capability degraded/blocked.
4. On pressure WARNING: complete current small unit, checkpoint, unload model(s) and cache, reduce frame batch/context, reschedule. On CRITICAL: stop scheduling, checkpoint, unload, pause, warn UI, resume when pressure normal/user approves. On crash, restore from last verified checkpoint and replay idempotent work.
5. Periodically recalibrate throughput and memory after successful actual inference. Guard against concurrent video decode/cache + LLM memory peak. Limit renderer concurrency and temp disk usage too.
6. Do not pretend complete if memory exhaustion prevented a lane; coverage JSON must record `partial` or `failed` with reason, and only permit export with appropriate user-visible warning when policy allows.

## Preserve quality on 16 GiB

- **Same event types** available as on large hardware: speech, audio, visual, cross-modal. Different execution time and quality of specific installed models can change results; measure differences rather than promise equal scores.
- Whole source coverage 10 deciles minimum: cheap audio/VAD/shot cues and explicit coarse visual samples over all timestamps; adaptive dense review around events. Do **not** truncate the source to first N minutes because memory is low.
- 1–6h originals: stream audio; window decode and index to disk; process clip segments sequentially. Cache keys include original SHA, timebase, decode/feature and model revision. Frame density must be logged; skipped windows are not inspected.
- Word-level timestamps and cut edges use integer SourcePTS/rational timebase. Audio samples and VFR mapping must be consistent after resuming.
- Model unload != deleting observations. Save transcripts, embeddings, event IDs and time maps in atomic on-disk run records.
- Profile FAST may reduce extra investigative passes/candidate count **with explicit policy** while retaining full-source baseline scan. DEEP on 16 GiB may increase sequential calls (if memory safe) rather than simultaneous models.

## Production telemetry

Local-only by default, opt-in diagnostic export containing hardware tier (not identifying hardware serial), stage times, model hashes, per-stage real peak RSS/MLX active+cached bytes, pressure, model unload count, swap/thermal if supported, coverage, checkpoint recovery count and actual AV decode status. Never send private media, raw transcript or personal data silently.
