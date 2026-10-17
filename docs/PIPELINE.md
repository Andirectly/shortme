# Pipeline

Reihenfolge: Import → Vorabprüfung → Transkription → Analyse-Signale → Clip-Auswahl →
Grenzen einrasten → Tracking & Layout → Rendern (FFmpeg) → Untertitel & Overlays (tscaps) → Export.
Jede Stufe schreibt ein Checkpoint-Artefakt in den Projektordner; Wiederholung/Absturz setzt dort fort.

## 1. Import
- Datei per Drag & Drop/Dateiauswahl oder URL (yt-dlp; ClipForge `ytdlp.ts` als Basis)
- Bei Import: Standbild extrahieren und stark weichgezeichnet speichern (Ambient-Hintergrund der UI)
- Vorabprüfung: Dauer, Größe, freier Speicher (Reserve ≥ 1 GB nach geschätztem Peak), Audiospur vorhanden

## 2. Transkription (sherpa-onnx)
- Audio zu Mono 16 kHz extrahieren, in Abschnitten (~15 s Fenster, mit Überlappung) dekodieren
- Modell: Parakeet v3 (schnell, 25 EU-Sprachen) oder Whisper large-v3-turbo; Wahl nach Meilenstein 0
- Ergebnis: Wörter mit Start/Ende, Satzzeichen, Sprecher-ID (pyannote-Segmentierung + Embeddings)
- VAD (Silero o. ä., sherpa-onnx) speichern: wird für Grenzen und Pausenschnitte gebraucht
- Transkript-Cache pro Datei-Hash; Neu-Generierung transkribiert nie doppelt

## 3. Analyse-Signale (pro Sekunde, innerhalb des Videos normalisiert)
- Lautheit/Energie, Sprechtempo, Lachen/Applaus-artige Spitzen, Stille
- Kamerawechsel: TransNetV2 (ONNX, ~31 MB) → Liste von Shot-Grenzen
- Signale je Video normalisieren (leiser Podcast und lauter Stream liefern beide Spitzen)

## 4. Clip-Auswahl (llama-server, lokal)
- Modell 12–14B Q4 GGUF, Kontext 16384 (explizit setzen, nie Default 4096), JSON-Schema erzwingen
- Optionale Vorauswahl: Transkript in Fenster teilen, Kandidaten-Bereiche sammeln
- Kandidaten: in sich geschlossene Mikro-Geschichten Hook → Aufbau → Pointe (ClipForge `highlights.ts`)
- LLM sieht Transkript + Zeitleiste der Signale aus Stufe 3
- Bewertungsraster (je 0–20, Summe 0–100): Hook-Stärke, emotionaler Payoff, Zitierbarkeit,
  Eigenständigkeit (ohne Vorwissen verständlich), Dichte
- Zweiter Durchgang „Ende prüfen“: Ende verlängern bis der Gedanke abgeschlossen ist
- Finalisten in EINEM Aufruf direkt vergleichen (relative Rangfolge statt absoluter Scores)
- Pro Clip zusätzlich: Titel, Hook-Text (Einblendung), 1-Satz-Begründung des Scores,
  Schlüsselwort-Tags (Wort-Indizes) für Untertitel: `emphasis`, `entity`, `hook`
- Benutzer-Prompt „Wonach suchen?“ wird in den Prompt eingesetzt
- Fallback ohne LLM: TextTiling-Themensegmentierung (ClippyMe `texttiling_ops.py`), Score = heuristisch
- Prompts liegen als Textdateien in `resources/prompts/` (ohne Code-Änderung tunebar)
- Robustes JSON-Parsing mit Validierung; ungültige Antworten 1× wiederholen

## 5. Grenzen einrasten (pure Funktionen, unit-getestet)
Reihenfolge (ClippyMe `cut_ops.py` als Vorlage):
1. Auf nächste Wortgrenze
2. Auf umgebenden Satz erweitern (Start zurück zum Satzanfang, Ende vor zum Satzende);
   max. Clip 90 s, keine Überlappung mit Nachbarclips, Abkürzungen/Dezimalzahlen nicht als Satzende
3. In nächste Stille der Wellenform schieben (nur Richtung Stille)
4. Auf nahe Kamerawechsel (TransNetV2) einrasten, wenn ≤ 0,5 s entfernt
- Endschutz: Satzende durch VAD bestätigt, max. 0,6 s Nachlauf

