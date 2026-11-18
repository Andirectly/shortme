# 09 — Decisions, honest unknowns, Claude output expectations

## Decisions approved as starting architecture, not performance assertions

- Design for **16 GiB Apple Silicon** first. Auto-detect and run conservative sequential AI jobs, without silently skipping long-video regions or AV lanes.
- Keep Windows's pre-existing engines untouched and use a distinct Mac-native backend; reuse UI and project/editor/export logic where possible. No automatic assumption of Electron or Tauri.
- Prioritize Swift native system/media/audio adapters, MLX Swift for supported local LLM/VLM, Core ML/ANE for audio where verified, Vision for crop; optional pinned local MLX Python helper only when needed for exact model features.
- One installed model ≠ all features solved. Need 4 independent candidates, cross-modal retrieval, context investigation, measured cut edges, actual rendered-output judgment and repair, and editability.
- Keep Mac model installs local and user-triggered; avoid paid cloud runtime tokens.

## Blockers Claude must report and resolve in user's repo/environment

- **Missing actual app repository**: We inspected only implementation/documentation ZIPs; cannot know real module names, engine registry, current UI stack or whether Engine 4 was integrated.
- **No real Mac benchmark or compile**: Swift probe provided as a starter, not built in this environment; 16 GiB reference policy is only validated in Python unit tests against synthetic fixtures.
- **Exact Qwen3-VL-Embedding-2B Mac runtime compatibility**: not proven by MLX Swift generic VLM support. Strict parity blocked until actual visual embedding+retrieval PoC and license audit.
- **No user video or blind reviewer dataset**: Quality cannot be evaluated yet. No fake evidence or scores.
- **Signing credentials**: Cannot notarize/distribute a signed DMG without actual Apple Developer credentials.
- **Model legal distribution**: Each weights/runtime license may be more restrictive than a repo's code license.

## What Claude should return after implementation

1. Code changes in actual repo: cross-platform dispatch + Mac native backend, with exact file path list and git commits.
2. Mac hardware capture on a physical 16 GiB device and available memory/pressure profile behavior; real tests proving sequential unload and resume.
3. A working authorized original → multiple editable final video files with actual A/V plus full provenance, run logs and stream decode proof.
4. Test records: command/exit/log, 16 GiB peak memory, resource fallbacks, source coverage by 10 deciles/lane, original/recheck, offline test and Windows regressions.
5. Mac `.app`/DMG artifacts with signing/notarization status, downloadable model configuration and license/SBOM.
6. Honest blocked tasks and a precise `docs/SHORTME_MAC_NEXT_SESSION.md` for continuation if not finished.

Before all mandatory gates pass, the truthful output is **"implementation in progress"**, not "fully running macOS ShortMe".
