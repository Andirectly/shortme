# Engine 4 – Abnahmebericht

Stand 2026-11-17, Basis-Git `306c0af` (Änderungen in diesem Stand noch uncommittet bis zum Abschluss-Commit). Rechner: RTX 5090 32 GB, Windows 11 Pro 26200.
Zahlen je Anforderung: `docs/ENGINE_V4_STATUS.md` (erzeugt von `scripts/v4-status.mjs` aus Evidence + Gate). Gate: `docs/implementation/shortme-engine-v4/tools/v4_gate.py`.

## Engineering ≠ Quality
- **Engineering:** Core-Gate siehe STATUS. Offen bleiben nur Anforderungen, die externe Hardware brauchen (V4-044: 16/12-GB-GPU; V4-045: frischer Windows-Rechner).
- **Quality:** **nicht belegt.** V4-050–053 brauchen ≥ 20 autorisierte, gelabelte Quellen und 2 unabhängige Blind-Reviewer. Es gibt **keine** Aussage „Engine 4 ist besser als 1–3“.

## Echte Läufe (Engine 4, Profil Ausgewogen, sofern nicht anders genannt)
| Quelle | Lauf | Dauer | Ergebnis | Belege |
|---|---|---|---|---|
| Dinner Song, 60 s, Bild+Ton (Gesang/Rede) | `v4-mwjv82xk-2z62m` (**Run-Proof**) | 1343 s | 3 Clips | `docs/ENGINE_V4_RUN_PROOF.json`; Ausgabe 16,6 s Bild+Ton; 35+ Modellaufrufe mit Spuren; Folgefenster in 2 Gruppen |
| Tech-Podcast, 1,8 h (6448 s) | `v4-mwjw7lxw-ialtf` | 2684 s (44,7 min) | 6 Clips von 140 s bis 5205 s | `docs/ENGINE_V4_LONG_RUN.json`; jedes Zehntel in allen Lanes geprüft; echte Reparaturen (payoff → spätere Kante, dead-air → Stille entfernt); 2 Clips verworfen (`reject`) |
| Minecraft-Stream, 293 s | `v4-mwjxy2b8-bk8u0` | 1440 s | 5 Clips | `docs/ENGINE_V4_GAMING_RUN.json`; wortloses Spielereignis mit beobachteter Handlung/Reaktion |
| Dinner Song ohne Tonspur (abgeleitet, `-an`), Profil Schnell | siehe `docs/ENGINE_V4_SILENT_RUN.json` | – | – | Ton-Lane übersprungen, keine Sprach-Seeds, Bildanalyse ohne Ton, `audio-seam: not-applicable` |

## Proben (Skripte, echte Medien, Exit-Codes in docs/v4-logs/)
- `scripts/v4-repair-check.ts`: Pointe absichtlich abgeschnitten → `payoff: fail` erkannt → Ende auf spätere Kante → neu gerendert (neue SHA) → `acceptable`. **PASS**
- `scripts/v4-compare-proof.ts`: Engine 1/2/3/4 auf derselben Datei, Vergleich mit 4 Läufen; Engine-4-Clip-Recheck eines Engine-2-Clips, Zuordnung unverändert. **PASS** (`docs/ENGINE_V4_COMPARE_PROOF.json`)
- `scripts/v4-cancel-check.ts`: Abbruch nach 45 s → Manifest `cancelled`, Zustand `stopped`, keine Restprozesse. **PASS**
- `scripts/v4-asr-check.ts`: Parakeet-Wortzeiten gültig; Gegenprobe Qwen3-ASR: deutsch 0,962, englisch 0,887 Wortfolgen-Übereinstimmung (LCS). **PASS** (keine WER gegen Referenztext)
- `scripts/v4-e2e-verify.ts`: harte Prüfungen der Real-Media-IDs gegen die Lauf-Dateien.
- Oberfläche im echten Fenster (CDP): Schalter mit 4 Engines, Herkunftsansicht, Editor mit V4-Clip, Export 1080×1920 Bild+Ton (15,4 s).

## Während der Umsetzung gefundene und behobene Fehler (auch für Engines 1–3 relevant)
- Exporter: Titel mit `'`/`,` brachen den FFmpeg-Filtergraphen; Arbeitsordner mit Titel überschritt die Windows-Pfadgrenze; Quellen ohne Tonspur ließen sich gar nicht exportieren.
- Python-Worker: VRAM wuchs je MiniCPM-o-Aufruf (fehlendes `inference_mode`); ffmpeg der Hilfsbibliotheken nicht im PATH des installierten Programms; Clips ohne Ton scheiterten am Tonauszug; abgeschnittene JSON-Antworten an der Token-Grenze; zweiter Versuch lieferte identische Antwort.
- Engine 4: Checkpoints speicherten Fehlschläge (beim Fortsetzen wiederholt); Investigator stoppte ohne Kontextprüfung.

## Laufzeit / Ressourcen (gemessen)
Siehe `docs/ENGINE_V4_BENCHMARKS.md`. 1,8 h Material: 44,7 min gesamt (Keyframes 529 s, Sprach-Lane 169 s, Embedding 341 s, AV-Phase 1249 s). MiniCPM-o: 18,1 GB geladen, Spitzen 21–29 GB (Eingaben ≤ 40 s).

## Bekannte Grenzen / offene Punkte
- 16/12-GB-Profile nicht gemessen (nur 5090); sauberer Windows-Erststart nicht geprüft.
- Kein Qualitätsnachweis (siehe oben); Prompts/Budgets sind Startwerte.
- Zielzeit „3 h in 30–45 min“: 1,8 h brauchten 44,7 min → 3 h liegen voraussichtlich darüber (nicht gemessen); größter Posten AV-Phase und Keyframe-Scan.
- Die Engine-4-Läufe liegen in einem Test-Datenordner (Kopie echter Projekte); in der installierten App wurde Engine 4 noch nicht als Endnutzer-Lauf gestartet.
