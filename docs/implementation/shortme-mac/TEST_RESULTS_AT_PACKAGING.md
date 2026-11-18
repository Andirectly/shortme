# Checks performed on 2026-11-18 — model deep-dive upgrade v2

1. `PYTHONDONTWRITEBYTECODE=1 python -m unittest discover -s starter/tests -v` — **PASS 18/18** (11 policy tests, 7 model registry tests). Synthetic fixture/policy only, not a Mac memory measurement.
2. `python starter/policy/hardware_policy.py starter/fixtures/mac16.json` — **PASS**: `standard16`, `balanced`, max one simultaneous heavy model, approximately 5.76 GiB *planning* worker budget. This is not real measured available memory.
3. Original V4 reviewed reference `python -m unittest discover -s tests -v` — **PASS 14/14**. Validates reference package, not actual ShortMe desktop code.
4. `swiftc -frontend -parse starter/HardwareProbe/Sources/ShortMeHardwareProbe/main.swift` — **PASS** syntax-only. Actual macOS compilation and runtime have NOT been tested.
5. ZIP CRC verification and SHA256 manifest — **PASS** during packaging.

No Apple Silicon Mac, real video source, actual model weights or complete ShortMe desktop app repository was available. No ASR, vision, laughter model or video render was executed. No comparative ShortMe quality improvement is proven. Official model authors' benchmarks are labelled as such in docs/14.


## V4 GitHub-first addendum (2026-11-18)

Original V3 checks shown above are historical to that package. V4 documentation update does NOT include a real GitHub connection, source clone, macOS build, real-media run, or 1:1 UI screenshot evidence. ZIP CRC and SHA manifest will be checked again when packaging.
