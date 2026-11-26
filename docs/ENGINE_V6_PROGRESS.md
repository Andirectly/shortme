# Engine 6 – Fortschritt (kompakt, zum Fortsetzen nach Kontextkürzung)

Branch `feat/engine6` (Basis main 655ad21). Auftrag: PDF Rev. 4 (nicht erneut komplett lesen; Kapitel bei Bedarf in `docs/ENGINE_V6_DECISIONS.md` nachsehen). Kein Merge/Release vor bestandenen echten Läufen + Baseline-Vergleich gegen Engine 4.

## Erledigt (committet auf feat/engine6)
Registry (`shared/engine.ts`, Run-Präfix v6, nicht v4), Dispatcher, `v6/` (index, adapters, editorial, plan, audit, recheck, profiler, visualIndex, frames, roi, revisions), `clips/clipLayout.ts`, `render/exportOne.ts` (Export übernimmt geprüfte Datei bei gleichem Fingerabdruck+SHA), UI-Rang statt Score, Recheck, Remote-Ablehnung, Index-Benchmark (`docs/bench-v6/`), Tests `tests/engineV6.test.ts` (18).
Auf main: Remote-Abnahme Windows, Einzelinstanz-Fix, Lock-Prüfsumme CRLF.

## Echter Lauf 1 (solo, 10 min, Wunsch 10, 495 s)
Fehler gefunden: `worker.py` `analyze_av` nutzte `len(frames)` nach `del frames` → ALLE AV-Aufrufe schlugen fehl → 9 Kandidaten „Kernereignis nicht beobachtet“, alle Prüfpakete ungültig (korrekt nie `verified`). Fix: `n_frames` (nicht committet, siehe unten).

## Stand 26.11.
Läufe solo + Podcast (kalt) gegen Engine 4 gemessen, UI/Export/Recheck/Neustart im echten Fenster geprüft, volle Suite grün (1233), Mac ausgeblendet. Offen: menschliche Blindbewertung, Mac-Test, Release-Entscheidung, gepackte App testen.

## Nächste Schritte (alt)
1. Skip-Gründe mit `inv.stopReason` loggen; AV-Ausfälle als Fehler melden (statt still).
2. Lauf 2 solo mit Engine 6; Baseline Engine 4 (gleiche Quelle/Optionen) – Zeit, Clips, geprüft.
3. crop-safety „Einstellung ohne Person“ prüfen (Solo-Video).
4. AV-Dedupe (`SHORTME_V6_AVDEDUPE=on`) messen; Mehrere Quellen (podcast-2p, Vlog 27 min).
5. UI-Test im echten Fenster, Neustart, alter Run, Recheck, Export Wiederverwendung.
6. Docs: `ENGINE_V6_STATUS.md`, Benchmarkbericht `ENGINE_V6_BENCHMARK.md`; Gelerntes in CLAUDE.md; Mac = UNTESTED markieren.
7. Merge/Release nur bei bestandenen Nachweisen.

## Blocker
MacBook nicht erreichbar → Mac-Teil UNTESTED.
