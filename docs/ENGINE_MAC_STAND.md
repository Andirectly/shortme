# Shortme „Engine Mac“: Stand, Stärken, Schwachpunkte, offene Fragen

Stand: 18.11.2026. Gemessen auf einem MacBook Pro M1 Pro, 16 GB gemeinsamer Speicher, macOS 26.5.
Testvideo: deutscher Food-Vlog, 17,5 Minuten, 1080p50, eine Person spricht fast durchgehend (YouTube „Ich teste die 4 BESTEN DÖNER in BERLIN“).

## Worum es geht

Shortme ist eine private Desktop-App (Electron, TypeScript), die aus langen Videos automatisch kurze 9:16-Clips mit Untertiteln macht – ein lokaler Ersatz für OpusClip, komplett offline, ohne Cloud-KI.
Es gibt eine Windows-Version (NVIDIA-GPU) und jetzt eine Mac-Version. Die „Engine Mac“ ist die Clip-Auswahl für Apple Silicon.

Bedingungen, die für jede Empfehlung gelten:
- alles lokal auf dem Rechner, keine Cloud-API, keine Kosten pro Video
- muss auf einem Mac mit **16 GB** laufen (Metal gibt einem Prozess höchstens ~11,8 GB GPU-Speicher); große Modelle laufen nacheinander, nie gleichzeitig
- Modelle mit offener Lizenz (Apache-2.0, MIT o. ä.), keine reinen Forschungsgewichte
- deutsche und englische Videos (Vlogs, Podcasts, Twitch-Streams)

## Ablauf der Engine (gleiche Pipeline wie „Engine 4“ unter Windows, nur andere Modelle)

1. **Transkription:** Parakeet TDT 0.6B v3 (sherpa-onnx), Wortzeiten.
2. **Vier unabhängige Suchwege über das ganze Video:**
   - Sprache: lokales LLM (Qwen3-8B Q4_K_M über llama.cpp mit Metal) liest das Transkript in 180-s-Fenstern und schlägt Momente vor
   - Ton: Apple SoundAnalysis (`SNClassifySoundRequest`, 303 Klassen) → Lachen, Jubel, Rufen, Aufkeuchen; dazu Pegelsprünge
   - Bildwechsel: Keyframe-Vergleich
   - Bildsuche: Qwen3-VL-Embedding-2B (PyTorch auf Apple-GPU/MPS), Textanfragen wie „a person reacting strongly“ gegen Video-Fenster
3. **Zusammenführen:** Rangfusion der vier Wege → die besten Kandidatengruppen.
4. **Nachuntersuchung:** Gemma 4 E4B (4-bit, MLX über mlx-vlm 0.8) sieht ~10 Einzelbilder und hört den Ton eines 30-s-Ausschnitts, ordnet Beobachtungen Rollen zu (Vorgeschichte, Auslöser, Reaktion, Pointe) und darf Vorher/Nachher nachfordern. Kandidaten ohne beobachtete Handlung/Reaktion fliegen raus.
5. **Schnittwahl:** Gemma wählt Start/Ende aus einer festen Liste gemessener Kanten (Satzende, Pause, Bildwechsel) – nie freie Sekunden.
6. **Rendern + Endprüfung:** echter 9:16-Clip mit Untertiteln, dann prüft Gemma die fertige Datei (Einstieg, verständlich ohne Vorwissen, Pointe enthalten, natürliches Ende, Ereignis sichtbar) plus gemessene Kriterien (Stille, Nähte). Bei Durchfallen gezielte Reparatur.
7. **Rangfolge:** „akzeptabel“ vor „prüfen“, dann Zahl bestandener Kriterien.

## Gemessene Zeiten (Profil „Schnell“, 17,5-min-Video)

