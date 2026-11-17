# ENGINE V4 — Detailprüfung und verbindliche Übergabekorrekturen

**Prüfung:** 16. November 2026. **Spezifikationsrevision:** 4.1. Die in Shortme zu implementierende Pipeline-/Engine-Version bleibt `4.0` und die vierte Engine-ID `engine4`.

## Freigabestatus des Pakets

**JA: als Entwicklungsauftrag an Claude Code übergeben. NEIN: nicht als fertig implementierte oder produktionsreife Engine verstehen.**

Das originale Shortme-Repository, echte interne Videodateien und Windows-RTX-Hardware sind nicht enthalten. Kein Mensch kann allein aus dieser ZIP den realen App-Anschluss verifizieren. Das Paket spezifiziert eine umfassende Implementierung und überprüfbare Mindestbelege; Claude muss unmittelbar im echten Shortme-Repo entwickeln. Keine theoretische Garantie, dass Claude alle Aufgaben in einer einzigen Session abschließen kann.

## Prüfung von oben nach unten

| Bereich | Befund | Aktion dieser Revision |
|---|---|---|
| 00 Start | V4 als zusätzliche vierte Engine richtig definiert | Einstieg und Reviewstatus aktualisiert |
| 01 Master | Guter verbindlicher Arbeitsauftrag, aber doppelte Status-Terminologie | Auf `pending`, `in_progress`, `blocked`, `failed`, `passed` vereinheitlicht |
| 02 Pipeline | Vier unabhängige Retrievalwege, Eventgraph, Cut-Graph, Repair gut; Rubrik hatte andere Namen als JSON-Schema | Genau die 10 Schema-IDs synchronisiert |
| 03 Datenverträge | Run-/TimeMap-/Evidence-Konzept richtig; Produktdaten liegen oft im User-Project außerhalb des Git-Repos | Gate akzeptiert echte Run-Traces innerhalb des Projekt-Runverzeichnisses, nicht nur im Source-Repo |
| 04 Stages S0–S9 | Verantwortlichkeiten und Reihenfolge vollständig | Evidence-Log-Hash als Pflicht nachgezogen |
| 05 Testing | Unterscheidung Kern/Qualität richtig; Precision-Bezeichnung war irreführend | Human-usable Precision ausdrücklich von temporaler Matching-Proxy getrennt |
| 06 GitHub/Lizenzen | jevcut MIT, Qwen/ASR/MiniCPM Apache, VideoHighlighter AGPL | LongVideoAgent **nur als Design** behandeln, solange keine explizite Lizenz geklärt ist; kein fremder Code blind übernehmen |
| 07 Anti-Shortcut | Gute Reporting-Vorgaben; alter Gate war nur receipt-lint | Real ffprobe, Run-Korrelation, getrackte Traces, Source-Deciles, Qualitätsmanifest ergänzt |
| 08 Copy/Paste | Klare Implementierungsanweisung | auf revidierte Proof-Regeln und Qwen-V4-014 hingewiesen |
| 09 Hardware/Modelle | Hardwareannahmen vorsichtig; V4-014 explizit Qwen, aber Hardware-Doc erlaubte Ersatz ohne Vertragsänderung | Qwen2B bei V4-014 als Muss, dokumentierte genehmigte Vertragsänderung für einen Ersatz erforderlich |
| 10 Local prompts | Strukturierte Outputs statt Zeit-Halluzinationen | Eindeutige `schema`-Validierung; min/max 10 verschiedene Qualitäts-IDs |
| requirements | Genau 54 IDs: 50 Core, 4 Quality | SHA und Liste **unverändert**. Keine Scope-Reduktion |
| reference_core | Referenzfunktionen, keine echte Engine | `pause`/`speech-pause` und `action`/`action-transition` im Edge-Prefilter angeglichen |
| tools/gate | Alte Run-Probe prüfte nur behauptete `streams`, letzte 10%, keine Quality-Belege | Echte Datei erneut mit ffprobe geprüft, 10 Source-Decile-Lanes, Modell-Traces/Runmanifest, separates Quality-Manifest; Tests hinzugefügt |
| tools/eval | `precisionAtK` war nur zeitliche Gold-Event-Übereinstimmung | umbenannt in `temporalMatchPrecisionProxyAtK` (kein menschliches Publishability-Urteil) |
| Altpakete | Verschachtelte V3/V3.5 ZIPs enthielten potenziell widersprechende Instruktionen | **Aus dieser Übergabe entfernt**. `reference_core` bleibt als klar markierte Referenz |

## Zusätzliche Muss-Kriterien für den produktiven Nachweis

