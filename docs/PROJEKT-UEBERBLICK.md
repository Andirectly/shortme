# Shortme – Projektüberblick (Stand 21.10.2026)

Zweck dieser Datei: Claude Chat (oder jede neue Sitzung) soll in fünf Minuten verstehen, **was Shortme ist, was gebaut und installiert wurde, wo es Schwierigkeiten gab und was offen ist**. Details stehen in `docs/PROGRESS.md` (Chronik), `CLAUDE.md` („Gelerntes“), `docs/MODELS.md` (Modelle/Werkzeuge/Lizenzen), `docs/PIPELINE.md`, `docs/DESIGN.md`.

## 1. Was ist Shortme?
Lokale Windows-Desktop-App (Electron + TypeScript + React/Vite, Zustand): **lange Videos → kurze vertikale Clips** (1080×1920) mit animierten Untertiteln, Viralitäts-Ranking, Sprecher-Tracking, Editor und Export. Ersatz für Opus Clip, **komplett offline** (keine Cloud-APIs). Nutzung nur privat durch den Entwickler (zwei eigene Rechner). Basis: Fork von ClipForge (intern „Cutawan 0.14“, Datenordner `%APPDATA%\cutawan`). Installation: `C:\Users\Andirectly\AppData\Local\Programs\Shortme`. Zielhardware: NVIDIA ≥ 12 GB VRAM (Entwicklungsrechner: RTX 5090, 32 GB).

**Feste Entscheidungen (nicht neu diskutieren):** Electron statt Tauri · keine Cloud · fester Ausschnitt pro Einstellung, harter Schnitt bei Sprecherwechsel · Untertitel als reine Daten (Wörter + Zeit + Tags + Preset-ID), Renderer austauschbar · **Vorschau = Export** (gleicher Planungs-/Render-Code) · Bearbeitungen nicht-destruktiv als Operationen (Undo/Redo = Cursor im Log) · Design dunkel, Glas, Mica, Apple-Bewegungsprinzipien · ASR und LLM nie gleichzeitig im VRAM · Qwen3-14B bleibt Standard-LLM · Modelle nur nach Entscheidung im Testlab ersetzen, nie automatisch löschen · keine weiteren Katalog-Kandidaten ohne Auftrag integrieren.

