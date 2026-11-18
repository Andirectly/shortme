# ShortMe macOS — Claude Code implementation kit (Apple Silicon, 16 GB first)

**Status:** Engineering brief + researched architecture + runnable offline **hardware-policy prototype** + macOS Swift hardware probe starter. **Not** a finished ShortMe app/engine. Created 2026-11-18.

## Objective

Port the existing Windows ShortMe product to macOS, using a **Mac-native analysis engine** (Apple Silicon + Metal/MLX/Core ML/Vision/AVFoundation) while keeping existing UX, project files, captions, editor and Windows engines functional. Long video → complete evidence-backed scan → discover funny/exciting events using independent speech, audio and image lanes → investigate context → cut → verify rendered AV → provide editable finished vertical shorts.

**Reference device: a Mac with 16 GiB unified memory.** Runtime detects hardware and memory pressure rather than assuming all 16 GB can be used for models. Larger machines scale up. Local inference should require zero cloud LLM tokens, with model download consent and clear license checks.

## GitHub access — now REQUIRED first

**First run `04_CLAUDE_CODE_GITHUB_CONNECT_PROMPT.md` in Claude Code.** It must authenticate (with the user’s permission), find and verify the real Windows ShortMe desktop source on GitHub, pin its commit and create a separate feature branch/worktree. The user did not provide a URL, so do **not** guess from a public repository name. See `docs/17_GITHUB_REPO_DISCOVERY_AND_SAFE_PORTING.md`. If private access is missing, the user must authorize GitHub on their own machine or in Claude Code cloud. Read-only inspection precedes any changes.

## Use in existing repo (after verification)

1. Unzip this kit. Copy the **contents** of `ShortMe_macOS_DeepDive_Upgrade_2026_11_18/` into the actual ShortMe source repository at `docs/implementation/shortme-mac/` (leave existing project files intact).
2. Open Claude Code at the **root of that real app repository** and paste the entire content of `01_CLAUDE_CODE_MASTER_PROMPT.md`.
3. Provide Claude Code access to a real Apple Silicon Mac with Xcode, macOS 14+ and 16 GiB memory. If working elsewhere, do repo-compatible work and mark Mac-native validation blocked.
4. The macOS package contains the user's existing reviewed V4 specification as `reference/Shortme_Engine_V4_Reviewed_Claude_Code_Paket.zip`. Unzip/read it as a **functional reference**, not as a command to implement Windows V4 in place of the Mac work. New Mac-specific decisions here override Windows-only runtime guidance; V4 functional invariants remain.
5. Implement according to `docs/04_IMPLEMENTATION_PHASES.md` and verify against `docs/06_TEST_MATRIX_AND_GATES.md`. Do not say complete merely because the hardware probe or UI runs.

## What exists in this kit

- `01_CLAUDE_CODE_MASTER_PROMPT.md` — ready-to-paste task brief.
- `docs/` — architecture, V4 source correspondence, dynamic 8–64 GB policy, model/feature options, IPC and persistence, tests, dependency licensing and research.
- `starter/HardwareProbe/` — actual Swift source for hardware inspection; **not compiled/tested on macOS in this environment**.
- `starter/policy/` + `starter/tests/` — Python policy implementation + passing fixture tests; reference-only until measured on a Mac.
- `reference/` — unchanged user-provided reviewed V4 ZIP (user's own reference, with tests and algorithms).
- `templates/` — evidence and adapter manifest examples, not completed results.

## Ground truth / scope of inspected archives

We examined both user-provided V4 ZIPs. The reviewed V4 4.1 ZIP includes docs, 54 requirement IDs, tests, a `reference_core/algorithms.py`, schemas and evaluation scripts. The other implementation ZIP additionally contains historical V3/V3.5 subarchives. **Neither contains the actual ShortMe desktop app repository.** Its build stack, Windows integration details and genuine model performance cannot be verified from these archives. Claude Code must inspect the real source tree first.

## Short release criterion

A successful real Mac run must ingest an authorized >30-min audio/video source, complete coverage across the whole duration with documented sampling, recover multiple grounded candidates including near the end of the source, render editable MP4 shorts with real sound and captions, survive a critical memory-pressure simulation/resume without data loss, and pass blind human quality review before claiming superiority. On 16 GiB, the run must not depend on disabling visual/audio lanes silently or increasing OS GPU memory limits.


## Research update, 2026-11-18

The additional [00_DEEP_DIVE_ZUSAMMENFASSUNG.md](00_DEEP_DIVE_ZUSAMMENFASSUNG.md) identifies Apple SoundAnalysis, Marlin-2B video time mapping, Qwen3.5-4B/Gemma 4 E4B trials, and commercial checkpoint restrictions. Include docs/10 through 14 in Claude’s reading. The latest 14th addendum covers Parakeet Ultra/Redux, Swift embedding parity evidence and the verified Gemma 4 Apache-2.0 license correction. After the base master prompt, apply [02_CLAUDE_CODE_RESEARCH_UPGRADE_PROMPT.md](02_CLAUDE_CODE_RESEARCH_UPGRADE_PROMPT.md) as a supplemental concrete model-integration directive. Neither this research nor the original Swift starter proves model execution on an actual 16 GiB Mac.


## V3: P0 UI 1:1 macOS parity

The user explicitly requires identical ShortMe application visuals on macOS. Do not replace the product UI just because the ML backend is Swift-native. Read `00_UI_PARITY_UPGRADE_SUMMARY.md`, `docs/15_UI_PIXEL_PARITY_AND_DESIGN_FREEZE.md`, `docs/16_MAC_INTEGRATION_EDGE_CASES.md` and `templates/ui_parity/screen_inventory.json`. Master prompt now includes the mandatory UI freeze. For continuing an existing Claude Code job from V2, apply `03_CLAUDE_CODE_UI_PARITY_ADDENDUM.md` separately. Windows source + screenshots are **not** included in the ZIP, so real visual parity remains unverified until captured from the actual app.


## V4 GitHub-first addendum

The user confirmed that the full ShortMe desktop source **should be** on GitHub and asked that Claude Code connect to it. `00_GITHUB_FIRST_README.md`, `04_CLAUDE_CODE_GITHUB_CONNECT_PROMPT.md` and `docs/17_GITHUB_REPO_DISCOVERY_AND_SAFE_PORTING.md` define the new hard gate. No GitHub repository was actually accessed while preparing this kit.