## 6. Tracking & Layout
Erkennung (5 fps, ONNX Runtime CUDA/DirectML):
- Gesichter: UltraFace (ClipForge `detect.ts`) oder SCRFD; Personen optional YOLOX
- Tracks pro Person (IoU + Interpolation, ClipForge `facetracks.ts`), Reset an Kamerawechseln
- Aktiver Sprecher: LR-ASD ONNX (ClipForge `asd.ts`, `mfcc.ts`) kombiniert mit Sprecher-IDs aus Stufe 2

Regeln (ClippyMe `reframe_ops.py`/`reframe_track.py` als Vorlage):
- Fester Ausschnitt pro Einstellung. Kamera bewegt sich innerhalb eines Shots NIE (kein Schwenk, kein Zoom-Atmen)
- Sprecherwechsel → harter Schnitt auf neuen Sprecher
- Wechsel nur, wenn Herausforderer ≥ 1,25× aktiver ist und ≥ 1 s spricht (kein Ping-Pong)
- Gesichter < 10 % der Größe des größten Kandidaten ignorieren (Hintergrundköpfe)
- Subjekt wandert > 12 % der Bildbreite im Shot → weiterer, fester Ausschnitt statt Verfolgen
- Kein Sprecher erkannt > 3 s → zurück zur Bildmitte, leicht herauszoomen

Layouts (pro Shot automatisch, im Editor überschreibbar):
- `smart`: fester Crop auf aktivem Sprecher
- `split`: zwei Sprecher übereinander (bei gleichzeitigem Sprechen/Dialog), Untertitel auf der Naht
- `fit` („Ganzes Bild“): 16:9 mittig, oben/unten unscharfe vergrößerte Kopie
- `fixed`: mittiger Ausschnitt
- Keine Gesichter → `fit`

Qualitätskontrolle: Gesichtsquote pro Clip (% Zeit mit Gesicht im Ausschnitt).
< 60 % → Warnhinweis und Abzug im Ranking.

## 7. Rendern (FFmpeg)
- Schneiden, Pausen entfernen (Dreifach-Prüfung: keine Wörter UND leise UND VAD ohne Stimme;
  max. Lücke erhalten 0,15 s), Reframe-Spuren anwenden
- Sprung-Zoom: bei entfernten Pausen leichter Zoom-Wechsel (1,0 ↔ 1,08) genau am Schnitt
- Alle Zeitachsen (Wörter, Tracks, Zoom) auf gekürzte Zeitleiste umrechnen (eine zentrale Funktion)
- Audio: Loudness-Normalisierung −14 LUFS, kurzes Ausblenden am Ende
- Zwischenergebnis hochwertig (CRF ≤ 16 oder NVENC hohe Qualität), da danach noch einmal kodiert wird
- Hardware-Encoder: NVENC zuerst, Testkodierung beim Start, sonst CPU (ClipForge `encoders.ts`)
- 16:9-Quellausschnitt jedes Clips aufbewahren (nachträglicher Layout-Wechsel ohne Neuanalyse)

## 8. Untertitel & Overlays (@tscaps/engine)
- Eingabe: gerenderter Clip + Dokument (Wörter, Zeiten, Tags → CSS-Klassen) + Preset (JSON + CSS)
- Ebenen: Untertitel, Hook-Titel (erste ~3 s), Logo/Wasserzeichen
- Export per WebCodecs in einem versteckten zweiten Electron-Fenster (UI bleibt flüssig)
- Fallback: ASS-Datei erzeugen (ClipForge `captions.ts`) und per FFmpeg/libass einbrennen
- Zusätzlich optional SRT-Datei

## 9. Export
- Profile: TikTok / Reels / Shorts (1080×1920, 30 fps), eigenes Profil
- MP4 mit `+faststart`, Dateiname = KI-Titel (Windows-verbotene Zeichen/Namen entfernen)
- Batch: „Alle fertigen Clips exportieren“

## Job-Steuerung
- Warteschlange, Fortschritt pro Stufe, Pausieren/Fortsetzen, „Stoppen & behalten“, Verwerfen
- Fertige Clips erscheinen im UI, während andere noch rendern
- Wiederaufnahme nach Absturz über Checkpoints

## Datenmodell (SQLite, z. B. better-sqlite3)
projects(id, source_path, hash, duration, created) · transcripts(project_id, words_json) ·
signals(project_id, data_json) · clips(id, project_id, start, end, score, reason, title, hook, status) ·
tracks(clip_id, layout_json) · edits(id, clip_id, seq, op_json) · presets(id, name, json, css, is_default) ·
exports(id, clip_id, profile, path, created)
