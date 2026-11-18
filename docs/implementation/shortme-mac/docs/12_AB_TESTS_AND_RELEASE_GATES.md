# Research 12 — What would prove a 'better model' for ShortMe

## First, avoid model-for-the-model's-sake

A strong 4B text QA score does NOT imply more funny clips. Evaluate a 16 GiB source job on the same authorized media, engine version and target number of clips. All decision thresholds below are release-design criteria, **not tests already passed**.

## Experimental matrix (one change at a time)

| Experiment | Baseline | Candidate | Primary thing measured |
|---|---|---|---|
| E1 audio event | energy/pitch/silence only | + Apple SoundAnalysis | ground-truth laugh/applause/excited/scream event recall, false alerts/hour; event time error |
| E2 audio | Apple SoundAnalysis | YAMNet fixed classes vs CLAP2 text prompts | incremental true positives on held-out German/English creators vs latency and license |
| E3 ASR | FluidAudio Parakeet v3 | **Parakeet Ultra**, Redux; Apple SpeechTranscriber where available, WhisperKit | DE/EN WER, interjections/proper nouns, overlap, word edge P50/P90 error, peak RAM and disk footprint |
| E4 video time-map | existing sampled VLM/Qwen3-VL retrieval | + Marlin-2B dense temporal captions | visual-only event recall and exact frame timestamp source correctness; no LLM timestamps unsupported |
| E5 director | Qwen3.5-4B MLX Q4 | Gemma 4 E4B 4-bit and E2B | judge agreement with blinded editors, structured invalid responses, setup/payoff coverage, peak RSS |
| E6 V4-014 | canonical Qwen3-VL-Embedding-2B implementation | Swift/MLX port or MLX Python variant | repeatable semantic query ranking/parity and full-source coverage |
| E7 final-judge | render-only gates | independent real encoded MP4 AV reinspection | false-pass A/V corruption, captions desync, wrong speaker, missing payoff |

## Gold set protocol

- ≥20 user-authorized long-form sources, separately partition creators/sessions; categories podcast, humorous banter, gaming/streaming, visually-dependent moments, deadpan jokes, silent/low-audio moments, boring controls, multiple speakers, background soundtrack and negative laugh tracks.
- Annotate event category, objective spans (scene/speech/audio) with uncertainty and publishable clip start/end reference, not only viral-score labels. Two blinded independent human reviewers of actual rendered clips; option 'none publishable'. Log disagreements.
- Generate and freeze source hashes, target K/duration, theme prompts, ASR language, exact Mac chip/OS/RAM, memory pressure, models+weights SHA, runtime version, prompt, determinism parameters, clip hashes.
- Evaluate recall of all independently annotated positive events including late-decile positives; editor publishable Top-K; context preservation; min/median manual edit time; exact cut edge, caption sync, crop active-speaker misframing, audio defects, export fps/PTS.
- Compare rate of completion without swap thrash, frozen UI, crash/pressure recovery, elapsed wall clock, peak RSS/Metal/VM footprint. No test may assert fabricated metrics or hosted inference without marking it.

## Acceptance for a promoted model

- Correct real source span references and no hallucinated scene evidence.
- No collapse of full-source/late-duration recall, no omitted speech/audio/visual independent lanes.
- Strict original V4 model parity gates still respected unless owner approves contract change.
- No commercial-use license blocker for shipped checkpoint or vendored code.
- Report a **measured improvement with confidence intervals or at minimum per-source paired outcomes** in human publishability or core task recall; otherwise keep challenger feature-flagged and do not replace default.
- On 16 GiB, safe completion and saved/resumable checkpoints without runaway swap or OS panic. On 8 GiB, honest degraded/blocked statuses if verified impossible.

## Negative examples required

Non-humorous loud music, fake audience laughter, YouTube intro laugh-track, background TV voice, excited speech without payoff, text-only punchline with calm voice, visual-only reaction to a quiet sentence, foreign-language names, overlapping crosstalk, non-speaking face visible, person speaking off camera, scene after last 90% of video, VFR and frame gaps, newly rendered clip with muted track, missing captions, corrupted last frame.

## Files Claude must produce on-device

`mac_measurements.json` (actual 16 GiB run; OS/metal/RSS/swap/context), `model_registry_resolved.json` (revisions/hashes/licenses), `source_coverage.json` (per lane by decile), `candidate_events.json` (source evidence IDs), `blind_review.csv` (separated sessions), `export_validation.json` (measured playback), `ablation_results.json` (machine and human metrics), and a status report including BLOCKED tasks. These are named output targets, not present measurements.
