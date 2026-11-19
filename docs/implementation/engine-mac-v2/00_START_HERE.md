# Shortme Engine Mac – vollständiges Claude-Code-Gesamtpaket
Stand: 18.11.2026 · M1 Pro · 16 GB · Deutsch/Englisch · lokal

## Auftrag

Claude soll die neue Mac-Engine vollständig programmieren, integrieren und als Standard aktivieren. Die bisherige aktive Mac-Engine wird damit ersetzt. Editor, vorhandene Projekte und Windows-Unterstützung bleiben funktionsfähig.

Dieses Archiv enthält den Implementierungsauftrag, Architektur und Hilfsbausteine. Die fertige Engine entsteht durch die Umsetzung im tatsächlichen Shortme-Repository.

## So startest du

ZIP vollständig in Claude Code beziehungsweise dessen Projektkontext geben. Den Text aus **START_IN_CLAUDE.txt** übergeben. Claude muss **01_CLAUDE_CODE_AUFTRAG.md**, **05_LAUFZEITREGELN.md** und **08_IMPLEMENTIERUNG_UND_ABNAHME.md** gemeinsam ausführen.

## Die acht Schritte der neuen Engine

1. Video prüfen; Ton, Analysebilder und Parakeet-Transkript mit Wortzeiten vorbereiten.
2. Mit Sprache, Tonereignissen, Bildwechseln und Bildsuche alle Quellabschnitte durchsuchen.
3. LFM3-Omni-2B untersucht echte Bilder und echten Ton der Kandidaten.
4. Qwen3.5-9B wählt Geschichten, gemessene Schnittkanten, Reihenfolge und Titel.
5. Optionalen Cold Opener nur bei eingeschaltetem Regler voranstellen; Standard 0 = aus.
6. Echte Hochformat-Clips mit passenden Untertiteln und Bildausschnitten rendern.
7. Tatsächliche Renderdateien mit LFM, Qwen und technischen Messungen prüfen.
8. Konkrete Fehler gezielt reparieren und geprüfte Ergebnisse im bestehenden Editor bereitstellen. Gemma nur bei konkreten ungelösten Fragen.

## Vollständiger Inhalt

- **START_IN_CLAUDE.txt:** kurzer Startauftrag zum Kopieren.
- **01_CLAUDE_CODE_AUFTRAG.md:** vollständiger Ablauf und Integrationsauftrag.
- **02_ENGINE_PLAN.json:** Modellrollen und gewünschte Einstellungen.
- **03_ENGINE_CONTRACTS.ts:** Hilfsbausteine für Schnitt- und Freigaberegeln.
- **04_VERIFY_POLICY.mjs:** 19 Prüfungen dieser Hilfsbausteine.
- **05_LAUFZEITREGELN.md:** begrenzte Arbeit, Wiederholungen, Zeitlimits und ehrlicher Fortschritt.
- **06_RUNTIME_POLICY.ts:** Hilfsfunktionen für Arbeitsgrenzen und Restzeit.
- **07_VERIFY_RUNTIME.mjs:** 11 Prüfungen der Laufzeit-Hilfsfunktionen.
- **08_IMPLEMENTIERUNG_UND_ABNAHME.md:** verbindliche vollständige Umsetzung, Ablösung der bisherigen Mac-Engine und echte End-to-End-Abnahme.
- **reference/INTEGRATIONSPLAN.md:** Architektur, Projektvergleich und Quellen.

## Fertig bedeutet

Ein normaler Mac-Run aus der App läuft durch die neue Pipeline und erzeugt tatsächlich geprüfte MP4-Dateien. Dazu müssen Modelladapter, Scheduler, Renderer, IPC, Persistenz und neue Standardroute implementiert sein. Die Laufzeit-Hilfen müssen im echten Ablauf wirken.

Die 30 Hilfsprüfungen sind Teil der Unterstützung, kein Ersatz für einen vollständigen Mac-Lauf. Mit Node.js 24 oder neuer:
```sh
node 04_VERIFY_POLICY.mjs
node 07_VERIFY_RUNTIME.mjs
```

Die vorhandenen App-Buildwerkzeuge bleiben maßgeblich; dadurch entsteht keine neue vorgeschriebene Node-Version für die App.

## Reihenfolge bei unterschiedlichen Detailformulierungen

08 konkretisiert die vollständige Lieferung und Standardaktivierung. 05 konkretisiert die Laufzeitgrenzen. 01 legt die produktive Pipeline fest. Alle drei Dokumente sind zusammen umzusetzen; die Architekturreferenz wird entsprechend angewandt.
