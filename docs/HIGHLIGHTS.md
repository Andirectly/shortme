# Highlights aus Langvideos – Recherche und Umsetzung

Stand 2026-10-18. Quellen: arXiv 2602.02219 (Positions-Bias bei LLM-Rubrik-Bewertung), arXiv 2505.19429 (Rhapsody: Podcast-Highlights, „Most replayed“ als Ground Truth), arXiv 2407.12028 (TreeSeg), GitHub mutonby/openshorts, Anbieter-Blogs zu Clip-Längen. Hinweis: Kaum ein Open-Source-Clipper veröffentlicht echte Prompts oder Auswertungen; vieles ist Erfahrungswissen. Reddit war über die Suche nicht abrufbar.

## Was wir umgesetzt haben (M9)
| Maßnahme | Begründung | Datei |
|---|---|---|
| Anfangsprüfung: Konnektiv-/Anapher-Start („Und…“, „Er ist…“) + LLM-Urteil „ohne Vorwissen verständlich?“, Start bis zu 2 Sätze nach vorn (Frage mitnehmen), max. 2 Runden | größter Fehlermodus: Clip beginnt mitten im Gedanken | select.ts, prompts/standalone.md |
| Bewertung mit Belegen: erst Hook-/Payoff-Zitat und fehlenden Kontext, dann Noten; Zitat muss wörtlich im Clip stehen, sonst −1 | weniger Halluzination/Willkür | prompts/rate.md, `quoteOk` |
| Grobe Skala 0–4 mit Ankern statt 0–20, 2 Proben (Temperatur 0,2/0,5), Median | 14B-Modelle kollabieren bei feinen Skalen auf Lieblingszahlen | `mergeRatings` |
| Paarvergleich der Top-6-Finalisten in beiden Reihenfolgen (Uneinigkeit = Unentschieden) statt Gesamt-Rangliste in einem Aufruf | Positions-Bias | prompts/pair.md |
| Mehr Kandidaten (3,5× Zielanzahl) und Qualitätsschwelle (Hook ≥ 8/20 und eigenständig ≥ 8/20 bevorzugt) | schwache Clips nur als Lückenfüller | select.ts |
| Weiche Längenvorgabe: Sweetspot 22–50 s, Abzug darüber/darunter | Anbieter-Blogs (anekdotisch) | `lengthPenalty` |
| Ton-Signale (Lautstärke-Spitzen, Lachen-Heuristik) als kleiner Bonus, nie als Auswahl | Evidenz schwach | signals.ts |
| Kandidaten-Prompt: keine Warm-ups, Antwort nur mit der Frage davor | Hook in den ersten Sekunden | prompts/candidates.md |

## Noch offen (nach erwartetem Nutzen)
1. **Eigener Prüfstand**: 10–20 Podcasts mit YouTube-„Most replayed“-Kurve; Trefferquote der Top-Clips gegen die Peaks messen (Rhapsody-Methode). Ohne das bleibt jede Prompt-Änderung Bauchgefühl.
2. **Audio-Ereignismodell** (YAMNet/PANNs als ONNX) für Lachen/Applaus statt Heuristik.
3. **Embedding-Grenzen** (TreeSeg-artig, multilingual-e5/bge-m3) als Prior für Start/Ende.
4. **Kalibrierung** gegen 20–30 eigene Daumen hoch/runter (Rubrik-Dimensionen streichen, die nicht korrelieren).
5. Diversität: Themen-Abstand zwischen den gewählten Clips (nicht fünfmal derselbe Punkt).
6. Textqualität: Parakeet liefert Eigennamen/Umgangssprache teils falsch („S-Kate Fox“) – Whisper-Gegenprobe oder Wörterbuch pro Projekt.