1. `ENGINE_V4_EVIDENCE.json`: Für jede `passed` ID Code-/Testpfade, tatsächlich ausgeführter Testbefehl, Exitcode 0, `testLog` **und `testLogSha256`**. Eine Logdatei zu benennen ist kein Beweis, dass das Kommando wirklich lief; ein Mensch muss einen repräsentativen Ausschnitt nachvollziehen.
2. `ENGINE_V4_RUN_PROOF.json`: `runManifestAbsolutePath` verweist auf das **wirkliche** `manifest.json` des V4-Runs in den Projektdateien. `sourceSha256`, `engineId`, `runId` stimmen überein. `sourceMediaAbsolutePath` und `outputMediaAbsolutePath` existieren und bestehen unabhängig wiederholtes `ffprobe` und SHA-Prüfung.
3. In der primären AV-E2E-Referenz müssen Quelle und Output **Video + Audio** enthalten. **Separat** werden echte ohne-Audio-, ohne-Sprache- und Silent-Videos getestet, wobei Audio-Judgement `not-applicable` korrekt begründet wird. So wird eine optionale Audiospur nicht künstlich erfunden.
4. `modelCalls`: reale `modelRevision`, `realInputModalities`, `tracePath` (relativ zum Run-Verzeichnis oder absolut dort), `success`. AV-Verifikation darf **ein gemeinsames Modell mit Audio+Video** oder zwei tatsächlich synchronisierte Spezialmodelle mit gleichen `windowId` und `verificationGroupId` verwenden. Für Output-Judgement muss `inputArtifactSha256` der gerenderten Datei entsprechen. Die gesamte ID-/Belegkette muss im Run einsehbar sein.
5. `coverage`: Pro Lane `speech`, `audio`, `visual` mindestens ein wirklicher `inspected`-Bereich in **jedem** Source-Dezil; diese Mindestprobe beweist noch keine lückenlose semantische Sichtung. Das Produkt muss für die vollständige Quelle außerdem den Sampling-/Full-Scan-Plan und tatsächliche Clip-Recall-Qualität nachweisen.
6. `ENGINE_V4_QUALITY_EVIDENCE.json`: In `docs` eine Datei nach dem folgenden Schema erstellen, **erst wenn echte private Bewertungsdaten vorliegen**. Details:
   - `sources`: mindestens 20 Objekte mit eindeutigem `sourceSha256` (64 Hex), `genre` aus `podcast|twitch|gaming|rap|no-speech|negative` (alle Kategorien vertreten), `authorized:true`, `labelsPath` (lesbare echte JSON-Datei, absolut oder repo-relativ), `reviewers` mit mindestens zwei verschiedenen `{reviewerId,blind:true,ratingsPath}` pro Quelle. Reale Reviewer sollten die Zuordnung zur Engine nicht sehen.
   - `benchmarkReport`: `{measured:true, reportPath:"...", enginesCompared:["engine1","engine2","engine3","engine4"], metrics:["eventRecall","boundary","standalone","editMinutes"]}`; Report-JSON muss existieren.
   - `ablationReport`: `{measured:true, reportPath:"...", componentsTested:["video","audio","investigator","cut","repair"]}`; Report-JSON muss existieren.
   - Ein leeres Template ist in `examples/quality_evidence.EMPTY_TEMPLATE.json`. Es darf das Quality-Gate **nicht** bestehen. Kein künstlicher Goldkorpus und keine selbsterfundenen menschlichen Ratings.
7. Model-JSON-`final_judge.schema.json`: genau 10 unterschiedliche IDs, je eine für `hook`, `standalone`, `payoff`, `natural-end`, `audio-seam`, `visual-seam`, `essential-event`, `caption-sync`, `crop-safety`, `dead-air`. Ein `acceptable` muss durch zusätzliche **produktive** Policy-Regeln aus Einzelkriterien abgeleitet werden; das Schema allein erzwingt diese logische Beziehung nicht.
8. Benchmark-`temporalMatchPrecisionProxyAtK` ist **keine echte Präzision nutzbarer Clips**. Human-usable Precision, Clip-Qualität, Edit-Zeit und eventbasierte Recall müssen getrennt erfasst werden. Matching-Regeln vor Evaluation einfrieren; Output nicht auf privaten Holdout optimieren.

## Befehle im tatsächlichen Shortme-Repo

```bash
python -m unittest discover -s docs/implementation/shortme-engine-v4/tests -v
python docs/implementation/shortme-engine-v4/tools/v4_gate.py --repo . --init
python docs/implementation/shortme-engine-v4/tools/v4_gate.py --repo . --level core --json
python docs/implementation/shortme-engine-v4/tools/v4_gate.py --repo . --level all --json
```

**Wichtig zur Kontrolle:** Schon ein `--level core == PASS` liefert nur die formale Receipt-Prüfung; das Tool **führt die eingetragenen Tests nicht selbst aus** und kann die semantische Wahrheit von Modelltraces oder unabhängige menschliche Bewertungen nicht garantieren. Eine reale Windows-App-Demo mit mindestens einem nachvollziehbaren Original-Video-Run, Decoder-/Audio-Test und manueller Clip-Prüfung ist daher **zwingend**. Eine Single-Session-Verkürzung, ein grüner UI-Screenshot oder nur synthetische Tests sind keine Abnahme.

## Externe Entscheidungen und Blocker

- Ohne Shortme-Quellcode keine Integrationsevaluierung.
- Ohne echte autorisierte Medien keine multimodale E2E-Abnahme.
- Ohne Windows-Testmaschine keine Behauptung Windows 12/16/32GB-Funktion.
- Ohne zwei unabhängige Reviewer und 20 Quellen keine geprüfte Qualitätssteigerung.
- Falls die V4-Core-Engine technisch läuft, der Holdout aber schlechter abschneidet als V1–V3, ist **Qualität nicht freigegeben**; dann Ablation und gezielte Iteration. Ein freigegebenes Softwarefeature und ein nachgewiesener Qualitätsvorteil sind verschiedene Entscheidungen.

## Ergänzende Forschungsprüfung (16.11.2026)

Siehe `12_QUALITY_FRONTIER_AND_CANDIDATES.md`: VideoITG hat **nichtkommerziell** lizenzierte Forschungsgewichte, ClipTalk zeigt Active-Speaker-Vorgehen, Kinocut bietet Media-Receipts. Diese Funde rechtfertigen kontrollierte Feature-/Ablationstests, **keine** ungeprüften zusätzlichen Pflicht-Stacks und **keinen** absoluten Spitzenqualitäts-Claim.
