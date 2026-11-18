# Shortme – Übergabe für die Mac-Version

Stand: **Version 0.40.1**, 18.11.2026, Commit `cdab31e` (Branch `main`, GitHub `Andirectly/shortme`, privat).
Dieses Dokument ist der Einstieg für Claude Code auf dem Mac. Erst lesen, dann `CLAUDE.md` (Regeln + „Gelerntes“), dann je nach Aufgabe die Fachdokumente in `docs/`.

---

## 1. Was Shortme ist

Lokale Desktop-App (Electron), die **lange Videos in kurze, vertikale Clips** verwandelt – mit animierten Untertiteln, Titel, automatischem Bildausschnitt (Sprecher-Tracking), Viralitäts-/Qualitätsranking und einem Editor. Ersatz für Opus Clip, **komplett offline**: keine Cloud-KI, alle Modelle laufen lokal und werden in der App heruntergeladen (Modell-Manager), nie ins Repo.
Nutzung ausschließlich privat (zwei eigene Rechner). Bisher nur Windows 11 + NVIDIA (RTX 5090 32 GB, zweiter PC RTX 5070 Ti 16 GB).

Interner Fork-Name: **Cutawan** (Fork von ClipForge, MIT). Datenordner heißt deshalb `cutawan`.

## 2. Inhalt dieses Pakets

| Pfad | Inhalt |
|---|---|
| `shortme/` | kompletter Quellcode (alle Dateien unter Git, Stand `cdab31e`) |
| `shortme.bundle` | **kompletter Git-Verlauf** – `git clone shortme.bundle shortme` ergibt das Repo mit allen Commits |
| `screenshots/` | aktuelle Bilder der Oberfläche (Windows) |
| `MAC-UEBERGABE.md` | dieses Dokument (liegt auch in `shortme/docs/`) |

**Nicht enthalten** (absichtlich): `node_modules/` (→ `npm install`), heruntergeladene Modelle (→ Modell-Manager), Windows-Binärdateien (llama-server, Node-Laufzeit, uv/Python-Umgebungen, yt-dlp, Streamlink), Testvideos `test-videos/`, Referenz-Repos `reference/`, Nutzerdaten (Projekte), Installer `release/`.
Alternativ zum Paket: `git clone https://github.com/Andirectly/shortme.git` (privat, eigener GitHub-Zugang).

## 3. Funktionen (Oberfläche)

Navigation links (Glas-Leiste): **Start · Projekte · Stil-Studio · Live · Upload · Werkbank · Lernen · Modelle · Testlab · Einstellungen**.

