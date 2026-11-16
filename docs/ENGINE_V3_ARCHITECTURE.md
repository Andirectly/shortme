# Engine 3 – Architektur (wo sie wirklich eingehängt ist)

## Einhängepunkte im Bestand
| Bereich | Datei | Rolle für Engine 3 |
|---|---|---|
| Engine-IDs, Läufe, Zustand | `src/shared/engine.ts`, `engines/state.ts` | `adaptive-v3` neben `legacy`/`multimodal-v2`; Run-Isolation `analysis/runs/<runId>/`, Run-IDs `v3-…`, Profil in `options.profile` |
| Dispatcher | `clips/engines/index.ts` (`runSelection`) | Zweig `adaptive-v3` → `v3/index.ts` (`selectV3`), nie über `selectV2` |
| Job/IPC | `shortme/engineIpc.ts`, `ipc.ts`, `preload/index.ts` | gewählte Engine + Profil, Pflichtmodelle (`missingModelsFor`), Installation der Python-Umgebungen |
| GPU-Sperre | `src/main/engines/vram.ts` (`VramSequencer`) | einzige Sperre; Residents `v3-embed`, `v3-temporal`, `v3-av` laden/entladen je Phase |
| Modelle | `src/main/engines/catalog.ts` | `qwen3-vl-embedding-2b`, `minicpm-o-4_5`, `lighthouse-cg-detr-clip` mit fester Revision und SHA-256 |
| Redaktioneller Teil | `clips/engines/v2/index.ts` (`runPipeline`) | gemeinsamer Ablauf für Engine 2 und 3, Unterschiede über `V3Hooks` (siehe unten) |
| Schnitt/Export/Editor | unverändert | Clips von Engine 3 haben dieselbe Form (`ShortmeClip`, `source:'v3'`) |

## Ablauf Engine 3
1. Ton-Index (YAMNet, vorhanden), Keyframes, Chat/Heatmap – gemeinsame Quellen.
2. Textsuche (Engine-2-Code, LLM) – Quelle `text`.
3. **Embedding-Index** (Qwen3-VL-Embedding-2B, Python 1): Fenster über die ganze Zeitachse, Anfragen als Vektoren, Spitzen → Kanal `visual-embed`.
4. **Zeitliche Verortung** (Lighthouse CG-DETR + CLIP, Python 2): 120-s-Fenster mit 10 s Überlappung, Momente in Quellsekunden → Kanal `temporal` (nicht in Profil „Schnell“).
5. **Rangfusion je Kanal** (RRF, k = 60), Clustern, Detailauswahl mit reservierten Plätzen je Quelle.
6. **Bild+Ton-Prüfung mit MiniCPM-o 4.5** (Python 2): Ausschnitt mit Bild und Ton → Wahrheitswerte + kurze Sätze → Belege `observed` (visual + audio).
   Nur Ereignisse, bei denen das scheitert oder die nicht in `avMax` liegen, nutzen die Engine-2-Prüfer Qwen3-VL-4B/Voxtral (sichtbar in `diagnostics.json`: `v3Av`, `visionFallback`).
7. Bewerten, Schnittvarianten, Nahtprüfung, Paarvergleich = Engine-2-Code (Kompatibilitätspfad, unverändert).

## Zwei Python-Umgebungen
- `py312-v3` (Hash-Lock): torch 2.8.0+cu128, transformers 4.57.6 → Embedding-Modell.
- `py312-v3av` (feste Versionen, keine Hashes wegen Git-Pins): torch 2.8.0+cu128, **transformers 4.51.0** (MiniCPM-o schreibt das vor), Lighthouse, CLIP, minicpmo-utils.
- Beide führen dasselbe `resources/python/worker.py` aus; `capabilities` meldet, welche Modelle die jeweilige Umgebung wirklich laden kann.
- Protokoll v1: Zeilen-JSON, `requestId`/`runId`, Pfade nur in freigegebenen Ordnern, kein Netzwerk, fd 0/1 der Kindprozesse umgeleitet (ffmpeg von Lighthouse hing sonst am Protokoll-stdin).

## Persistenz
Pro Lauf `clips.json`, `events.json`, `evidence.json`, `diagnostics.json`, `variants.json`, `ratings.json`, `comparisons.json`. Gemeinsame, versionierte Caches unter `analysis/shared/` (Embeddings je Modell/Revision/Fingerprint, Temporal-Ergebnisse je Fingerprint).
Abweichung von der Spezifikation: kein `manifest.json`/`decision-log.json`/`cuts.json` je Lauf (Status steht in `analysis/state.json`; Schnitte in `variants.json`).

## Vergleich
Siehe `ENGINE_COMPARISON.md`.
