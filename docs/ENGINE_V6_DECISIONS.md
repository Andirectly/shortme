# Engine 6 – Entscheidungen (Rev. 4, Stand 25.11.2026)

Grundlage: `Shortme_Engine6_Adaptive_Intelligence.pdf` Rev. 4. Code: `src/main/shortme/clips/engines/v6/`. Benchmarks: `docs/ENGINE_V6_BENCHMARK.md`, Rohdaten `docs/bench-v6/`.

## Architektur
| Entscheidung | Grund |
|---|---|
| Eigener Orchestrator `v6/`, Engine-ID `engine6`, Pipeline 6.0, Run-Präfix `v6-`; `isV4Pipeline('engine6') = false` | PDF Kap. 2; Engine 4/Mac bleiben unverändert |
| Wiederverwendet: v4-Spuren (Sprache mit Cache, Ton, Bildwechsel, Bild-Embedding, Chat), Fusion `fuseSeeds`/`selectBalanced`, `investigateGroup`, `judgeCuts` (nur wortlos), `measuredCriteria`, `planRepair` (nur wortlos), v3-Worker, Exporter | keine Doppelimplementierung, getestete Bausteine |
| Modellphasen gebündelt: Text (Sprachsuche) → Embedding → Text (Ranking) → AV (Untersuchung, wortlose Kanten) → CPU (Render) → AV (Ausgabe ansehen) → Text (Urteil) | auf 12/16-GB-Geräten nie zwei große Modelle gleichzeitig; Modellwechsel minimiert |
| Ranking über den vollständigen Wortlaut, Gruppen ≤ 6, reproduzierbar gemischt (Saat aus Quell-SHA), Spitzenvergleich in Runden zu 6 (beste 3 weiter) | Kap. 10: kein O(n²), keine isolierten 0–100-Noten, kein Kürzen des Originaltexts (Gruppe wird kleiner) |
| Ranking-Antwort: JSON-Schema (Grammatik) + Hostprüfung: jede ID genau einmal, Rang = Permutation, Satzgrenzen aus dem eigenen Kandidaten; ungültig → einmal wiederholt, sonst „unvollständig“ | Kap. 4/10/23, nie still ergänzt |
| Titel kommt aus dem Ranking (vor dem Render), Endprüfungs-Titel wird nur protokolliert | geprüfte Datei = exportierte Datei (Titel steckt im Fingerabdruck/Bild) |
| Schnitt für Sprachclips rein hostseitig aus Satz-IDs (`planSpeech`): zu kurz → ganze Folgesätze; zu lang → ungültig (Reserve), nie mechanisch gekürzt | Kap. 12; spart den Cut-Judge (in Engine 4 ~14 s je Aufruf) |
| Wortlose Clips: Cut-Judge der Engine 4 auf gemessenen Kanten, Wortschnitt verboten | Kap. 12 |
| Ausschnitt vor dem Render über das gemeinsame Layout-Modul (`clips/clipLayout.ts`), danach eingefroren; `analysis.ts` plant für Engine 6 nicht neu, zieht keine Gesichtsquote ab und sortiert nicht nach Score | Kap. 12/16: keine zweite Layoutplanung nach dem Audit, Rang bleibt erhalten |
| Render über `render/exportOne.ts` (= Nutzer-Export) mit `inputFingerprint`; der Export übernimmt die geprüfte Datei nur bei gleichem Fingerabdruck UND gleichem SHA-256 | Kap. 13: Prüfung gilt genau dieser Datei; Bearbeitung/Stil/Preset → neuer Render, alter Status gilt nicht |
| Endprüfung: Technik (ffprobe + vollständiger Decode), AV-Modell sieht/hört die ganze Datei in gezählten Paketen ≤ 40 s, Textmodell urteilt über behaltenen Wortlaut + Beobachtungen + Messwerte | Kap. 13; Engine 4 prüfte bei > 40 s nur Anfang/Mitte/Ende |
| `verified` nur bei Technik ok, vollständiger Paketabdeckung, standalone/payoff/natural-end/hook = pass (+ essential-event bei wortlos), keine gemessene Stille/Naht/Ausschnitt-Fehler | Kap. 13 |
| Reparatur: höchstens 1 je Clip, global ≤ Wunschzahl; Sprache: ein Satz davor/danach; schlechtere Reparatur überschreibt nichts | Kap. 13 |
| Rangwert in `score` (100, 96, …), Oberfläche zeigt „#Rang“ statt Punktzahl | Kap. 16: kein 90/100-Qualitätswert |
| Remote: Worker lehnt unbekannte Engine ab (`VERSION_INCOMPATIBLE`) statt still die Standard-Engine zu nehmen | Kap. 16; Worker ≤ 0.52 sind davon noch betroffen |
| Mac: Qwen3.5 (mlx_vlm) + Gemma 4 E4B (`analyze_av`) + Embedding – **UNTESTED** | Kap. 11; MacBook in dieser Sitzung nicht verfügbar |

## Gemessene Schalter (Benchmark, Rohdaten `docs/bench-v6/`)
| Mechanismus | Messung | Entscheidung |
|---|---|---|
| Bildindex: ein Decode (B) statt Sprung je Bild (A) | solo 10 min: 19,6 → 9,3 s; podcast 12 min: 22,8 → 13,1 s; Vektor-Kosinus zu A 0,97–0,98, Top-5-Übereinstimmung 0,82–0,83 | **an** |
| Auflösung 320 statt 448 px | Embedding-Zeit gleich (2,5 vs 2,6 s), Decode gleich, Treffer schlechter (0,68 vs 0,82) | **448 px** |
| Redundanzreduktion im Bildindex | Podcast: nur 2/92 Fenster übernommen, Treffer 0,83 → 0,67; Vlog: 0 übernommen | **aus** (Mechanismus bleibt, `V6_INDEX.dedupe`) |
| Hardware-Decode (`-hwaccel auto`) | 15,8 s statt 10,0 s (Software) | **aus** |
| Redundanzreduktion in AV-Prüfpaketen (`keepFrames`) | siehe Benchmarkbericht | siehe dort |

## Abweichungen vom Auftrag (bewusst, mit Grund)
- **Progressive Verarbeitung (Kap. 21)**: segmentweiser Import mit ASR während des Downloads ist NICHT umgesetzt. yt-dlp führt Bild und Ton erst am Ende zu einer MP4 zusammen; ein validierter Teilindex existiert vorher nicht – der Auftrag verlangt in genau diesem Fall „sicher auf vollständigen Import warten“. Umgesetzt ist die Überlappung innerhalb des Laufs (Keyframes ∥ YAMNet/Sprachsuche, Kamerawechsel ∥ Suche, Render ∥ nichts Großes auf der GPU).
- **Dualer Import / separate Low-Res-Rendition (D)**: nicht umgesetzt; Variante B (skalierte Frames aus dem Original, ein Decode) ist gemessen und aktiv. C (lokaler Proxy) existiert nur im Mac-Pfad für AV1 (`mac2/proxy.ts`).
- **Adaptiver Controller (P1), globaler Themenindex (P1), semantische Duplikate über Embeddings (P1), A/B-B/A-Vergleiche (P1), Precision Alignment (P1), Active-Speaker-Tracking (P1), Reranker (P1)**: nicht umgesetzt, standardmäßig aus; Duplikate nur über Zeitüberlappung (> 50 % am kürzeren Clip).
- **P2** (Token-Kompression im Modell, Speculative Decoding, Präferenzprofil): nicht umgesetzt.