- **Start** (`StartScreen.tsx`): Video hineinziehen oder Link (YouTube, Twitch …, per yt-dlp). Danach Start-Dialog (Sheet): Videotyp (Podcast, Vlog, Talking Head, Stream/Gaming, Vortrag), **Auswahl-Engine 1–4** (+ Profil Schnell/Ausgewogen/Gründlich für Engine 3/4), Format 9:16/1:1/16:9, Bildausschnitt (Smart, Vollbild, Split, Fest, Facecam+Gameplay), Cliplänge, Anzahl (Automatisch = ab 10 min Material mindestens 10 Clips), Untertitel-Vorlage, Zeitschätzung → „Clips finden“.
- **Verarbeitung** (`ClipScreens.tsx` RealProcessing): Fortschritt Transkribieren / Analysieren / Clips finden, Restzeit, Pausieren / Stoppen & behalten / Verwerfen. Jobs laufen nacheinander in einer Warteschlange (`src/main/shortme/jobs.ts`, misst die Dauer je Stufe).
- **Projekte** (`ProjectGrid.tsx`): Karten mit Vorschau; Klick öffnet Clips, laufende Analyse oder (ohne Clips) den Start-Dialog. Rechtsklick: Link/Pfad kopieren, neu analysieren, löschen (optional mit Originaldatei). **Auswählen** oben rechts: Mehrfachauswahl („Alle“, „Letzte 30 Tage“) und gemeinsames Löschen.
- **Clip-Liste**: Raster/Liste, Score-Details, Laufzeit des Laufs (Tooltip je Stufe), Engine-Schalter (zeigt die Ergebnisse je Engine, Läufe sind isoliert), „Neu berechnen“, „Engines vergleichen“, Bewertung je Clip (stark / mittel / schlecht + Gründe), Clip löschen, „Wer ist wer?“ (Personen), Herkunftsansicht für Engine-4-Clips.
- **Editor** (`EditorScreen.tsx`): Live-Vorschau = Export (gleicher Plan, `shared/framing.ts`, `shared/previewDraw.ts`), Transkript (Klick springt, Doppelklick korrigiert, Wörter herausschneiden), Layout je Szene (Smart/Fest/Vollbild/Split, Facecam+Gameplay), Untertitel-Stil, Animation, Titel (TikTok-Stil), Bildausschnitt. **Zeitleiste**: Filmstreifen, Wellenform, Szenen; Start/Ende-Griffe mit **60 s Puffer** vor/nach dem Clip; **Bereich löschen** (markieren → bis hier löschen, magnetisch wie in Premiere, Klick stellt wieder her). Alle Änderungen sind Operationen (Undo/Redo, `shared/edits.ts`). Export 1080×1920 mit tscaps (CSS-Untertitel), Fallback ASS/libass, optional Remotion.
- **Stil-Studio**: Untertitel-/Titel-Vorlagen (Schrift, Farben, Glow, Box, Animationen), eigene Schriften importieren, Vorlagen speichern/exportieren.
- **Live** (`LiveScreen.tsx`, `src/main/twitch/live.ts`): Twitch-Ringpuffer (Streamlink → FFmpeg-Segmente). Kanal wird beim Tippen geprüft (gibt es ihn, ist er live, Titel). „Letzte N Min sichern“, „Stoppen & sichern“ (legt Projekt an, ohne Analyse), „Verwerfen“. Live-Symbol leuchtet rot während der Aufnahme. Optional Chat-Signal. Twitch-VOD-Import (auch laufende VODs) mit TwitchDownloaderCLI für Chat.
- **Upload**: Veröffentlichen (siehe `docs/UPLOAD-SETUP.md`).
- **Werkbank** / **Lernen** (`src/main/learn/`): Kanäle/Videos hinzufügen → echte Creator-Shorts per Tonabgleich im Langvideo finden (`shared/audioMatch.ts`) → Shortme-Treffer messen. Lerndatensatz (JSONL, alle Engines, Bewertungen, Korrekturen) neu bauen und exportieren; Blind-Vergleich; Bewertungskatalog über privates Repo `Andirectly/shortme-data` abgleichen.
- **Modelle**: Modell-Manager (Download mit Prüfsumme, Fortsetzen), Laufzeiten (Node, llama-server, Python-Umgebungen), Systemcheck.
- **Testlab**: Modelle/Renderer vergleichen, aktive Wahl (Gesichtsmodell, Untertitel-Renderer …).
- **Einstellungen**: Exportordner, Hintergrund (Glas/Schwarz), Updates (In-App über GitHub Releases), Twitch-Token, Werkbank-Optionen.

## 4. Die vier Auswahl-Engines

| Engine | Kern | Läuft auf |
|---|---|---|
| **1 – Original** (`clips/select.ts`) | LLM (Qwen3-14B via llama-server) wählt Sätze, Einrasten an Wort/Satz/Stille/Kamerawechsel, Ranking | llama.cpp |
| **2 – Multimodal** (`clips/engines/v2/`) | + Bild (Qwen3-VL-4B) und Ton (Voxtral-3B) über llama-server, Ton-Index (YAMNet), Keyframes | llama.cpp |
| **3 – Adaptive AI** (`clips/engines/v3/`) | Python-Worker: Qwen3-VL-Embedding-2B (Suche übers ganze Video), Lighthouse (zeitliche Verortung), MiniCPM-o 4.5 (Bild+Ton-Prüfung) | PyTorch **CUDA** |
| **4** (`clips/engines/v4/`) | 4 Suchwege + Rangfusion → MiniCPM-o-Nachuntersuchung → gemessene Schnittkanten + Cut-Judge → Rendern + Endprüfung am fertigen Clip + Reparatur. Herkunft je Clip. Doku: `docs/ENGINE_V4_*`, Paket `docs/implementation/shortme-engine-v4/` | llama.cpp + PyTorch **CUDA** |

