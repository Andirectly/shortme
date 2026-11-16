# Engine 3 – Status (nur Belegtes)

Stand 2026-11-16, RTX 5090 (32 GB), Windows 11, Treiber 610.88. „läuft“ = auf diesem Rechner mit echten Daten ausgeführt (Smoke + ein voller Lauf), nicht mehr.

## Modellrollen
| Rolle | Modell | Status | Beleg |
|---|---|---|---|
| Visuelle Semantiksuche | Qwen3-VL-Embedding-2B | implemented | voller Lauf; Index 37 Fenster in 13,2 s, 4,26 GB geladen, Spitze 4,49 GB |
| Zeitliche Verortung | Lighthouse CG-DETR + CLIP ViT-B/32 | implemented | voller Lauf: 3 Fenster à 120 s in ca. 16–21 s, 0,77 GB geladen, Spitze 0,91 GB. Auf Vlogs trainiert (QVHighlights), Werte nicht kalibriert |
| Bild+Ton-Prüfung | MiniCPM-o 4.5 (bf16, Transformers 4.51.0) | implemented | voller Lauf: 5 von 5 Ereignissen geprüft (45,8 s gesamt); Laden 13–27 s, 18,1 GB, Spitze 22,0 GB (Einzeltest) |
| Ersatzprüfer Bild / Ton | Qwen3-VL-4B, Voxtral | implemented-with-fallback | nur für Ereignisse, die MiniCPM-o nicht prüfen konnte oder die jenseits `avMax` liegen; im Lauf sichtbar (`visionFallback`, `v3Av`) |
| Audio-Signale | YAMNet (Engine-2-Code) | implemented (geteilt) | Ton-Index wie in Engine 2 |
| Text/Chat | Engine-2-Textsuche | implemented (geteilt), als „compat“ gekennzeichnet | – |
| Bewertung, Schnitt, Naht, Paarvergleich | Engine-2-Code | implemented (geteilt) | – |
| Alternativer Prüfer | MOSS-VL-Instruct | not-implemented | nicht geprüft |
| Event-Refiner | TEMPURA | not-implemented | nicht geprüft |
| Frame-Auswahl | VideoITG | blocked (`license-blocked`) | Gewichte nichtkommerziell; kein Download |
| Ranker | TRINITY, QB-Highlights, Qwen3-VL-Reranker | not-implemented | nicht geprüft |
| V2-Forschungsadapter | Marlin, TripleSumm | unverändert | nicht angefasst |
| Embedding 8B | – | not-implemented | – |
| Worker-Operationen `select_frames`, `rank_candidates` | – | not-implemented | Worker meldet es in `capabilities` |

## Befehle und Ergebnisse
| Befehl | Ergebnis |
|---|---|
| `npx vitest run` | 141 Dateien, 1090 Tests grün |
| `npx tsc --noEmit -p tsconfig.node.json` / `…web.json` | ohne Fehler |
| `npx eslint` (neue Dateien) | ohne Meldung |
| `ENGINE=adaptive-v3 PROFILE=balanced SHORTME_DATA=<Daten> npx tsx --tsconfig tsconfig.node.json scripts/engine-run.ts bc5147fe stream 5` | Exit 0, 4 Clips, 324 s (293-s-Stream) |
| `node .tmp`-Worker-Tests (Lighthouse, MiniCPM-o über das Protokoll) | beide Modelle laden, antworten, entladen |

## Gefundene und behobene Fehler
- ffmpeg-Kindprozess (Lighthouse) erbte stdin des Workers → Worker hing. Behoben: Protokoll-Pipes auf private Handles, fd 0/1 der Kinder umgeleitet.
- numba (über librosa) versuchte den JIT-Cache an einen nicht beschreibbaren Pfad zu schreiben (Wiederholungsschleife) → `analyze_av` hing. Behoben: `NUMBA_CACHE_DIR` auf einen beschreibbaren Ordner.
- 33 Lighthouse-Vorschläge ließen alle 45 Rohvorschläge zu **einem** Ereignis verschmelzen. Behoben: Gesamtbudget (`max(6, Dauer/150 s)`), schmalere Spannen.
- MiniCPM-o + gleichzeitig geladener `llama-server` (10 GB) passen nicht in 32 GB: die GPU lagert in den Hauptspeicher aus, die Prüfung wird um Größenordnungen langsamer. Im Test wurde die App geschlossen. In der App sorgt der `VramSequencer` für das Entladen (im installierten Zustand **nicht** vollständig durchgespielt).

## Bekannte Abweichungen von der Spezifikation
- Keine Laufdateien `manifest.json`, `decision-log.json`, `cuts.json` (Status in `analysis/state.json`, Schnitte in `variants.json`).
- AV-Umgebung ohne `--require-hashes` (Git-Pins), Embedding-Umgebung mit Hashes.
- Qwen3-VL-Reranker, MOSS-VL, TEMPURA, TRINITY, QB-Highlights nicht gebaut; VideoITG gesperrt.
- Kein Test an einem 1–3-Stunden-Video; die Zielzeit „3 h in 30–45 min“ ist **nicht gemessen**.
- Qualitätsaussage „besser als Engine 2“: nicht belegt (kein Blindtest mit Daten).
