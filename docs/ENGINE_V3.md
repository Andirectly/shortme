# Engine 3 – Adaptive AI (Status)

Stand: nur gemessene Werte. Alles andere steht als „nicht umgesetzt“ da.

## Ablauf
Text-Suche → Embedding-Index (Qwen3-VL-Embedding-2B, Python-Worker) → 14 feste Anfragen (`queries-v1`) → Spitzen (z-Wert) → Rohvorschläge → RRF-Fusion mit den Text-/Ton-Vorschlägen → Detailprüfung, Bewertung, Schnittvarianten, Nahtprüfung = Code von Engine 2 (`compat`, ausdrücklich nicht neu).
Profile: Schnell (12-s-Fenster), Ausgewogen (8 s), Gründlich (8-s-Fenster, 4-s-Schritt, 6 Bilder).

## Laufzeit
- Python 3.12 unter `<Daten>/runtime/py312-v3`, per `uv` 0.13.1 (SHA-256 fest), Lock mit Hashes (`resources/python/requirements.lock.txt`), torch 2.8.0+cu128.
- Worker `resources/python/worker.py`, Zeilen-JSON (Protokoll v1), Pfade nur unter erlaubten Wurzeln, kein Pickle.
- Modell `qwen3-vl-embedding-2b` (feste HF-Revision, SHA-256 je Datei) über den Modell-Manager; liegt nicht im Repo/Installer.
- ASR und Embedding-Modell nie gleichzeitig im VRAM (VramSequencer, Resident `v3-embed`).

## Gemessen (RTX 5090, 293-s-Stream, Ausgewogen)
- Modell laden 2,26 s, 4,26 GB; Peak 4,49 GB; Index 37 Fenster in 13,2 s.
- Gesamtlauf 367 s, 4 Clips, Bildprüfung als `signal-only` markiert (Embedding-Signal, keine Detailprüfung am Bild).
- Eine einzige Messung, ein Video. Keine Qualitätsaussage „besser als Engine 2“.

## Vergleich (`docs`-Kurzfassung)
`src/shared/compare.ts` (Zuordnung, Zeitabbildung, Blind-Reihenfolge), `src/main/shortme/clips/compare.ts` (Speicher `analysis/comparisons/<id>.json`), Ansicht `CompareScreen.tsx`.
Nur Läufe eines Projekts. Zuordnung: zeitliche IoU ≥ 0,25 oder Anker im Fenster; je Lauf ein Ereignis pro Match; knappe Zweitkandidaten → `ambiguous`; manuelles Zusammenführen/Trennen wird gespeichert. „Nur hier“ gilt für das Endergebnis, nicht für den Rohpool.
Nicht umgesetzt: synchrones Nebeneinander-Abspielen; getrennter `clip-recheck`-Lauf; Rohpool-Vergleich.

## Adapter-Status (keine Fake-Einträge)
| Baustein | Status |
|---|---|
| Qwen3-VL-Embedding-2B | umgesetzt, real getestet |
| Lighthouse, MiniCPM-o 4.5, MOSS-VL, TEMPURA, TRINITY, QB-Highlights, Qwen3-VL-Reranker, Marlin, TripleSumm | nicht umgesetzt, nicht geprüft |
| VideoITG | `license-blocked` (nichtkommerzielle Gewichte), kein Download |
| `temporal_ground`, `analyze_av`, `select_frames`, `rank_candidates` im Worker | nicht implementiert (Worker meldet das) |

## Offen
Schätzung (`estimate.ts`) nutzt Startwerte, nicht kalibriert. `manifest.json`/`embedding.json` je Lauf laut Spezifikation fehlen. Oberfläche (Schalter, Profil, Laufzeit-Installation, Vergleich) per Typecheck geprüft, nicht im laufenden Fenster durchgeklickt.
