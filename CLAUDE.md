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
- M27: Kandidaten nie mit `slice(0, max)` kürzen (schneidet das Ende langer Videos ab) → `thinEvenly`; yt-dlp braucht für YouTube eine JS-Laufzeit (`--js-runtimes node:<node-runtime>`), `--no-warnings` versteckt das; `gh release create` liefert 404 → Release über `gh api repos/Andirectly/shortme/releases` (scripts/release.mjs); Anbieter-Archive (sherpa-onnx) können nachträglich neu hochgeladen werden → Prüfsumme im Katalog neu prüfen
- M29: Kleine bewegte Gesichter (Facecam) nie per IoU gleichsetzen → `sameSpot`; bei Streams haben ~75 % der Kandidaten Hook-Note 5, absolute „solide“-Schwellen taugen dort nicht → relative Schwelle; echte Läufe ohne UI per CDP (`reanalyze`/`transcribe` mit `frame`), Test-Datenordner mit Junction `models` nur per `cmd /c rmdir` entfernen (Remove-Item -Recurse könnte durch den Link löschen)
- M30: Bewertungskatalog liegt in privatem Repo `Andirectly/shortme-data` (Token nur in der Anmeldeinformationsverwaltung, nie aus der `gh`-Sitzung des Nutzers übernehmen); Netzwerkteil hinter `Remote`-Schnittstelle, damit der Abgleich ohne echte Zugangsdaten testbar ist
- M31: FFmpeg-Optionen nie nach Version raten: `-/filter_complex` geht erst ab 6.1, ffmpeg-static ist älter → `runWithGraphFile` (probieren + ausweichen); jede Release braucht einen CHANGELOG-Abschnitt (Added/Changed/Fixed, deutsch, kurz): die App zeigt ihn als Patch Notes
- M25 Lernen: Datensatz wird idempotent aus Projektdateien neu gebaut (`dataset/`), nie angehängt; Kandidaten-Spur (`candidates.json`) nur aus `selectClips`; Werkbank nutzt Projekte + `creator.json`/`eval.json`; Tonabgleich = Kreuzkorrelation von 8-Band-Spektralmerkmalen (shared/audioMatch.ts); preload darf nur `@shared`-Typen importieren (kein `../main`)
- Engine V2: Läufe isoliert unter `analysis/runs/<runId>/` (Legacy = `clips.json`), Clips immer über `findClip` laufübergreifend suchen; Modellantworten gegen Schema prüfen UND Rohanfang loggen (Token-Grenze/`finish_reason=length`); Prompt-Felder wie das Schema benennen (`start/end` statt `first/last` ließ das Modell Sekunden liefern); Voxtral kann Nähte nicht beurteilen (8/8 „sauber“, auch mitten im Wort) → Pegelmessung am Schnittpunkt; Freitextfelder in Tonmodell-Antworten schweifen aus → nur Wahrheitswerte; `docs/ENGINE_V2_STATUS.md` hat Testbefehle und Restprobleme
- Engine V3: Python ist hier zur Laufzeit erlaubt (nur gemanagte `uv`-Umgebung, Lock mit Hashes); schwere Python-Importe im Hauptthread VOR dem stdin-Lesen (Windows blockiert sonst), `System32\tar.exe` statt Git-tar; Engine-Vergleich nur innerhalb eines Projekts, „exklusiv“ gilt nur fürs Endergebnis; Stand in `docs/ENGINE_V3.md`
- Engine V3 (AV): MiniCPM-o braucht transformers==4.51.0 → eigene Umgebung `py312-v3av`; Kinder des Workers (ffmpeg) erben stdin → fd 0/1 umleiten; numba/librosa brauchen `NUMBA_CACHE_DIR` (sonst Hänger auf Junction-/Schreibschutz-Pfaden); MiniCPM-o (22 GB) nie mit geladenem llama-server testen (Auslagerung in RAM); Lighthouse nur ≤ 150 s je Fenster; Rangfusion je Kanal (`RawProposal.channel`), sonst fluten viele Vorschläge die Clusterung
- Engine V4: eigener Orchestrator `clips/engines/v4/` (nie runPipeline/selectV3), Nachweise über `scripts/v4-*.ts|mjs` + `docs/ENGINE_V4_*`; MiniCPM-o-Eingaben ≤ 40 s (75 s → >32 GB VRAM) und `inference_mode` + `empty_cache` je Aufruf; zweiter Modellversuch nur mit Temperatur (sonst identische Antwort); Exporter-Arbeitsordner nie nach dem Titel benennen (Windows-Pfadgrenze) und Titel ohne `'`/`,` (Filtergraph); nie `git stash`, während Hintergrundläufe aus der Arbeitskopie laden
- Engine V4 (App-Test): Clip-Vielfalt per Überlappung am kürzeren Clip (`overlapRatio`), nicht IoU; installierte App per `Shortme.exe --remote-debugging-port=9333` + `scripts/cdp.cjs` (importUrl/transcribe/jobs) testen; `release/` ist für Claude gesperrt → per `node -e` prüfen
- Laufzeit: JobQueue misst je gemeldeter Stufe (`stageClock`, `JobContext.timing`) → `clips.json.timing`; Engine 4 kostet v. a. MiniCPM-o-Aufrufe (Nachuntersuchung ~19 s, Cut-Judge ~14 s, Endprüfung ~12 s je Aufruf) → Aufrufzahl senken wirkt, Keyframes parallel kaum (CPU-Konkurrenz)
- Mac (M1 Pro 16 GB): npm 11 blockt Install-Skripte → `allowScripts` in package.json; Electron-Zip mit `ditto -x -k` entpacken, wenn `install.js` ein unvollständiges `dist/` hinterlässt; Engine-Binärdateien je Plattform gleiche id, `CATALOG` filtert nach `platform`; Apple Silicon = ⅔ Unified Memory als VRAM-Budget (hardware.ts); Token im Schlüsselbund (`security -i`, Geheimnis per stdin); Streamlink per gemanagtem uv (`uv tool install --managed-python`) nach <Daten>/bin/streamlink, Assistent richtet es auf dem Mac mit ein; `npm run package -- --mac --publish never` → release/Shortme-<v>-arm64.dmg (ad-hoc signiert)
- Mac Engine 1 (M1 Pro, 17,5-min-Video): ASR 35 s, TransNetV2 17 min auf CPU (CoreML/MLProgram nicht schneller, 6 statt 2 Threads ≈ 1,6×), LLM-Auswahl mit Qwen3-8B ≈ 15 min, Export 30 s/Clip; Qwen3-8B wählt bei einem 3000-Wörter-Fenster nur Stellen aus dem ersten Drittel → `windowWords: 1200` für 8B; fehlende Modelle lädt die App beim Start nach (installRecommended, 5 Versuche, setzt .part fort); Dock-Icon kommt gepackt aus dem .icns (build/icon-mac.png, nie `dock.setIcon` mit dem eckigen icon.png)
- Mac-Bausteine (seit 0.43 in Engine Mac 2, `MAC_FLAVOR` entfernt): Apple SoundAnalysis (Swift-Helfer native/mac-worker, 17,5 min Ton in 4 s) statt YAMNet, Qwen3-VL-Embedding im Original-Code auf MPS (Umgebung py312-mac, requirements-mac.lock.txt), Gemma 4 E4B über mlx-vlm (py312-macav) statt MiniCPM-o; Engine 3/4 auf dem Mac ausgeblendet (`enginesFor`)
- Gemma 4 (mlx-vlm 0.8): Ton je Stück höchstens 30 s, längerer Ton wird STILL abgeschnitten → in 30-s-Stücke teilen; Metal erlaubt ~11,8 GB je Prozess (M1 Pro 16 GB): ≤ 12 Bilder bei ≤ 30 s, ≤ 8 bei mehr (gemessen 7,5–8,1 GB Spitze); nie parallel zu anderen GPU-Modellen testen (llama-server antwortet dann HTTP 500, Metal OOM)
- YouTube liefert AV1 im mp4; M1/M2 dekodieren AV1 nur per Software (Keyframe-Scan > 10 min statt 3,5 s) → Download bevorzugt avc1
- Downloads: yt-dlp als eigene Prozessgruppe (`detached`), beim Beenden `stopAllYtDlp`, gleiche Zieldatei = ein Download, Pause per SIGSTOP/SIGCONT (nur macOS), Restzeit aus `[download] … ETA` bzw. ffmpeg `time=/speed=` über die Bereichslänge (`parseDownloadProgress`); Twitch-VOD eines laufenden Streams (`is_live`) wächst → „Ganzes VOD“ nur mit festem Ende laden, sonst nimmt ffmpeg bis Streamende auf
- Engine Mac 2 (`mac2/`, Standard für `engine-mac` seit 0.43): LFM3-Omni-2B (MLX 8-bit) beobachtet Bilder + separat zugeführten Ton (Pakete ≤ 30 s, 8 Bilder), Qwen3.5-9B (MLX 4-bit) plant Schnitte aus Kanten-IDs, ordnet im Vergleich und prüft den Render; beide laufen als `mlx_vlm.server` (OpenAI-API, `response_format` json_schema über llguidance → erzwungene ID-Enums), Residenten im VramSequencer; Zeitlimit/Abbruch beenden den Serverprozess (`releaseAll` nie innerhalb `vram.use` → Deadlock); gemessen M1 Pro: LFM laden 3–4 s, Paket 7–10 s, ~3,2 GB
- Python-Bearbeitung per Heredoc: nie `open(p,'w').write(open(p).read())` (leert die Datei vor dem Lesen; ast.parse hält eine leere Datei für gültig) – worker.py war so kurz leer
- Engine Mac 2 (gemessen, 17,5-min-Vlog, 10 Wunsch-Clips): 54 min gesamt – Schnittplan 35 s/Aufruf, Inhaltsprüfung 35 s, LFM-Paket 16–18 s, Render 53 s/Clip; Qwen lehnte mit ±25-s-Fenster und „reject wenn nicht eigenständig“ ALLES ab → ±45 s, „lieber erweitern“, Länge korrigiert der Host; Qwen setzt den Cold Opener immer an den Clipanfang → Host leitet ihn aus beobachteten Reaktionen ab (coldOpenFromObs); Untertitel brechen am Cold-Opener-Ende (`breakBefore`)
- Engine Mac 2 ab 0.44 (gemessen, gleicher 17,5-min-Vlog, 10 Wunsch-Clips): 28,5 min, 8 Clips (2 frei, 6 prüfen), 0 Fehler; Engine 1: 26 min, 10 Clips mit Schnitten mitten im Satz und ohne Abdeckung nach Minute 12,5. Phasen: Sprachsuche 192 s, LFM-Beobachtung 408 s (30 Pakete à 13 s), Pläne 283 s (14 à 20 s), Prüfung LFM 472 s + Qwen 247 s (25 s/Clip). Vorab-Rendern während der Planung (Render ~1,7 s je Clipsekunde, CPU) → Render ist nie mehr der Engpass. Reparaturen wegen standalone halfen 0/4 → nur natural-end/dead-air. Qwen-Richter lehnt Vlog-Clips fast immer als „nicht eigenständig“ ab → `decideMac2` macht daraus needs-review. Läufe bei Temperatur 0 sind reproduzierbar (Lauf 5 = Lauf 6)
- UI ist für Mac und Windows dieselbe (gemeinsamer Renderer): Plattform-/Engine-Unterschiede nur über `enginesFor`/`window.cutawan.platform`, nie eigene UI-Varianten; GitHub `Andirectly/shortme` main ist die eine Quelle: vor der Arbeit `git pull`, nach jedem Commit `git push`; Releases (`npm run release`) je Plattform bauen, gleiche Versionsnummer
- Projekt öffnen muss `loadResults(hash, true)` nutzen: die Sperre in loadResults (fremder Hash) gilt nur für späte Hintergrund-Ergebnisse, sonst bleibt das alte Projekt sichtbar
- Plattform-Grenze auch im Hauptprozess: `isLocalEngine` (control.ts) lehnt fremde Engines bei Start/Standard/Umschalten ab; Patch Notes per `notesForPlatform` (Mac-Punkte unter Windows ausgeblendet); Release pro Version von beiden Rechnern: zuerst bauender legt an, der andere lädt seine Dateien dazu (`scripts/release.mjs`) – ein Release ohne `latest.yml` lässt Windows kein Update finden
- UX-Upgrade 0.47: drei getrennte Achsen je Clip – Freigabe (`review.json`, `shared/review.ts`), KI-Prüfung (abgeleitet aus `v2.verification`), Lernbewertung (`ratings.json`); Clipversion = `clipRevision` (Grenzen + wirksame Edit-Ops); Fortschritt nie aus Zeitschätzung als Prozent, Zähler nur via `measuredStep`; Funktionen im Editor, die `videoRef` nutzen, nach dessen Deklaration platzieren (sonst zusätzliche React-Compiler-Lintfehler); Stand und offene Punkte in `docs/shortme-ux-implementation-audit.md`
- Remote Engine: geräteunabhängiger Kern in `shared/remote/` + `main/remote/urlGuard.ts`, Stand/Offenes in `docs/REMOTE_ENGINE.md`; Transport/Relay ist noch nicht entschieden
- Spuren 0.48: Chat-Spur (`chatLane`, Spitzen = verschiedene Schreiber je 10 s gegen 5-min-Median, Spam eines Nutzers zählt einmal) in Engine 4 + Mac; Spur-Gewichte aus Review-Freigaben (`learnedLaneWeights`, erst ab 30 Entscheidungen, 0,7–1,3, Spuren aus `v2.eventNote`); Sprachsuche-Cache `analysis/cache/speech-<key>.json`; Mac-Endprüfung kürzen → docs/MAC-AUFTRAG-ENDPRUEFUNG.md
