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

## M5 – Tracking & Layouts (Status: FERTIG, Sichtprüfung offen)
Plan: ClipForge-Erkennung (YuNet + LR-ASD, `analyzeClipASD`) weiterverwenden → eigener, reiner Shot-Planer (`src/main/shortme/layout/plan.ts`) nach PIPELINE §6: feste Ausschnitte je Einstellung, Wechsel nur bei ≥ 1,25× Score und ≥ 1 s Führung, Hintergrundgesichter (< 10 %) ignoriert, Subjekt > 12 % gewandert → weiterer fester Ausschnitt, > 3 s ohne Sprecher → mittig fest, ohne Gesicht → fit, Ping-Pong → split; Gesichtsquote ins Ranking (Abzug bis 20 Punkte bei < 60 %).
Geprüft: 12 Unit-Tests (Wechsel als harter Schnitt, Hysterese, kein Ping-Pong, fragmentierte Tracks, Aussetzer, Drift, fit ohne Gesichter, Gesichtsquote). Echte Clips (podcast-2p, solo; scripts/test-layout.ts): Shots lückenlos, keine Shots < 0,75 s, Ausschnitte im Bild; Shot-Zahl nach Aufräumregeln 8–30 je Clip (vorher 14–45).
Grenzen: nofaces.mp4 fehlt (fit-Fallback nur per Unit-Test geprüft). Die Testvideos sind geschnittene Handkamera-Vlogs: viele Einstellungen ohne erkennbares Gesicht (fixed/fit) – Qualität nur per Sichtprüfung beurteilbar. LR-ASD-Analyse ≈ 0,5× Echtzeit pro Clip (3 Clips ≈ 2 min).

## M6 – Rendern, Untertitel, Export (Status: Kern fertig, tscaps-Overlay offen)
Umgesetzt (src/main/shortme/render/): TimeMap als einzige Zeitachsen-Umrechnung, Pausen-Dreifachprüfung (keine Wörter + still + VAD ohne Stimme, 0,15 s bleiben), Sprung-Zoom 1,0 ↔ 1,08 an entfernten Schnitten, filter_complex je Stück (smart/fixed-Crop, fit mit unscharfem Hintergrund, split gestapelt), Lautheit −14 LUFS (2-Pass über bestehendes loudness.ts), NVENC/CPU über bestehendes encoders.ts, ASS-Untertitel (Wort-Hervorhebung, KI-Tags, Hook 0–3 s) direkt im selben Encode, SRT optional, Dateinamen aus dem KI-Titel (Windows-sicher, nummeriert), Export-Job + IPC + Buttons (Clip-Übersicht, Editor), Preset-Export/-Import als JSON-Datei.
Geprüft: 16 Unit-Tests (tests/shortmeRender.test.ts). Echter Export (scripts/test-export.ts, podcast-2p, 2 Clips): 1080×1920, Dauer = Plan (Δ ≤ 0,03 s), Lautheit −14,09/−14,03 LUFS, 0,15× Echtzeit (NVENC), SRT. Standbilder gesichtet: 9:16-Ausschnitte folgen dem Sprecher, Untertitel mit Wort-Hervorhebung.
ABWEICHUNG von der Stack-Entscheidung: Untertitel laufen derzeit über ASS/libass statt @tscaps/engine (der Export in M0 war schnell: 0,09×). Grund: bleibende Arbeit für Tags-per-Index (Tagger), Hook-Overlay und das versteckte Renderfenster; ASS war in diesem Meilenstein sicher lieferbar. Folgearbeit: tscaps-Overlay als Standard mit ASS als Fallback (Datei-Hook: exporter.ts videoPost). Damit ist das Kriterium „Export = Editor-Vorschau“ noch NICHT streng erfüllt (Vorschau ist HTML/CSS, Export libass). Stil-Studio-Regler wirken in der Vorschau, noch nicht im Export (Export nutzt die 5 Presets).
Offen: Logo/Wasserzeichen, Marken-Kit, Export-Profile in der UI (Backend: profiles.ts), „Auf alle anwenden“.

