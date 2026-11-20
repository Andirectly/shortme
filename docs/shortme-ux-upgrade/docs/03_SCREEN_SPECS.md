# 03 – Screen-/Interaktionsspezifikation

## A. Start
- Importbereich bleibt prominent: URL-/Datei-Dropzone.
- Nach Import: klare Default-Voreinstellungen, erweiterte Optionen eingeklappt.
- Optionenzusammenfassung rechts/unten: Videotyp, gewünschte Anzahl, Cliplänge, Layout, Untertitelvorlage, Cold Opener, erwartete Dauer **als Spanne**, keine exakte Garantie.
- Nur auf Windows Engine-Switch anzeigen, auf Mac nicht.
- Bestehende Optionen nicht entfernen.

## B. Verarbeitung
- Überschrift, Videotitel + Dauer; aktuelle Phase; globaler dezent sichtbarer Mini-Status.
- Phasen `Transkribieren`, `Analysieren`, `Clips finden & prüfen` mit abgeschlossen/laufend/ausstehend; **keine drei fiktiven gleich langen Balken**.
- Gesamt-ETA als Spanne (`ca. 18–24 Min.`), bei Unklarheit `Wird ermittelt`.
- Verstrichene Zeit plus letzter echte Engine-Schritt (falls vorhanden).
- Unterhalb: verfügbare Zwischenstände (`Transkript bereit`, `2 vorläufige Kandidaten`) nur durch echte Events.
- Aktionen: Pausieren/Fortsetzen, Beenden und Ergebnisse behalten, Verwerfen; vorhandene Semantik bewahren.
- App weiter verwendbar, soweit Jobmanager es erlaubt.

## C. Projektkarten
- Vorschaubild, Titel, Originaldauer, Clip-Anzahl, letzter Status (z. B. `6 Vorschläge · 3 freigegeben`), Datum.
- Beim laufenden Job Hinweis, dass Ergebnisse noch entstehen.
- Kontextmenü/Mehrfachaktion ohne destruktive Regression.

## D. Clip-Liste und Review
- Grid/List-Switch bleibt; `Review starten` als primäre Aktion.
- Filter: Alle / Offen / Bitte prüfen / Freigegeben / Verworfen. `Bitte prüfen` als KI-Statusfilter deutlich beschriften (optional getrennte Filterzeilen).
- Karten zeigen: Thumbnail/Video, Länge, Quellposition, Titel, Score, 1-2 Qualitätsgründe; KI-Badge + Nutzerfreigabe getrennt.
- Ein Review-Screen: großer 9:16-Player links; rechts aktiver Clip, Qualitätshinweise, Auswahl und Wechsel. Unterhalb optional Filmliste.
- 1/2/3 für Freigabe/Zur Prüfung/Verwerfen, Space, N/P, E. Keine Aktionen, wenn Eingabefeld aktiv. Fokusrahmen sichtbar.
- `geprüft` gilt nur, wenn KI-Check für die relevante **Clipversion** erfolgreich lief. Bei Edits neue Check-Bewertung erforderlich oder Status veraltet markieren.
- Nach Freigabe nächsten offenen Kandidaten anwählen. Bei Filter „Freigegeben“ nicht automatisch verschwinden lassen, solange Änderung noch aktiv ist; definierte Navigation.
- Nicht mehrere überlappende Clip-Vorschauen parallel automatisch abspielen.

## E. Editor
- Kopfzeile: Zurück zum Review, Clip, Speichern-Status, Undo/Redo, Export.
- Linkes Transkript mit Wort-Highlight bleibt; Textkorrigieren ≠ Schneiden müssen als getrennte Aktionen klar sein.
- Standard: 9:16-Preview dominant; Quelle mit Tracking-Rahmen per `Quelle/Bildausschnitt` sichtbar.
- Werkzeuggruppen: Schneiden / Bildausschnitt / Untertitel & Titel / Export.
- Untertitel-Standard: Vorlage, Größe, Position, Akzentfarbe, Animation. Rest unter `Erweitert`.
- Timeline: echtes Quellmaterial, Clipgrenzen, Cold Opener, Wellenform; Start/Ende mit Vorschau und Undo.
- Preflight: messbare Prüfungen, Warnungen zum Zeitpunkt anklickbar; falsch-positive Hinweise dürfen Export nicht unklar blockieren.
- Nächster/vorheriger Clip mit Reviewkontext. Nicht-destruktive Änderungen persistieren.

## F. Vorlagen
- Stil-Studio als `Vorlagen` in Nav; volle bestehende Funktionspalette inkl. Auf alle Clips anwenden, Import/Export, Als Standard.

## G. Sidebar
Hauptpunkte: Start / Projekte / Exporte / Vorlagen / Weitere Werkzeuge / Einstellungen.
- Weitere Werkzeuge: Live, Werkbank, evtl. andere seltene Punkte.
- Exporte: exportierte Dateien + optional Upload/Veröffentlichen.
- Einstellungen: Modelle, Lernen, Allgemein, System, Updates/Konten optional.
- Vorhandene Routen/Deep Links/Menübefehle weiter erreichbar. Bei unklarer Migration doppelte Einträge lieber zeitweise behalten.
- Icon-only als Collapse-Variante mit Tooltip/Aria-Label.

## Responsive
Zielgröße Mac 2540×1504 Screenshot, aber kleine Electron-Fenster ab ~1180px Breite berücksichtigen: Panel faltbar, Review-Player priorisiert, kein horizontales Gesamtscrollen. Tastatursteuerung und Focus sichtbar.
