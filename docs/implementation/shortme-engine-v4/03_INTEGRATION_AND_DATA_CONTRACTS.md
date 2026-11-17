# V4 – technische Verträge und echte App-Integration

**Normativ sind die Invarianten**; Typ-/Modulpfade sind Beispiele und müssen an echte Repo-Struktur angepasst werden. Alte V1–V3-Schemas nicht destruktiv migrieren.

## Engine-Registry und Run-Isolation

```ts
type EngineId = ExistingEngine1 | ExistingEngine2 | ExistingEngine3 | 'engine4';
interface EngineManifest {
  id: 'engine4'; displayName: 'Engine 4'; pipeline: 'adaptive-event-intelligence';
  pipelineVersion: '4.0'; protocolVersion: 1; supportedProfiles: ('fast'|'balanced'|'deep')[];
}
type RunKind = 'full-source-analysis' | 'clip-recheck';
interface V4Run {
  runId: string; projectId: string; engineId: 'engine4'; kind: RunKind;
  source: {mediaId: string; sha256: string; durationPts: string; timebaseNum: number; timebaseDen: number};
  snapshot: {gitSha: string; configSha256: string; modelRevisions: Record<string,string>;
             weightHashes: Record<string,string>; promptVersions: Record<string,string>;
             queryRevision: string; seed: number; profile: 'fast'|'balanced'|'deep'};
  status: 'queued'|'running'|'partial'|'completed'|'cancelled'|'failed';
  createdAt: string; finishedAt?: string;
}
```

**Invariants:** `engine4` darf nicht `engine3` dispatchen. Shared Media cache *mit* Version-Key okay; Results/edits nie still überschreiben. Fallbacks im `modelRevisions`-Snapshot. Altprojekte bleiben mit vorhandenen IDs aufrufbar. UI muss Run-ID transparent anzeigen.

## Medien, Belege, Source-Zeit

Verwende Source-PTS Integer/Rational (oder existing präzises TimeMap-System) intern, nicht ungeprüfte float-seconds. Validieren: finite, monoton, `end > start`, within source, `TimeMap` nur eine autoritative Zuordnung. VFR, Audio-Startoffset, mehrere Streams, sample rate und variable Frameraten schützen.

```ts
type Span = {startPts: string; endPts: string; timebaseId: string};
type Evidence = {
 id: string; runId: string; modality: 'video'|'audio'|'speech'|'chat'|'metadata';
 span: Span; modelId: string; checkpointSha?: string; state: 'observed'|'inferred'|'unknown';
 framePts?: string[]; audioSampleRange?: [number,number]; wordIds?: string[];
 observation: string; featureRevision: string;
};
type CandidateSeed = {id:string;lane:'speech'|'audio'|'visual'|'cross-modal';anchorPts:string;span:Span;evidenceIds:string[];rank:number};
type EventRole = 'setup'|'trigger'|'action'|'reaction'|'payoff'|'context'|'unknown';
type EventNode = {id:string;role:EventRole;span:Span;state:'observed'|'inferred'|'unknown';evidenceIds:string[]};
type EventGraph = {id:string;runId:string;seedIds:string[];nodes:EventNode[];relations:{from:string;to:string;kind:string;evidenceIds:string[]}[]};
type CutEdge = {id:string;pts:string;kind:'sentence'|'pause'|'speaker'|'shot'|'audio-phrase'|'action'|'reaction'|'source-boundary'|'manual';isMeasured:boolean;evidenceIds:string[]};
type CutVariant = {id:string;eventId:string;keep:Array<{startEdgeId:string;endEdgeId:string}>;sourceTimeMapId:string;outputPts:string};
type Judgement = {variantId:string;outputSha256:string;evaluatedRenderedOutput:boolean;
 criteria:{id:string;state:'pass'|'fail'|'unknown'|'not-applicable';reason:string;evidenceIds:string[]}[];
 decision:'acceptable'|'needs-review'|'reject'};
```

