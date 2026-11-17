# MASTER-AUFTRAG AN CLAUDE CODE – ENGINE V4 ALS VIERTE VOLLSTÄNDIGE ENGINE

## 0. Ausführungsmodus

Du arbeitest **im geöffneten echten Shortme-Repository**. Nicht erklären, planen und anschließend als abgeschlossen melden, sondern **Code entwickeln, anschließen, ausführen, debuggen, nachweisen**. Autorisierung: lokale Python-Worker, normale lokale Entwicklung, nicht destruktive Änderungen und Modellinstallationen nach überprüften Lizenzen. Fremde Änderungen erhalten. Kein Zwang zu Rückfragen nach jedem Arbeitsschritt. Keine externen KI-Cloud-APIs, Uploads, versteckte Telemetrie oder Lizenzverletzung. Keine Behauptung vollständiger Umsetzung bei noch fehlenden Tests/HW/Medien.

**ENTSCHEIDENDE VORGABE:** Ergänze `Engine 4` als vierte echte Wahl. **Nicht** die Pipeline der Engine 3 ersetzen, nicht `engine3` intern auf `4.0` umbenennen, nicht nur Engine 4 als UI-String an V3 hängen. Engine 1, 2 und 3 bleiben funktionsfähig, Daten/Edits isoliert, Vergleich mit **allen vier Engines**.

## 1. Normative Dateien (alle lesen, nicht nur Zusammenfassung)

`00_START_HERE.md`, **diese Datei**, `02_PRODUCT_PIPELINE_SPEC.md`, `03_INTEGRATION_AND_DATA_CONTRACTS.md`, `04_IMPLEMENTATION_SEQUENCE.md`, `05_TESTS_AND_RELEASE_GATES.md`, `06_RESEARCH_AND_LICENSES.md`, `07_PROGRESS_AND_ANTI_SHORTCUT.md`, `09_DECISIONS_AND_HARDWARE.md`, `10_LOCAL_MODEL_PROMPTS_AND_JSON_SCHEMAS.md`, `11_AUDIT_AND_SIGNOFF.md`, `12_QUALITY_FRONTIER_AND_CANDIDATES.md`, `requirements/v4_requirements.json` und vorhandene App- und Engine-Unterlagen. Alte V3/V3.5-ZIPs sind **historische Referenz**, keine konkurrierenden Instruktionen. Bei Widerspruch Vorrang: reale Projekt-Sicherheitsanforderungen/Bestandsschutz > dieses V4-Muss-Ziel > alte V3.5 Referenzen.

## 2. Definition des erwarteten Endergebnisses

- Nutzer sieht **Engine 1 / Engine 2 / Engine 3 / Engine 4** in der bestehenden App.
- V4 startet **neue eigenständige lokale Analysepipeline** (keine V3-Reuse unter falscher Bezeichnung; gemeinsame harmlose Infrastruktur wiederverwenden).
- Ein 1–6-stündiger Podcast / Just-Chatting-Stream / Gaming-Mitschnitt wird über die **gesamte Länge** günstig indexiert; **Text**, **Audio**, **Video** entdecken unabhängig Kandidaten.
- Lokales echtes Video-Retrieval, AV-Prüfung mit echten Mediendaten, adaptiver Investigator, evidenzgedeckter Event-Graph, Cut-Lattice aus gemessenen echten Edges, Clip-Varianten, **Rendering mit Ton**, Final-Artifact-Judge und begrenzte automatische Reparatur sind tatsächlich an den **produktiven Dispatcher** angeschlossen.
- V4 liefert editierbare, mit Audio synchronisierte Clips, Projektpersistenz, Preview und Export. Sie zeigt zu jedem Event Herkunft, Eventrollen, Unklarheiten, Schnittedges und jede Änderung.
- V1–V4 lassen sich auf **der gleichen Originaldatei** neu analysieren und nebeneinander oder nacheinander vergleichen; **Clip-Recheck** ist eine andere Funktion und geht nicht als Original-Find-Recall in die Benchmarks ein.
- Windows-first, lokal/offline zur Laufzeit, Windows-kompatibles Python-Sidecar, klare 12/16/32-GB-Profile, Cache, Cancel/Retry, atomare Writes, stabile Run-IDs.
- Echte Benchmarks gegen Alt-Engines und menschliche Blindratings, keine behaupteten Verbesserungen ohne Daten.

## 3. Verbindliche Umsetzung ohne Abkürzungen