| Schritt | Dauer |
|---|---|
| Transkription | ~1 min |
| Kamerawechsel (TransNetV2, CPU) | ~3 min |
| Apple-Tonanalyse | 5 s (47 MB RAM) |
| Bildwechsel-Suche | 4 s |
| Bildsuche, 88 Fenster à 4 Bilder | 3,9 min |
| Sprach-Lane (Qwen3-8B), normal | ~7 min |
| **Nachuntersuchung, 24 Gemma-Aufrufe** | **12,5 min** |
| **Schnittwahl, 16 Gemma-Aufrufe** | **10,5 min** |
| Rendern + Endprüfung, 8 Clips | 8,6 min |
| **Gesamt** | **~40 min** (mit Sprach-Lane ~47 min) |

Gemma 4 E4B je Aufruf: 22–27 s, Spitze 7,5–8,1 GB GPU-Speicher (~10 Bilder + bis 30 s Ton).
Zum Vergleich: OpusClip braucht laut Erfahrungsberichten 5–10 min für ein 20–30-min-Video (Cloud-GPUs).

## Was gut funktioniert

- **Apple SoundAnalysis** als Ton-Weg: extrem schnell (17,5 min Ton in 5 s), wenig Speicher, erkennt Lachen/Jubel/Musik brauchbar.
- **Bildsuche auf der Mac-GPU** mit dem Original-Code und denselben Gewichten wie unter Windows: lädt in 4 s, ~1,5 s je Fenster, plausible Treffer.
- **Gemma 4 versteht Bild UND deutschen Ton** im selben Aufruf: es gibt Inhalte des Gesprochenen korrekt wieder.
- **Formale Absicherung:** Antworten werden gegen ein Schema geprüft; erfundene Segment-IDs oder Schnittkanten werden abgewiesen und neu angefragt (92 % gültige Antworten im Test).
- **Nachuntersuchung filtert echt:** von 12 Kandidaten blieben 8 übrig.
- **Speicher-Disziplin:** Modelle laufen nacheinander; vor Gemma prüft die App den macOS-Speicherdruck.
- **Schnitte nur an gemessenen Kanten** → keine Schnitte mitten im Wort.

## Schwachpunkte

1. **Endprüfung/Rangfolge trennt kaum.** Gemma 4 E4B bewertet fast jeden Clip mit „bestanden“; die Begründungen sind oft nur umformulierte Kriterien aus dem Prompt („Die ersten Sekunden machen klar, worum es geht“). Alle 6 Clips bekamen 90–100 Punkte. Die Reihenfolge unter den Finalisten ist dadurch fast zufällig. Widersprüche kommen vor („Pointe: unbekannt – Die Pointe ist nicht enthalten“ statt „durchgefallen“).
2. **Gemma ist der Zeitfresser:** 27 von 40 Minuten. Viele Aufrufe (Nachuntersuchung 2 je Kandidat, Schnittwahl 2 je Ereignis, Endprüfung je Clip).
3. **Modell-Eigenheiten von Gemma 4 E4B in mlx-vlm:** hört je Tonstück nur 30 s (längerer Ton wird still abgeschnitten → wir teilen jetzt), schreibt manchmal Platzhalter aus dem Beispiel-JSON ab (Titel „Kurzer deutscher Titel“), rutscht gelegentlich in einen Denkmodus.
4. **Titel kommen aus der Endprüfung** und sind schwach („Bewertung von Essen“, „Essen genießen“).
5. **Bildsuche nutzt englische Standard-Anfragen** („people laughing hard“, „a win or celebration“) – bei einem Food-Vlog passen die kaum; die Treffer sind dann eher Zufall.
6. **Sprach-Lane ist bei Vlogs der wichtigste Weg**, hängt aber an einem 8B-Modell (16 GB erlauben kein 14B neben dem Rest); Qwen3-8B wählte in einem früheren Test mit zu großen Textfenstern nur Stellen vom Anfang.
7. **Gesamtdauer** ist 4–8× langsamer als OpusClip.
8. **Videoformat:** AV1-Videos (YouTube liefert sie oft) dekodiert ein M1/M2 nur per Software → alles mit Bildern wird extrem langsam (Keyframe-Scan > 10 min statt 3,5 s). Download bevorzugt jetzt H.264; selbst geladene AV1-Dateien bleiben langsam. Das gebündelte FFmpeg ist Version 6.0 (ffmpeg-static), ohne VideoToolbox-Nutzung in der Pipeline.
9. **Kamerawechsel-Erkennung (TransNetV2) läuft nur auf der CPU** (CoreML war nicht schneller).

