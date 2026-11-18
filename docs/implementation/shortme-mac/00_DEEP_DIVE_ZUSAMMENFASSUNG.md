# ShortMe macOS — neue Research-Ergebnisse, 18.11.2026

Diese ZIP ist ein **ergänztes Claude-Code-Implementierungspaket**, keine lauffähige Mac-App. Enthält das ursprüngliche 16-GB-Paket, die unveränderte V4-Referenz, neue Recherchen, einen Vorschlag zur Modellentscheidung und einen Testplan. **Keines der neuen Modelle wurde auf dem 16-GB-Mac des Nutzers ausgeführt.** Eine Qualitätssteigerung ist Hypothese, nicht Messwert.

## Die wichtigste Änderung

Statt nur Qwen3-VL-Embedding-2B + ASR + VLM zu betrachten, sollen die besten Kandidaten pro *Aufgabe* gegeneinander getestet werden:

1. **Leichte Audio-Events auf dem ganzen Video:** Apple SoundAnalysis (`SNClassifySoundRequest`/`SNAudioFileAnalyzer`) erkennt u. a. Lachen/Applaus; alternative YAMNet/LAION CLAP2 bei messbaren Fehlern.
2. **Spracherkennung:** **FluidAudio Parakeet Ultra** als neuer DE/EN-Hauptkandidat (Sep. 2026); Parakeet v3 als Vergleich und Redux als speichersparende Alternative. Apple SpeechAnalyzer/SpeechTranscriber auf unterstützten Systemen sowie WhisperKit vergleichen; Wortzeitstempel separat benchmarken. Offizielle FLEURS-24-Sprachen-Mittelwerte: Ultra 11,67 % WER vs v3 14,81 % (keine spezifische deutsche ShortMe-Messung).
3. **Videokontext:** Marlin-2B (z. B. `NemoStation/Marlin-2B-MLX-8bit`) für dichte visuelle Ereignisbeschreibungen und zeitliche Verortung gegen Qwen3.5-4B, Qwen3-VL-4B testen. `marlin-mlx` ist macOS 26+, alternative MLX-Pfade prüfen.
4. **Semantische Bild-/Videowiederauffindung:** Das V4-relevante `Qwen/Qwen3-VL-Embedding-2B` mit vorhandenem Swift/MLX-Port weiterhin separat untersuchen; Marlin ersetzt **nicht** automatisch dessen V4-Pflichtfunktion.
5. **Lokaler Regisseur:** Qwen3.5-4B-Instruct-MLX-4bit vs Gemma 4 E4B 4-bit vs kleinere E2B; Humoreinschätzung erst nach Evidenz-Fusion. Gemma 4 E4B kann Audio sowie Video als Framefolge untersuchen; **das offizielle Gemma-4-E4B-Checkpoint ist Apache-2.0-lizenziert** (anders als ältere Gemma-Generationen). Die genaue Quantisierung und alle eingebundenen Dependencies separat prüfen.
6. **Qualitätsregeln:** Signal-basierte Kandidaten + Sprachkandidaten + reine Bildkandidaten + kontrollierte Kanten/Render/Final-Judge aus V4 beibehalten; nie nur dem LLM die Suche überlassen.

## Sehr wichtige rechtliche Entdeckung

`omine-me/LaughterSegmentation` ist MIT als Code, aber das veröffentlichte **trainierte Modell ist ausdrücklich research-use-only**. Nicht in kommerzielles ShortMe übernehmen. NVIDIA VideoITG-Weights ebenfalls nichtkommerzielle Forschungsgewichte, siehe bestehende V4-Referenz.

## Einstieg für Claude Code

1. Paket in echtes ShortMe-Repository bei `docs/implementation/shortme-mac/` einfügen. Bestehende Änderungen nicht überschreiben.
2. `01_CLAUDE_CODE_MASTER_PROMPT.md` für Gesamtimplementierung benutzen.
3. Für dieses Research-Upgrade zusätzlich `02_CLAUDE_CODE_RESEARCH_UPGRADE_PROMPT.md` ausführen. Dokumente 10–13 lesen.
4. Zuerst echtes Repo auditieren, dann auf **einem realen Mac mit 16 GiB** einen Modell-PoC, Speicher- und Qualitätsvergleich durchführen; keine ungemessenen Gewissheiten.

Die Quellen und Mess-/Lizenzgrenzen stehen in den neuen Dateien. Recherche = GitHub-Projektangaben, offizielle Apple/Google/HF-Dokumentation und Reddit-Erfahrungen (nicht unabhängige Mac-Benchmarks).

## Zusätzliche verifizierte Funde

- **Parakeet Ultra** (September 2026): offizieller FluidAudio-Vergleich 11,67 % mittlere FLEURS-WER statt 14,81 % bei v3; deutscher Creator-Test offen. Redux als platzsparender Kandidat.
- **Gemma 4 E2B/E4B:** offizielle Modellgewichte **Apache 2.0**, nicht die früheren Gemma Terms. Originale Modellkarte und exakte Quantisierung prüfen.
- **Swift Qwen3-VL-Embedding:** veröffentlicht numerische Referenz-Parität; GPU-Peak 4,6–6,6 GB wurde aber auf M5 Max mit 128 GB gemessen, nicht auf 16 GB.
- **Marlin:** 8-Bit-Gewicht ca. 2,5 GB ist nicht gleich tatsächlicher Laufzeit-RAM; marlin-cli nennt ~16 GB im warmen Betrieb.

Siehe `docs/14_VERIFIED_LATE_2026_FINDINGS.md` für Links, Grenzen und Claude-Code-A/B-Tests.
