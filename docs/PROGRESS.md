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
