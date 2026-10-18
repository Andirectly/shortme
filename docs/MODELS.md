# Modelle und Plätze

Wird vom Testlab bzw. `scripts/sync-models-docs.ts` erzeugt – nicht von Hand ändern. Pro Platz ein aktives Modell, höchstens zwei integrierte Alternativen; die Pipeline nutzt immer das aktive Modell. „Zum Entfernen“ heißt: markiert, der Code ist noch da (Entfernen nur gezielt, nach Absprache).

## Gesichtserkennung (`face`)

| Modell | Zweck | Status |
|---|---|---|
| YuNet | Sehr kleiner, schneller Gesichtserkenner. | aktiv |
| SCRFD-10G (InsightFace Buffalo_L) | Starker Gesichtserkenner, deutlich robuster bei schwierigen Winkeln. | Test |
| SCRFD-2.5G | Leichte SCRFD-Variante als Mittelweg. | Kandidat (nicht integriert) |

## Personen-Tracking (`tracking`)

| Modell | Zweck | Status |
|---|---|---|
| IoU-Tracks (aktuell) | Verbindet Erkennungen über Überlappung der Boxen. | aktiv |
| ByteTrack | Bewährter Tracker, nutzt auch unsichere Erkennungen. | Kandidat (nicht integriert) |
| BoT-SORT-ReID (BoxMOT + OSNet x0.25) | Erkennt Personen am Körper-Aussehen (Kleidung, Statur) wieder. | Test |

## Sprechererkennung (wer spricht im Bild) (`asd`)

| Modell | Zweck | Status |
|---|---|---|
| LR-ASD | Prüft Lippenbewegung gegen Tonspur. | aktiv |
| FabuLight-ASD | Wie Light-ASD, zusätzlich mit Körperpose. | Kandidat (nicht integriert) |

## Sprechertrennung (Tonspur) (`diarization`)

| Modell | Zweck | Status |
|---|---|---|
| pyannote Segmentation 3.0 + WeSpeaker | Bisherige Sprechertrennung (standardmäßig aus). | aktiv |
| NVIDIA Sortformer (offline) | Moderne Sprechertrennung, erkennt überlappende Sprache. | Kandidat (nicht integriert) |

## Ton-Ereignisse (Lachen, Applaus) (`audio_events`)

| Modell | Zweck | Status |
|---|---|---|
| YAMNet (AudioSet) | Aktuelles Modell: erkennt Lachen, Applaus und laute Stimme in 521 Klassen. | aktiv |
| Zencastr Laughter Detection | Lachen-Erkennung, speziell für Podcast-Audio trainiert. | Kandidat (nicht integriert) |
| SenseVoice (nur Ereignisse/Emotion) | Erkennt Lachen, Applaus, Musik und Emotion in einem Durchgang. | Kandidat (nicht integriert) |

## Stimm-Emotion (`emotion`)

| Modell | Zweck | Status |
|---|---|---|
| audeering wav2vec2 Emotion (MSP-Podcast) | Misst Erregung, Dominanz und Valenz der Stimme. | Kandidat (nicht integriert) |

## Clip-Auswahl (LLM) (`llm`)

| Modell | Zweck | Status |
|---|---|---|
| Qwen3-14B Q4_K_M | Aktuelles Modell für die Clip-Auswahl. | aktiv |
| Gemma 4 12B QAT Q4_0 | Neueres Modell, versteht Text, Bild und Audio. | Kandidat (nicht integriert) |
| Qwen3.8 27B (3-Bit) | Größeres Modell, stark komprimiert. | Kandidat (nicht integriert) |

## Untertitel-Renderer (`renderer`)

| Modell | Zweck | Status |
|---|---|---|
| tscaps (@tscaps/engine) | Aktueller Renderer: CSS-Vorlagen, Bilder per SVG im versteckten Fenster, Export direkt als Video. | aktiv |
| Remotion | React-Komposition, Bilder per Headless-Chrome, Overlay wird mit FFmpeg über das Video gelegt. | Test |
