# Start-Prompts für Claude Code

Ablauf je Meilenstein:
1. `/model opus` → Shift+Tab bis Plan-Modus → Prompt unten einfügen
2. Plan lesen, korrigieren, freigeben
3. `/model sonnet` → umsetzen lassen
4. Abnahme prüfen → committen → `/clear`

Alle Prompts setzen voraus, dass CLAUDE.md automatisch geladen wird.

---

**M0**
Lies docs/ROADMAP.md Abschnitt M0 und docs/PIPELINE.md §2, §4, §6, §8. Plane die fünf Spikes als
eigenständige Skripte unter spikes/. Für Spike 2 und 4: nutze einen Subagenten, der in reference/hotclip
die sherpa-onnx-Einbindung und in src/main/pipeline/asd.ts die ASD-Nutzung zusammenfasst (max. 15 Zeilen).
Ergebnisse in spikes/RESULTS.md.

**M1**
Lies docs/DESIGN.md und den Skill apple-design. Plane den Umbau des Renderers (src/renderer) auf das
Designsystem mit Beispieldaten in src/renderer/mock/. Bestehende Pipeline-Anbindung nicht verändern,
nur hinter einer Mock-Schicht verbergen. Zuerst Tokens + Fenster + Navigation, dann Screens in der
Reihenfolge der Abnahmekriterien.

**M2**
Lies docs/ROADMAP.md M2 und spikes/RESULTS.md. Plane Sidecar-Verwaltung, Hardware-Erkennung,
Modell-Manager und Systemcheck. Modell-URLs und SHA-256 in resources/models.json.

**M3**
Lies docs/PIPELINE.md §1–2 und „Job-Steuerung“, „Datenmodell“. Ersetze die OpenAI-Transkription in
src/main/pipeline/transcribe.ts durch sherpa-onnx (Wahl aus spikes/RESULTS.md). Plane Checkpoints und
Warteschlange.

**M4**
Lies docs/PIPELINE.md §3–5. Stelle src/main/pipeline/highlights.ts auf llama-server (localhost,
OpenAI-kompatibel) um. Übernimm die Einrast-Logik aus reference/clippyme/src/clippyme/pipeline/cut_ops.py
nach TypeScript als pure Funktionen mit Unit-Tests. TransNetV2 und VAD-Grenzschutz: Subagent fasst die
Umsetzung in reference/hotclip zusammen.

**M5**
Lies docs/PIPELINE.md §6. Erweitere src/main/pipeline/faces.ts, facetracks.ts, asd.ts um die Regeln
(fester Crop pro Shot, Hysterese 1,25, min. Gesichtsgröße 10 %, Lost-Subject). Vorlage für die Regeln:
reference/clippyme/src/clippyme/pipeline/reframe_ops.py und reframe_track.py. Split-Layout nach
reference/openshorts/split_layout.py.

**M6**
Lies docs/PIPELINE.md §7–9 und docs/DESIGN.md „Stil-Studio“, „Einstellungen“. Lies
reference/tscaps/packages/engine/README.md. Plane: FFmpeg-Render → tscaps-Overlay im versteckten Fenster,
ASS-Fallback über bestehendes captions.ts, Export-Profile, Stil-Studio mit tscaps-Vorlagenformat.

**M7**
Lies docs/DESIGN.md „Editor“. Plane den Editor auf Basis des bestehenden ClipForge-Editors.
Bearbeitungen als Operationen in Tabelle edits; Undo/Redo darüber. Prüf-Werkbank-Ideen: Subagent fasst
reference/hotclip zusammen.

**M8**
Lies docs/ROADMAP.md M8. Plane electron-builder-Konfiguration (NSIS), Bündelung von FFmpeg, yt-dlp,
llama-server, ONNX-Runtime und sherpa-onnx; Logs und Fehlermeldungen.

---

## Bei Problemen
- Fehler: „Untersuche die Ursache in 1–2 Sätzen, bevor du Code änderst.“
- Kontext voll: `/compact` mit „Behalte nur Plan, offene Punkte und geänderte Dateien.“
- Qualität schlecht (Tracking/Ranking): konkreten Zeitstempel im Testvideo nennen statt allgemein beschreiben.
