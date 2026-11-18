# 16 — Important macOS-specific integration issues that must not change ShortMe's look

## Permissions, media and storage

- User-selected video and output folder access, long-lived project reopen using approved bookmark/permission flows, robust paths with spaces and Unicode, removable media and stale bookmarks.
- Include bundled FFmpeg/FFprobe or platform media components correctly for `arm64`, licenses, spawned worker signatures, executable permissions and development vs installed resource paths. Avoid globally installed dependencies.
- Export colors/audio/captions must match Windows intentions: check Rec.709/metadata, color profiles, HDR→SDR policy, variable frame rate timestamps, mixed sample rates, rotation metadata, alpha and pixel aspect. Compare actual rendered output, not just editor preview.
- Avoid changing source bitrates or frame rates silently during import; retain rational timestamps and original media provenance.

## Engine and model management

- Keep `engine1`–`engine4` Windows logic operational. On Mac show `macNative` and only explicitly compatible engines; don't present broken selectable engines.
- Unified memory 16 GiB: model loading/unloading controlled by resource governor, no surprise UI freeze. Streaming progress has stage name, time spent, Cancel and resume; save work before applying a pressure fallback.
- Model downloads are optional/consented, resumable and integrity-checked, with clear storage cost and version. Put models in appropriate app-support path, not inside signed app bundle after distribution. No per-job downloads or mystery network inference.
- On first run, hardware detects 16/32/64 GB and Metal; UI shows auto profile and honest resource modes. Keep settings labels/styles consistent with Windows UI design.
- Distinguish pipeline version, model version, backend and hardware profile in project manifests; be able to re-open and edit Mac and Windows projects without destructive conversion.

## Interaction & macOS release requirements

- macOS native menu bar includes app, file, edit, view, window, help relevant to actual functionality; Cmd-based shortcuts and expected close-vs-quit semantics; drag/drop works with app security model.
- Core audio/media decoders must preserve exact timing in cut exports; visual preview, thumbnails, captions and export do not drift even under variable-frame-rate content.
- Gate 16 GiB benchmark on actual device; energy/thermal throttling should not cause hangs. Save jobs and resume across sleep/wake. Respect low power mode.
- Signs all included helper executables consistently when distributing; Developer ID + hardened runtime + notarization for normal external install; bundle `.app`/`.dmg`. A developer unsigned build is not a finished signed release.
- A future app updater must replace signed application resources safely and not overwrite user media/projects/models. Do not attempt hot-patching notarized executable code arbitrarily.

## Minimum smoke tests

1. Import 60-minute authorized interview; cancel and resume mid-transcription and after visual analysis; memory-pressure downgrade and rerun.
2. Produce multiple true rendered MP4 vertical clips with synchronized audio and captions, open them in ordinary players, inspect output metadata.
3. Reopen project; keep all hand-edited clip boundaries and captions after reanalysis; preserve Mac↔Windows schema/metadata where documented.
4. On Mac 16 GiB, verify UI remains interactive during job, peak RSS/Metal data recorded, no swap storm/crash, late-source events not silently skipped.
5. Screenshot all UI stages against the exact Windows reference, inspect diffs, record app version and sizes.
6. Apple Silicon fresh install: models downloaded by consent, CLI subprocesses packaged; save, update, reopen, export, uninstall without harming user data.
