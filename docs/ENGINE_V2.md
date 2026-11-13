# Neue Engine (Beta): Architektur, Modelle, Einrichtung

Zweiter, voll lokaler Auswahlweg neben der bisherigen Engine. Der Auftrag steht in `docs/ENGINE_V2_AUFTRAG.md`, der tatsächliche Stand in `docs/ENGINE_V2_STATUS.md`.

## Umschalter
- **Erstellen-Dialog** (Startbildschirm, Zeile „Auswahl-Engine“): wählt die Engine für den nächsten Lauf. Die Wahl bleibt über Neustarts erhalten (`<Daten>/engine-default.json`).
- **Clip-Liste** (neben „Neu berechnen“): `EngineBar` mit dem Umschalter und einer Statuszeile: laufender Job, angezeigter Lauf, nächste Auswahl. Drei getrennte Zustände: *gewählte Engine*, *laufender Job*, *angezeigter Ergebnislauf*.
- Während ein Analysejob läuft, ist der Schalter gesperrt (Hinweis + der vorhandene Abbruchweg „Stoppen & behalten“).
- Klick auf die andere Engine: passt ein vorhandenes Ergebnis zu den aktuellen Eingaben (Fingerabdruck), wird es sofort angezeigt, ohne neue ASR oder Auswahl. Sonst: Modellprüfung → bei fehlenden Modellen Hinweis + Knopf „Modell-Manager öffnen“ (kein stiller Wechsel) → sonst Lauf starten.

## Läufe und Dateien
```
projects/<hash>/
  clips.json                 bisheriges Ergebnis = Lauf „legacy“ (unverändert, keine Startmigration)
  analysis/state.json        { selected, shown, view, runs[] } – Läufe, gewählte und angezeigte Engine
  analysis/audio-v2.json     YAMNet-Gruppen-Zeitreihe (versionierter Cache, eigene Datei, events.json bleibt unberührt)
  analysis/runs/<runId>/
    clips.json               Clips dieses Laufs (Clip-IDs `<runId>-c<n>`, kollisionsfrei)
    diagnostics.json         Stufenzeiten, Abdeckung, Budgets, Probleme, verworfene Varianten, Vergleichsstatistik, Peak-VRAM = „nicht gemessen“
    evidence.json            alle Belege (Text/Ton/Bild/Chat) mit Zustand signal-only | observed | unknown | failed
    events.json              geclusterte Ereignisse mit Fundquellen
    ratings.json             Bewertung je Ereignis (Kriterien 0–3 oder null = nicht beurteilbar, Qualitätsklasse, Zitat, Unsicherheit)
    variants.json            Schnittvarianten mit Prüfung
    comparisons.json         Paarurteile (beide Reihenfolgen)
  layout/<clipId>.json, thumbs/, edits/, ratings …   je Clip-ID, damit zwischen Läufen nichts vermischt wird
```
- `RunInfo`: runId, Engine, Versionen, Fingerabdruck (Medienidentität, Transkript-Version/Wortzahl/Modell, Engine+Version, Suchwunsch, Inhaltstyp, Bildausschnitt, Anzahl, Modell-/Prompt-/Algorithmusrevisionen), eingefrorene Optionen, Modelle, Modalitätsstatus (`checked | signal-only | unavailable | failed`), Abdeckung, Status (`running | done | incomplete | failed | stopped`).
- Ein Lauf pro Projekt gleichzeitig (`claimProject` + `hasActiveJob`); Doppelklick, IPC-Wiederholung und mehrere Fenster erzeugen keine zweite Analyse. Unterbrochene Läufe werden beim Start als `stopped` markiert, nie als fertig.
- Export, Editor, Vorschau und Lernen finden Clips über `findClip` (alle Läufe), gebunden an die Clip-ID: ein laufender Export liest nach einem Enginewechsel nicht plötzlich andere Clips.

## Pipeline der neuen Engine (`src/main/shortme/clips/engines/v2/`)
| Stufe | Modul | Modell / Laufzeit |
|---|---|---|
| Quellen: YAMNet-Gruppen (Lachen, Jubel, Rufen, Gesang/Rap, Musik), Keyframe-Bildänderungen, Chat/Heat | `audioIndex.ts`, `visualIndex.ts` | YAMNet (ONNX), FFmpeg |
| Textsuche: 180-s-Fenster, 30 s Überlappung, ≤ 700 Wörter | `search.ts` | Text-LLM (llama-server) |
| Bild-Rundgang: gleichmäßig über die ganze Dauer (≤ 240 Bilder, Gruppen zu 6 mit Frame-IDs) | `visualIndex.ts` | Qwen3-VL-4B + Projektor |
| Ereignisse: Rohvorschläge aller Quellen clustern, Detailauswahl (Zeitfächer + Reserve je Quelle, ≤ 50) | `shared/engineV2.ts` | – |
| Bildprüfung je Ereignis (≤ 5 Frames um den Höhepunkt) | `observe.ts` | Qwen3-VL-4B |
| Tonprüfung je Ereignis (Fenster ≤ 30 s, 4 s Überlappung, Zeiten auf Quelle zurückgerechnet) | `observe.ts` | Voxtral-Mini-3B + Projektor |
| Fusion + Bewertung je Inhaltstyp (Aussage, Unterhaltung, Performance, Gaming) | `judge.ts` | Text-LLM |
| Schnittplanung: Grundvariante + ≤ 2 gekürzte Varianten, ≤ 3 Stücke | `plan.ts` | Text-LLM |
| Nahtprüfung am zusammengesetzten Ton | `observe.ts` (`checkSeam`) | Voxtral |
| Prüfung am erhaltenen Material, Paarvergleich (Ring + Sehnen, beide Reihenfolgen, Bradley–Terry, Unsicherheit an der Grenze priorisiert) | `plan.ts`, `compare.ts` | Text-LLM |
| Titel, Hook, Schlüsselwörter, Untertitel-Korrektur (nur für die endgültigen Clips) | `index.ts` | Text-LLM |

