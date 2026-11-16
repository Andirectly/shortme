# Engine 3 – Adaptive AI

Kurzfassung. Details: `ENGINE_V3_ARCHITECTURE.md` (Aufbau), `ENGINE_V3_STATUS.md` (Modellrollen, Befehle, Fehler), `ENGINE_V3_BENCHMARKS.md` (Messungen), `ENGINE_COMPARISON.md` (Vergleich), `ENGINE_V3_LICENSES.md` (Lizenzen).

## Ablauf
Text-/Ton-Quellen → Embedding-Index (Qwen3-VL-Embedding-2B) → Lighthouse-Verortung (CG-DETR/CLIP) → Rangfusion je Kanal → **Bild+Ton-Prüfung mit MiniCPM-o 4.5** → Bewertung, Schnitt, Naht, Paarvergleich (Engine-2-Code, als „compat“ gekennzeichnet).
Profile: Schnell (grobe Fenster, keine Lighthouse-Verortung, 6 Ereignisse mit Bild+Ton), Ausgewogen (8-s-Fenster, Verortung, 16 Prüfungen), Gründlich (4-s-Schritt, 32 Prüfungen).

## Voraussetzungen (Pflicht, keine stille Rückstufung)
- Python-Umgebungen `py312-v3` und `py312-v3av` (App installiert sie selbst; Knopf „Erneut versuchen“ bei Fehlern).
- Modelle im Modell-Manager: `qwen3-vl-embedding-2b` (4,3 GB), `minicpm-o-4_5` (18,8 GB), `lighthouse-cg-detr-clip` (0,5 GB) sowie die Engine-2-Modelle (Ersatzprüfer, Text, Naht).
- GPU: gemessen 22 GB Spitze für MiniCPM-o allein; Modelle laufen nacheinander (VramSequencer).

## Reproduzieren
`ENGINE=adaptive-v3 PROFILE=balanced SHORTME_DATA=<Daten> npx tsx --tsconfig tsconfig.node.json scripts/engine-run.ts <projekt> stream 5`
Die App vorher schließen: ihr `llama-server` belegt sonst VRAM, MiniCPM-o wird dann extrem langsam.

## Offen
Lauf auf langen Videos, Blindtests, Schätzung (`estimate.ts`) nicht kalibriert, Adapter MOSS-VL/TEMPURA/TRINITY/QB-Highlights/Reranker nicht gebaut, VideoITG gesperrt.