Gemeinsam: Transkription Parakeet TDT 0.6B v3 (sherpa-onnx, eigener Node-Kindprozess), Signale (Pegel, Stille, YAMNet), Kamerawechsel (TransNetV2), Layout/Tracking (YuNet/SCRFD + LR-ASD + IoU/BoT-SORT, ONNX Runtime), Export (FFmpeg).
**VRAM-Regel:** nie zwei große Modelle gleichzeitig – `src/main/engines/vram.ts` (VramSequencer) lädt/entlädt der Reihe nach.

## 5. Architektur

```
src/main/            Electron-Hauptprozess (Node)
  index.ts           Fenster (Windows: Acrylic + titleBarOverlay; macOS: vibrancy + Ampel – schon vorhanden), Updates
  engines/           Modell-/Laufzeit-Katalog, Downloader, Sidecars (llama-server), VRAM, Systemcheck, ASR-Worker
  pipeline/          FFmpeg, yt-dlp, Encoder (NVENC/VideoToolbox/CPU), ASD/Tracking, Composition (aus ClipForge)
  shortme/           App-Logik: Import, Projekte, Transkription, Jobs, IPC, Render/Export, Layout, Clips + Engines
  twitch/            Live-Puffer, VOD-Import, Chat, Token (Windows-Anmeldeinformationsverwaltung)
  learn/             Werkbank, Datensatz, Blind-Vergleich, Katalog
  remotion/          optionaler Remotion-Renderer
src/preload/         sichere Brücke (window.cutawan), nur @shared-Typen importieren
src/renderer/src/shortme/   neue Oberfläche (React 19, Zustand, motion), Tokens in tokens.css
src/shared/          reine, getestete Logik für Main + Renderer (edits, framing, captions, estimate, engine, twitch …)
resources/           gebündelt: python/worker.py (+ vendor, Lock-Dateien), kleine ONNX-Modelle, Schriften, Prompts, Profile, yt-dlp-Plugins
captions-remotion/   Remotion-Komposition für Untertitel-Overlay
tests/               ~150 Vitest-Dateien (1144 Tests)
scripts/             Mess-/Nachweisskripte (engine-run, v4-*, quality-eval/-batch, cdp.cjs …), release.mjs
docs/                Fachdokumente (siehe Abschnitt 9)
```

**Datenordner** (`app.getPath('userData')` → Windows `%APPDATA%\cutawan`, macOS `~/Library/Application Support/cutawan`; überschreibbar mit `SHORTME_DATA`):
`projects/<hash>/` (project.json, audio.wav, transcript.json, clips.json = Engine 1, `analysis/runs/<runId>/` = Engine 2–4, edits/, ratings.json …), `models/`, `runtime/` (Node, uv, Python-Umgebungen), `bin/` (yt-dlp, Streamlink …), `downloads/`, `learn/`.

## 6. Mac-Portierung: was zu tun ist

### 6.1 Windows-spezifisch → Mac-Ersatz

