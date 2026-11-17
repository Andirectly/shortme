# SHORTME ENGINE V4 – vollständiger Implementierungsauftrag (4. Engine)

**16. November 2026** · VERSION `4.1` (geprüfte Auftragsspezifikation; Produkt-Engine bleibt `4.0`) · Ziel: bestehende Shortme-Desktop-App und **vier echte Engines**.

## WICHTIG: Dies ist nicht die bisherige V3.5

Das ältere Paket `Shortme_Engine_V3_5_Claude_Code_Paket.zip` sagte ausdrücklich *keine vierte Engine*. **Diese Aussage ist hier aufgehoben.** Dieses Paket ist maßgeblich. Neue auswählbare `Engine 4` mit eigenem `engine4`-Dispatcher und separaten Runs; Engines 1/2/3 unverändert. Anstatt nur einen neuen Prompt zu schreiben, wird V4 wirklich im vorhandenen Repository implementiert. Dazu ist der vorhandene Shortme-Code nötig, der **nicht** in diesem Paket liegt.

## Start mit Claude Code

1. Den **Inhalt** des entpackten Ordners `Shortme_Engine_V4_Reviewed/` direkt nach `docs/implementation/shortme-engine-v4/` **im echten Shortme-Repo** kopieren (keine zusätzliche Verzeichnisebene). Bestehende Dateien und früheren V3-Auftrag nicht überschreiben.
2. Claude Code im Root **dieses App-Repositories** starten.
3. Den Text aus **`08_COPY_PASTE_INTO_CLAUDE_CODE.md`** unverändert als Auftrag verwenden. Claude muss danach sämtliche `01–11` lesen.
4. Arbeitsfortschritt in `docs/ENGINE_V4_STATUS.md` und `docs/ENGINE_V4_EVIDENCE.json` pflegen. Die Datei mit den Anforderungen `requirements/v4_requirements.json` ist die **verbindliche Abnahmeliste**. Die Korrekturen und zu liefernden Proof-Formate stehen in `11_AUDIT_AND_SIGNOFF.md`.
5. Gegen Ende mit `python docs/implementation/shortme-engine-v4/tools/v4_gate.py --repo . --level core` (und später `--level all`) prüfen. **Ohne reale Nachweise muss das Gate rot bleiben.**

## Wozu diese Dateien dienen

- `01_CLAUDE_CODE_MASTER_PROMPT.md` – verbindlicher Endzustand, Arbeitsregeln, Stopbedingungen, keine Platzhalter.
- `02_PRODUCT_PIPELINE_SPEC.md` – Algorithmus mit autonomen Event-Suchen und jevcut Cut-Lattice.
- `03_INTEGRATION_AND_DATA_CONTRACTS.md` – App-Dispatcher, Source-PTS, Persistenz, lokale Modelle, Sicherheit.
- `04_IMPLEMENTATION_SEQUENCE.md` – Arbeitspakete, vollständig bis Stage S9, kein Abbruch nach hübschem UI.
- `05_TESTS_AND_RELEASE_GATES.md` – konkrete Qualität, True-AV, Recall, vier Engines, Windows.
- `06_RESEARCH_AND_LICENSES.md` – Repos, was tatsächlich übernommen werden soll, Lizenz- und Cloud-Risiken.
- `07_PROGRESS_AND_ANTI_SHORTCUT.md` – bei halber Umsetzung überprüfbare Aussagen, ohne Selbsttäuschung.
- `08_COPY_PASTE_INTO_CLAUDE_CODE.md` – der eigentliche Startbefehl.
- `09_DECISIONS_AND_HARDWARE.md` – vernünftige verbindliche Modelrollen und Hardware-Fallbacks.
- `requirements/v4_requirements.json` – **54** überprüfbare Muss-Anforderungen.
- `11_AUDIT_AND_SIGNOFF.md` – Reviewbefunde, zusätzliche Proof-Verträge und Freigabegrenzen.
- `10_LOCAL_MODEL_PROMPTS_AND_JSON_SCHEMAS.md` – konkret strukturierte Modellaufträge und Live-JSON-Schemas.
- `tools/v4_eval.py` – ausführbare lokale Auswertung aller vier Engines auf echten Goldlabels, ohne fiktive Benchmarkdaten.
- `schemas/` – strikte Modellentscheidungs-Schemas.
- `tools/v4_gate.py` – Status-/Proof-Auditor mit realem Runmanifest, Trace-Lokalisierung und 10-Decile-Coverage; default FAIL für unbewiesene Implementierung. **Kein Beweis für authentische Modell-/Reviewerleistung**.
- `tools/v4_probe_media.py` – echter ffprobe/Hash-Test für Ausgabeclips (nicht Modellqualitätsnachweis).
- `tests/` – Tests für den Auditor, nicht für eine vorgetäuschte Shortme-Engine.
- `reference_core/` – leicht angeglichene historische V3.5-Referenzalgorithmen zum Adaptieren, **keine komplette KI**.
- Ältere V3/V3.5-ZIPs sind absichtlich **nicht** enthalten, damit Claude Code keine alten widersprüchlichen Instruktionen übernimmt.

## Harte Wahrheit

Der Shortme-Quellcode, eure echten Filme und eine Windows-RTX-Umgebung liegen diesem Chat nicht vor. Deshalb kann dieses Paket **nicht selbst** behaupten, die Engine sei bereits in eurer App eingebaut oder mit GPU getestet. Dafür muss Claude Code im echten Repo die Implementierung durchführen und jede Stage belegen. Ein Textprompt allein kann vollständige Umsetzung nicht garantieren – der technische Gate-Mechanismus macht Lücken aber prüfbar und blockiert die Freigabe.

## Wissenschaftliche / Produktqualität – Forschungs-Update

Lies zusätzlich `12_QUALITY_FRONTIER_AND_CANDIDATES.md`. V4 ist eine starke testbare Architektur, **keine garantierte State-of-the-Art-Shorts-Engine**. VideoITG-Weights sind nicht zur kommerziellen Integration freigegeben; ClipTalk/Kinocut sind Vergleichsreferenzen, keine automatisch einzubauenden Bibliotheken.
