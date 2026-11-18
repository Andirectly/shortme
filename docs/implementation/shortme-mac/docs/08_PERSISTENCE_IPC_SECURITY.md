# 08 — IPC, cache/resume, model and data security

## Never break existing projects

Audit actual ShortMe database/config before creating new keys. Use existing IDs/time-map if possible; otherwise add backwards-compatible optional fields and a schema-version migration with tests. `macNative` is a new backend identity; Windows engines/results are read-only to Mac runtime unless a complete compatible port is actually implemented. A successful Mac render should open in the **existing** editor, not a new disconnected list.

## Source time, evidence, output

- A stable `sourceSha256` + original stream PTS/timebase are authoritative. Source offsets/rotation, multiple streams, VFR, audio encoder delay and timebase mapping must survive all stages. No cumulative float-seconds drift.
- Every observed clip reason links `evidenceId`s to actual media spans/ASR words/frame PTS/audio samples. `unknown` is a valid model decision; no unsupported negative / smile / laughter labels.
- Every rendered clip includes output SHA, generated from source + chosen cut edge IDs + crop/caption + renderer revision. Actual output A/V judge must analyze **that** output and rerun after changes.
- `cancel` and `resume` are idempotent; use atomic temp-file + fsync + rename; keep generation/checkpoint version. Crash before checkpoint should not label stage `completed`.

Example directory layout (adapt to original project layout):

```
projects/<id>/analysis/shared/<sourceSha>/<featureRev>/
projects/<id>/analysis/runs/<runUUID>/
  manifest.json
  hardware_snapshots.jsonl
  model_session_metrics.jsonl
  coverage.json
  source_time_map.json
  transcript_words.json
  audio_features.json
  frame_observables.json
  video_embeddings.index
  candidates.json
  evidence.json
  investigations.jsonl
  event_graphs.json
  edges.json
  cut_variants.json
  outputs/<variant>.mp4
  actual_output_verdicts.json
  repair_history.json
  errors.jsonl
projects/<id>/analysis/compare/<compare-id>.json
```

Disk index structures should be versioned and written atomically. On 16 GiB, model heaps are short-lived but evidence on disk persists. Cache invalidation keys include source checksum, PTS mapping, model/quantization hashes, prompt revision, sampler revision and feature schema.

## IPC/security boundaries

No `shell=True` with raw user filenames; argv-safe and URL-safe paths; no arbitrary filesystem paths received directly from LLM. Main app handles sandbox/security-scoped bookmarks for user-granted video paths. Worker operations accept typed bounded inputs and UUID run references only; large raw frames passed via controlled file staging or byte-buffer caps, not huge JSON messages. Model investigator can request only allowlisted window operations; no shell, network or OS control. Download/install is explicit UI action. Filepaths, temp dirs and logs should never leak to cloud APIs.

Verify model SHA before load, reject unreviewed remote code (`trust_remote_code`), enforce timeout/quotas and no hidden package downloads. Encoder binaries/sidecars need correct macOS signatures and permissions. Model weights can be downloaded after installation with consent if redistribute terms are complex. Never delete user projects during uninstall.
