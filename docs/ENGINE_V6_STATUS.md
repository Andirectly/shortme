# Engine 6 – Status (Rev. 4, Stand 26.11.2026)

Branch `feat/engine6`. Entscheidungen: `ENGINE_V6_DECISIONS.md`. Zahlen: `ENGINE_V6_BENCHMARK.md`, Rohdaten `bench-v6/`. Fortschritt: `ENGINE_V6_PROGRESS.md`.

## Start
Engine 6 ist auf **Windows** wählbar (Erstellen-Dialog, Engine-Schalter, Standard speicherbar). Auf dem **Mac ist sie ausgeblendet** (`ENGINE6_ON_MAC = false` in `shared/engine.ts`), bis sie dort getestet ist; `loadDefaultEngine` überschreibt auf dem Mac eine gespeicherte Wahl nicht mehr. **Nicht Standard.** Voraussetzungen (Windows): dieselben Modelle wie Engine 4 (Qwen3-14B, MiniCPM-o, Qwen3-VL-Embedding, YAMNet) – kein neues Modell.
Skripte: `node scripts/v6-run-report.cjs <hash> engine6|engine4` (Auswertung), `scripts/v6-cold.cjs <hash>` (kalter Lauf), `scripts/v6-blind-pack.cjs` (anonymes Paket), `scripts/v6-index-bench.ts` (Bildindex).

## Implementiert und geprüft (Windows, RTX 5090)
| Bereich | Stand | Nachweis |
|---|---|---|
| Registry, Dispatcher, Run-Ordner, Manifest, Zustandsmaschine, Profiler (Phasen, Zähler, RAM, VRAM) | läuft | echte Läufe, `manifest.json` je Lauf |
| Bildindex: ein Decode, 448 px, Redundanzreduktion (aus) | läuft | `bench-v6/index-*.json` |
| Spuren (Sprache mit Cache, Ton, Bildwechsel, Embedding, Chat) + Fusion | läuft | `candidates.json` |
| Redaktionelles Ranking über den Wortlaut (Gruppen, Spitzenvergleich, Hostprüfung) | läuft | `ranking.json`, 7 Runden, 0 ungültig |
| Gezielte Untersuchung offener Fragen / wortloser Kandidaten, ROI-Detailzoom | läuft (ROI: 2 Aufrufe im Lauf 3) | `roi.json`, `investigation.jsonl` |
| Host-Schnittplan aus Satz-IDs, wortlos über Kantengitter | läuft | `plans.json` |
| Ausschnitt vor dem Render, Render = Export-Pfad, Überlappung mit AV-Phase, Reserven bei Bedarf | läuft | Lauf 3 |
| Ausgabeprüfung (Technik + ganze Datei in Paketen + redaktionell), 1 Reparatur/Clip, beste Version bleibt | läuft | `audits.json` |
| Rang in der Oberfläche (#Rang, „nach Rang sortiert“), Review, Editor | läuft | echtes Fenster, 2 Projekte |
| Export übernimmt die geprüfte Datei bytegleich (SHA-256), nach Bearbeitung neuer Render | geprüft | Export-SHA = geprüfte SHA; nach `editWord` andere SHA |
| Recheck Engine 6 (frisch gerendert, ganze Datei in Paketen) | geprüft | 3 Rechecks, reproduzierbar `verified` |
| Neustart der App, alte Projekte | geprüft | Läufe und Clips laden, alte Projekte unverändert |
| Remote: unbekannte Engine wird abgelehnt | Test | `tests/remoteEngineSelect.test.ts` |

## Nicht umgesetzt / bewusst weggelassen (Begründung in DECISIONS)
Progressiver Import (Kap. 21), separate Low-Res-Rendition (Kap. 6/8 Variante D), adaptiver Controller, globaler Themenindex, semantische Duplikate per Embedding, A/B-B/A-Vergleiche, Precision Alignment, Active-Speaker-Tracking, Reranker, alle P2. Frühe Veröffentlichung einzelner geprüfter Clips während des Laufs: nicht umgesetzt (der gemeinsame `runAnalysis` veröffentlicht erst nach der Auswahl).

## UNTESTED
- **Mac (Apple Silicon, M1 Pro 16 GB)** – deshalb ausgeblendet: Adapter (Qwen3.5/mlx_vlm, Gemma 4 `analyze_av`, Embedding) existieren, aber kein einziger Lauf. Speicherbedarf, Paketgrößen (≤ 30 s Ton für Gemma!) und Frame-Limits sind nicht angepasst – `observeRendered` nutzt 40-s-Pakete wie Windows. Vor Mac-Nutzung prüfen.
- Menschliche Blindbewertung: Paket liegt bereit (`C:\Claude Apps\Shortme-blind\solo`), noch nicht bewertet. Modellurteile (`verified`) sind **kein** Qualitätsnachweis.
- Nur 2 Quellen (solo 10 min, Podcast 12 min, je 1 Lauf); keine Streams/Gameplay/stille Pointen/4K/VFR-Läufe; keine Wiederholungen → keine P50/P95.
- Remote-Übertragung von Engine-6-Läufen (Hash/Release-Gate) nicht durchgespielt.
- AV-Redundanzreduktion (`SHORTME_V6_AVDEDUPE=on`) nicht gemessen → bleibt aus.

## Benchmark (Kurzfassung, Details `ENGINE_V6_BENCHMARK.md`)
kalt, gleiche Quelle/Optionen, Windows RTX 5090: solo Engine 4 1340 s / 10 Clips / 3 geprüft → Engine 6 609 s (−55 %) / 9 / 4; Podcast 1156 s / 10 / 1 → 775 s (−33 %) / 7 / 4. Qualität menschlich nicht bewertet.

## Bekannte Grenzen
- Untersuchungsantworten des AV-Modells sind manchmal ungültig (JSON-Syntax, erfundene Segment-ID): 3 von 9 im Podcast-Lauf; betroffene Kandidaten fallen weg.
- Test-Exporte während der Abnahme wurden gelöscht; `upload/exports.json` kann noch 2 Verweise auf die gelöschten Test-Dateien enthalten.
- „Hook“ wird vom AV-/Textmodell streng beurteilt (viele `needs-review` wegen `hook:fail`) – Qualität der Hook-Bewertung ungeprüft.
- Zeit bis zum ersten geprüften Clip (406 s solo) ist besser als vorher, aber alle Clips werden erst am Ende veröffentlicht.
- Peak-VRAM 28,9 GB (Gesamtbelegung der GPU laut nvidia-smi inkl. anderer Programme) – auf 12/16-GB-Karten nicht getestet.
