# 01 — Inspected user-provided V4 packages and non-negotiable semantics

Source inspected: `Shortme_Engine_V4_Reviewed_Claude_Code_Paket.zip` (reviewed V4.1) and `Shortme_Engine_V4_Claude_Code_Implementation_Paket.zip` (V4 complete implementation brief). Both contain requirements and reference components but no ShortMe app repo. The reviewed ZIP is copied unchanged into `reference/`.

Most important reviewed files to unpack and consult:

- `00_START_HERE.md`: V4 is **fourth Windows engine**, `engine4`; do not supersede old Engines 1–3.
- `02_PRODUCT_PIPELINE_SPEC.md`: full-source observables; independent speech, audio, visual, cross-modal candidates; balanced fusion; bounded investigation; event graph; measured cut lattice; local cut judge; render and AV judge/repair.
- `03_INTEGRATION_AND_DATA_CONTRACTS.md`: run manifests, rational source PTS, provenance, evidence IDs, original/recheck distinction, editor compatibility, IPC and atomic resume.
- `09_DECISIONS_AND_HARDWARE.md`: Qwen3-VL-Embedding-2B is exact mandatory V4-014 path; other roles support quality-tested replacements; no false-equivalent single-modality judges.
- `11_AUDIT_AND_SIGNOFF.md`: sound/video real media proofs, hashes, 10-decile coverage, no synthetic evaluation claims.
- `12_QUALITY_FRONTIER_AND_CANDIDATES.md`: research models/code licensing pitfalls; measurable quality rather than claims.
- `requirements/v4_requirements.json`: 54 original IDs; keep unchanged.
- `reference_core/algorithms.py`: sample algorithms, not full ML implementation.
- `tools/v4_gate.py`/`v4_eval.py`: acceptance/evaluation aid; not runtime engine.

**Mac port rule:** preserve the *behavioral* invariants, not the Windows CUDA/Python runtime choices or Windows installer scripts. Avoid treating `engine4` and `macNative` as the same implementation if they cannot share runtime/checkpoints. Use a cross-platform `pipelineFamily` to compare versions while keeping distinct `engineId` and model snapshots.

**No evidence for current app internals:** Need to read original ShortMe repository before assuming Electron, Python, Tauri, React, SwiftUI, repo build commands, actual engine count already merged, or export paths. No integration patches can be made using only supplied ZIPs.
