# 1:1 in Claude Code einfügen (im Root des bestehenden Shortme-App-Repositories)

```text
Du sollst jetzt die vollständige SHORTME ENGINE V4 als vierte, eigenständige, lokal laufende Engine in dieser existierenden App IMPLEMENTIEREN. Nicht nur planen. Nicht V3 umbennen oder überschreiben. Engine 1, 2 und 3 müssen unverändert nutzbar bleiben, Engine 4 wird vierte Auswahl mit echtem Dispatcher und getrennten Runs.

LIES ZUERST VOLLSTÄNDIG alle Dateien in docs/implementation/shortme-engine-v4/ einschließlich 01_CLAUDE_CODE_MASTER_PROMPT.md, 02_PRODUCT_PIPELINE_SPEC.md, 03_INTEGRATION_AND_DATA_CONTRACTS.md, 04_IMPLEMENTATION_SEQUENCE.md, 05_TESTS_AND_RELEASE_GATES.md, 06_RESEARCH_AND_LICENSES.md, 07_PROGRESS_AND_ANTI_SHORTCUT.md, 09_DECISIONS_AND_HARDWARE.md und 10_LOCAL_MODEL_PROMPTS_AND_JSON_SCHEMAS.md sowie 11_AUDIT_AND_SIGNOFF.md und 12_QUALITY_FRONTIER_AND_CANDIDATES.md sowie das unveränderliche requirements/v4_requirements.json mit 54 IDs. Die alten V3.5-Archive sind absichtlich nicht enthalten; deren frühere Anweisung 'keine Engine 4' ist außer Kraft.

Arbeite S0 bis S9 vollständig und direkt am produktiven Repo ab. Nutze echte lokale Qwen Video-Embedding Suche, unabhängige Sprache/Audio/Video Lanes, einen budgetierten LongVideoAgent-inspirierten Investigator, evidence-backed Eventgraph, das jevcut-Prinzip zur Enumeration realer Cut-Edges mit lokalem ID-basiertem Judge, tatsächliche MP4 Renderings mit Audio, Final-Output AV-Check, automatisch begründete Repair-Schleife, Editor/Export/Caption-Konsistenz, Original-Reanalyse, Clip-Recheck und V1/V2/V3/V4 Vergleich. Keine Fake KI, keine Cloud-KI, keine Platzhalter an Pflichtstellen und keine still ausgelassene Teilfunktion.

Initialisiere den Status mit:
python docs/implementation/shortme-engine-v4/tools/v4_gate.py --repo . --init

Führe Tests und E2E auf echten autorisierten Medien aus. Beachte: `V4-014` verlangt den Qwen3-VL-Embedding-2B-Pfad; Ersatz ist ohne explizite, versionierte Freigabe keine erfüllte ID. Die Haupt-E2E-Probe verwendet Audio+Video; Fälle ohne Audio erhalten eigene Tests mit `not-applicable`. Pflichtevidence pro ID in docs/ENGINE_V4_EVIDENCE.json (Codepfade, Testpfade, wirklich ausgeführter Befehl, Exitcode, Log, für ML-Funktionen realMediaRunId). Schreibe auf echter Zielhardware docs/ENGINE_V4_RUN_PROOF.json. Prüfe kontinuierlich:
python docs/implementation/shortme-engine-v4/tools/v4_gate.py --repo . --level core --json

Wenn Core Gate FAIL ist, ist Engine V4 NICHT FERTIG, egal wie weit UI/Code aussieht. Suche die fehlenden IDs und implementiere sie. Das `--level all` Quality Gate verlangt außerdem `docs/ENGINE_V4_QUALITY_EVIDENCE.json` mit echten Holdout-Videos und unabhängiger Review; fehlende externe Medien/Reviewer als blocked kennzeichnen und niemals Qualitätsverbesserung behaupten. Auch dann andere umsetzbare Aufgaben nicht liegen lassen.

Bei Zwischenfrage sage exakt, welche IDs passed/partial/blocked/failed sind; niemals 'fertig' ohne Nachweise. Wenn eine einzelne Coding-Session endet, schreibe docs/ENGINE_V4_NEXT_SESSION.md (Git-SHA, exakte offene IDs und Repro-Kommandos), damit die nächste Session weiter implementiert. START mit Repo-Audit und erste echte vertikale V4-Quelle->Clip-Pipeline, danach ALLE IDs.
```
