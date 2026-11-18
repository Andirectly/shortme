# Research 13 — Commercial use, provenance and traps

This is an engineering licensing checklist, not legal advice and not a substitute for final counsel approval.

| Candidate | Observed evidence / constraint | Recommendation |
|---|---|---|
| Apple SoundAnalysis, SpeechAnalyzer, Vision, AVFoundation | Apple platform frameworks; platform/version support subject to SDK and app entitlement terms | Favor native first; ship proper macOS entitlements and test offline |
| `omine-me/LaughterSegmentation` | GitHub README states code is MIT but **publicly available trained weights are for research use only**: https://github.com/omine-me/LaughterSegmentation | **EXCLUDE weights** from commercial ShortMe; study conceptual feature only, or obtain separate license |
| NVIDIA VideoITG | existing reviewed V4 docs note pretrained weights non-commercial preview | Do not ship/use these weights commercially |
| Gemma **4** E2B/E4B | **Official model cards list Apache-2.0**: https://huggingface.co/google/gemma-4-E4B-it and https://gemma.ai/models/gemma-4/model-card/ (older Gemma releases differ) | Verify exact official/converted checkpoint, dependencies, attribution and NOTICE; do not apply outdated Gemma-generation license assumptions |
| Qwen3.5-4B | official HF model card lists Apache-2.0: https://huggingface.co/Qwen/Qwen3.5-4B | Suitable investigation candidate after verifying exact conversion/subtree |
| Marlin-2B | HF base and MLX model cards list Apache-2.0: https://huggingface.co/NemoStation/Marlin-2B | Candidate pending dependency, `trust_remote_code` review, exact checkpoint hash & commercial legal signoff |
| LAION CLAP2 | repo says models Apache-2.0: https://github.com/LAION-AI/clap2 | Verify **specific** chosen weights and conversion before packaging |
| TensorFlow YAMNet | TensorFlow models repo Apache-2.0: https://github.com/tensorflow/models | Verify weight artifact and any CoreML/ONNX conversion redistribution rights |
| `Aseiel/VideoHighlighter` | project README AGPL-3.0: https://github.com/Aseiel/VideoHighlighter | **Do not embed its source in proprietary app** without legal review; idea-level reading only |
| `Hook12aaa/marlin-mlx` | repo README claims MIT, macOS 26+ | Read LICENSE/NOTICE, compile on target and verify real video correctness, don't silently vendor |
| `Shortcast` / `Clipmunk` | Apache-2.0 source stated; models/FFmpeg/Swift vendor subtrees independent | Architecture references, not turnkey ownership of all dependent rights |
| ffmpeg | build flags can make LGPL/GPL conditions differ; codecs have separate considerations | Own pinned distributable build and check license, patent and notices |

## Security/reliability

- Only download on user request; show model ID, approximate size, license, purpose and disk space.
- Record pinned revision, SHA256, source URL, conversion metadata; avoid `trust_remote_code` execution without review. Disable silent network at runtime and telemetry by default.
- Isolate native MLX Python helper if needed; bounded process stderr/stdout, JSON schema, cancellation, memory lease, no arbitrary path traversal or shell interpolation.
- Preserve author rights in input videos; model author terms and user source consent are separate issues.
- Do not auto-apply repository `xattr -dr com.apple.quarantine` workarounds; signed/notarized distribution is preferred.