GPU-Phasen laufen nacheinander über den vorhandenen `VramSequencer` (Residents `llm`, `v2-vision`, `v2-audio`, `asr`); keine verschachtelten `use()`-Aufrufe. `LlamaServer.start()` vergleicht Modell, Projektor, Kontext, KV-Quantisierung und GPU-Schichten (`serverSignature`) und startet bei Abweichung neu.

Prompts: `resources/prompts/v2/*.md` (Revision `prompts-v2.2`, Teil des Fingerabdrucks). Video- und Chattexte sind DATEN; Antworten werden gegen JSON-Schemas geprüft (ein Wiederholungsversuch, dann verständlicher Fehler).

## Regeln, die die Ergebnisse ehrlich halten
- Fehlender Ton-/Bildbeleg = **ungeprüft**, nie Note 0 und nie eine erfundene Pointe. Ein Signal allein (YAMNet, Bildänderung) zählt nicht als geprüft.
- Kein Hook-Cap bei „Und/Also/Ja“, keine Payoff-Anhebung, kein Auffüllen auf eine Mindestzahl; gewünschte Anzahl = Obergrenze, null Clips ist zulässig.
- Qualität wird als Klasse (schwach, solide, stark, außergewöhnlich, ungeprüft) mit Kriterien 0–3 geführt; die angezeigte Zahl (50/65/80/92) ist ein Klassenanker, keine Messgenauigkeit. Keine kalibrierten Wahrscheinlichkeiten.
- Gekürzte Varianten müssen Naht (Ton) und Prüfung am erhaltenen Material bestehen; sonst bleibt die zusammenhängende Variante.
- Ausgabelänge = Summe der erhaltenen Stücke; Spanne ≤ 120 s.

## Editor, Vorschau, Export
`ShortmeClip.autoCuts` (automatisch entfernte Quellintervalle) ist getrennt von manuellen Wortlöschungen. `EditState.autoCuts` + Operation `{ t: 'autoCuts', ranges, cut }` (Wiederherstellen/Erneut anwenden, Undo/Redo). `effectiveClip(...).removed` führt beide zusammen; Vorschau (`previewPlan`) und Export rufen dasselbe `planExport`/`TimeMap` auf. Clips ohne Sprache (`wordless`, `lastWord = firstWord − 1`) erzeugen keine Wörter und keine Untertitel.

## Modelle (nur über den Modell-Manager, nie im Repo oder Installer)
| ID | Datei | Größe | Quelle (Revision gebunden) | Lizenz |
|---|---|---|---|---|
| `qwen3-vl-4b` | `Qwen3VL-4B-Instruct-Q4_K_M.gguf` | 2,50 GB | Qwen/Qwen3-VL-4B-Instruct-GGUF @ 1cd86afb… | Apache-2.0 |
| `qwen3-vl-4b` | `mmproj-Qwen3VL-4B-Instruct-F16.gguf` | 0,84 GB | dito | Apache-2.0 |
| `voxtral-mini-3b` | `Voxtral-Mini-3B-2507-Q4_K_M.gguf` | 2,47 GB | ggml-org/Voxtral-Mini-3B-2507-GGUF @ 20616573… | Original Apache-2.0; die ggml-org-Seite trägt **keine** Lizenzmetadaten, Lizenz laut Originalkarte `mistralai/Voxtral-Mini-3B-2507` |
| `voxtral-mini-3b` | `mmproj-Voxtral-Mini-3B-2507-Q8_0.gguf` | 0,72 GB | dito | dito |
| `yamnet` | bestehend | – | bestehend | Apache-2.0 |
| `llama-server` + Text-LLM | bestehend | – | bestehend | – |

Alle Dateien: SHA-256 im Katalog (`src/main/engines/catalog.ts`), Größen und Hashes per HF-API geprüft. Das ggml-org-Qwen2.5-Omni-7B-GGUF wird bewusst **nicht** verwendet (Lizenzmetadaten widersprechen der Originalkarte).

## Einrichtung / erster Klick
1. Modell-Manager → „Qwen3-VL 4B Instruct“ (Bild) und „Voxtral Mini 3B“ (Ton) installieren (zusammen ≈ 6,5 GB; YAMNet und llama-server meist schon vorhanden).
2. Erstellen-Dialog oder Clip-Liste → „Neue Engine (Beta)“. Fehlen Modelle, steht die Liste samt Knopf zum Modell-Manager da, und „Clips finden“/„Neu berechnen“ bleiben gesperrt.
3. Sind die Modelle da und es gibt noch kein V2-Ergebnis, startet ein Lauf (ASR/Signale/Kamerawechsel werden wiederverwendet).

## Quellen, übernommene Ideen, Lizenzen
Kein Code aus HotClip oder Reelsaw (beide AGPL) wurde kopiert; übernommen sind nur Ideen (Bild-Kontaktabschnitte mit Frame-IDs, geprüfte Audio-Nähte als Konzept). Frame-IDs nach NumPro/MM-VID (MIT) als Muster, getrennte Aufgaben (Highlight, Anfang/Ende, Kürzung) nach HIVE. YAMNet-Klassenliste: `resources/yamnet/yamnet_class_map.csv` (tensorflow/models, Apache-2.0).