1. Lies vor Änderung `CLAUDE.md`, `AGENTS.md`, README, package.json, Skripte, Tests, Engine Dispatcher, Worker, Modell-/Frame-/ASR-Caches, Editor, Captions, FFmpeg und lokale DB. Schreibe `docs/ENGINE_V4_BASELINE.md` mit Pfaden, git SHA und echten Testausgaben. Kein destruktiver Cleanup.
2. Erstelle im Repo `docs/ENGINE_V4_TRACEABILITY.md` als Tabelle aller 54 IDs aus dem JSON. Jede ID muss genau eine Implementierungsstelle, Tests und Real-Media-Beleg erhalten; zu Beginn `NOT_STARTED`. Ändere nicht die Anforderungen, um den Gate-Check grün zu bekommen.
3. Baue in kleinen **vertikalen Slices**: Source → echte Model Outputs → Kandidaten → Event → Edge → MP4 → Judge → Editor. Nach jedem Slice Tests ausführen und Logs notieren. UI nur zusammen mit funktionierendem Backend.
4. Implementiere **alle** `core`-Anforderungen aus `requirements/v4_requirements.json`. **Kein optional / nice-to-have** für Kernfunktionen. Falls eine Bibliothek oder ein Modell nicht auf Zielhardware läuft, implementiere einen **tatsächlich lokal lauffähigen** Ersatz derselben Funktion, dokumentiere Abweichung und teste ihn mit echten Medien. Eine Dummyklasse und `TODO` sind kein Ersatz. Optional ist nur der exakte Modellname, nicht die Fähigkeiten oder Tests.
5. Forschungsideen wie jevcut/LongVideoAgent **portieren als Design**, keine Forschungsstacks blind vendoren. Kein OpenRouter/TypeSafe/Lemonfox im Offline-Pfad. Prüfe jede genutzte Code-/Weights-/Transitive-Lizenz, locke Revisions/Hashes.
6. Setze Artefakt-Judge auf den **gerenderten Output mit tatsächlichem Audio/Video** an, nicht nur auf Transkript/Metadaten. Repair bis max 2 begründete Änderungen und erneutes Decodieren. Grenzpunkte ausschließlich aus Edge-IDs, keine halluzinierten Start-/Endsekunden.
7. Implementiere Vollquellen-Reanalyse, Run-Vergleich 1/2/3/4, Recheck, diffbare Ergebnisse, Editierbarkeit, Export, Schutz von User-Edits, unterbrechbare Jobs.
8. Nach Code/Tests: `tools/v4_probe_media.py` auf echten E2E-Clips, `tools/v4_gate.py` auf alle Anforderungen. Gate rot bedeutet **nicht fertig**. Ein synthetischer FFmpeg-Smoke ist nützlich, beweist aber nur Integrität, nicht gute Highlights.
9. `quality`-IDs (echter Holdout, zwei Menschen, Blindbewertung, Ablations) sind Bestandteil des **Produktabnahmeplans**. Fehlen private gelabelte Videos oder Reviewer, `BLOCKED_EXTERNAL_INPUT`, aber **nicht** Produkt-/Qualitätsfreigabe behaupten. An allen anderen umsetzbaren Aufgaben weiterarbeiten.
10. Status nach jeder Stage und vor Sessionende exakt mit `passed`, `in_progress`, `blocked`, `failed`, `pending` je ID aktualisieren. Nur `passed` mit vollständigen Belegen wird vom Gate akzeptiert. `in_progress` umfasst implementiert, aber noch nicht echt getestet; `blocked` nennt den konkreten externen Input.

## 4. Verpflichtender Zwischenbericht, falls ich frage „wie weit?“

Antworte **nicht** mit „fertig“, „90 %“ oder vagem Fortschritt. Gib: (a) Gesamtanforderungen Anzahl; (b) belegte grüne IDs; (c) implementiert-aber-nicht-real-getestet; (d) blockiert; (e) nicht begonnen; (f) zuletzt ausgeführtes Kommando mit Exitcode und Log; (g) welches echte V4-Video/Artefakt zuletzt erzeugt wurde; (h) drei nächste konkrete Tasks. Jede Zahl muss aus `v4_requirements.json` + `ENGINE_V4_EVIDENCE.json` ermittelt sein. Zwischenstand durch `python .../tools/v4_gate.py --repo . --level core --json` reproduzierbar.

## 5. Nicht zulässige Erfolgsmeldungen

- keine „V4 fertig“, wenn nur Auswahl-UI / Serviceklasse / Mocksmoke / referenzierter GitHub-Code existiert;
- kein „multimodal“, wenn der visuelle Suchweg nur ASR-Text rankt;
- kein „AV geprüft“, wenn Modell nur Frames ohne Waveform sieht;
- kein „selbstoptimierend“, wenn nur LLM-Prompt bei Replay nochmal identisch läuft;
- kein „alle Videos untersucht“, wenn Coverage nur 5 min scannt oder letzte Stunde fehlt;
- kein „besser als V3“, wenn kein Blind-Holdout-Vergleich vorliegt;
- keine Sicherheits- oder Lizenzfreigabe ohne echte Version-/Assetprüfung;
- kein `pass`, wenn Tests übersprungen, gefälscht, rot oder nur Mock waren.

## 6. Abschlussbedingung und Umgang mit äußeren Blockern

Die Arbeit **nicht freiwillig** nach S3/S5 abbrechen. Führe S0–S9 in `04_IMPLEMENTATION_SEQUENCE.md` aus. Implementierung und Tests ohne echte Hardware müssen weiter möglich bleiben, aber fehlende RTX-Smoketests transparent als blockiert markieren. Keine erfundenen Behauptungen oder Artefakte. `Engineering complete` nur bei `v4_gate --level core == 0` **plus menschlich überprüftem realen E2E-Screenrecord/Run**. `Quality validated` separat: `--level all == 0` und echte Qualitätsschwelle gegen Alt-Engines erreicht. Ist V4 technisch fertig, aber in Qualitätsmessung unterlegen, verbessere Ursache durch datengestützte Ablation und reevaluiere – verkaufe keinen bloßen Umbau als Erfolg.

**STARTE JETZT mit S0; danach S1 und einem ersten echten End-to-End-Vertikalschnitt.** Lies nicht nur diese eine Datei, sondern alle Pflichtdocs, entwickle die produktive App vollständig bis zum Abnahmekriterium, oder melde präzise verbleibende Blocker und unvollständige IDs.
