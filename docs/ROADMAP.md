# Roadmap

Arbeitsweise pro Meilenstein: Plan-Modus mit Opus → Plan prüfen → Umsetzung mit Sonnet →
Abnahme mit `test-videos/` → Commit → „Gelerntes“ in CLAUDE.md → `/clear`.
Jeder Meilenstein ist erst fertig, wenn ALLE Abnahmekriterien erfüllt sind.

## Referenzpfade (in `reference/`)
| Repo | Relevante Pfade |
|---|---|
| clip-forge (Basis, = Projekt selbst) | `src/main/pipeline/*.ts`, `src/shared/`, `scripts/export-asd-onnx.py`, `resources/models/` |
| hotclip (xixihhhh/hotclip) | sherpa-onnx-Einbindung, TransNetV2, VAD-Grenzschutz, Prüf-Werkbank, Render-Cache → per Subagent lokalisieren |
| tscaps (francozanardi/tscaps) | `packages/engine/` (README!), `templates/`, `templates/AUTHORING.md`, `templates/_docs/` |
| OpenClipper (GrepCut) | `src/features/clipper/engine/autoflip/build-track.util.ts`, `src/features/clipper/shared/smart-crop.util.ts` |
| clippyme (fralapo) | `src/clippyme/pipeline/cut_ops.py`, `reframe_ops.py`, `reframe_track.py`, `texttiling_ops.py`, `gemini_request.py` |
| openshorts (mutonby) | `split_layout.py`, `layout_picker.py`, `active_speaker.py`, `hook_grounding.py` |
| clips-studio (ColinGPT9) | `config/prompts/`, `llm/manager.py` |

---

## M0 – Technik-Spikes (Risiken zuerst)
Kleine CLI-Skripte unter `spikes/`, jedes gibt eine Ergebniszeile aus. Kein UI.
1. **ClipForge-Basis**: Fork baut (`npm run dev`), Tests grün. Liste aller OpenAI-Aufrufe erstellen.
2. **ASR Deutsch**: Parakeet v3 vs. Whisper large-v3-turbo (sherpa-onnx, Node) auf `podcast-2p.mp4`:
   Echtzeitfaktor, Stichprobe Wortfehler (50 Wörter manuell), Wort-Zeitstempel plausibel. → Wahl festhalten.
3. **LLM lokal**: llama-server (CUDA) mit 2 Kandidaten (12–14B Q4, z. B. Qwen3-14B, Gemma 3 12B),
   Kontext 16384, JSON-Schema: Clip-Auswahl auf deutschem Transkript. Gültiges JSON 5/5, Laufzeit, Plausibilität. → Wahl.
4. **Tracking**: LR-ASD + Gesichtserkennung (ONNX Runtime GPU) auf `podcast-2p.mp4`: richtige Person ≥ 90 % (Stichprobe 20 Momente).
5. **Untertitel-Export**: `@tscaps/engine` in Electron-Fenster, 60-s-Clip 1080×1920 exportieren: Dauer, Qualität, keine Artefakte.
   Ziel < 1,5× Echtzeit. Sonst Fallback ASS/libass als Standard.
**Abnahme:** `spikes/RESULTS.md` mit Messwerten und getroffenen Wahlen; CLAUDE.md-Stack ggf. aktualisiert.

## M1 – UI-Prototyp (Beispieldaten, keine echte Pipeline)
Renderer von ClipForge auf DESIGN.md umbauen: Fenster/Mica/Titelleiste, Navigation, Start, Erstellen-Sheet,
Verarbeitung, Clip-Übersicht, Editor-Layout, Stil-Studio, Modelle, Einstellungen.
**Abnahme:** alle Screens klickbar; Federn/Drag laut Skill; reduced-motion funktioniert; 60 fps beim Scrollen der Übersicht.

## M2 – Engines & Modell-Manager
Sidecar-Verwaltung (llama-server, FFmpeg, yt-dlp), sherpa-onnx- und ONNX-Runtime-Einbindung, Hardware-Erkennung (VRAM),
Modell-Downloads (Fortsetzen, SHA-256, Fortschritt), Ordner-Import, Systemcheck-Screen, VRAM-Sequenzierung (laden/entladen).
**Abnahme:** frische Installation lädt Modelle über den Assistenten; Systemcheck grün; App beendet alle Kindprozesse sauber.

## M3 – Import & Transkription
Drop/URL, Vorabprüfung, Ambient-Standbild, Transkription mit Wort-Zeiten + Sprecher-IDs + VAD, Cache, Checkpoints,
Job-Warteschlange mit Pausieren/Stoppen.
**Abnahme:** alle 3 Testvideos transkribiert; Neustart während Transkription setzt fort; zweiter Lauf nutzt Cache.

## M4 – Clip-Auswahl & Grenzen
Signale (normalisiert), TransNetV2, Prompts als Dateien, Kandidaten → Bewertungsraster → Ende prüfen → Finalisten-Vergleich,
Tags, Begründung; Einrasten in 4 Stufen (unit-getestet); TextTiling-Fallback.
**Abnahme:** 0 Clips beginnen/enden mitten im Wort oder Satz (manuelle Prüfung aller Clips der Testvideos);
jeder Clip ohne Vorwissen verständlich (Stichprobe); Unit-Tests für Einrast-Logik grün.

## M5 – Tracking & Layouts
Erkennung 5 fps, Tracks, LR-ASD + Sprecher-IDs, Regeln aus PIPELINE.md §6, Layouts smart/split/fit/fixed,
Gesichtsquote ins Ranking.
**Abnahme:** `podcast-2p`: Sprecherwechsel als harte Schnitte, kein Ping-Pong; `nofaces`: nie ein leerer Ausschnitt
(Fallback fit); keine Kamerabewegung innerhalb eines Shots.

## M6 – Rendern, Untertitel, Export, Stil-Studio
FFmpeg-Render (Pausen-Dreifachprüfung, Sprung-Zoom, Zeitachsen-Umrechnung, −14 LUFS, NVENC), tscaps-Overlay
(Untertitel, Hook-Titel, Logo) im versteckten Fenster, ASS-Fallback, Export-Profile, Dateinamen, Stil-Studio funktional,
Marken-Kit, Preset-Import/-Export.
**Abnahme:** exportierter Clip = Editor-Vorschau (visueller Vergleich 5 Zeitpunkte); Lautheit −14 ±1 LUFS;
Untertitel synchron nach Pausenschnitten.

## M7 – Editor
Transkript-Editing, Zeitleiste mit Wort-Griffen, Ende prüfen, Inspector (Untertitel/Bildausschnitt/Hook),
Person anklicken = Kamera folgt, Sicherheitszonen, „Auf alle anwenden“, nicht-destruktive Operationen, Undo/Redo, Autosave.
**Abnahme:** jede Änderung rückgängig machbar; Neustart stellt Bearbeitungsstand wieder her.

## M8 – Installer & Feinschliff
electron-builder NSIS-Installer, Auto-Update optional aus, Installation auf dem zweiten Rechner, Fehlermeldungen, Logs,
Leistungsprüfung (60-min-Podcast Ende-zu-Ende).
**Abnahme:** zweiter Rechner: Installation → Modelle laden → Clips exportieren ohne Eingriff.

## Später (nicht in V1)
Tempo 1–2×, KI-Bearbeitungs-Chat, direktes Veröffentlichen, B-Roll, Dubbing, Lernen aus behalten/verworfen,
Remotion als Premium-Renderer, Kanal-Beobachtung, VLM-Bildbewertung.
