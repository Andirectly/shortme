# 04 — Execution plan in the real ShortMe repo

## S0 — audit (blocking prerequisites)

- Inspect real repository, changes, package manifests, runtime, source/timebase, current engines and UI. Do not assume Electron. Inventory V4 progress; user-provided ZIP is a spec, not proof of installed V4.
- Identify shared cross-platform contracts and Mac-only dependencies; test existing Windows build/tests as baseline where feasible. Write architecture diff and engine registry migration.

## S1 — native Mac worker and app shell

- Build `shortme-mac-worker` (Swift CLI/service or XPC if appropriate) and real platform dispatcher. Implement hardware probe+capabilities+health/cancel+worker lifecycle. Build/start from the Mac version of the actual app. Do not replace existing Engines 1–4.
- Add typed IPC, source path/sandbox access, stderr/log handling, no arbitrary shell operations; expose lossless paths and Unicode filenames.

## S2 — resource governor, 16 GiB

- Use `starter/HardwareProbe` and reference policy to implement production Swift resource governor (or equivalent). Dynamic pressure, thermal/power events, model registry with state unloading, checkpoint/resume, bounded queue and profile UI.
- Actual cold/warm MAC measurement on 16 GiB; no fixed allowance derived from model file size alone. Fix verified safe per-model settings.

## S3 — media ingest and cheap full scan

- Probe and checksum source, exact PTS/timebase, VFR, offsets/rotation, streams. Stream audio windows, cheap loudness/RMS/pause/VAD/audio events and shot/motion/overlay cues. Coverage by decile and lane. Cached thumbnails not entire source in RAM.

## S4 — independent AI candidate lanes

- Local DE/EN ASR + exact word timings (ASR benchmark/test), audio anomaly/emotion *evidence* from actual sound, video event/face/action observation, real frame-derived semantic embeddings/query bank. Strict V4-014 equality requires real Qwen3-VL-Embedding-2B on Mac, not an asserted substitute. Cross-modal and text candidate searches must preserve sources.
- Fuse with lane budgets and event-aware deduplication. Save evidence and coverage separately; handle negative scenes. Whole-source sampling and retrieval shouldn't be limited to transcript windows.

## S5 — investigation and cut lattice

- Deterministic bounded tool-use (before/after/specific frames and audio/related moments). Actually retrieve second context windows. Graph setup→trigger→action→reaction→payoff only when observed/inferred labels appropriate, with citations to source evidence IDs. Negative/contradiction tests.
- Enumerate physically measured audio/word/shot/action/speaker cut edges. Local judge selects known edge IDs, not free timestamps. 2–5 variants context-safe/hook-first/natural-end; validate with time maps and source boundaries.

## S6 — real output, editor integration

- Cut actual video+sound with VFR handling, AVFoundation or licensed FFmpeg, create 9:16 reframe with native Vision tracking and safe fallback; editable word captions and graphic safe zones. Verify rendered MP4 with `ffprobe`/AVFoundation, actual video+audio playback and fresh output A/V judge. Targeted repair and rerender; preserve manual edits.

## S7 — user workflow

- Jobs, original reanalysis vs clip-recheck, engine result comparisons, progress, 'Auto/Fast/Balanced/Deep', diagnostics and optional offline model management. Cancel/restart/resume. Same project file compatibility with Windows where feasible; migration tests.

## S8 — regression, low-memory and offline

- Test with a real 16 GiB Mac first; subsequent 8/24/32/64 only where available. Stress with other apps consuming RAM, thermal throttling and critical pressure simulation. Assert safe pause / no OOM catastrophe / recovery / output validity. Windows unaffected.

## S9 — release and empirical quality

- Build arm64 app bundle, code-sign/notarize when developer credentials exist, dependency/weight audit, quarantine/entitlements and offline-first model cache. Benchmark equivalent original 20 source set against Windows baselines only with version/evidence controls and two blind reviewers; do not claim a win before data exists.

Each stage requires a documented real code path, test path, executed command, exit status and reproducible log. If an external requirement is missing (real Mac, source, legal permission, media, identities, notary secrets), mark BLOCKED while doing all unaffected work. Never commit downloaded model weights or copyrighted video.