## 2. Pipeline in Kürze
1. **Import** (Datei, Link über yt-dlp, Twitch) → Projekt unter `<Daten>/projects/<hash>/` (Hash = Größe + 3×4 MB).
2. **Transkription**: sherpa-onnx, Parakeet TDT 0.6B v3 int8 (Wortzeiten nativ), läuft als Kindprozess in eigener Node-22-Laufzeit.
3. **Analyse**: Signale (Lautstärke), Kamerawechsel (TransNetV2), Audio-Ereignisse (YAMNet: Lachen/Applaus/laut/Pause), Themen-Durchgang, „Most replayed“-Heatmap (YouTube), optional Twitch-Chat.
4. **Clip-Auswahl** durch das LLM (llama.cpp `llama-server`, Qwen3-14B Q4_K_M): wählt über Satznummern, Einrasten auf Wort → Satz → Stille → Kamerawechsel; Ranking: Belege vor Noten, grobe Skala, Paarvergleich.
5. **Layout**: Gesichter (YuNet/SCRFD), Pose-Köpfe (YOLOv8n-pose), Tracking (IoU oder BoT-SORT-ReID), Sprecher (LR-ASD), Personen-Wiedererkennung (Gesichts-Embeddings). Planer `shared/layoutPlan.ts` → Shots (smart/split/fit/fixed/**stream**).
6. **Editor**: Operationslog (`shared/edits.ts`), Vorschau per Canvas (`shared/previewDraw.ts`), Export per FFmpeg-Filtergraph (`render/graph.ts`), Untertitel per tscaps (Standard) oder ASS (Fallback) oder Remotion (Testlab-Alternative), Titel-Overlay (Offscreen-Fenster → PNG-Folge → FFmpeg).

## 3. Meilensteine (Kurzfassung, Details in PROGRESS.md)
- **M0–M8**: Fork analysiert, Modell-Spikes, neue UI (`src/renderer/src/shortme/`), Engines/Downloader/Modell-Manager, Projekte + Transkription, Clip-Auswahl, Layout-Planer, Export, Editor, **NSIS-Installer** (`npm run package`).
- **M9–M13**: Auswahlqualität, Untertitel-Gruppierung nach Zeichenbudget, tscaps-Animationen.
- **M14–M15**: Pose-/Embedding-basierte Personenerkennung, „Wer ist wer?“-Dialog, Stufen-Diagnose; Modell-Spike Gemma 4 12B / Qwen3.8 27B (Qwen3-14B bleibt), Heatmap, Audio-Ereignisse, Themen, Daumen-Feedback.
- **Testlab**: Nebeneinander-Vergleich von Modellen je „Platz“ (Gesichtserkennung, Tracking, Untertitel-Renderer) mit Messwerten; `resources/models-catalog.json` + `<Daten>/models-state.json`; Entscheidungen schreiben `docs/MODELS.md`. SCRFD-10G und BoT-SORT-ReID als Alternativen integriert, **YuNet und IoU-Tracker bleiben aktiv bis zur Entscheidung des Nutzers**.
- **M16 Untertitel/Titel/Presets**: Preset-Format v2 (Schrift, Größe in px, Kontur, Schatten, Glow, Box, Animationen), Glow Karaoke (Standard), TikTok-Titel mit runden verbundenen Boxen, Animations-Tab, Presets speichern/überschreiben/importieren/exportieren, eigene Schriften. Eingebaute Presets ≈ 66–84 px (bewusst klein).
- **M17 Remotion im Testlab**: Komposition `captions-remotion/` (gleiche Presets/Daten), Export als Overlay-Bildfolge; **tscaps bleibt aktiv**. Messung: 60 s ≈ 24,5 s (tscaps, +2 MB) vs. ≈ 51 s (Remotion, +370 MB).
- **M18 Aufräumen**: Editor-Seitenleiste breiter/kompakter, Erklärtexte entfernt, Vollbild („Ganzes Bild“) automatisch bei winzigen Personen/Gruppen ohne Sprecher.
- **M19 Twitch-Paket**: Streamlink + TwitchDownloaderCLI (wie yt-dlp zur Laufzeit nach `<Daten>/bin`), VOD-/Clip-/Kanal-Import über das normale Import-Feld, „Letzte N Minuten“ eines laufenden VODs, **Live-Puffer** (Tab „Live“, Ringpuffer 10-s-Segmente, Badge), stumme VOD-Abschnitte erkennen und ausschließen, Twitch-Token in der Windows-Anmeldeinformationsverwaltung, **Chat strikt opt-in** (Ranking-Signal + `[Chat lacht]`), verständliche Fehlermeldungen.
- **M20 Inhaltstyp + Facecam-Layout**: Typ-Auswahl im Erstellen-Dialog (Podcast / Vlog / Solo / Stream-Gaming / Vortrag) mit automatischem Vorschlag, Profile in `resources/profiles/*.json`, Layout **Facecam + Gameplay** (oben 1/3:2/3, 50:50, unten, kleines Fenster, Abstand) mit Facecam-Erkennung über Kanten, Editor mit zwei verschiebbaren Rahmen, Kanal-Layouts, Untertitel an der Naht.

## 4. Was ist installiert / mitgeliefert?
**Im Installer:** FFmpeg/FFprobe (ffmpeg-static 6.1), Prompts (`resources/prompts`), Profile (`resources/profiles`), Schriften, yt-dlp-Plugins, Modellkatalog, Remotion-Bundle (`resources/remotion-bundle`), kleine Vision-Modelle (LR-ASD, YuNet, UltraFace, Silero-VAD).
**Zur Laufzeit geladen (Datenordner `%APPDATA%\cutawan`):**
- Modell-Manager: Parakeet v3, Silero-VAD, TransNetV2, YOLOv8n-pose, Gesichts-Embedding, YAMNet, Node-Laufzeit (für ASR), Speaker-Modelle (optional), **Qwen3-14B Q4_K_M** + `llama-server` (CUDA-Build).
- `bin/`: yt-dlp (selbst-aktualisierend), Streamlink 8.6.2 (Windows-Build), TwitchDownloaderCLI 1.56.5 (erst beim ersten Chat-Download), `cred.ps1` (Token-Zugriff).
- Remotion: Chrome Headless Shell (~295 MB) beim ersten Remotion-Export unter `<Daten>/.remotion`.
Lizenzen der Werkzeuge: siehe `docs/MODELS.md` (Streamlink BSD-2, TwitchDownloader MIT, yt-dlp Unlicense; Ganymede nur als Logik-Vorlage gelesen).

## 5. Dateilandkarte (wichtigste Orte)
- `src/main/pipeline/` – ffmpeg, asd, yunet/scrfd, tracker, ytdlp (aus ClipForge)
- `src/main/shortme/` – Import, Projekte, Transkription, `clips/` (Analyse, Auswahl, Signale), `layout/` (Planer-Anbindung, **facecam.ts**, streamShots, suggest), `render/` (exporter, graph, captionPass, titleOverlay, ass), `ipc.ts`, `profiles.ts`
- `src/main/engines/` – Katalog, Downloader, Manager, Sidecars, Systemcheck
- `src/main/twitch/` – tools, import, live, liveChat, chat, silence, token, settings, ipc
- `src/main/testlab/`, `src/main/remotion/`
- `src/shared/` – **gemeinsamer Code Main/Renderer**: edits, framing, previewDraw, layoutPlan, preset, captions, title, **streamLayout**, camEdges, videoKind, twitch
- `src/renderer/src/shortme/` – Screens (Start, Projekte, Clips, Editor, Live, Studio, Modelle, Testlab, Einstellungen), `ui.tsx`, `tokens.css`
- `captions-remotion/` – Remotion-Komposition + Bundle-Skript
- `scripts/` – Abnahmeskripte (test-engines, test-twitch, test-live, test-stream*, cdp.cjs für Fenster-Tests …)
- `tests/` – vitest (908 Tests grün)
- `docs/` – PROGRESS, MODELS (generiert), PIPELINE, DESIGN, ROADMAP, REVIEW, HIGHLIGHTS …

## 6. Arbeitsweise / Konventionen
- Antworten und UI auf **Deutsch**, knapp (Skill `credit-saver`). Nur Aufgabe umsetzen, nichts nebenbei refaktorieren.
- Nach jedem Paket: Tests/Typecheck, `docs/PROGRESS.md`, „Gelerntes“ in `CLAUDE.md`, Commit. **Installer bauen und Installation upgraden nur auf Zuruf** (Shortme ggf. schließen; Installation per PowerShell `Start-Process … /S /D=…`).
- Test mit echtem Material: öffentliche Twitch-VODs, `test-videos/` (podcast-2p, solo, nofaces), Rotpilz-Livemitschnitt. Fenster-Tests über `node scripts/cdp.cjs <port> eval|shot` mit `electron . --remote-debugging-port=<port>`.
- Erklärtexte in der UI sind unerwünscht (nur kurze Pflichthinweise, z. B. Twitch-Rechtehinweis).

## 7. Schwierigkeiten und Lösungen (Auswahl)
- **sherpa-onnx-node crasht in Electron** → ASR als Kindprozess in eigener Node-Laufzeit; Worker beendet sich nie selbst.
- **Diarisierung (pyannote+WeSpeaker) übersegmentiert** (4 statt 2 Sprecher) → optional/aus.
- **TransNetV2 nur auf CPU** (DirectML bringt nichts bzw. ist langsamer; ReID-Modell auf DirectML ebenfalls langsamer → CPU).
- **LLM hält Längenvorgaben nicht ein** → Länge per Einrast-Logik erzwingen; Untertitel-Korrektur manchmal verworfen („Wortzahl ≠“) → sauberer Fallback.
- **tscaps**: friert CSS-Animationen ein und spult per negativer `animation-delay` → eigene `@keyframes` brauchen `animation-delay: var(--on-segment-starts, 0s)`; kein `backdrop-filter`; Engine sieht nur Schriften aus der übergebenen CSS.
- **FFmpeg 6.1**: `-filter_complex_script` entfällt → `-/filter_complex <datei>`; Filterketten nie mit `\\,` in JS-Strings bauen.
- **Windows**: `rename` über vorhandene Datei (EPERM/EBUSY → Wiederholung); winCodeSign braucht Symlink-Recht → `signAndEditExecutable=false`; Bash/MSYS verstümmelt `/S`-Argumente; asarUnpack für alles, was externe Node-Laufzeit lädt.
- **Remotion**: Ordnername `remotion/` überschattete `import 'remotion'` (baseUrl) → `captions-remotion/`; `react`/`react-dom`/`remotion` müssen **Laufzeit**-Abhängigkeiten sein (sonst fällt das Paket still auf tscaps zurück); Chrome-Download-Ordner hängt am cwd; erster Remotion-Export im Paket ~284 s (Download).
- **Twitch**: laufendes VOD = neuestes Archiv mit `is_live`; TwitchDownloaderCLI `--version` endet mit Code ≠ 0; Twitch-VODs können in Teilen **stumm** sein (geschützte Musik) – echtes Beispiel gefunden und ausgeschlossen; Live-Puffer läuft im Main-Prozess weiter, Segmente werden beim Stoppen/Start gelöscht.
- **Facecam-Erkennung**: erste Versionen nahmen Innenkanten der Kamera statt des Rahmens → gelöst durch Kanten-Median über alle Zeilen/Spalten + gemeinsame Wahl nach Seitenverhältnis (16:9/4:3/1:1) mit Bildrand als Kante; Chat direkt unter der Kamera bleibt ausgespart.
- **Gefundene Fehler**: `even()` hat Minimum 2 → Abstand 0 wurde 2 px; Stumme Fehler (`.catch(() => undefined)`) verstecken Bugs; Intermittierender FFmpeg-Exit „3199971767“ bei einem Export (nicht reproduzierbar).
- **Werkzeug-Eigenheiten (Claude Code)**: Bash kollabiert doppelte Backslashes und bricht bei Heredocs mit Apostrophen/Umlaut-Anführungszeichen ab → lange Dateien mit Write/Edit schreiben; `models/` und `spikes/out/` sind per Deny-Regel nicht lesbar; `npm` führt Install-Skripte nicht aus (`node node_modules/electron/install.js`).
- **Lint**: `npm run lint` scannt `reference/` und scheitert dort (vorbestehend); react-hooks-Regeln melden bekannte Altlasten im Editor.

## 8. Offene Punkte / Nicht geprüft
- Remotion: Entscheidung im Testlab steht aus (tscaps aktiv); Remotion mit Stream-Layout/Naht-Position nicht geprüft.
- YuNet vs. SCRFD-10G und IoU- vs. BoT-SORT-Tracker: Entscheidung im Testlab offen.
- Twitch: Live-Puffer mit Token/Werbung/Chat-IRC, Abonnenten-VOD, Chat-Signal an echten Streams ungeprüft; Systemcheck zeigt TwitchDownloaderCLI rot, solange nicht geladen (kein Fehler).
- Inhaltstyp: Vlog/Vortrag an echten Videos ungeprüft; Bearbeitung pro Szene und „Neu berechnen“ im Fenster ungeprüft; Facecam-Ausschnitt nicht auf das Gesicht zentriert (Idee aus openshorts `screencast_layout.py`).
- Bestehende Projekte behalten ihr altes Layout (Typ im Editor umstellen + „Neu berechnen“).
- Leistung auf dem zweiten PC unvermessen; Auswahlqualität mit „Most replayed“ an echten YouTube-Videos nicht ausgewertet; Gemma 4 nicht im Modell-Manager (bewusst).
- Ponytail-Plugin steht in `.claude/settings.json`, wirkt erst in neuer Sitzung.

## 9. Typische nächste Schritte (Vorschläge)
Testlab-Entscheidungen treffen (Renderer, Gesichtserkennung, Tracker) · Stream-Layout mit Remotion prüfen · Facecam-Ausschnitt gesichtszentriert · Vlog/Vortrag an echtem Material testen · Live-Puffer + Chat-Signal im Dauerbetrieb · zweiter Rechner: Installation und Leistung messen.