## Fragen für die Recherche

1. **Besserer lokaler Clip-Richter auf 16 GB Apple Silicon:** Welches Modell bewertet Kurzclips (Video + Ton, Deutsch) ehrlicher als Gemma 4 E4B und passt in ~11 GB Metal-Speicher? Kandidaten: Qwen3.5-4B/Qwen3-VL-4B/8B (MLX), Gemma 4 größere Varianten, Qwen3-Omni, MiniCPM-V/MiniCPM-o in MLX-Quantisierung, Phi-4-multimodal. Gibt es Benchmarks für „Video-Highlight-Bewertung“ oder „Short-form-Viralität“ mit offenen Modellen?
2. **Bewertungsmethode statt Modell:** Liefern paarweise Vergleiche („Clip A oder B?“), Ranglisten über mehrere Clips oder ein getrennter Ablauf (multimodales Modell beschreibt nur, Text-LLM urteilt) bei kleinen Modellen messbar bessere Rangfolgen als absolute Bestanden/Durchgefallen-Urteile? Quellen zu „LLM-as-a-judge“ mit kleinen Modellen, Positions-Bias, Kalibrierung.
3. **Wie machen es OpusClip, Vizard, Klap, Munch, Descript, Clipmunk, Shortcast** (falls öffentlich): Welche Signale nutzen sie für den „Virality Score“? Gibt es Paper oder Patente?
4. **Offene Datensätze/Modelle für Highlight-Erkennung** in Vlogs/Podcasts/Streams (z. B. QVHighlights, Moment-DETR, TimeChat, Lighthouse, UniVTG, VideoLLaMA-Varianten), die auf Apple Silicon laufen.
5. **Tempo auf Apple Silicon:** Wie bekommt man Gemma 4 / ähnliche Modelle in MLX schneller (Prompt-Caching des Systemprompts, KV-Cache-Wiederverwendung über Aufrufe, weniger Bild-Tokens, Batch-Verarbeitung, speculative decoding)? Erfahrungswerte für M1 Pro.
6. **Spracherkennung Deutsch auf dem Mac:** Parakeet Ultra (FluidAudio/CoreML) gegen Parakeet v3 gegen WhisperKit gegen Apple SpeechAnalyzer – gibt es Messungen für deutsche Umgangssprache und Wortzeit-Genauigkeit?
7. **Bessere Suchanfragen für die Bildsuche:** Sollten Anfragen pro Videotyp (Vlog, Gaming, Podcast) oder aus dem Transkript erzeugt werden? Erfahrungen mit Qwen3-VL-Embedding für Moment-Retrieval.
8. **Titel-Erzeugung:** Welche Prompt-Muster oder Modelle erzeugen gute, kurze, deutsche Clip-Titel/Hooks lokal?
9. **Video-Dekodierung:** Lohnt sich ein eigener FFmpeg-Build mit VideoToolbox (Hardware-H.264/HEVC) bzw. dav1d für AV1 auf M1/M2? Gibt es eine schnellere Kamerawechsel-Erkennung als TransNetV2 auf CPU (z. B. PySceneDetect, AutoShot, CoreML/ANE-Varianten)?

Bitte bei jeder Empfehlung angeben: Lizenz, ungefährer Speicherbedarf auf Apple Silicon, ob es eine MLX- oder CoreML-Version gibt, und Quellen.
