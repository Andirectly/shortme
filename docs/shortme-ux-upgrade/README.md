# Shortme 0.45 – UX-Upgrade / Claude-Code-Implementierungspaket

**Erstellt:** 20.11.2026 · **Ziel:** bestehende Electron-/React-App Shortme, kein Neubau

Dieses ZIP ist ein **Umsetzungsauftrag samt Spezifikation, Referenzen, Datenverträgen und Offline-UI-Demonstrator**. Es enthält **nicht den Shortme-Quellcode** und ist daher **kein fertiges App-Update**. Erst Claude Code oder ein Entwickler kann es anhand des echten Repositorys implementieren.

## Schnellstart

1. ZIP entpacken.
2. Den Ordner (oder den Inhalt) in das **bestehende** Shortme-Repository legen, z. B. `docs/shortme-ux-upgrade/` (nicht den bestehenden `src/`-Ordner überschreiben).
3. Repository in Claude Code öffnen.
4. In Claude Code senden: **„Lies `docs/shortme-ux-upgrade/CLAUDE_CODE_START_HERE.md` vollständig und setze den dortigen Auftrag im bestehenden Shortme-Repository um. Arbeite die Phasen durch und führe Tests aus.“** Pfad anpassen, wenn der Ordner anders heißt.
5. Optional die lokale HTML-Konzeptansicht `mockup/review-demo.html` im Browser öffnen. Sie zeigt nur Demo-Daten; keine Verbindung zu Shortme.

## Was implementiert werden soll

- **A – Review first:** Review-Screen, Tastaturaktionen, zwei getrennte Zustände (KI-Check vs. Freigabe), Filter, Quelle/Zeit/Score/Prüfgründe, direkte Korrekturen, bessere Sidebar.
- **B – Progress first:** nachvollziehbare ETA, Phasen, persistente Zwischenstände, progressive Kandidaten **nur wenn die echte Engine sie liefern kann**, keine Fake-Clips.
- **C – Editor polish:** vereinfachte Untertitel-Controls, größere 9:16-Vorschau, nächster Clip, Export-Preflight, design-konsistente Glasebenen.

## Inhalte

| Datei | Zweck |
|---|---|
| `CLAUDE_CODE_START_HERE.md` | Verbindlicher Auftrag für Claude Code |
| `docs/01_BESTAND_UND_GRENZEN.md` | Aktueller Ablauf, wichtige Produktannahmen und Schutzvorgaben |
| `docs/02_FUNKTIONEN_PRIORISIERT.md` | Priorisierte Features, Abhängigkeiten und Aufwand |
| `docs/03_SCREEN_SPECS.md` | UI- und Interaktionsverhalten pro Screen |
| `docs/04_ENGINE_PROGRESSIVE_EVENTS.md` | Event-Verträge, ETA und Engine-Grenzen |
| `docs/05_DESIGN_SYSTEM.md` | Gestaltungsregeln und Accessibility |
| `docs/06_GITHUB_REFERENZEN.md` | Geprüfte Referenz-Repos, Lizenzrisiken und Einsatzbereiche |
| `docs/07_ABNAHME_TESTS.md` | Konkrete Akzeptanzkriterien und Testmatrix |
| `contracts/shortme-review-progress.reference.ts` | Nicht-invasives TypeScript-Datenmodell als Referenz |
| `mockup/review-demo.html` | Lokaler, interaktiver Review-Prototyp mit Beispieldaten |
| `checklists/UMSETZUNG.md` | Fertigstellungsliste für den Entwickler |

## Nicht enthalten

- Kein importierbarer Shortme-Patch, kein Klon der genannten Open-Source-Projekte, keine Modellgewichte.
- Die Screenshots aus `shots/` wurden hier nicht geliefert. Claude Code soll sie im echten Repo prüfen, falls vorhanden.
- Lizenzangaben sind Recherchestand 20.11.2026 und müssen vor Übernahme fremden Codes erneut im konkret verwendeten Commit geprüft werden.
