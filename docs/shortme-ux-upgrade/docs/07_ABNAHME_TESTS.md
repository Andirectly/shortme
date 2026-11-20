# 07 – Testplan & Akzeptanz

## Automatisierte Prüfungen (abhängig vom Repo)
- Vorhandenes `typecheck`, `lint`, Unit-/Integrationstest-Set und `build` mindestens einmal nach jedem abgeschlossenen Abschnitt.
- Persistenz-Migration alter Projekte mit fehlendem Review-/KI-Status.
- Review-State-Reducer: gültige Transitionen, idempotente Saves, `verworfen` != gelöscht.
- Fortschritt: `total=0` oder unbekannt -> kein Prozent; clamping bei ungültigen Werten; ETA nur als Daten-basierte Bandbreite.
- Event-Replay mit Duplicate/Out-of-order, Job-Abbruch/Resume, erneuter Analyse und revidierter Clipversion.

## Manuelle Smoke Checks

1. **Bestehende Projektdatei** laden; Clips, Untertitel, Layouts, Lernwertungen und Exporte unverändert.
2. **Review**: 10 Clips, Tab/Shift+Tab sowie Space, N/P, 1/2/3/E, Änderung sichtbar und nach Restart persistiert.
3. **Status**: AI „Bitte prüfen“ und User „Freigegeben“ können gleichzeitig existieren, UI erklärt beide.
4. **Edit**: Clip öffnen, nur Untertitel ändern, Undo/Redo, Save, Review-Zurück, kein Verlust.
5. **Cold Opener**: Vorschau und Render stimmen, Länge korrekt nach Kürzung.
6. **Mac**: kein Engine-Umschalter; **Windows**: alte Umschalterlogik unverändert.
7. **Progress**: 26-Minuten-Lauf (oder Replay echter Jobevents) zeigt reale Phasen; keine Fake-Clips; bei unbekannter ETA keine Scheinpräzision.
8. **Progressive**: sofern Engine Events ausgibt, Vorschau erst ab realem `preview.ready`, Qualitätsbadge erst ab echtem `quality.updated`.
9. **Stop & keep**: bereits echte Zwischenstände bleiben nach App-Restart; „Verwerfen“ funktioniert separat.
10. **Export**: Vorläufige Clips nicht stillschweigend als geprüft; freigegebene Auswahl funktioniert, unveränderte Outputqualität.
11. **Navigation**: Live, Werkbank, Lernen, Modelle, Upload, Updates auffindbar, keine toten Routen.
12. **Offline**: lokales Video lässt sich ohne Netz bearbeiten/exportieren, opt-in Online-Funktionen separat.
13. **A11y/Performance**: Keyboard Focus, Reduced Motion, Desktop-Fenster kleiner, gleichzeitiger Enginejob + UI-Navigation ohne Freeze.

## Vergleichstest UX (vorher/nachher)
- Gleiche 10 Vorschläge aus gleicher Quelle: Zeit vom Öffnen bis 3 Freigaben, Zahl der Editorwechsel, Zahl der Klicks, Fehler bei Entscheidungen protokollieren.
- Gleiche 26-Minuten-Quelle: Zeit bis erstes **echtes** Transkript, erster **echter** Kandidat und erstes fertiges Video, Gesamtlaufzeit und Speicherlast.
- Auf M1 Pro die absolute Engine-Laufzeit nicht schönrechnen. Ziel: produktivere Wartezeit bei gleicher oder besserer Engine-Stabilität.

## Definition of Done
Eine Phase ist nur abgeschlossen, wenn UI **mit echten Projektdaten** funktioniert, persistiert, vorhandene Funktionen intakt bleiben, durch Tests geprüft ist und eventuelle Einschränkungen dokumentiert sind. Ein HTML-Prototyp oder ein neuer Schalter alleine reicht nicht.
