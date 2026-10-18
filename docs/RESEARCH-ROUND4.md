# Research Runde 4 – Highlight-Auswahl und Untertitel-Animationen (2026-10-18)

Hinweis: Webrecherche über Suchtreffer; Aussagen zu Tools stammen großteils von Anbieter-/Vergleichsseiten und sind nicht im Code geprüft. Quellen am Ende.

## 1. Gibt es ein Tool mit besserer Highlight-Auswahl?
**Kurz: Nein – kein Open-Source-Clipper schlägt unsere Pipeline erkennbar.** Die bekannten Projekte (OpenShorts, AI-Youtube-Shorts-Generator, opensource-clipping, HotClip, SupoClip) machen im Kern dasselbe: Whisper → *ein* LLM-Aufruf (Gemini/GPT) bewertet das Transkript → Clips + „Virality-Score“. Das ist einfacher als unsere Kette (Anfangsprüfung, Belege, Paarvergleich, Einrasten). Quelle der Qualität dort ist ein größeres Cloud-Modell, nicht eine bessere Methode.

**Was die Forschung sagt (relevant für uns):**
- Rhapsody (Podcast-Highlights, Label = YouTube „Most replayed“): Zero-shot GPT-4o/Gemini schneiden **schlecht** ab; kleine, **auf Replay-Daten feinjustierte** Modelle sind deutlich besser, am besten mit **Sprach-/Audiomerkmalen + Transkript**. → Reines Prompten (auch unseres) hat eine Qualitätsgrenze; Kalibrierung an echten Daten bringt mehr.
- Mr. HiSum (31 892 YouTube-Videos, Label = „Most replayed“, ≥ 50 000 Zuschauer je Video) ist der größte offene Datensatz dafür; 2026er Audio-Visual-Arbeiten zeigen Gewinne durch Audio-Encoder (AudioSet/PANNs-Merkmale) gegenüber reinem Bild.
- Für Textgrenzen: TreeSeg und „Multi-Level Transcript Segmentation“ (2026) – Themenwechsel als Prior für Clip-Anfang/-Ende.

**Empfehlung (in Reihenfolge Nutzen/Aufwand):**
1. **„Most replayed“ direkt nutzen, wenn das Video von YouTube kommt.** yt-dlp liefert die Replay-Kurve für YouTube-Videos als Metadaten-Feld (`heatmap`; im Code zu prüfen). Die Kurve ist das beste verfügbare Qualitätssignal überhaupt – als Bonus im Ranking (Clip über einem Peak) und als Prüfstand. Aufwand klein (Metadaten beim Link-Import speichern, Bonus in `select.ts`).
2. **Eigener Prüfstand**: 10–20 YouTube-Podcasts/Vlogs laden, Top-Clips gegen Peaks messen (Trefferquote). Ohne Messung bleibt jede Prompt-Änderung Bauchgefühl.
3. **Kalibrierung mit deinem Feedback**: Daumen hoch/runter pro Clip speichern → kleines Modell (z. B. logistische Regression auf unseren 5 Kriterien + Audio-Signalen + Länge) gewichtet die Scores neu. Billig, lernt deinen Geschmack.
4. **Audio-Ereignismodell** (YAMNet/PANNs, ONNX) für Lachen/Applaus/Betonung statt Heuristik – entspricht dem, was die 2026er Papers verbessert.
5. **Größeres Modell als Schiedsrichter nur für die Top-Kandidaten** (z. B. Qwen3-30B-A3B, falls ≥ 16 GB VRAM) – optional, bleibt lokal.

## 2. Bessere Untertitel-Animationen
Befund aus den Quellen: Standard bei Short-Form sind **1–3 Wörter gleichzeitig**, **Wort-für-Wort-Hervorhebung** (Farbe/Fett/Skalierung), **Pop-in mit Feder (Bounce)**, **Schlüsselwort-Betonung**, minimal für Vlog/Cinematic; Lesbarkeit (Kontrast, Kontur) und Safe-Zones vor Effekten. Leistungszahlen („+40 % Watchtime“) sind Anbieter-Angaben, nicht belegt. „Hormozi-Stil“ ist Marketing-Kürzel ohne feste Definition.

tscaps-Vorlagen sind **CSS mit Wort- und Buchstaben-Spans** – genau unser Weg (captionCss). Damit sind alle folgenden Animationen ohne neue Engine machbar:
| Animation | Umsetzung |
|---|---|
| Pop-in (Feder) | Wort startet `scale(0.7)`, `opacity 0` → Overshoot `1.12` → `1` (Keyframes, ~180 ms) |
| Aktives Wort „Karaoke“ | Farbfüllung per `background-clip:text` über Wortdauer |
| Aktives Wort Skalierung | `.word-being-narrated { transform: scale(1.12) }` mit Übergang |
| Schlüsselwort-Betonung | größer + Highlight-Farbe + leichtes Wackeln (nur `emphasis`-Tags) |
| Zeile gleitet ein | `translateY(12px) → 0`, `blur(6px) → 0` |
| Typewriter | Buchstaben-Spans mit gestaffeltem `animation-delay` |
| Box-Highlight wandert | Hintergrundbox folgt dem aktiven Wort (`transition` auf Position) |
Grenzen: ASS-Fallback kann nur Teile (`\t`-Transformationen für Skalierung/Farbe, kein Blur-Keyframe); Vorschau = Export bleibt gewahrt, weil beide dasselbe CSS nutzen.

**Empfehlung:** Neues Feld `animation` je Preset (pop, karaoke, bounce, slide, typewriter, none) in `shared/captions.ts`; captionCss erzeugt die Keyframes; Editor bekommt eine Auswahl „Animation“. 4–5 neue Presets als Startpunkt. Ich setze das um, sobald du die Richtung bestätigst.

## Quellen
- Rhapsody (arXiv 2505.19429), Mr. HiSum (NeurIPS 2023 D&B), „Sounding Highlights“ (arXiv 2602.03891), TreeSeg (arXiv 2407.12028), „Towards Multi-Level Transcript Segmentation“ (arXiv 2601.02128)
- GitHub: mutonby/openshorts, Anil-matcha/AI-Youtube-Shorts-Generator, NaufalRizqullah/opensource-clipping, francozanardi/tscaps; HotClip (xixihhhh.github.io/hotclip)
- Untertitel-Praxis: clipspeed.ai, openclip.app (caption animation guide), capcut.com/resource, subclip.app, choppity.com
