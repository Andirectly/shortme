# 06 — Real Mac test/acceptance matrix; NO invented pass states

## 16 GiB acceptance, minimum

- Real macOS arm64 app launches and can select `macNative`, stable project opens and all Windows projects remain readable (subject to actual format audit).
- Hardware sample matches About This Mac (RAM, Metal name, Apple Silicon) and shows live pressure. No issue if `memory_pressure` initially unknown; never present unknown as normal.
- Real authorized audio+video source >=30min (prefer >1hr), variable frame rate case, rotation, long Unicode path, no-audio, missing ASR language case, and late highlight in final 10% of source. Coverage evidence for **all 10 deciles**, every lane `inspected|partial|failed|skipped(reason)` and actual sampling evidence.
- Local DE/EN ASR tested against manually checked words and boundaries; real audio anomalies and image-based events demonstrably found **without relying exclusively on transcript**; cross-modal query backed by frames. If required Qwen3 embedding path fails, strict V4 parity gate = FAIL even if another visual implementation works.
- Evidence-backed highlights with setups/payoffs and source references; actual bounded secondary context tool call; deterministic observed edges; 2+ viable cut variants when justified; local judge uses edge IDs.
- At least one playable 9:16 MP4 with actual H.264/H.265 video + audio, usable crop/tracked faces when applicable, correct word captions and clean seams. Probe actual exported file with ffprobe/AVFoundation. Original file preserved.
- True rendered-output video+audio check and, where a failure is detected, repair/re-render followed by a new judge on new output hash. No silent pass for missing audio if source has audio.
- UI compare/recheck/reanalyse and manual editor edits persist; rollback/cancel/resume from verified checkpoint without clobbering user work.
- Offline analysis after model installation (block network); all media stays local. No per-video hosted inference.
- Memory stress on actual **16 GiB** device: simultaneous normal desktop apps, pressure WARNING and CRITICAL (inject via test seams if OS condition not reliably inducible), pause/resume and unload evidence; no process uncontrolled termination, no corrupted project, no giant memory leaks, no automatic changes to OS memory limits. Log real max process RSS/GPU allocated and swap pressure when available.
- macOS app release build and Windows smoke regression. Signing/notarization may be BLOCKED absent credentials; not a reason to mark code 'signed'.

## Other RAM tiers and limits

- 8 GiB only if device available: honest degrade/unsupported model notice rather than fabricated end-to-end performance.
- 24/32 GiB: complete same source; increase tested context/sampling or optionally parallelism; compare clip quality and peak memory.
- 64 GiB+: optional 2 simultaneous models only if empirically safe; don't assume hardware memory means additional accuracy.
- Unsupported Intel: clear explanation / alternate mode not mislabeled as Apple Silicon engine.

## Independent human quality proof

Use reviewed V4 `11_AUDIT_AND_SIGNOFF.md` and `12_QUALITY_FRONTIER_AND_CANDIDATES.md` methodology. 20 distinct authorized original media (podcast, Twitch, gaming, rap, no-speech and negatives), at least 2 independent blind human raters, same source and output budget across Windows baseline(s) and Mac, randomized labels. Report event recall, published-worthy Top-K, start/end boundaries, standalone/payoff, manual edit time, audio/crop/caption failures, processing time, RAM and reviewer disagreement. Device differences confound cross-platform results; don't assert Mac is 'better' absent a controlled blind test. `NOT_MEASURED` must remain distinct from `FAIL`.

## Technical tests to add in app repo

| Area | Test and evidence |
|---|---|
| Hardware | recorded Swift probe JSON on 16 GiB; process pressure listener event unit tests; profile fallback; unknown pressure handling |
| Resource | model unload before next heavy loader; real peak; GPU+renderer concurrent memory; pause/resume idempotency; emergency disk full and low swap |
| Media | source PTS rational invariant, VFR A/V offsets, mixed streams, wrong duration / corrupt media / empty files |
| Features | video frames (not ASR!) represented, audio real sample feature extraction, measured 10-decile coverage per lane |
| Agents | bounded tool count/cost, retry invalid JSON, genuine secondary window, counterexample check and no invented timestamps |
| Cutting | edge IDs exist, same run, no zero-duration, natural spoken/audio/music boundaries, clip edits retained |
| Export | actual encoded A+V streams, crop/caption overlay/word sync, no out-of-range frames, decode whole rendered clip |
| Security | path traversal/unknown op rejects, no shell injection, no silent network model loads, checkpoint/license SHA enforced |
| Packaging | clean macOS arm64 install/uninstall, signed/notarized only when proven, no deletion of project during uninstall |

## Existing reference policy tests (PASS at packaging time only)

```bash
python3 -m unittest discover -s starter/tests -v
python3 starter/policy/hardware_policy.py starter/fixtures/mac16.json
```

`starter/HardwareProbe` requires real Mac:

```bash
cd starter/HardwareProbe && swift build -c release
swift run -c release shortme-hardware-probe > /tmp/shortme-mac-device.json
python3 ../policy/hardware_policy.py /tmp/shortme-mac-device.json
```

The included test suite **does not** prove any Mac compile, model inference, highlight quality or export. Any such claim requires tests in the actual app repo on authorized media.