## M7 – Editor (Status: Kern fertig, Sichtprüfung offen)
Umgesetzt: nicht-destruktive Operationen (src/shared/edits.ts: trim, cutWords, hook, caption, layout, follow) mit Cursor-Log (Undo/Redo = Cursor, neue Operation verwirft Redo-Zweig), Autosave als edits/<clip>.json im Projektordner (atomar), Wiederherstellung beim Öffnen; Editor-Oberfläche angebunden (Transkript: Doppelklick schneidet Wörter heraus, Zeitleiste: Griffe rasten an Wortgrenzen, genau ein Undo-Schritt je Ziehen, Hook/Stil/Größe/Position/Hervorhebung, Layout ab Abspielposition, Person in der Quelle anklicken = fester Schnitt dorthin, Sicherheitszonen, „Stil auf alle anwenden“ als Operation je Clip). Export wendet die Operationen an (wirksamer Clip: neue Wortgrenzen, Shots auf neuen Beginn bezogen, herausgeschnittene Wörter als Schnitte).
Geprüft: 9 Unit-Tests (tests/edits.test.ts: jede Operationsfolge vollständig rückgängig machbar, JSON-Roundtrip, defekte Logs, Layout-Teilung ohne Lücken); scripts/test-edits-export.ts (Export mit Edits: kürzer um die entfernten Wörter, neuer Hook, Wörter fehlen in den Untertiteln, Hervorhebung aus, Beschnitt/Undo); UI im Browser-Pane: 2 Schnitte → Undo/Undo/Redo → Neuladen stellt Stand (Cursor 1, Redo möglich) wieder her. npm test 814/814.
Grenzen: Vorschau ist weiter ein Standbild + simulierte Wiedergabe (kein echter Videoplayer), Wellenform ist ein Platzhalter; Trim kann nicht über die ursprünglichen Clipgrenzen hinaus verlängern; Hook-Änderung im Browser-Pane nicht per Skript testbar (Blur-Ereignis) – Logik per Unit-Test abgedeckt; die ASD-Person-Auswahl „Person anklicken“ setzt nur einen festen Ausschnitt (keine automatische Verfolgung ab hier).

## M8 – Installer & Feinschliff (Status: Installer fertig und lokal geprüft, zweiter Rechner offen)
Umgesetzt: electron-builder NSIS (Shortme-Setup-0.14.0.exe, 257 MB, pro Benutzer, Installationsordner wählbar, Updates aus: kein publish/Updater im neuen UI), sherpa-onnx + Worker aus dem asar entpackt (fremde Node-Laufzeit kann kein asar lesen), Prompts als extraResources, Datei-Log (userData/logs/shortme.log, 2 MB + 1 Rotation, console.warn/error, uncaught), Menü „Logs öffnen“, verständliche deutsche Fehlermeldungen (errors.ts, getestet).
Geprüft: Paket (release/win-unpacked) und per stiller Installation installierte App: Selbsttest ASR (54 Wörter) + llama-server (health) + sauberes Beenden aller Kindprozesse; Deinstallation sauber. Unit-Tests 2 neue (errors).
Funde: (1) `/D=` mit Leerzeichen im Pfad lässt den NSIS-Installer abstürzen (Exit 0xC0000005) – Pfad ohne Leerzeichen funktioniert (Standard %LOCALAPPDATA%\\Programs\\Shortme ist unkritisch); (2) electron-builder kann winCodeSign ohne Symlink-Recht (Windows-Entwicklermodus) nicht entpacken → `signAndEditExecutable: false`: die EXE trägt dadurch NICHT das Shortme-Icon (Installer/Verknüpfungen schon über build/icon.png); mit aktiviertem Entwicklermodus Option entfernen; (3) Installer ist 257 MB, Modelle (≈ 10 GB) lädt der Einrichtungs-Assistent beim ersten Start.
Leistung 60-min-Video (synthetisch aus Testvideos, scripts/test-perf60.ts, RTX 5090): Import 0.4 s, Transkription 3.8 min, Analyse+Clips+Layouts 5.5 min, 3 Exporte 0.2 min; Summe bis Clipliste 9.3 min; 11 Clips (llm).
Hinweis Leistung: Transkription 60 min = 228 s (gemessen im ersten Lauf, danach Cache); TransNetV2 jetzt über DirectML (6 ms statt 156 ms je Fenster, Kamerawechsel 60 min ≈ 1 min statt ≈ 19 min). Ergebnis: **60-min-Video bis zur Clipliste ≈ 9,3 min (0,16× Echtzeit)**, 3 Exporte ≈ 14 s. Vorgabe „Leistungsprüfung 60 min Ende-zu-Ende“ erfüllt; Testmaterial synthetisch (Testvideos aneinandergehängt), Clip-Qualität dort nicht beurteilt.
