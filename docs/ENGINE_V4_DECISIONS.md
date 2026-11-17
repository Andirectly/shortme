# Engine 4 – Entscheidungen (mit Grund)

| # | Entscheidung | Grund / Beleg |
|---|---|---|
| D1 | Eigener Orchestrator `v4/index.ts`; geteilt werden nur Infrastruktur-Bausteine (Transkript, Signale, Textsuche, YAMNet-Index, Embedding-Index, Python-Worker, Exporter, Layout, GPU-Sperre) | Vorgabe „keine V3-Reuse unter falscher Bezeichnung, harmlose Infrastruktur wiederverwenden“; Test `engineV4Registry`: kein Import/Aufruf von `runPipeline/selectV2/selectV3` |
| D2 | Ein Modell (MiniCPM-o 4.5) für Investigator, Cut-Judge und Endprüfung | einziges lokal gemessenes Modell mit echter gemeinsamer Bild+Ton-Eingabe; eine GPU-Phase statt Modellwechsel je Schritt |
| D3 | AV-Eingaben ≤ 40 s (lange Bereiche als Anfang+Mitte+Ende) | gemessen: 75-s-Ausschnitt → VRAM über 32 GB, Auslagerung, Zeitüberschreitung; `inference_mode` + Cache-Freigabe je Aufruf |
| D4 | Endprüfung = Modell (hook, standalone, payoff, natural-end, essential-event) + Messungen (dead-air, audio-seam, visual-seam, caption-sync, crop-safety) | Messbares wird gemessen statt geschätzt; Entscheidung wird aus den 10 Kriterien abgeleitet, nicht vom Modell übernommen |
| D5 | Grenzen nur als Kanten-IDs; Cut-Judge sieht nur Kanten in ±7 s um die Kandidatengrenzen | jevcut-Prinzip; so liegen alle Alternativen im gezeigten Anfangs-/Endteil |
| D6 | Sprach-Lane = vorhandene Shortme-Textsuche (LLM über Satznummern) | erprobt; Satznummern statt Zeiten (keine erfundenen Zeitstempel) |
| D7 | ASR = vorhandenes Parakeet-Transkript | V4-012 erlaubt Bestands-ASR; Qwen3-ASR-Vergleich nicht gemessen → V4-012 bleibt in_progress |
| D8 | Fusion nach Referenzalgorithmus (RRF je Lane, keine Transitiv-Kette, mehrdeutig → eigene Gruppe) + reservierte Lane-Budgets + Zeit-Zehntel | V4-021, `reference_core/algorithms.py` als Design |
| D9 | Ereignisse ohne beobachtete Kernrolle oder mit Widerspruch werden nicht geschnitten | „unknown statt Erfindung“; null Clips sind erlaubt |
| D10 | Exporter-Fehler mit Apostroph/Komma im Titel an der Wurzel behoben (`safeFileName`) | trat im ersten V4-Lauf auf und betraf alle Engines |
| D11 | VideoITG, LongVideoAgent-Code, jevcut-Dienst, VideoHighlighter nicht genutzt | Lizenz (nichtkommerziell/AGPL/keine Lizenz) bzw. Cloud-Dienst |
| D12 | Bei MiniCPM-o-Ladefehler bricht der Lauf mit klarer Meldung ab | „OOM degradiert klar oder blockiert“; kein ungemessener Ersatz |
