# M0 – Ergebnisse (2026-10-17, RTX 5090 32 GB, Node 24)

Skripte: `spikes/asr.cjs`, `asr-compare.cjs`, `llm.cjs`, `subs/` (Electron), `scripts/test-asd.ts` (aus dem Fork).
Testmaterial: `podcast-2p.mp4` = „Tattoo“-Video (12:09, 2 Personen, viele Schnitte/Handkamera), `solo.mp4` = „Gericht für 10 €“ (10:19). Die Videos sind Vlogs, keine statischen Podcast-Zweierbilder.

## 1. ClipForge-Basis (= Cutawan 0.14.0)
- `npm ci`, `typecheck` grün. `npm test`: 722/723 grün; 1 Fehler = Windows-`EPERM` beim atomaren Umbenennen (`tests/projectPersistence.test.ts`), Race mit Virenscanner/Indexer – kein Logikfehler, vor M3 härten (Retry beim `rename`).
- npm führt Install-Skripte nicht automatisch aus → Electron-Binary musste per `node node_modules/electron/install.js` geholt werden.
- **OpenAI-/Cloud-Aufrufe** (alle auf lokale Engines umzustellen):
  - `src/main/pipeline/openai.ts` – zentral: `/audio/transcriptions` (Z. 270, 308) und `/chat/completions` (Z. 456); `DEFAULT_OPENAI_API_BASE`. Aufrufer: `highlights.ts`, `editorialReview.ts`, `socialCaption.ts`, `visualScore.ts`, `visualStory.ts`, `screenDetail.ts`, `sourceDiscovery.ts`, `broll.ts`, `imagesearch.ts`, `transcribe.ts`, `projectTranscript.ts`, `composition.ts`, `presenterComposition.ts`.
  - Zusätzlich Cloud-Pfade: `openrouter.ts`, `shared/openrouter.ts`, `subscription.ts` (ChatGPT-Abo), UI: `SettingsModal`, `SetupWizard`, `SubscriptionSettings`, `HomeScreen`, `TopBar`.
  - Lokale Transkription im Fork nutzt **Python** (`resources/local-whisper/*.py`) → durch sherpa-onnx ersetzen (Stack-Regel „kein Python“).
  - Gute Nachricht: Gesichter, LR-ASD, Silero-VAD, MFCC, Encoder-Erkennung liegen schon fertig vor (ONNX-Modelle in `resources/models/`).

## 2. ASR Deutsch (sherpa-onnx 1.13.8, CPU, 4 Threads, Silero-VAD ≤ 20 s)
| | Parakeet v3 int8 | Whisper large-v3-turbo int8 |
|---|---|---|
| Zeit für 729 s | 30,3 s | 167,3 s |
| RTF | **0,042** (60 min ≈ 2,5 min) | 0,230 |
| Wort-Zeitstempel | ja (Token-Zeiten, monoton, nur 2 Wörter > 1 s) | nein (Segmentzeiten) |
| Wörter | 2279 | 2287 |
- Unterschied beider Transkripte: 24 % der Wörter (Wortebene, ohne Satzzeichen). Stichprobe: Parakeet lässt gelegentlich kurze Einwürfe aus („gar nicht“), Whisper formuliert Umgangssprache glatter.
- **Wahl: Parakeet v3** (5× schneller, Wortzeiten nativ; Whisper bräuchte zusätzliches Alignment). Whisper turbo bleibt optionale Zweitwahl im Modell-Manager.
- ⚠ Die 50-Wörter-Prüfung gegen Audio braucht dich (siehe `docs/REVIEW.md`); ich kann kein Audio hören. GPU-Provider wurde nicht getestet (CPU reicht weit).

## 3. LLM lokal (llama.cpp b11711, CUDA 13.4, `-c 16384 -fa on`, JSON-Schema, Transkript 12 min ≈ 5k Token)
| | Qwen3-14B Q4_K_M | Gemma 3 12B Q4_K_M |
|---|---|---|
| Gültiges JSON | 5/5 | 5/5 |
| Antwortzeit (≈500 Token) | 4,2 s | 3,7 s |
| VRAM gesamt | 13,6 GB | 12,2 GB |
| Instruktionstreue | Score-Skala 0–100 eingehalten | 1 von 5 Läufen Skala 0–10 statt 0–100 |
| Clip-Länge | 90–130 s (Vorgabe 20–60 s ignoriert) | 70–180 s (ebenso) |
- **Wahl: Qwen3-14B** (stabilere Skala, Hooks als wörtliche Zitate). Beide ignorieren die Längenvorgabe → in M4 Kandidatenfenster fest vorgeben/validieren und mit Einrasten (max 90 s) erzwingen, nicht dem LLM überlassen.
- ⚠ Zielhardware ≥ 12 GB: beide Modelle sprengen 12 GB bei 16k Kontext (KV-Cache). Abhilfe M2: `--cache-type-k/v q8_0` oder Q4_K_S/Qwen3-8B als „kompakt“-Profil. Auf deinen Rechnern (32 GB) unkritisch. Die zweite Maschine habe ich nicht geprüft.
- Thinking-Modus von Qwen3 per `chat_template_kwargs.enable_thinking=false` aus; Plausibilität der Clipwahl inhaltlich → `docs/REVIEW.md`.

## 4. Tracking (Fork-Code `analyzeClipASD`: YuNet + LR-ASD, ONNX Runtime)
- Läuft ohne Anpassung außerhalb von Electron (`tsx`). 60 s Video (200–260 s) in 25,7 s (0,43× Echtzeit), 40 Tracks, 26 Schnitte in 60 s.
- Das Testvideo ist stark geschnitten (alle 2–3 s Kamerawechsel, Gesichter oft nur halb im Bild) → Tracks sind kurz.
- **Treffsicherheit ≥ 90 % NICHT bestätigt**: Ich kann aus Standbildern nicht sicher erkennen, wer spricht (annotierte Frames 200–258 s gesichtet: Boxen sitzen auf den Gesichtern, Sprecher-Farben plausibel, aber nicht verifizierbar). → Stichprobe 20 Momente als Aufgabe für dich in `docs/REVIEW.md`.

## 5. Untertitel-Export (`@tscaps/engine` 0.7.0 in Electron 35, unsichtbares Fenster)
- 60-s-Clip 1080×1920, 30 fps, H.264+AAC: **5,7 s = 0,09× Echtzeit** (Ziel < 1,5×) ✔
- Bildprüfung 3 Frames: Text scharf, Outline sauber, Position/Hervorhebung korrekt, keine Artefakte.
- Ausgabe 93 MB/60 s (≈ 12 Mbit/s) → in M6 `withQuality` auf Export-Profil abstimmen.
- **Entscheidung: tscaps bleibt Standard, ASS/libass nur Fallback.** Hinweis: Wort-genaue Hervorhebung braucht Wortzeiten im Document (`PassthroughTranscriber`), im Spike nur SRT-Cues.

## Empfehlungen / Stack-Änderungen
1. CLAUDE.md-Stack: Parakeet v3 und Qwen3-14B festschreiben (erledigt).
2. Install-Skripte (electron, onnxruntime-node, ffmpeg-static) für Installer/CI via `allowScripts` freigeben.
3. Offene Entscheidungen für dich: (a) Modell-Profil für 12-GB-Karten, (b) Fork heißt intern noch „cutawan“ – Umbenennung in M1 miterledigen?
