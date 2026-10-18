# Shortme

Lokale Windows-Desktop-App: lange Videos → kurze, vertikale Clips mit animierten Untertiteln,
Viralitäts-Ranking, Sprecher-Tracking und Editor. Ersatz für Opus Clip, komplett offline.
Nutzung ausschließlich privat durch den Entwickler (zwei eigene Rechner). Keine Weitergabe.

## Stack (fest)
- Electron + TypeScript + React (Vite), Zustand für State, Tailwind nur für Layout-Utilities
- Basis: Fork von **ClipForge** (JeremySNR/clip-forge, MIT). Pipeline liegt in `src/main/pipeline/`
- Lokale Engines als mitgelieferte Binärdateien/Native-Module, kein Python zur Laufzeit:
  - Transkription: sherpa-onnx (Parakeet TDT 0.6B v3 int8 oder Whisper large-v3-turbo int8), Muster wie HotClip
  - LLM: llama.cpp `llama-server` (CUDA-Build) als Kindprozess, OpenAI-kompatible API auf localhost
  - Vision: ONNX Runtime (UltraFace/SCRFD, LR-ASD, TransNetV2)
  - Video: FFmpeg (gebündelt), yt-dlp (gebündelt, selbst-aktualisierend)
  - Untertitel: `@tscaps/engine` (CSS, Export per WebCodecs), Fallback ASS/libass
- Zielhardware: NVIDIA ≥ 12 GB VRAM. ASR und LLM nie gleichzeitig im VRAM (sequenziell laden/entladen)
- Modelle werden in der App heruntergeladen (Modell-Manager), nie ins Repo

## Getroffene Entscheidungen – NICHT neu diskutieren
- Electron statt Tauri (Grund: Code aus ClipForge/HotClip/tscaps direkt übernehmbar)
- Keine Cloud-APIs. Jeder OpenAI-Aufruf aus ClipForge wird auf lokale Engines umgestellt
- Kamera: fester Ausschnitt pro Einstellung, harter Schnitt bei Sprecherwechsel (siehe PIPELINE.md)
- Untertitel als reine Daten (Wörter + Zeit + Tags + Preset-ID); Renderer austauschbar
- Vorschau = Export: Vorschau und Export nutzen denselben Planungs-/Render-Code
- Bearbeitungen nicht-destruktiv als Operationen gespeichert (Undo/Redo trivial)
- Design: dunkel, Glas-Ebenen, Mica, Apple-Bewegungsprinzipien (Skill `apple-design`)

## Lizenzen
Private Nutzung → Code aus MIT- UND AGPL-Projekten darf übernommen werden.
Bei übernommenem Code Herkunft als Kommentar im Dateikopf vermerken (`// from: <repo>/<pfad>`).

## Dokumente (nur lesen, wenn der Meilenstein sie braucht)
- `docs/PIPELINE.md` – Ablauf, Algorithmen, Parameter
- `docs/DESIGN.md` – Designsystem, Screens, Editor, Stil-Studio, Export
- `docs/ROADMAP.md` – Meilensteine mit Abnahmekriterien und Referenzpfaden
- `docs/PROMPTS.md` – nur für den Menschen, nicht lesen

## Referenz-Repos
Liegen in `reference/` (nicht im Git). Nur gezielt die in ROADMAP.md genannten Pfade lesen.
Für Suchen in Referenz-Repos einen Subagenten nutzen, der nur eine kurze Zusammenfassung zurückgibt.

## Token-Regeln
- Skill `credit-saver` gilt immer: knapp antworten, nur Diffs, keine unveränderten Dateien ausgeben
- Erst untersuchen, dann ändern. Keinen Code außerhalb der Aufgabe refaktorieren oder umformatieren
- Terminal-Befehle laufen über RTK (Hook ist global installiert). Lange Logs nie komplett lesen:
  nur Fehlerzeilen (`| rtk` bzw. tail/grep)
- Keine Erkundung ohne Ziel: exakte Pfade nutzen. Keine großen Ordner lesen (siehe .claude/settings.json)
- Tests/Skripte geben nur „PASS“ oder kurze Fehlerbeschreibung aus
- Nach jedem Meilenstein: Erkenntnisse unten unter „Gelerntes“ ergänzen (max. 1 Zeile pro Punkt)

