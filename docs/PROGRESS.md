# Fortschritt

## Setup-Korrekturen (vor M0)
- Paketinhalt war nicht eingerichtet: docs/*.md lagen im Root, `.claude/skills` fehlte, `reference/`, `test-videos/` fehlten → nachgeholt, .gitignore ergänzt.
- Testvideos zugeordnet: `podcast-2p.mp4` = "Tattoo"-Video (2 Personen, 12 min), `solo.mp4` = "Gericht für 10€" (1 Person im Bild, 10 min). `nofaces.mp4` fehlt (bekannt) → Prüfungen in docs/REVIEW.md vorgemerkt.
- Fork ist **Cutawan v0.14.0** (Umbenennung von ClipForge), Hardware: RTX 5090 32 GB, Node 24, FFmpeg 9 im PATH.

## M0 – Technik-Spikes (Status: FERTIG, wartet auf Freigabe — Ergebnisse in spikes/RESULTS.md)
Plan:
1. Fork: typecheck + Tests + OpenAI-Aufrufe listen (erledigt, siehe RESULTS.md)
2. ASR: sherpa-onnx-node, Parakeet v3 int8 vs. Whisper large-v3-turbo int8 auf podcast-2p (RTF, Wort-Stichprobe, Zeitstempel)
3. LLM: llama-server CUDA, Qwen3-14B vs. Gemma 3 12B Q4, ctx 16384, JSON-Schema, 5 Läufe je
4. Tracking: Gesichter + LR-ASD (ONNX Runtime GPU), 20 Stichprobenmomente
5. Untertitel-Export: @tscaps/engine in Electron, 60 s 1080×1920, Dauer < 1,5× Echtzeit
Danach Stopp, Ergebnisse + Empfehlung.

## M1 – UI-Prototyp (Status: FERTIG, wartet auf deine Ansicht)
Plan: Tokens/Shell (Mica, Titelleiste, Navigation) → Screens mit Beispieldaten (Start, Erstellen-Sheet, Verarbeitung, Clips, Editor, Stil-Studio, Modelle, Einstellungen) → Prüfung im Browser-Pane.
Geprüft: typecheck/lint grün; alle Screens klickbar; Sheet (Wurfgeste), Zeitleisten-Griffe (1:1, Einrasten), Undo/Redo, Autosave getestet; Scroll 144 fps. Offen für dich: docs/REVIEW.md (M1).
Beispieldaten: 10 Thumbnails aus den Testvideos in `shortme/assets/` (klein, im Repo).

## M2 – Engines & Modell-Manager (Status: FERTIG)
Plan: Katalog mit Prüfsummen → Downloader (Range-Fortsetzen, SHA-256) → Manager (Status, Pause, Import) → Hardware-Erkennung → Sidecars (llama-server, ASR-Worker, Aufräumen) → VRAM-Sequenzierung → Systemcheck → IPC/UI (Modelle, Einstellungen, Assistent).
Ergebnis (scripts/test-engines.ts, frischer Datenordner, 5090): Installation von Silero, TransNetV2, llama.cpp, Node-Laufzeit, Parakeet, Qwen3-14B in 357 s (≈ 10 GB); zweiter Lauf 0 s (nichts erneut geladen); Systemcheck 8/8 grün; ASR 60 s in 2,6 s; LLM antwortet; nach Beenden 0 Sidecars.
Im echten Electron-Prozess (`SHORTME_SELFTEST`): ASR 54 Wörter, llama-server läuft, `before-quit` beendet ihn in 85 ms; Prozess verschwindet in < 1 s (Handle des Elternprozesses).
Unit-Tests: tests/engines.test.ts (11, grün). `npm test`: 733/734 (bekannter Windows-EPERM-Test aus M0).
Wichtige Funde: sherpa-onnx-node läuft NICHT in Electron („External buffers are not allowed“) → ASR als Kindprozess mit eigener Node-22-Laufzeit (Asset `node-runtime`). Sidecars werden in `run/sidecars.json` protokolliert; verwaiste Prozesse werden beim nächsten Start beendet.

## M3 – Import & Transkription (Status: FERTIG)
Plan: Projektordner je Datei-Hash (`projects/<hash>/`) → Vorabprüfung (pure, getestet) → Ambient-Standbild (vorgeblurt) → Audio 16 kHz → ASR im Worker mit Segment-Checkpoints (`asr.jsonl`, Fortsetzen ab letztem Segmentende) → optional Sprecher (pyannote+WeSpeaker) → `transcript.json` (Wörter, Sprecher, VAD-Intervalle) → Cache über Hash → Job-Warteschlange (Pausieren/Stoppen/Verwerfen) → IPC + UI-Anbindung.
Abnahme: beide vorhandenen Testvideos transkribiert; Abbruch mitten in der Transkription setzt fort; zweiter Lauf = Cache (nofaces.mp4 fehlt weiter).
Ergebnis (scripts/test-transcribe.ts, Datenordner mit Modellen): podcast-2p 2282 Wörter / 54 Segmente in 215 s inkl. Sprecher-Erkennung (ASR allein ≈ 30 s); solo 1745 Wörter in 185 s. Abbruch bei 284 s → Checkpoint (20 Segmente), Neustart „Setzt bei 284 s fort“, Ergebnis ≈ Volllauf (Δ 0,39 % Wörter). Zweiter Lauf: Cache, 1–2 ms. Tests: 747/747 grün (inkl. 13 neue in tests/shortme.test.ts; EPERM-Flake in projects.ts behoben).
Offen/Grenzen: nofaces.mp4 fehlt → Prüfung in REVIEW. Sprecher-Erkennung (pyannote+WeSpeaker) übersegmentiert (4/3 Sprecher bei 2 echten) → standardmäßig AUS, Aktiver Sprecher kommt in M5 vor allem aus dem Video (LR-ASD). Quelle der Wahrheit für Wörter ist die Parakeet-Ausgabe; keine Satzzeichen-Nachbearbeitung.

## M4 – Clip-Auswahl & Grenzen (Status: weitgehend fertig, Abnahme offen)
Umgesetzt: Signale (Lautheit, Tempo, Spitzen, Stille; je Video normalisiert), TransNetV2 (CPU, ≈ 0,2× Echtzeit → 60 min ≈ 13 min, für M8 beschleunigen), Prompts als Dateien (resources/prompts), Pipeline Kandidaten → Raster → Ende prüfen → Finalisten-Vergleich → Einrasten in 4 Stufen, Tags, TextTiling-Fallback, Vorschaubilder, IPC + UI (Verarbeitung, Clip-Raster, Editor-Wörter echt).
Geprüft: Unit-Tests snap/select (30, grün, inkl. Fuzz 200 Bereiche: nie Wort angeschnitten, Beginn=Satzanfang, Ende=Satzende, Nachlauf ≤ 0,6 s). Lauf auf podcast-2p (LLM, 23 s) und solo (LLM, 187 s inkl. TransNetV2): je 3 Clips, automatische Randprüfungen PASS.
Offen: manuelle Qualitätsprüfung (REVIEW), voller npm test nach den letzten UI-Änderungen nicht erneut gelaufen, nofaces.mp4 fehlt. Clip-Länge neigt zu 57–81 s (Verlängerung durch „Ende prüfen“) – ggf. Prompt/Grenze tunen.
