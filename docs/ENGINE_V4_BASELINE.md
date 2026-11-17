# Engine V4 – Baseline (S0)

Stand vor jeder V4-Änderung: Git `306c0af534c1ac548a425896ad3fa91538ce741e` (Branch `main`), Datum 2026-11-16, Rechner RTX 5090 32 GB, Windows 11 Pro 26200, Node 24.21, Python 3.12.9 (uv).

## Ausgeführte Baseline-Checks (Logs unter `docs/v4-logs/`)
| Befehl | Exit | Ergebnis |
|---|---|---|
| `npx vitest run` | 0 | 141 Dateien, 1090 Tests grün (`baseline-vitest.log`) |
| `npx tsc --noEmit -p tsconfig.node.json` | 0 | `baseline-tsc-node.log` |
| `npx tsc --noEmit -p tsconfig.web.json` | 0 | `baseline-tsc-web.log` |
| `python -m unittest discover -s docs/implementation/shortme-engine-v4/tests` | 1 | 13/14 grün. **Vorbefund im Paket, nicht in Shortme:** `test_strict_path_with_no_package_as_proof` scheitert unter Windows, weil `tempfile` einen 8.3-Kurzpfad (`ANDIRE~1`) liefert und `contained_file` die Wurzel nicht auflöst. Das Repo selbst liegt unter einem Langpfad und ist nicht betroffen. Paket bleibt unverändert. |
| `v4_gate.py --repo . --init` | 0 | `docs/ENGINE_V4_EVIDENCE.json` mit 54 IDs `pending` |

## Vorhandene Engines und echte Pfade
| Teil | Pfad |
|---|---|
| Engine-IDs, Läufe, Zustand | `src/shared/engine.ts` (`legacy`, `multimodal-v2`, `adaptive-v3`), `src/main/shortme/clips/engines/state.ts` |
| Dispatcher | `src/main/shortme/clips/engines/index.ts` (`runSelection`, `engineRevisions`) |
| Analyse-Job | `src/main/shortme/clips/analysis.ts` (`runAnalysis`, `loadClips`, `saveClips`, `findClip`) |
| Job-Queue / IPC | `src/main/shortme/jobs.ts`, `src/main/shortme/engineIpc.ts`, `src/main/shortme/ipc.ts`, `src/preload/index.ts` |
| Engine 1 | `src/main/shortme/clips/select.ts` (LLM über Satznummern, Einrasten) |
| Engine 2 | `src/main/shortme/clips/engines/v2/*` (`runPipeline`) |
| Engine 3 | `src/main/shortme/clips/engines/v3/*` (`selectV3` → `runPipeline` mit `V3Hooks`) |
| Python-Worker | `resources/python/worker.py` (Protokoll v1), Umgebungen `py312-v3` (Embedding) und `py312-v3av` (MiniCPM-o, Lighthouse), Client `v3/pyWorker.ts` |
| GPU-Sperre | `src/main/engines/vram.ts` (`VramSequencer`, Residents `llm`, `vision`, `audio`, `v3-embed`, `v3-temporal`, `v3-av`) |
| Modelle | `src/main/engines/catalog.ts`, Manager/Downloader `src/main/engines/` |
| ASR | Parakeet v3 (sherpa-onnx, eigene Node-Laufzeit), Ergebnis `projects/<hash>/transcript.json` mit Wortzeiten |
| Signale | `src/main/shortme/clips/signals.ts` (Pegel, Stille), `audioEvents.ts` (YAMNet), `shots.json` (Kamerawechsel) |
| Clips/TimeMap | `ShortmeClip` (`src/shared/shortme.ts`): `start/end`, `autoCuts` (entfernte Quellabschnitte) = autoritative Quelle→Ausgabe-Abbildung; `shared/compare.ts` `clipPieces`/`sourceToOutputTime` |
| Editor | `src/renderer/src/shortme/EditorScreen.tsx`, Operationen `src/shared/edits.ts` (Undo/Redo) |
| Export | `src/main/shortme/render*.ts` (FFmpeg, 9:16, tscaps-Untertitel), Vorschau = Export-Plan (`previewPlan`) |
| Vergleich | `src/shared/compare.ts`, `src/main/shortme/clips/compare.ts`, `CompareScreen.tsx`, `CompareSync.tsx` |
| Packaging | `npm run package` (electron-builder NSIS), `extraResources: resources/python` |

## Medien für Abnahmeläufe
- `test-videos/podcast-2p.mp4` (Video+Audio, 2 Sprecher), `solo.mp4`, `nofaces.mp4`.
- Projekt `bc5147fe…` (293-s-Twitch-Stream, 1080p60, Video+Audio) in `%APPDATA%\cutawan\projects`.
- Längere Quelle (≥ 1 h): noch zu bestimmen (S2/S9).