Local Judge Responses: schema validated, IDs must exist and belong to same run; invalid JSON -> failure/retry within bounded budget then `unknown`. `observed` with zero evidence reject; fabricated `edgeId` reject; audio judged while no audio passed reject. For `not-applicable`, prove absent stream with ffprobe. No unstable chat-style parser as source of truth.

## Worker und Modell-Lifecycle

- Reuse bestehendes Sidecar, bevorzugt versioniertes JSON-RPC via stdio (oder existing secure IPC), typed operation list: `health`, `model_status`, `probe_source`, `cheap_features`, `transcribe`, `align_words`, `embed_video`, `query_index`, `audio_event`, `inspect_video`, `inspect_audio`, `inspect_av`, `judge_rendered_clip`, `cancel`, `unload`, `shutdown`.
- Main owns media authorization, Run state, GPU exclusive job queue, model revision locks. Child darf keine frei formulierten ASR-Worte als shell/path ausführen. Input allowlist und no shell=True. Timeouts, max items, max windows, caps on payload and resource budgets.
- Fallback: low VRAM **reale** lokale Modellalternative mit markierten Qualitäts-/Featureunterschieden. „Model not loaded“ != „passed“. Modelle sequentiell laden/entladen bei 16 GB; pin Python env (uv/venv) für Windows Packager.
- Download/Model management nur über explizite vom Nutzer ausgelöste Installation/Verfügbarkeit; keine versteckten Netz-Aufrufe im Analyse-Lauf.

## Filesystem/Persistenz (an Repo anpassen)

```
projects/<project>/analysis/shared/<source-sha>/<feature-revision>/...
projects/<project>/analysis/runs/<run-id>/
  manifest.json  coverage.json  candidates.json  evidence.json
  investigation.jsonl  event_graphs.json  cut_edges.json
  variants.json  actual_preview.mp4  verdicts.json  repairs.json
  clips.json  errors.jsonl
projects/<project>/analysis/compare/<compare-id>.json
```

Atomic temp write + fsync + rename; stage snapshot hashes, cache invalidation when model/ASR/prompt changes; source hash changes invalidate dependent stages. Restore partial with no fake `completed`. Existing Timeline/Clip Editor metadata is authoritative, do not create a second conflicting timeline.

## Vergleich und UX

Existing single-video project: Run button allows engine 1..4; 4 runs independently. Compare screen 4 columns when space permits (mobile/compact 2x2), synchronized source seek, play/pause and scene matching, engine blind mode, provenance visible after unblind. User may reanalyze original source for new discovery vs independently rejudge selected clip; only full-source eligible for recall. Engine 4 clip opens in editor; caption/audio/crop remain editable; non-destructive Undo/Redo; export verifies actual streams.

## Sicherheits- und Release-Checks

- no arbitrary `subprocess(shell=True)`; sanitize FFmpeg args paths, temporary dir isolation, IPC input size; no unsafe model code download without review (some models require `trust_remote_code` -> vet and pin snapshot).
- model weight/code dependencies with exact SHA, source, license and verified inference commands. AGPL/noncommercial checkpoint out of default commercial runtime unless approved.
- cancel, crash/resume, shutdown, stale cache, insufficient RAM, Windows paths, installer and uninstall clear temp not private user project assets.

## Proof-Pfade für den überarbeiteten Abnahmeprüfer

Source-/Run-/Model-Traces dürfen in echten User-Projektverzeichnissen **außerhalb des Git-Repositories** liegen; sie müssen mit `runManifestAbsolutePath` unter demselben Runverzeichnis referenziert werden. Nur Produktcode/Testcode/Testlogs sind als repo-relative Pfade in `ENGINE_V4_EVIDENCE.json` anzugeben. `testLogSha256` ist erforderlich. Die primäre E2E-Probe enthält Bild+Ton; No-Audio-Fälle separat mit `not-applicable` prüfen. Siehe `11_AUDIT_AND_SIGNOFF.md`.
