
## Rhapsody (reference/rhapsody, 190 KB Code, Apache-2.0)
- Daten: Hugging Face `yhpark/rhapsody` (gesperrt, Zugang beantragen; Datasets-Format/Parquet), Code nur Auswertung.
- Zeilenfelder: `vid, cid, plid, gt, title, metadata, dva, hubert, segment_summaries, entire_summary, transcript`; `gt` = Replay-Kurve (np.array, 100 Werte 0..1, ein Wert je Prozent-Segment = YouTube-Heatmap mit 100 Bins).
- Highlight-Regel (`utils.graph_to_indices`): `gt[0] = gt[1]` (Bias im ersten Segment), Indizes mit `gt > 0,5` (`--gt_threshold`), nach Wert absteigend, max. 20 (`--max_n_gt`). Keine Glättung, keine Mindest-/Maximallänge: ein Highlight = ein Bin (1 % der Folge), keine Zusammenfassung benachbarter Bins.
- Kein Filter nach Aufrufen im Code (Auswahl der Folgen steckt im Datensatz); leere GT (kein Bin > 0,5) wird standardmäßig übersprungen (`--include_empty_gt`).
- Modelle: Zero-Shot (GPT-4o/Gemini), BM25 zum Titel, QLoRA-Llama-3.2-1B mit Segment-Klassifikationskopf (`ft_llm/`), Audio optional (DVA/HuBERT).
- Übernehmbar: Schwelle 0,5 + erster-Bin-Korrektur + Top-N; Beispielzeile liegt nicht im Repo (Datensatz gesperrt).

## MR.HiSum (reference/MR.HiSum, 60 MB, Code „All rights reserved“; Daten CC BY 4.0 + YouTube-AGB)
- Auslesen (`dataset/crawler.py`): Watch-Seite laden, `ytInitialData` per Regex, Pfad `playerOverlays…multiMarkersPlayerBarRenderer.markersMap[-1].value.heatmap.heatmapRenderer`; fehlt bei entfernten Videos (try/except).
- Normalisierung (`preprocess.align_most_replayed`): je Sekunde n → Bin `floor(n*1000 / markerDurationMillis)` (max. 99); Wert = `heatMarkerIntensityScoreNormalized` (0..1, von YouTube schon normiert) → `gtscore` pro Sekunde; keine eigene Formel.
- Format: `mr_hisum.h5` (Gruppe je `video_N`: features, gtscore, change_points via KTS, gtsummary via 0/1-Rucksack) + `metadata.csv` (`video_id, yt8m_file, random_id, youtube_id, duration, views, labels`; jedes Video ≥ 50 000 Aufrufe); 31 892 Videos.


## Fertige Datensätze

| | Repurpose-10K (arXiv 2412.08879, „Video Repurposing from User Generated Content", AAAI 2025) | Rhapsody (arXiv 2505.19429, github.com/younghanstark/rhapsody) |
|---|---|---|
| Download | Repo `yongliang-wu/Repurpose`: Splits in `/data`, Videos selbst per yt-dlp holen; ob die Freigabe vollständig live ist: unbestätigt | Hugging Face `yhpark/rhapsody`, gesperrt (Zugriff anfragen, `hf auth login`); GitHub nur Code |
| Lizenz | Code MIT; Datensatz-Lizenz nicht angegeben (unbestätigt); Videos gehören den Urhebern | Paper CC BY-NC-SA 4.0; Ethikteil: nur akademische Forschung; HF-Datensatzlizenz leer (Repo Apache-2.0 nur für Code) |
| Inhalt | Nur Annotationen (Start/Ende je Clip), keine Videos/Features | YouTube-IDs, Replay-Graph, verarbeitete Features; kein Original-Audio; Transkripte unbestätigt |
| Felder | Clip-Grenzen je Langvideo; genaues Schema unbestätigt | Titel, Beschreibung, Kategorien, Aufrufe, Replay-Graph (100 Segmente/Episode) → Highlight-Indizes (Schwelle τ=0,5) |
| Größe | >10 000 Videos, >120 000 Clips, Ø 32 min (≈5 300 h, eigene Schätzung); Plattengröße unbestätigt | 13 364 Episoden, 90 Kanäle, Ø 27,2 min (≈6 000 h, Schätzung), HF 65,8 GB; Split 70/10/20 |
| Sprache | nicht angegeben, vermutlich überwiegend Chinesisch (Plattform-Nutzer), unbestätigt | nur Englisch (Lingua-Filter) |
| Label | Von echten Nutzern gesetzte Clip-Grenzen (Themenabschnitte) | Implizit: Wiederholungs-Häufigkeit der Zuschauer (Podcast-Highlights) |

**Eignung Vortraining:** Repurpose-10K passt inhaltlich (Langvideo → Clips, Nutzerlabels), aber Sprache vermutlich nicht Deutsch, Lizenz unklar, Videos müssen selbst geladen werden; nur als Experiment für private Nutzung, Ergebnis unsicher. Rhapsody passt zu Podcasts und liefert Verhaltenslabels (näher an Viralität), ist aber nur Englisch und NC/Forschung; für rein private Nutzung vertretbar, Transfer auf Deutsch nur über Text-/Audio-Merkmale ohne Sprachbindung (unbestätigt).

## Unser Datensatz (`<Daten>/dataset/`, Rhapsody-kompatibel)
- `videos.jsonl`: eine Zeile je Video wie Rhapsody (`vid`, `title`, `gt` = 100 Bins der Replay-Kurve 0..1 oder null, `metadata`, `transcript` = Segmente); `candidates.jsonl`: Kandidaten (Shortme, Creator, Referenz); `pairs.jsonl`: `{a, b, source, weight, vid, split}` (a besser als b); `split.json`: Video → train/test (80/20, einmal vergeben); `blind.jsonl`: Blindtest-Urteile.
- Rhapsody-Highlights ableitbar: `gt[0] = gt[1]`, Bins mit `gt > 0,5`, absteigend, max. 20.
