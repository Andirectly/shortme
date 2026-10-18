# Shortme – Was eingebaut ist und warum (für Recherche)

Lokale Windows-App (Electron + TypeScript + React): lange Videos → kurze vertikale Clips (9:16) mit animierten Untertiteln, Highlight-Ranking, Sprecher-Tracking, Editor. Komplett offline, nur private Nutzung. Ziel-Hardware: NVIDIA ≥ 12 GB VRAM. Stand: 2026-10-18.

## 1. Gesamtablauf
Import → Transkription → Signale + Szenenschnitte → LLM-Clipauswahl → Layout-/Kameraplanung → Rendering → Untertitel → Export. Dazu ein nicht-destruktiver Editor.

## 2. Engines und Gründe
| Baustein | Gewählt | Warum |
|---|---|---|
| Transkription | sherpa-onnx, Parakeet TDT 0.6B v3 int8 (+ Silero VAD) | RTF 0,04 auf CPU, native Wortzeiten; Whisper large-v3-turbo war langsamer (RTF 0,23) und ohne Wortzeiten |
| ASR-Betrieb | Kindprozess mit eigener Node-22-Laufzeit | sherpa-onnx-node crasht in Electron ("External buffers") |
| LLM | llama.cpp `llama-server` (CUDA), Qwen3-14B Q4_K_M, Kontext 16k, JSON-Schema | beste Qualität, die in ~13,6 GB VRAM passt; ASR und LLM nie gleichzeitig im VRAM |
| Gesichter / Sprecher | YuNet (Gesichter), LR-ASD (aktiver Sprecher), optional pyannote+WeSpeaker | Diarisierung übersegmentiert Dialoge (4 statt 2 Sprecher) → standardmäßig aus |
| Szenenschnitte | TransNetV2 (ONNX, DirectML) | auf CPU zu langsam |
| Video | FFmpeg 6.1 (gebündelt, NVENC, loudnorm −14 LUFS), yt-dlp | |
| Untertitel | @tscaps/engine (Standard), ASS/libass als Fallback | tscaps exportiert 60 s in 5,7 s; Vorschau = Export |
| Keine Cloud-APIs | alles lokal | Entscheidung des Entwicklers |

## 3. Clip-Auswahl (Kern der Qualität)
Recherchebasis: arXiv 2602.02219 (Positions-Bias bei LLM-Rubrik-Bewertung), arXiv 2505.19429 (Rhapsody, Podcast-Highlights, "Most replayed" als Ground Truth), arXiv 2407.12028 (TreeSeg), GitHub openshorts, Anbieter-Blogs zu Clip-Längen. Reddit war nicht abrufbar.

| Maßnahme | Grund |
|---|---|
| LLM wählt über Satznummern, nicht über Zeiten | LLMs sind bei Zeitangaben unzuverlässig |
| Einrasten der Grenzen: Wort → Satz → Stille → Kamerawechsel (ASR-Zeiten ±0,1 s, Nachbarwort-Schutz) | Länge/Grenzen vom LLM nicht verlässlich |
| Anfangsprüfung: Konnektiv-Start ("Und…") + LLM-Urteil "ohne Vorwissen verständlich?", Start bis 2 Sätze nach vorn, max. 2 Runden | häufigster Fehler: Clip beginnt mitten im Gedanken |
| Endprüfung (Pointe vollständig?) | abgeschnittene Clips |
| Bewertung mit Belegen: erst Hook-/Payoff-Zitat + fehlender Kontext, dann Noten; Zitat muss wörtlich vorkommen, sonst −1 | weniger Halluzination |
| Grobe Skala 0–4, 1–2 Proben (Temp. 0,2/0,5), Median; zweite Probe nur für obere Hälfte | 14B-Modelle kollabieren bei feinen Skalen |
| Paarvergleich der Finalisten in beiden Reihenfolgen (Uneinigkeit = Unentschieden) | Positions-Bias |
| Weiche Längenvorgabe: Sweetspot 22–50 s, Max 90 s | anekdotisch aus Anbieter-Blogs |
| Qualitätsschwelle (Hook ≥ 8/20, eigenständig ≥ 8/20 bevorzugt) | schwache Clips nur als Lückenfüller |
| Ton-Signale (Lautstärke, Lachen) nur als kleiner Bonus | Evidenz schwach |
| Clip-Anzahl automatisch ≈ Dauer/150 s (4..30) + Option "Anzahl Clips" | Nutzer-Feedback: nur 1 Clip |
| Pool = Finalisten + übrige bewertete Clips | Auffüllen bei Überlappungen |