| Bereich | Windows heute | Mac-Ersatz | Stelle |
|---|---|---|---|
| Installer | NSIS (`build.win`) | DMG/ZIP, arm64; Signieren/Notarisieren optional (privat) | `package.json` → `build.mac`, `scripts/afterPack.cjs`, `scripts/release.mjs` |
| Fenster-Glas | `backgroundMaterial: 'acrylic'`, titleBarOverlay | `vibrancy: 'under-window'`, `titleBarStyle: 'hiddenInset'` (schon im Code) | `src/main/index.ts` |
| LLM | llama-server **CUDA**-Build (Windows-ZIP + cudart) | llama.cpp **macOS arm64 (Metal)**-Release | `engines/catalog.ts` (`llama-server`), `engines/sidecars.ts` |
| Node-Laufzeit für ASR | `node-v22…-win-x64.zip` | `node-v22…-darwin-arm64.tar.gz` | `catalog.ts` (`node-runtime`), `engines/asr` |
| sherpa-onnx (Parakeet) | win-x64 Paket | `sherpa-onnx-node` hat darwin-arm64 | `asrWorker`, asarUnpack |
| Python (Engine 3/4) | `uv-x86_64-pc-windows-msvc.zip`, torch **cu128** | uv `aarch64-apple-darwin`, torch für **MPS** (kein CUDA-Index) | `clips/engines/v3/runtime.ts`, `resources/python/requirements*.{in,txt}` |
| Python-Worker | prüft `torch.cuda`, `.cuda()`, `mem_get_info`, `empty_cache` | Gerät abstrahieren: `cuda` → `mps` (Speicher: `torch.mps.current_allocated_memory`, `torch.mps.empty_cache`) | `resources/python/worker.py`, `vendor/qwen3_vl_embedding.py` |
| MiniCPM-o 4.5 (bf16, 18 GB + Spitzen bis ~29 GB) | GPU ≥ 20 GB, sonst klarer Abbruch (`SHORTME_AV_MIN_VRAM_GB`) | Apple Silicon mit ≥ 48–64 GB Unified Memory; MPS-Unterstützung von transformers/MiniCPM-o prüfen (evtl. fp16, kleinere Eingaben) | `worker.py` `_load_av` |
| Lighthouse | `device="cuda"` fest | `mps` oder `cpu` | `worker.py` `_load_temporal` |
| VRAM-Planung | NVIDIA-VRAM | Unified Memory (RAM-Budget statt VRAM) | `engines/vram.ts`, `engines/hardware.ts`, `systemcheck.ts` |
| Video-Encoder | NVENC (ffmpeg-gpu.exe / System), sonst libx264 | **VideoToolbox** – Erkennung existiert schon (`videoToolboxWorks`) | `pipeline/encoders.ts` |
| FFmpeg | `ffmpeg-static` (lokal durch gyan 6.1.1 ersetzt, da npm hier keine Install-Skripte ausführt) | `npm install` lädt das darwin-Binary; Version ≥ 6.1 prüfen | `pipeline/ffmpeg.ts` |
| ONNX Runtime (Gesichter, ASD, TransNetV2, YAMNet) | CPU/CUDA | CPU oder CoreML-EP | `pipeline/asd.ts`, `inference/` |
| Zugangsdaten (Twitch-Token, Katalog-Token) | Windows-Anmeldeinformationsverwaltung via PowerShell + `CredReadW` | **macOS-Schlüsselbund** (`security add-generic-password` / `find-generic-password`) | `src/main/twitch/token.ts` (`secretGet/Set/Del`) |
| Streamlink | `streamlink/windows-builds` ZIP | `uv tool install streamlink` oder Homebrew | `src/main/twitch/tools.ts` |
| TwitchDownloaderCLI | `…-Windows-x64.zip` | `…-MacOS-Arm64.zip` (Release-Asset prüfen) | `src/main/twitch/tools.ts` |
| yt-dlp | `yt-dlp.exe` (+ JS-Laufzeit `--js-runtimes node:<node-runtime>`) | `yt-dlp_macos` | `pipeline/ytdlp.ts` |
| Prozesse | `windowsHide`, `taskkill`-Baum, Pfade mit `\` | `kill` Prozessgruppe; `/`-Pfade | `twitch/live.ts` (killTree), `engines/sidecars.ts` |
| Lokales Whisper (alt) | – | `resources/local-whisper` hat schon MLX (Apple) | `src/main/localWhisper.ts` |

### 6.2 Empfohlene Reihenfolge auf dem Mac
1. `git clone shortme.bundle shortme` (oder GitHub), `npm install`, `npm run typecheck`, `npm test` – reine Logik (src/shared, die meisten Tests) muss sofort laufen.
2. `npm run dev`: Oberfläche startet (Browser-Vorschau ohne `window.cutawan` zeigt Beispieldaten).
3. Katalog-Einträge je Plattform (`process.platform`/`arch`) für llama-server (Metal), Node-Laufzeit, uv – dann Modell-Manager → Parakeet + Qwen3-14B laden → **Engine 1** Ende-zu-Ende (Import → Transkript → Clips → Editor → Export mit VideoToolbox).
4. Schlüsselbund statt Anmeldeinformationsverwaltung (`token.ts`), Streamlink/TwitchDownloader für Mac → Live-Tab.
5. Engine 2 (nur llama.cpp-Modelle, sollte mit Metal laufen).
6. Python-Worker auf MPS umstellen (Gerät abstrahieren, Lock-Dateien für macOS neu erzeugen) → Engine 3 → Engine 4. Speicherbedarf von MiniCPM-o vorher messen.
7. `build.mac` (dmg, arm64), `scripts/release.mjs` um Mac-Artefakte erweitern (electron-updater nutzt `latest-mac.yml`).

## 7. Befehle

- `npm run dev` · `npm test` · `npm run typecheck` · `npm run lint` · `npm run package` · `npm run release`
- Echter Engine-Lauf ohne UI: `ENGINE=engine4 PROFILE=balanced SHORTME_DATA=<Ordner> npx tsx --tsconfig tsconfig.node.json scripts/engine-run.ts <projekt-hash-präfix> auto [anzahl]`
- Echtes Fenster fernsteuern: App mit `--remote-debugging-port=9334` starten, dann `node scripts/cdp.cjs 9334 eval "<js>"` bzw. `shot <datei.png>`
- Qualitätsmessung gegen Creator-Shorts: `node scripts/quality-eval.mjs <python>`; Stapel über alle Engines: `node scripts/quality-batch.cjs`
- Engine-4-Nachweise/Gate: `node scripts/v4-status.mjs <python>`, `python docs/implementation/shortme-engine-v4/tools/v4_gate.py --repo . --level core --json`

## 8. Wichtige Regeln und Fallstricke (Auszug aus CLAUDE.md „Gelerntes“)
- Keine Cloud-APIs; Modelle nie ins Repo; ASR und LLM nie gleichzeitig im (V)RAM.
- Vorschau = Export (gleicher Plan); Bearbeitungen nur als Operationen.
- Preload importiert nur `@shared`-Typen.
- FFmpeg: Filtergraph direkt als `-filter_complex <Graph>` (jede Version), Datei nur für sehr lange Graphen; Fehlermeldungen über `ffmpegErrorLines` (eigentliche Fehlerzeile zuerst); `-nostdin`.
- Engine 4: MiniCPM-o-Eingaben ≤ 40 s, `inference_mode` + `empty_cache` je Aufruf; zweiter Modellversuch nur mit Temperatur; Checkpoints nur bei Erfolg; Clip-Vielfalt per `overlapRatio`.
- Läufe isoliert unter `analysis/runs/<runId>/`; Clips immer über `findClip` suchen.
- Jede Release braucht einen CHANGELOG-Abschnitt (Deutsch, Added/Changed/Fixed) – die App zeigt ihn als Patch Notes.
- Tests nie mit vorhandenen Dateinamen überschreiben (`ls tests` vorher).

## 9. Weiterführende Dokumente
- `docs/APP-UEBERSICHT.md` – ausführliche Gesamtübersicht (Stand 0.31: Auswahlverfahren, Prompts, Layout, Messwerte, Probleme)
- `docs/PIPELINE.md` (Ablauf, Parameter) · `docs/DESIGN.md` (Designsystem, Screens, Editor) · `docs/ROADMAP.md` (Meilensteine)
- `docs/ENGINE_V2_STATUS.md`, `docs/ENGINE_V3.md`, `docs/ENGINE_V4_RELEASE_REPORT.md`, `docs/ENGINE_V4_BENCHMARKS.md`
- `docs/MODELS.md`, `docs/CATALOG.md`, `docs/SECOND-PC.md`, `docs/UPLOAD-SETUP.md`, `docs/quality/report.md`
- `CHANGELOG.md` – alle Versionen mit Änderungen

## 10. Offene Punkte (Stand 0.40.1)
- Engine 4: Qualitätsnachweis (≥ 20 gelabelte Videos, 2 blinde Bewerter) fehlt; 12/16-GB-GPU und frischer Rechner nicht gemessen. Laufzeit: ~2,7 min je Clip (15-min-Video, Ausgewogen).
- Export auf dem zweiten Windows-PC: `/filter_complex`-Fehler behoben, ein „Invalid data“-Fehler mit Titel wird seit 0.36.1 abgefangen (Export ohne Titel + Grund) – Ursache noch nicht bestätigt.
- Live-Tab: Vorschau des Streams nicht eingebaut (Twitch-Player lässt sich in Desktop-Apps nicht einbetten).
- Werkbank-Pause bleibt nach Neustart nicht erhalten.
