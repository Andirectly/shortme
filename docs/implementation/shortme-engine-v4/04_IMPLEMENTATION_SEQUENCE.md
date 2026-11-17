# Verbindliche Implementierungsreihenfolge – S0 bis S9 ohne freiwilliges Abbrechen

**Regel:** Jede Stage ist als vertikale reale Funktion abgeschlossen, nicht als Dokument oder Stub. `requirements/v4_requirements.json` ist vollständig zu implementieren. Alte V3/V3.5-Referenz darf als Denkhilfe dienen, **nicht als Nachweis**.

| Stage | IDs | Wirklich umzusetzende Lieferung | Abnahme vor nächster Phase |
|---|---|---|---|
| **S0 Bestand** | 001–003 | Dispatcher, DB, Tests, Modelle, Windows-Packaging nachvollziehen | Baseline sha, Tests, Architekturdiagramm mit echten Dateipfaden |
| **S1 Engine4** | 004–008 | vierte UI-Auswahl + separater Dispatcher + persistierter Job + Sidecar | echter neuer Engine4-Run als eigener Datensatz; V1–V3 Regression |
| **S2 Medien und lokale Modelle** | 009–016 | ffprobe, VFR/PTS, vollständige cheap pass, ASR, audio, visual, Qwen Video-Index, AV verifier | echte Testmedien; Video-Embedding nicht ASR-only; lokal/offline; Lizenzen |
| **S3 Recall** | 017–022 | vier Kandidatenquellen, Querybank, Lane-Kontingente, Fusion, Evidence | Speech-only/audio-only/visual-only, letzten 10% und negative Clips |
| **S4 Investigate** | 023–027 | budgetierter Investigator, Kontextfenster, Graph/Belege, Trace | echter Zweitfenster-Toolcall auf unklarem Event, unknown statt Erfindung |
| **S5 Jevcut Cuts** | 028–032 | real gemessene Cut Edges, IDs, lokale Auswahl, Varianten, TimeMap | falsche Edge-ID scheitert, Standalone/Payoff/Timing Integration |
| **S6 Render & Repair** | 033–038 | echte MP4-Audio+Video, Judge auf Output, Repair mit Re-Render, Ranking, Captions | absichtlich abgeschnittene Pointe wird erkannt und gezielt geändert |
| **S7 Product UI** | 039–042 | Provenienz-UI, vier Wege im Vergleich, Clip-Recheck, Editor/Export | Produkt-UI arbeitet mit Backend nicht Mock, V1–4 compare |
| **S8 Stabilität** | 043–047 | cache, VRAM, Windows installer, IPC security, Cancel/Resume | Fehlerfälle ausführbar, clean Windows first-run test, Lizenzen |
| **S9 reale Abnahme** | 048–054 | tatsächliche E2E-, V1–4-Vergleichs- und Holdout-Messungen | technische `core`-Gate grün; Qualität nur mit echten Labels behaupten |

## Arbeitsprotokoll pro Task (niemals nur TODO-Liste)

1. Root-Repo-Dateien durch `rg`, Tests und Debug verstehen; `git status` protokollieren; fremde Änderungen nicht resetten.
2. Pro ID: Produktcode + Tests + echte Medienprobepfade + Runlogs. Kein `pass`, solange nur Dateien existieren.
3. In `docs/ENGINE_V4_EVIDENCE.json` den tatsächlichen Implementierungsbeleg speichern (Startschema durch `v4_gate.py --init` erzeugen). Pro ID `implementationFiles`, `testFiles`, `testCommand`, `testExitCode`, `testLog`, `testLogSha256`, `realMediaRunId` (für marker `real_media`). Beim Testlog **wirkliche** Ausgabe dokumentieren. Pfade nur innerhalb des echten Repos, Ausgabeclips/Private Labels dürfen außerhalb liegen, aber RunProof verifiziert die Daten.
4. Für `S2` zuerst ein 60s reales Probevideo – dann längere Stunde; danach `S3` mit Bildern, bei no-speech pass; anschließend `S4` und direkt output-render bis `S6`. Nicht Monate nur Infrastruktur bauen.
5. Fortschritt alle Stages in `docs/ENGINE_V4_STATUS.md`: Anzahl IDs per Zustand, fehlende Kernfeatures, Modell-GPU-Status, Repo commit und nächster Task.
6. Stage-Berichte sind Zwischenstände; Claude soll **nicht** nach Stage S5 mit „fertig“ abschließen. Wenn Sessionlänge begrenzt, speichere deterministischen Resume-Handoff `docs/ENGINE_V4_NEXT_SESSION.md` mit unvollständigen IDs und exakten Repro-Kommandos. Ein Handoff ist **keine** Freigabe.

## Nachweispakete im echten Repo

- `docs/ENGINE_V4_BASELINE.md`, `docs/ENGINE_V4_ARCHITECTURE.md`, `docs/ENGINE_V4_TRACEABILITY.md`, `docs/ENGINE_V4_MODELS.md`, `docs/ENGINE_V4_STATUS.md`, `docs/ENGINE_V4_BENCHMARKS.md`, `docs/ENGINE_V4_DECISIONS.md`, `docs/ENGINE_V4_NEXT_SESSION.md`, `docs/ENGINE_V4_EVIDENCE.json`;
- neue/angepasste **produktive** TypeScript/React/Electron/Python-Dateien, Modellmanager/Worker, Tests und ggf. Migrations; keine parallele fremde App;
- `docs/ENGINE_V4_RUN_PROOF.json` mit CLI-generiertem ffprobe-Media-Smokebeleg und korrelierten tatsächlich gespeicherten Run IDs; private Videodateien nicht verpflichtend in Git;
- `docs/ENGINE_V4_RELEASE_REPORT.md` mit Gates/Logs, Hardware und A/B-Resultaten und Limitierungen;
- Repro-Befehle: Setup, unit, integration, Windows build, offline inference, real E2E, compare, benchmark, `v4_gate`.

## Strategisches Prinzip

**Nicht** 20 KI-Modelle downloaden. Pflicht ist die **Funktionalität** der unabhängigen echten Modalitäten, adaptiven Verifikation und echten Schnitte. Behalte etablierte Shortme-Komponenten, sofern sie korrekt arbeiten. Ein Model wird nur verwendet, wenn Lizenz, physischer Lauf und Beleg nachgewiesen. Ansonsten einen überprüfbaren lokalen gleichwertigen Pfad implementieren, nicht silently skippen.