## Befehle
- `npm run dev` · `npm test` · `npm run typecheck` · `npm run lint` · `npm run package`
- Testvideos: `test-videos/` (podcast-2p.mp4, solo.mp4, nofaces.mp4) – Abnahme jedes Meilensteins

## Gelerntes
<!-- Claude Code ergänzt hier knappe Erkenntnisse, z. B. Build-Eigenheiten, Pfade, Fallstricke -->
- M0: Fork heißt intern „Cutawan 0.14“; ASD/YuNet/VAD/MFCC/Encoder-Erkennung existieren schon, ASR/LLM-Pfade sind Cloud/Python (openai.ts, resources/local-whisper)
- M0: Parakeet v3 int8 via sherpa-onnx-node: RTF 0,04 (CPU), Wortzeiten nativ → gewählt; Whisper turbo RTF 0,23, keine Wortzeiten
- M0: Qwen3-14B Q4_K_M gewählt (13,6 GB VRAM bei 16k); LLM ignoriert Längenvorgabe → Länge per Einrast-Logik erzwingen
- M0: @tscaps/engine exportiert 60 s in 5,7 s (0,09×) → tscaps ist Standard, ASS nur Fallback
- Umgebung: npm führt Install-Skripte nicht aus (`node node_modules/electron/install.js` nötig); `models/`, `spikes/out/` sind für Claude per Deny-Regel nicht lesbar → per Node-Skript prüfen
- M1: Neue UI in `src/renderer/src/shortme/` (Tokens, Shell, Screens, Beispieldaten); `?legacy` startet die alte Cutawan-UI; Window: Mica + titleBarOverlay in main/index.ts
- M1: React 19 hat kein globales `JSX` → `React.JSX.Element`; `.sm-root button {color:inherit}` schlägt Klassen → `:where()` nutzen
- M1: Flex/Grid-Spalten mit `minmax(0,1fr)`; Inline-Wort-Spans brauchen `{' '}` sonst kein Umbruch
- M2: sherpa-onnx-node crasht in Electron (External buffers) → ASR läuft als Kindprozess in eigener Node-22-Laufzeit (Asset `node-runtime`); `src/main/engines/` enthält Katalog, Downloader, Manager, Sidecars, VRAM-Sequenzierung, Systemcheck
- M2: llama-server schreibt `--version` auf stderr; Windows-Prozess bleibt nach Kill kurz sichtbar, solange der Elternprozess das Handle hält
- M2: Abnahme-Skript `scripts/test-engines.ts` (frischer Ordner via `SHORTME_DATA`), Electron-Selbsttest via `SHORTME_SELFTEST=<wav> npx electron .` nach `electron-vite build`
- M3: Projekte unter `<userData>/projects/<hash>/` (project.json, audio.wav, asr.jsonl = Checkpoint, transcript.json = Cache); Datei-Hash = Größe + 3×4 MB
- M3: pyannote+WeSpeaker übersegmentiert Dialoge (4 statt 2 Sprecher) → Diarisierung optional/aus; Worker-Prozess nie selbst `process.exit` (Nachrichten gehen sonst verloren), Client beendet ihn
- M3: Windows `rename` über vorhandene Datei: EPERM/EBUSY mit Wiederholung (atomic.ts, projects.ts)
- M4: LLM wählt über Satznummern (nicht Zeiten); Einrasten = Wort → Satz → Stille → Kamerawechsel mit Nachbarwort-Schutz (ASR-Zeiten ±0,1 s); TransNetV2 läuft nur auf CPU (langsam)
- M4: Bash-Heredocs mit Backticks/Apostrophen brechen ab → lange Dateien mit dem Write-Tool schreiben
- M5: Planer rein/testbar (layout/plan.ts); Tracks fragmentieren nach Schnitten → Personen per Position (Δ < 0,15) gleichsetzen, kurze Shots (< 0,75 s) in Nachbarn aufnehmen, sonst Flackern
- M6: ffmpeg 6.1 kennt kein `-filter_complex_script` mehr → `-/filter_complex <datei>`; Tests nie mit vorhandenen Dateinamen überschreiben (tests/render.test.ts war schon da → eigene Datei shortmeRender.test.ts); ASS-Endzeit des letzten Wortes an Folgegruppe kappen (sonst überlappende Zeilen)
- M7: Alle Bearbeitungen = Operationen (shared/edits.ts), Zustand = Basis + Ops bis Cursor; Slider committen erst beim Loslassen (sonst Log-Flut); Browser-Pane drosselt Animationen im Hintergrund-Tab → tabs_select vor UI-Tests
- M8: NSIS-Installer `npm run package` (release/); winCodeSign braucht Symlink-Recht → signAndEditExecutable=false; `/D=` ohne Leerzeichen; asarUnpack für alles, was die externe Node-Laufzeit lädt (Worker + chunks + sherpa); Bash/MSYS verstümmelt `/S`-Argumente → Installer per PowerShell Start-Process starten
- tscaps: Engine sieht nur Schriften aus der übergebenen CSS (data-URI); VTT-Zeilen nie überlappen lassen; Test-Dateien vor dem Anlegen mit `ls tests` gegen vorhandene Namen prüfen (captions.test.ts/render.test.ts existierten schon)
- Editor: Vorschau und Export teilen sich die Geometrie (shared/framing.ts, shared/previewDraw.ts) und den Plan (IPC previewPlan = planExport); Echtfenster-Tests per `node scripts/cdp.cjs <port> eval|shot` mit `electron . --remote-debugging-port=<port>`
- M9: Stumme Fehler (`.catch(() => undefined)`) verstecken Bugs – FFmpeg-Filter nie mit `\\,` in JS-Strings bauen; Tracking-Korrekturen immer szenenweise (sceneRange/followScene in shared/edits.ts); Auswahl-Qualität: Belege vor Noten, grobe Skala, Paarvergleich (docs/HIGHLIGHTS.md)
- M10: Untertitel-Gruppierung nach Zeichenbudget in shared/captions.ts (groupWords) für Vorschau, tscaps und ASS gemeinsam; Clip-Anzahl ≈ Dauer/150 s; Split nur bei Bedarf mit Zoom
- M13: tscaps friert CSS-Animationen ein und spult sie per negativer animation-delay (CSS-Variablen --on-segment-starts u. a.) → eigene @keyframes brauchen animation-delay: var(--on-segment-starts, 0s), sonst bleiben Wörter im from-Zustand; backdrop-filter geht nicht (SVG-foreignObject); SHORTME_DATA für llama-server absolut angeben
- M16: Das Bash-Werkzeug kollabiert doppelte Backslashes (`\n` wird `\n`): Texte mit Backslashes nie per Heredoc/node -e schreiben, sondern mit Write/Edit; tscaps-Animationen = pausiert + negative Verzögerung (--on-segment-starts, --on-word-being-narrated-starts/-ends) → Vorschau setzt dieselben Variablen aus der Abspielzeit; Titel = Offscreen-Fenster (transparent, paint-Event) → PNG-Folge → FFmpeg-Overlay
- M17: Remotion-Ordner nicht `remotion/` nennen (baseUrl "." überschattet `import 'remotion'`) → `captions-remotion/`; Overlay per `renderFrames` + `imageSequencePattern`, Chrome-Download-Ordner hängt am cwd (`withCwd(dataRoot())` im Paket)
- M19: Twitch: Werkzeuge (Streamlink-Windows-Build, TwitchDownloaderCLI) wie yt-dlp zur Laufzeit nach `<Daten>/bin`; laufendes VOD = neuestes Archiv mit `is_live` (yt-dlp -J), dessen Dauer wächst → `--download-sections *a-b`; TwitchDownloaderCLI `--version` beendet mit Code ≠ 0; Token nur in der Windows-Anmeldeinformationsverwaltung (stdin an PowerShell); Chat strikt opt-in
- M20: `even()` hat ein Minimum von 2 → nie für Werte benutzen, die 0 sein dürfen (Abstand); Facecam-Rahmen per Kanten-Median + Seitenverhältnis-Wahl (shared/camEdges.ts); Bash-Heredocs mit Umlaut-Anführungszeichen in sed brechen ab → Write/Edit; `executeJavaScript`-Tests im Fenster: PointerEvents manuell mit `setPointerCapture = () => undefined`
