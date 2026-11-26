# Engine 6 – Benchmarkbericht (Pilot, 26.11.2026)

**Richtung, kein Beweis.** 2 Quellen, je 1 Lauf pro Konfiguration, keine Wiederholungen (keine Streuung), keine menschliche Bewertung. Rohdaten: `docs/bench-v6/`, Läufe in den Projekten (`analysis/runs/<runId>/manifest.json`, `audits.json`, `selection.json`).

## Aufbau
- Commit `b33c633` + Korrekturen (siehe STATUS), Windows 11, RTX 5090 (32 GB), 7-Modell-Stand wie Engine 4: Parakeet v3, Qwen3-14B Q4_K_M (llama-server), MiniCPM-o 4.5 bf16, Qwen3-VL-Embedding-2B, YAMNet.
- Quellen: `solo.mp4` (10:19 min, 1 Sprecher, Vlog-artig), `podcast-2p.mp4` (12:09 min, mehrere Personen/Orte, Interview). Wunsch: 10 Clips (Standard), Inhaltstyp Standard bzw. Podcast, Profil Ausgewogen.
- Baseline = Engine 4 mit identischen Optionen und derselben Quelle. **Kalt**: Engine-Caches (Sprachsuche, Bildindex, Checkpoints) vor dem Lauf gelöscht; ASR, YAMNet und Kamerawechsel lagen für beide vor. Reihenfolge nicht gemischt (Engine 4 zuerst).
- „geprüft" heißt hier: Modellurteil der jeweiligen Engine über die gerenderte Datei (Engine 4: `acceptable`; Engine 6: `verified`). Das ist **kein** menschliches Qualitätsurteil.

## Ergebnisse
| Quelle | Engine | Gesamtzeit | Clips geliefert | geprüft | Zeit bis 1. geprüfter Clip | Teilfehler |
|---|---|---|---|---|---|---|
| solo 10 min | Engine 4 | 1340 s | 10 | 3 | nicht gemessen | 0 |
| solo 10 min | Engine 6 (Lauf 2: Render nacheinander) | 706 s | 9 | 4 | 587 s | 0 |
| solo 10 min | **Engine 6 (Lauf 3)** | **609 s (−55 %)** | 9 (1 fehlt) | 4 | 406 s | 0 |
| Podcast 12 min | Engine 4 | 1156 s | 10 | 1 | nicht gemessen | – |
| Podcast 12 min | **Engine 6** | **775 s (−33 %)** | 7 (3 fehlen) | 4 | 476 s | 3 (Untersuchungsantworten ungültig) |

**Gepackte App (Release 0.53.0, Installer-Build, Commit 0e23bb7)**: Twitch-Mitschnitt „trymacs“ 5:54 min (Stream-Ausschnitt, überwiegend Gameplay), Wunsch 6, Engine 6: 591 s, 2 Clips geliefert, 1 `verified`, 4 Plätze unbesetzt (6 von 8 geprüften Kandidaten `rejected`: hook/standalone/payoff), 1 Teilfehler, 14 Renderversuche, 6 Reparaturen. Kein Engine-4-Vergleich auf dieser Quelle. Das zeigt: Der Lauf ist im gepackten Programm vollständig lauffähig, aber auf Gameplay-/Stream-Material ist die Ausbeute gering und der Zeitaufwand im Verhältnis zur Länge hoch – dort ist Engine 6 nicht belegt besser.

Weitere Messwerte Engine 6 (solo Lauf 3 / Podcast): Peak-VRAM laut nvidia-smi 28,9 / 29,4 GB (Gesamtbelegung der GPU inkl. Desktop; auf 12/16-GB-Karten nicht getestet), Peak-RSS Hauptprozess 373 / 390 MB (Python-Worker nicht eingerechnet), Swap nicht erfasst (unbekannt). Warm (Caches da) solo: 650 s – der Gewinn liegt also nicht am Cache, sondern an der Pipeline.

Phasen solo Lauf 3 (grob): Index/Suche ~100 s, Ranking ~35 s, AV-Untersuchung + Planung ~270 s (Render überlappt), Ausgabeprüfung (AV + Urteil) ~140 s, Reparatur 3×.

## Einordnung
- **Zeit**: Ziel ≥ 25 % weniger bei gleicher Zahl geprüfter Clips: erreicht in beiden Pilotquellen *nach Modellurteil* (solo −55 %, Podcast −33 %). Stretch 40 %: nur solo.
- **Menge**: Engine 6 liefert weniger Clips (9/10, 7/10), weil Kandidaten, die die redaktionellen Mindestbedingungen verfehlen (`rejected`), nicht veröffentlicht werden. Das ist gewollt (Mindestqualität vor Füllpflicht), aber ein Rückgang der Stückzahl.
- **Qualität**: NICHT belegt. Anonymisiertes Blindpaket für solo (19 Clips, beide Engines gemischt) liegt in `C:\Claude Apps\Shortme-blind\solo`; Bewertung durch einen Menschen steht aus. „Hook“ wird vom Modell häufig als `fail` beurteilt → viele `needs-review`.
- **Zuverlässigkeit**: 0 Abstürze, 0 verspätete Publish; Teilfehler nur durch ungültige Modellantworten der Untersuchung (JSON-Syntax, erfundene Segment-ID) – betroffene Kandidaten wurden übersprungen, nicht still ergänzt. Dieselbe Untersuchungslogik wie Engine 4.
- Gefundene und behobene Fehler während der Messung: (1) AV-Worker `len(frames)` nach `del frames` → alle AV-Aufrufe schlugen fehl (Lauf 1, 5 Clips, 0 geprüft, korrekt nie „verified“); (2) Recheck übernahm die geprüfte Datei ohne Untertitelwörter und stufte den Clip als wortlos ein (`rejected` statt `verified`).

## Mechanismus-Messungen
| Mechanismus | Ergebnis | Entscheidung |
|---|---|---|
| Bildindex ein Decode statt Einzelsprünge | solo 19,6 → 9,3 s, Podcast 22,8 → 13,1 s | an |
| 320 px statt 448 px | gleiche Zeit, schlechtere Treffer | 448 px |
| Redundanzreduktion Bildindex | wenig Einsparung (0–2 von ~90 Fenstern), Treffer sinken | aus |
| Hardware-Decode | 15,8 s statt 10,0 s | aus |
| Render überlappt mit AV-Planung | solo 706 → 609 s, 1. geprüfter 587 → 406 s | an |
| AV-Redundanz in Prüfpaketen | nicht gemessen | aus |
| ROI-Detailzoom | 2 Aufrufe in einem Lauf; Nutzen nicht isoliert gemessen | an (nur bei Detailfrage) |

## Nicht gemessen (UNTESTED)
Mac (alle), Streams/Gameplay/wortlose Pointen/4K/VFR, Link-Import-Läufe (nur lokale Dateien), Wiederholungen (P50/P95), Menschenvergleich, externe Konkurrenz, Ablation A–F einzeln (nur Bildindex-Teile und Render-Überlappung).
