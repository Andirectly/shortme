# Tests, Nachweis, E2E und Quality Gate

## Nicht verhandelbare Grundregel

**Statische Tests ≠ echte multimodale Inferenz.** Ein TypeScript-Jest-Test, das lokale `reference_core`, KI-Mocks und synthetische FFmpeg-Probes zeigen Architekturkontrakte, aber nicht die Qualität echter Clips. Beide Arten sind notwendig, dürfen sich jedoch nicht gegenseitig ersetzen.

## Testebenen

| Ebene | Art | Beispiele | Gate |
|---|---|---|---|
| L0 | Unit | Edge-IDs, Eventgraph-Referenzen, schema, Cache Hash, time map | CI |
| L1 | Integration | FFmpeg, worker/IPC, DB, model manager, mock error injection | CI |
| L2 | Real-model | ASR deutsche Sprache, Video Embedding aus Frames, local AV model bekommt Waveform+Frames | Hardware |
| L3 | E2E Real media | Quelle in Engine4 -> Seeds -> Graph -> Cuts -> gerendertes MP4 -> Judge -> Editor/Export | Kernrelease |
| L4 | Vier-Engine | dieselbe Originalquelle alle 4, run isolation, compare/recheck | Kernrelease |
| L5 | Quality | Blind-Holdout, Event Recall, Boundary, Standalone, manuelle Edit-Minuten, Ablation | Qualitätsfreigabe |

## Mindestfälle L0–L3

- Reales Quellmedium 30sec/10min/1h+, letzte 10% Coverage; VFR, Audiooffset, fehlende Audiospur, Stille, Rap/Gesang, deutsch/englisch, Sprecherüberlappung, Gameplay ohne Rede, beschädigte Datei, sehr lange Pause.
- Visual-only Event muss durch `visual`-Lane gefunden werden, wenn ASR leer/aus. Audio-only Reaktion muss ohne Bild-Text-Query erfassbar sein.
- Deterministische Cut-Point-Lattice: nur **gemessene** Start-/End-Edge-IDs; Start vor Referent → standalone fail; End vor Pointe → fail; Reparatur erweitert den richtigen Edge; neues OutputSHA danach neu geprüft.
- Judge sieht decodiertes rendered MP4 + echten Audio-Input, beweist keine Fälschung: `evaluatedRenderedOutput=true` nur mit outputSHA und tatsächlichem Input. Fehlender Stream => begründetes not-applicable.
- Gap edit/Captions-Reencode: alle Words nach TimeMap richtig, kein Drift bei 59.94/23.976fps, Audio-Sample auf richtige Quelle.
- Single-GPU: 12/16/32 GB real soweit verfügbar; keine ungetesteten VRAM-Claims. OOM degradiert klar oder blockiert; nicht Dummy-Fortsetzung.
- App: vier echte Engine-Paths, Migration Altprojekt, cancel/kill/restart/retry, Zugriff nur erlaubte lokale Medienpfade, Unicode/Windows Filepaths.

## E2E-Nachweis-Pflicht

Speichere ein `ENGINE_V4_RUN_PROOF.json` (synthetische Textzahlen nicht ausreichend), dessen `runId` mit `analysis/runs/<run-id>` übereinstimmt, `engineId=engine4`, `runKind=full-source-analysis`, `sourceSha256`, `sourceMediaAbsolutePath`, `outputMediaAbsolutePath`, `outputSha256`, `modelCalls` (`role`, `modelRevision`, `realInputModalities`, `success`, `tracePath`), `coverage` (`lane`, `startPts`, `endPts`, `inspected`) und `eventIds`, `clipIds`, `judgementIds`, `timeMapId`. Probe `v4_probe_media.py` auf output und Source; ffprobe muss Audio-/Videostreams entsprechend der Quellspuren bestätigen. Der probe kann keine Modellgüte beweisen – echte Trace/Model-Samples manuell abgleichen.

## Bewertung: klare Definitionen

- Event Recall @ K: Anteil menschlich positiver Events mit mindestens einem passenden V4-Event über temporales Intervall/Peak innerhalb vorab fixierter Matching-Regeln. Niemand darf reine Clip-Rechecks als neue Discovery zählen.
- Human-usable Precision @ K: Anteil der Top-K-Kandidaten, die unabhängige Reviewer als publizierbar klassifizieren. K für alle 4 Engines identisch. **Nicht** gleichsetzen mit dem rein zeitlichen `temporalMatchPrecisionProxyAtK` aus `tools/v4_eval.py`.
- Both Boundary Acceptable: Start **und** Ende liegen im vorher festgelegten Akzeptanzband, in Bezug zur Quelle.
- Standalone/Payoff: zwei menschliche Rater bewerten ohne ursprüngliches langes Video; echtes Audio und tatsächlicher finales MP4.
- Edit time: reale Zeit, bis Editor final veröffentlicht; zähle manuelle Trim-/Caption-/Crop-Minuten.
- Resource: sec processing / hour footage, peak VRAM, CPU RAM, cache reuse, failed windows und modellseitige Kosten lokal.
- Confidence: pro Quellaufnahme, Gruppierung nach Creator/Session statt zufällig einzelne Clips mischen.

## Pilot-Corpus und Blindtest

Mindestens 20 verschiedene autorisierte *Originalmedien*, getrennte Creator/Session-Gruppen und negative Gegenbeispiele. Für jede echte Quelle: sha, Dauer, Genre, Sprachart, Gold-Events + accepted start/end bands, 2 unabhängige Reviewer. Kein Tuning auf geheimem Holdout. Bewertung nach festem Protokoll, randomisierte Engine Labels, getrennte Clip-Recheck-Messung, A/B/C/D-Vergleich, Tie/None-Option. Report `not-measured` wo kein Test stattfand.

## Sinnvolle Zielwerte – ausdrücklich **Hypothesen**, keine garantierten Verbesserungen

Technik: `core gate pass`, 100% verpflichtete Stage Coverage *laut tatsächlich gespeicherten Coverage Windows*, keine ungültigen timestamps, finale MP4s decodierbar und synchron.

Qualität: V4 muss nach unabhängiger Stichprobe in mindestens **einem primären Endpunkt** besser abschneiden als stärkste Alt-Engine, ohne relevante Regression bei Precision, Standalone oder Schnittqualität; praktische Reduktion der Editierzeit priorisieren. Statistik inkl. Konfidenz-/Ungewissheitsangabe, keine Signifikanz behaupten, falls zu wenige Aufnahmen. Die expliziten minimalen Freigabeschwellen anhand Baseline vor Tuning festlegen und dokumentieren. Ist die Qualität schlechter: Engineering kann grün sein, Quality Gate bleibt rot, gezielte Iteration.

## Abnahme

`tools/v4_gate.py --repo . --level core` prüft dokumentierte Anforderungen, Code-Dateien/Tests/Exitcodes und existierende Logs. `--level all` verlangt zusätzlich die Qualitäts-IDs. Das Gate beweist nicht, dass Menschen ehrlich reviewed oder ein Modell wahrheitsgetreu ist; ein unabhängiger Entwickler muss vor Release mindestens 1 realen V4-Run und ein Sampleclip auf der Zielmaschine überprüfen.
