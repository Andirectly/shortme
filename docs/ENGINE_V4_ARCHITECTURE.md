# Engine 4 – Architektur (an echte Pfade gebunden)

Engine-ID `engine4`, Anzeige „Engine 4“, Pipeline `adaptive-event-intelligence` 4.0, Lauf-IDs `v4-…`. Engines 1–3 unverändert (Dispatcher-Zweige `legacy`, `multimodal-v2`, `adaptive-v3`).

```
UI (StartScreen / EngineSwitch: 4 Optionen, Profil)          src/renderer/src/shortme/*
  └ IPC shortme:transcribe / engineSelect / recompute        src/main/shortme/ipc.ts, engineIpc.ts, preload
      └ runAnalysis (Job, RunInfo, Layout, clips.json)       src/main/shortme/clips/analysis.ts
          └ runSelection → engine4 → selectV4                src/main/shortme/clips/engines/index.ts
              └ v4/index.ts (Orchestrator)
                 S2 probe.ts/media.ts  ffprobe + SHA-256 + PTS/Timebase, Cache analysis/shared/source-v4.json
                    ASR = gespeichertes Parakeet-Transkript, YAMNet (v2/audioIndex), Keyframes (v2/visualIndex)
                 S3 lanes.ts  speech (llama-server, v2/search.textSearch) · audio (YAMNet + Pegel) · visual (Keyframe-Diff)
                              · cross-modal (Qwen3-VL-Embedding-2B, v3/embedIndex, Anfragebank + Erweiterung)
                    core.ts fuseSeeds/selectBalanced (RRF je Lane, reservierte Budgets, Zeit-Zehntel)
                 S4 investigate.ts  MiniCPM-o (Python-Worker, analyze_av) je Gruppe, Operationen aus fester Liste, Folgefenster
                    core.ts buildGraph (Rollen nur mit Fundstelle, „caused“ nur inferred)
                 S5 cut.ts  Kanten (Satzende, Pause, Shot, Aktion, Tonphrase, Quellgrenze) → Gitter → Cut-Judge (MiniCPM-o, Kanten-IDs)
                    → 2–3 Varianten (judge-choice, context-safe, hook-first, natural-payoff)
                 S6 finalize.ts  layoutForClip + exportClip (ASS-Untertitel, 9:16, Ton) → probeOutput → Endprüfung
                    (MiniCPM-o an der Ausgabedatei + Messungen: Stille, Nähte, Untertitel-TimeMap, Ausschnitt) → Reparatur ≤ 2 → rankFinal
              ← ShortmeClip[] (source 'v4', engine 'engine4') → gemeinsamer Editor/Export
```

## GPU-Phasen (einzige Sperre: `VramSequencer`)
`llm` (Sprach-Lane) → `v3-embed` (Index + Anfragen) → `v3-av` (Investigator, Cut-Judge, Rendern, Endprüfung, Reparatur). Nie zwei große Modelle gleichzeitig. Gerendert wird während der AV-Phase (FFmpeg, ONNX-Layout).

## Lauf-Ordner `projects/<hash>/analysis/runs/<runId>/`
`manifest.json` (Quelle, Snapshot, Status queued/running/partial/completed/cancelled/failed, Stufenzeiten, Fehler), `coverage.json` (Fenster je Lane + Zehntel), `candidates.json`, `evidence.json`, `investigation.jsonl`, `event_graphs.json`, `cut_edges.json`, `variants.json`, `verdicts.json`, `repairs.json`, `selection.json`, `model_calls.json`, `traces/c####-<rolle>.json`, `previews/<variante>-r<runde>/*.mp4` (tatsächlich gerenderte Clips), `clips.json` (von `runAnalysis`), `errors.json`.
Gemeinsame, versionierte Caches: `analysis/shared/source-v4.json`, `embeddings/<modell>/<rev>/<fingerprint>/`, `audio-series` (YAMNet).

## Zeit
Intern Quellsekunden aus der Probe (`durationPts`/Timebase im Manifest). Alle Grenzen nach außen sind Kanten-IDs; Ausgabe-Zeitachse = `TimeMap` des Exporters (`render/timeline.ts`), dieselbe für Vorschau, Untertitel und Export.

## Vergleich
`src/shared/compare.ts`, `clips/compare.ts`, `CompareScreen.tsx`/`CompareSync.tsx`: 2–4 Läufe, blinde Varianten A–D, Quellzeit-Wiedergabe, Clip-Recheck (Engine 2 oder Engine 4) getrennt gespeichert.

## Abschaltbar
`SHORTME_ENGINE4=off` oder Datei `<Daten>/engine4.disabled` → Engine 4 meldet sich als nicht verfügbar; Engines 1–3 laufen unverändert.
