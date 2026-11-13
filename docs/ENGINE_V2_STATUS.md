# Neue Engine (Beta): tatsächlicher Stand

Stand: Entwicklungsrechner mit NVIDIA GeForce RTX 5090 (32 GB). Architektur und Dateiformate: `docs/ENGINE_V2.md`. Es gibt **keine Veröffentlichung** für diesen Auftrag (kein Versions-/Changelog-Eintrag, kein Release, keine Installer-Aktualisierung).

## Was implementiert ist
- Dispatcher mit zwei gegenseitig ausschließenden Engines (`legacy`, `multimodal-v2`), Engine beim Jobstart eingefroren; bisherige Engine ruft den unveränderten Algorithmus.
- Getrennte Läufe (`analysis/state.json`, `analysis/runs/<runId>/`), Fingerabdruck, Wiederverwendung, Ein-Job-pro-Projekt, Stop-Markierung unterbrochener Läufe. Alle Schreibstellen für Clips (Publizieren, Löschen, Personen-Nachplanung) schreiben in den Lauf, aus dem die Clips stammen; Editor/Export/Vorschau/Lernen/Upload/Blindvergleich finden Clips über `findClip` laufübergreifend.
- Umschalter im Erstellen-Dialog und in der Clip-Liste; Modellprüfung mit Hinweis und Sprung zum Modell-Manager.
- Modelle über den bestehenden `AssetManager` (Resume, SHA-256): Qwen3-VL-4B + Projektor, Voxtral-Mini-3B + Projektor (Revision gebunden, Größe und Hash per HF-API geprüft). `LlamaServer` startet bei anderem Modell/Projektor/Kontext neu; Residents `v2-vision`/`v2-audio` im bestehenden `VramSequencer`.
- Pipeline: YAMNet-Gruppen-Index (eigener Cache), Keyframe-Bildänderungen, Textsuche (180-s-Fenster), Bild-Rundgang über die ganze Dauer, Ereignis-Clustering, Detailauswahl, echte Bild- und Tonprüfung, Fusion, Bewertung je Inhaltstyp, Schnittplanung (Grundvariante + gekürzte Varianten, ≤ 3 Stücke), Nahtprüfung, Prüfung am erhaltenen Material, Paarvergleich (Bradley–Terry), Titel/Hook/Schlüsselwörter, Untertitel-Korrektur.
- Editor/Export: `autoCuts` (getrennt von Wortlöschungen) mit Operation `autoCuts` (Wiederherstellen/Erneut anwenden, Undo/Redo), Knopf im Editor; Clips ohne Sprache (`wordless`); Clip-Karten zeigen für V2 Klartext statt Kriterienbalken.
- Lernen: `CandRecord` bekommt `engine`, `runId`, `eventId`, `variantId`; Datensatz wird über alle Läufe gebaut; Split bleibt pro Video (Hash), V2-Clips haben keine Legacy-Rubrik (`rubric: null`) und erscheinen nicht in der Legacy-Kandidatenspur; zurückgenommene automatische Kürzungen werden als `autoCutsRestored` erfasst.
- Prompts versioniert unter `resources/prompts/v2/` (Revision `prompts-v2.2`).

## Was real getestet wurde (exakte Befehle)
| Test | Befehl | Ergebnis |
|---|---|---|
| Echte Inferenz Bild + Ton | `SHORTME_DATA=<Daten> npx tsx --tsconfig tsconfig.node.json scripts/v2-smoke.ts test-videos/podcast-2p.mp4 90 60 90` | Qwen3-VL-4B: 3 Frames in 4,9 s, gültiges Schema-JSON. Voxtral-Mini-3B: 30 s Ton in 3,5 s, gültiges JSON (`gesprochen`). Ob die Bildbeschreibung inhaltlich stimmt, wurde nicht unabhängig geprüft. |
| Kompletter Lauf der neuen Engine | `SHORTME_DATA=<Daten> npx tsx --tsconfig tsconfig.node.json scripts/v2-run.ts bc5147fe stream 5` (Kopie eines vorhandenen Twitch-Stream-Projekts, 293 s, Deutsch/Englisch gemischt) | 4 Läufe: 5, 4, 4, 4 Clips, 254–337 s Gesamtzeit inkl. Layout. Abdeckung Text/Ton/Bild je 100 %, alle Modalitäten `checked`. |
| Nahtprüfung (Ton) | `scripts/v2-seam.ts bc5147fe` | Tonmodell allein: **8/8 Nähte „sauber“, auch 4 absichtlich mitten im Wort gesetzte** → taugt nicht als Prüfer. Pegelmessung am Schnittpunkt: 3/4 saubere Nähte bestätigt, 4/4 Nähte mitten im Wort abgelehnt. Das Tonmodell ist nur noch zusätzliches Veto. |
| Export mit denselben Planungsdaten | `scripts/v2-export.ts bc5147fe c4 122 126` (automatische Kürzung 122–126 s im Speicher eingesetzt) | geplant 11,98 s, Datei 12,00 s (ASS-Untertitel, 2 Stücke, 21 Wörter) |
| Gesamte Testsuite | `npx vitest run` | 136 Dateien / 1058 Tests grün; neue Dateien `engineState` (7), `engineV2` (11), `engineV2Stages` (23), `engineRuns` (7) |
| Typecheck, Build | `npx tsc --noEmit -p tsconfig.node.json` / `-p tsconfig.web.json`, `npm run build` | sauber |
| Lint | `npx eslint <geänderte Bereiche>` | nur vorbestehende Fehler (`sentences.ts`, `snap.ts`, `render/profiles.ts`, `transcription.ts`, `edits.ts` Zeile 77) |

