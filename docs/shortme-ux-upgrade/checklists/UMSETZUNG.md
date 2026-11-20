# Implementierungs-Checkliste (Stand 0.47.0, Details: docs/shortme-ux-implementation-audit.md)

## Analyse
- [x] Repo-Sicherheitsanweisungen gelesen (`AGENTS.md`/`CLAUDE.md`)
- [x] Komponenten / Stores / IPC / Persistenz / Export-/Preview-Pipeline verifiziert
- [ ] Screenshot-Vergleich mit `shots/` (Ordner nicht im Repo)
- [x] Audit mit echten Dateipfaden geschrieben

## A Review
- [x] Zwei Status-Achsen und Migration (+ Lernbewertung getrennt)
- [x] Review-Screen und Filter
- [x] Keyboard Shortcuts + Eingabefokus-Schutz
- [x] Clipkarten mit erklärenden KI-Warnungen
- [x] Persistente Auswahl, freigegebener Status nach Reload
- [x] Nächster Clip / Editor-Rücksprung
- [x] Tests / Build erfolgreich

## B Progress
- [x] Echte Phasen / verstrichene Zeit / ETA-Spanne
- [x] Globaler Status ohne UI-Blockade
- [x] Engine-Ereignisstellen ermittelt (siehe Audit, Phase B2)
- [~] Progressive Kandidaten nur bei echten Daten (Transkript bereit, vorläufige Clips ab Bildausschnitt; frühere Kandidaten nicht – begründet)
- [ ] Preview-Ready / Qualitätscheck als versionierte Events
- [x] Stop & Keep / Resume / Fail (bestehende Semantik, klarere Beschriftung)
- [ ] M1 Pro Memory/CPU (kein Testgerät hier)
- [x] Tests / Build erfolgreich

## C Editor + Design
- [x] Standard/Erweitert Untertitel; Vorlagen unverändert vollständig
- [ ] Größere 9:16-Vorschau + optionales Quellbild (bestehendes Layout beibehalten)
- [x] Timeline & Cold Opener unverändert
- [x] Export-Preflight auf messbaren Signalen
- [x] Konsolidierte Sidebar / alle Features erreichbar
- [x] Fokusring, Tooltips/aria-Labels für neue Elemente; Reduced Motion unverändert respektiert
- [x] Tests / Build erfolgreich

## Abschluss
- [x] Kein Cloud-/Account-/Telemetry-Zuwachs
- [x] Keine Lizenzverletzung durch Übernahme (kein fremder Code)
- [x] Änderungen und offene Grenzen dokumentiert
- [x] Realer End-to-End-Workflow getestet (Windows)
