# Research 14 — Verified late-2026 upgrades and corrections (18 November 2026)

This is a research and implementation **addendum** to docs/10–13, not a model benchmark run. No user Mac has been tested, and the real ShortMe app repository is not in the provided ZIPs. Keep all original 54 V4 must-IDs. Do not present hypotheses as proven clip-quality gains.

## 1. Better speech model found: FluidAudio Parakeet Ultra

Official release 2026-09-24: [FluidAudio v0.17.3](https://github.com/FluidInference/FluidAudio/releases). `AsrModelVersion.ultra`, model `FluidInference/parakeet-ultra-coreml`, multilingual 25 European languages, ANE/Core ML, iOS 17+ / macOS 14+. It is a post-trained Parakeet v3 derivative, ~630 MB download, same API family. `redux` is a much smaller ~220 MB download, iOS 18+/macOS 15+; first ANE compile may take minutes. **Existing `.v3` is still library default, so Claude must explicitly select `.ultra` for the test.**

Vendor-published benchmark (M-series ANE, FLEURS 24-language mean): **Ultra 11.67% WER, v3 14.81%, Redux 13.06%**; English LibriSpeech test-other **Ultra 3.81%, v3 4.12%**. This does NOT establish superiority on German podcast speech, named people, overlap, music, slang, or precise word boundaries. Test those with a held-out creator corpus. Source: [FluidAudio releases](https://github.com/FluidInference/FluidAudio/releases), [benchmark methodology](https://github.com/FluidInference/FluidAudio/blob/main/Documentation/Benchmarks.md).

Implementation: expose `asr-ultra`, `asr-v3`, `asr-redux`, `whisperkit`, and optional `apple-speech` as swappable adapters; record model ID/revision, language, word spans, confidence and alignment quality. Select by measured accuracy, memory and macOS compatibility; not by advertised speed alone. Use ASR as a separate phase and evict before heavy VLM. On-device speech output should be validated with timestamp constraints and no zero-length words.

## 2. Native Swift embedding port has stronger evidence than initially known

[mlx-swift-Qwen3-VL-Embedding](https://github.com/mnmly/mlx-swift-Qwen3-VL-Embedding) now documents numerical parity vs the Python reference: image cosine >=0.997, text >=0.9997, reranker score delta <0.0064. Author reports **4.6–6.6 GB peak GPU usage** for image-batch sweeps on an **M5 Max with 128 GB**, not a 16-GB Mac. Its public API explicitly covers text/image/cross-modal embeddings; **full timestamped video indexing still requires ShortMe's own frame/PTS adapter and correctness tests.** `xcodebuild` (not plain `swift test`) is required for Metal library loading per README.

Recommendation: retain exact `Qwen/Qwen3-VL-Embedding-2B` for strict V4 visual semantic recall. Run Swift/MLX parity + video timestamp index tests first, with small batches on 16 GB. Marlin-2B captions are an *additional* visual perception lane, not a drop-in replacement for embedding search.

## 3. Marlin is promising but has significant operational caveats

[NemoStation/Marlin-2B-MLX-8bit](https://huggingface.co/NemoStation/Marlin-2B-MLX-8bit) describes ~2.5 GB 8-bit weights and video dense captioning. **Temporal grounding needs actual per-frame timestamps delivered to the model**; one-shot `mlx-vlm` may produce captions without reliable temporal localization. [marlin-mlx](https://github.com/Hook12aaa/marlin-mlx) is a native C++ MLX implementation but lists **macOS 26+** and explicitly documents earlier bugs that synthetic-only tests missed. [marlin-cli](https://github.com/shu-bamma/marlin-cli) is useful as a reference for overlapping windows and JSON spans, but its README states its warm engine can occupy **~16 GB RAM**, making it an unsafe default on a 16 GB Mac without independent memory measurements. HF access claims differ by distribution path; verify actual revision, access and license before shipping.

For 16 GB: use bounded frames/windows, one heavyweight model loaded at a time, checkpoint per chunk, monitor real memory pressure, and fail honestly if memory cannot admit a specific checkpoint. Do not infer total runtime memory from a 2.5 GB model file.

## 4. Gemma 4 license correction (important)

Previous notes incorrectly carried over *older Gemma-generation* terms. The **official Gemma 4 E4B** [Hugging Face model card](https://huggingface.co/google/gemma-4-E4B-it) and [Google's model card](https://gemma.ai/models/gemma-4/model-card/) explicitly list **Apache-2.0**. Qwen3.5-4B official weights also list Apache-2.0: https://huggingface.co/Qwen/Qwen3.5-4B. Third-party conversions, code and embedded dependencies must still be checked separately. This is not legal advice.

Google's [memory table](https://ai.google.dev/gemma/docs/core.md) estimates **Gemma 4 E2B Q4_0 2.9 GB** and **E4B Q4_0 4.5 GB** for loading static weights plus a stated 20% allowance; **context/KV cache and other runtime buffers are excluded**. Gemma 4 E2B/E4B support text, images and audio; video is a sequence of frames, not unlimited native video playback. In the official GGUF card, audio input is bounded to ~30s and video to ~60s at 1fps for those examples; validate actual MLX runtime. This makes E4B a candidate for **short-window A/V judgment**, not an hour-long continuous judge.

## 5. Audio events: Apple's free native lane first, then CLAP2

[Apple SoundAnalysis](https://developer.apple.com/documentation/soundanalysis) explicitly supports laughter and applause among 300+ classes. Run across the full source, smooth over time, retain timestamp and negative examples. **Laughter is a signal, not proof of humor.** [LAION CLAP2](https://github.com/LAION-AI/clap2) is a zero-shot audio-text challenger if Apple classification misses unusual sound events; repo says MIT code and Apache-2.0 weights, verify checkpoint-specific licensing. Do not ship [omine-me/LaughterSegmentation](https://github.com/omine-me/LaughterSegmentation) pretrained weights: research-only despite MIT repository code.

## 6. Not all newer models are appropriate on 16 GB

Qwen3.6's public releases highlighted **27B** and **35B-A3B**, not a verified 4B-class replacement for the user's machine. Avoid equating active parameters with resident weights. Qwen3.5-4B Q4 and Gemma 4 E4B/E2B Q4 are better *first tests* on 16 GB. On 32+ GB, try a larger judge only if peak RAM/swap, time and blinded editorial scores justify it.

Sources: [Qwen official release log](https://github.com/AlibabaCloud-Official/Qwen3.6/blob/main/README.md), [Qwen3.5-4B official model card](https://huggingface.co/Qwen/Qwen3.5-4B), [Gemma 4 model card](https://gemma.ai/models/gemma-4/model-card/).

## 7. New A/B test requirements for Claude Code

- E3a: v3 vs **Ultra** vs Redux vs WhisperKit on German and English podcasts; compute WER, hallucinated words, proper names, overlapping speakers, and P50/P90 word timing error, plus Mac peak RSS/Metal and cold/warm runtime.
- E4a: Marlin time-map vs Qwen3.5 video descriptions; evaluate actual source PTS and visual-only moment recall. No synthetic-only pass.
- E6a: Swift Qwen3-VL-Embedding-2B vs reference Python on timestamped image crops; exact checkpoint, cosine parity, end-to-end query recall, **16 GB** peak pressure, and batch-size 1/2/4. Do not assume M5 Max 128 GB metrics transfer.
- E5a: Qwen3.5-4B Q4 vs Gemma 4 E4B Q4 vs E2B Q4 for setup/punchline/reaction/standalone on actual rendered clips. Quantized model must accept the requested modalities in the chosen runtime.
- Negative controls: canned laughter, music, excitement without punchline, quiet dry joke, purely visual reaction, late-video event, multi-speaker cut, corrupted export. Never label 'best model' without blinded human evidence.

**Output requirement:** update `model_registry_resolved.json`, `mac_measurements.json`, `source_coverage.json`, `ablation_results.json`, and `SHORTME_MAC_STATUS.md` after actual Mac testing. Do not invent values in these files. Document failures and license blockers.