### Gemessene Zeiten (Stream, 293 s, RTX 5090, ein Lauf)
Ton-Index 0,9 s · Keyframes 2,9 s · Textsuche 15,7 s · Bild-Rundgang 4,5 s · Bildprüfung 11 Ereignisse 43 s · Tonprüfung 11 Ereignisse 14 s · Fusion/Bewertung/Planung 69 s · Nahtprüfung 7–32 s · Prüfung + Vergleich 85–132 s · Titel/Untertitel 18 s · Layout 60 s. **Hochrechnung auf 3 h ist nicht gemessen**; die Zeiten wachsen ungefähr mit Ereigniszahl (Detailbudget 50) und Textfenstern. Peak-VRAM: **nicht gemessen**.

### Fehler, die der echte Lauf aufgedeckt hat (behoben)
- Bildantwort wurde bei 500 Tokens abgeschnitten → Fehlerbehandlung erkennt `finish_reason=length`, Rohanfang im Fehler.
- Prompts nannten `start`/`end`, das Schema `first`/`last`: das Modell lieferte Sekunden statt Satznummern, fast alle Schnittvarianten wurden abgelehnt → Wortlaut geändert, Werte außerhalb des Fensters werden verworfen statt geklemmt.
- Nahtprüfung mit Freitextfeld schweifte bis zur Token-Grenze aus → nur Wahrheitswerte.
- Verifikation erfand Nähte bei einstückigen Clips und wertete einen unklaren Einstieg als Mangel → Nähte nur bei gekürzten Varianten, Pflicht sind Setup/Kern/Abschluss.

## Konkrete Restprobleme / unbestätigt
- **Keine gekürzte Variante überlebte in den echten Läufen** (dieser Stream spricht fast pausenlos; Schnittpunkte lagen nicht in Pausen, oder die Prüfung blieb bei „needs-review“). Der Mehrstück-Pfad ist durch Unit-Tests und einen Export mit eingesetzter Kürzung belegt, aber nicht durch einen echten V2-Vorschlag mit Kürzung.
- **Bewertung schwankt zwischen Läufen**: derselbe Moment war einmal „solide“, einmal „außergewöhnlich“ (Verteilung der Klassen je Lauf: 9/0/2, 6/1/3, 10/0/0, 8/0/1 für solide/stark/außergewöhnlich). Keine Mehrfachabtastung eingebaut; Auswahlqualität gegenüber der bisherigen Engine ist **nicht gemessen**. Es gibt keinen Beleg für „besser als V1“ oder „Opus-Niveau“.
- Clips sind kurz (14–21 s): Die Grundvariante folgt dem Ereignisbereich der Textsuche (10–70 s Vorgabe, Modell liefert meist ~15 s).
- Verifikation ist meist „bitte ansehen“, weil das Modell bei Stream-Momenten den Einstieg für unklar hält; ein einzelner unklarer Einstieg zählt inzwischen nur noch als Hinweis.
- Der bekannte verpasste Rap (3-h-VOD) wurde in diesem Auftrag **nicht** erneut getestet: kein Lauf auf der 3-h-VOD, kein Vergleich V1/V2 mit festem K, keine Blindbewertung. Gesang/Rap-Pfad (YAMNet-Gruppe `vocal` → Voxtral → Bewertung „performance“) ist nur durch Unit-Tests der Signal-Logik belegt.
- Voxtral erkennt Imitation/Humor nicht belegt; ob das Modell Rap vom Sprechen unterscheidet, ist ungetestet.
- Keine ASR-Nachprüfung der Naht (Reelsaw-Idee) – bewusst nicht gebaut (separate ASR-Phase; Ersatz: Pegelmessung + Tonmodell-Veto).
- Kein UI-Test im echten Fenster (Umschalter, Klick auf „Neue Engine“) per CDP in diesem Durchgang; Umschaltlogik ist über `engineRuns`-Tests (Hauptprozess) und Typecheck abgesichert, die Darstellung nicht.
- Chat/Heat-Eingang ist verdrahtet, aber nicht mit echten Chat-Daten getestet.
- Mehrere Fenster: Einzelstart wird im Hauptprozess erzwungen (`claimProject`), aber nicht mit zwei echten Fenstern ausprobiert.
- Erstes Laden der V2-Modelle auf einer 12-GB-Karte ungetestet (nur 32-GB-Karte).

## Nicht ausführbare Forschungsadapter (nicht implementiert, nicht angeboten)
- **Marlin-2B über SkyVision.cpp**: nicht eingebaut; das Community-GGUF ist nicht allgemein llama.cpp-kompatibel, eine geprüfte Runtime gegen Referenzausgabe liegt nicht vor.
- **TripleSumm**: nicht eingebaut; passende Merkmalsextraktion und validierter Export fehlen.
Beide tauchen weder in der Modellauswahl noch als Dummy-Adapter auf.

## Lizenzen / Herkunft
Kein Code aus AGPL-Projekten (HotClip, Reelsaw) übernommen. Voxtral-GGUF von ggml-org ohne Lizenzmetadaten auf der Modellseite; Original unter Apache-2.0 (siehe `docs/ENGINE_V2.md`).