## 4. Kamera / Layout (fester Ausschnitt statt Schwenk)
- Fester Ausschnitt pro Kameraeinstellung, harter Schnitt bei Sprecherwechsel (kein ruhelos schwenkender Crop).
- Hysterese 1,25× / 1 s, Drift-Limit 0,06, kurze Shots (< 0,75 s) werden in Nachbarn aufgenommen, Personen per Position gleichgesetzt (Tracks fragmentieren nach Schnitten).
- Split-Screen nur wenn zwei Personen nötig sind, mit Zoom (max 1,8) – sonst doppelte Bilder.
- Gesichtsanteil-Strafe: Ausschnitte mit halb sichtbarem Sprecher werden schlechter bewertet.
- Manuelle Tracking-Korrektur gilt szenenweise (kein Springen von Frame zu Frame).

## 5. Untertitel
- Reine Daten (Wörter + Zeit + Tags + Preset-ID), Renderer austauschbar.
- Einzeilige Gruppierung nach Zeichenbudget je Schrift; Umbruch bei Satzende, Komma (ab 60 % Füllung), Pause > 0,45 s, max. 6 Wörter. Gleiche Logik für Vorschau, tscaps und ASS.
- LLM-Korrekturlauf (Zeichensetzung, Transkriptionsfehler) als Standard-Korrekturen; Risiko: falsche Korrektur bei Eigennamen. Jedes Wort im Editor änderbar.
- Hook-Titel standardmäßig aus (stören Untertitel), per Schalter aktivierbar.

## 6. Editor
- Alle Bearbeitungen als Operationen (trim, cutWords, hook, editWord, caption, layout, follow) → Undo/Redo, Autosave.
- Vorschau = Export (gleicher Plan- und Geometrie-Code), echtes Video mit Ton, Waveform, Filmstrip, Shot-/Schnitt-Spuren.
- Monochrome UI (Schwarz/Weiß/transparent), Mica, Glas-Ebenen, Spring-Animationen.

## 7. Bekannte Schwächen / offene Ideen
1. Kein Prüfstand: 10–20 Podcasts mit YouTube-"Most replayed"-Kurve, Trefferquote messen (Rhapsody-Methode).
2. Audio-Ereignismodell (YAMNet/PANNs) für Lachen/Applaus.
3. Embedding-Grenzen (TreeSeg-artig, bge-m3/multilingual-e5) als Prior für Start/Ende.
4. Kalibrierung gegen eigene Daumen hoch/runter.
5. Themen-Diversität zwischen gewählten Clips.
6. Parakeet macht Eigennamen/Umgangssprache teils falsch → Whisper-Gegenprobe oder Wörterbuch.
7. Auswahlqualität bei Vlogs nur mittel; Stil-Studio-Regler wirken noch nicht im Export.

## 8. Fragen für die Recherche
- Welche Methoden finden zuverlässig Highlights in Longform (Podcast, Vlog, Interview) ohne Cloud? Gibt es Ground-Truth-Datensätze?
- Bessere lokale LLMs/ASR für Deutsch (Eigennamen)? Alternativen zu Qwen3-14B auf 12–16 GB?
- Beste Praxis für Sprecher-Tracking/Reframing auf 9:16 (Opus Clip, Submagic, Vizard) und Untertitel-Stile mit hoher Retention?
