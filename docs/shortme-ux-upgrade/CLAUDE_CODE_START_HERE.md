# MASTER IMPLEMENTIERUNGSAUFTRAG – SHORTME 0.45 UX UPGRADE

Du arbeitest **innerhalb des bestehenden Shortme-Repositories**, nicht in einem neuen App-Projekt. Der Auftrag ist **Implementierung bis zu einem überprüfbar benutzbaren Stand**, keine reine Ideensammlung, kein bloßer visueller Klickdummy. Hierzu gehören UI, echte Statuspersistenz, IPC/State-Integration, Tests und Dokumentation. `mockup/review-demo.html` dient nur als Inspiration; es ist **keine** Zielimplementierung.

## 0. Kontext und verbindliche Schutzregeln

Shortme ist ein privates, deutschsprachiges Electron-/React-Desktop-Tool mit dunklem, Apple-inspiriertem Glasebenen-Design für einen Nutzer. Es verarbeitet lange Videos (Datei oder YouTube-/Twitch-Link, 15 Min. bis 6 Std.) lokal zu vertikalen 9:16-Shorts inklusive Titel, animierter Untertitel, Auto-Crop / Sprecher-Folge, Stream-Split und optionalem Cold Opener. Die Engine auf macOS ist **Engine Mac**; auf Windows können mehrere Engines vorhanden sein. Lokale Transkription mit Parakeet und weitere lokale Bild-/Audiomodelle sind vorhanden. Projekt-Daten und Bearbeitungen sind nicht-destruktiv.

**NIEMALS ohne Grund:**
- bestehende Engine, Modellpfade, KI-Logik, Auswahlalgorithmen, Rendering, Import, Lernen, Live, Werkbank, Upload oder Update-Workflow ersetzen/entfernen;
- Cloud-Abhängigkeiten, Pflichtkonten, Telemetrie, Online-Analytics oder neue Medien-Uploads einführen;
- Mac/Windows-Engine-Umschaltregeln beschädigen; auf macOS keinen neuen Engine-Umschalter anzeigen;
- eine fremde App als Ganzes einkopieren oder ganze UI-/State-Strukturen ohne Prüfung austauschen;
- Fortschritt, Qualitätsscore, geprüfte Clips oder Restzeit vortäuschen;
- Benutzer-Bearbeitungen, Freigaben, Lernbewertungen oder Exporte bei Neubewertung verlieren;
- Änderungen an fremden Projekten bzw. hochgeladenen Medien destruktiv durchführen.

Erhalte das bestehende German-Language-UI, die Offline-Kernfunktionen, Undo/Redo, vorhandene Presets, Cut/Crop/Captions/Title/Cold-Open, Batch und Export. „Upload“ darf als opt-in Online-Funktion separat weiterbestehen. Keine öffentlichen Release- oder Deployment-Aktionen.

## 1. REPO-AUDIT zuerst (nicht überspringen)

Lies `AGENTS.md`, `CLAUDE.md`, README, package.json, Routen, globale Zustände, IPC-Verträge, DB/JSON-Persistenz, vorhandene Tests, Clips-Editor, Render- und Job-Orchestrator, die verfügbaren `shots/*.png`, wenn vorhanden. Dokumentiere kurz:
1. Wo ist die Startseite? Wo sind Projekte, Clipliste, Editor, Sidebar, Styles?
2. Wo liegen Clip-Score, Qualitätsprüfung, Lernwertung, Nutzerstatus, Run-ID und Clip-Version?
3. Wie senden Engine/Worker/IPC Progress, Zwischenstände, Kandidaten, Preview-Ready und Prüfentscheidungen?
4. Wie funktionieren Speichern, Undo/Redo, Export und Stoppen & behalten?
5. Wie sind Mac/Windows sowie Enginelauf und angezeigtes Ergebnis voneinander abgegrenzt?

Lege dein Ergebnis als `docs/shortme-ux-implementation-audit.md` **im Repo** an. Erfinde keine Pfade oder Schnittstellen: nutze die tatsächlich gefundenen. Erst danach Code verändern.

## 2. PHASE A (höchste Priorität): REVIEW-MODUS ECHT EINBAUEN

Baue eine nutzbare Review-Ansicht, erreichbar aus der existierenden Clipliste, keine neue zweite Datenquelle. Sie muss einen Vorschlag schnell abspielen und zwischen 8–10 Clips ohne Sprung durch den vollständigen Editor wechseln können.

Pflichtfunktionen:
- Liste/Filter: Alle, Offen, Bitte prüfen, Freigegeben, Verworfen; geprüfte/fehlgeschlagene KI-Checks getrennt von Nutzerfreigaben.
- Pro Clip: Thumbnail/Preview, Titel, Dauer, Quell-Zeitbereich, Score (wenn vorhanden), Score-Begründung, KI-Status/Gründe, Freigabestatus, Aktionen.
- Review-Freigabezustände **offen / freigegeben / zur_pruefung / verworfen** dauerhaft speichern. KI-Qualitätsprüfung **ausstehend / bestanden / bitte_pruefen / fehlgeschlagen / nicht_durchgefuehrt** separat verwalten. Lernen **Stark / Mittel / Schlecht** niemals als Synonym für Freigabe verwenden.
- Tastaturbedienung: Space Play/Pause; N/P nächster/vorheriger; E Editor; 1 freigeben; 2 zur Prüfung; 3 verwerfen, nur wenn Fokus nicht in Textfeld und nicht im Konflikt mit existierenden Shortcuts. Kürzel sichtbar machen/konfigurierbar, wenn das bestehende System dies erlaubt.
- Zustand beim Zurückkehren in Projekt wiederherstellen (aktueller Clip, Filter, optional Scrolldaten), ohne fremde Navigationslogik zu brechen.
- Kein freigegebener Clip darf durch einen neuen Score automatisch wieder offen werden. Sichtbar kennzeichnen, ob ein Clip seit Freigabe inhaltlich verändert wurde (Review-Version-Fingerprint).
- Export nur tatsächlich freigegebene Clips, wenn Sammel-Export diese Filteroption anbietet; vorhandene Exportfunktionen beibehalten.
- Löschen nur mit der bestehenden Schutz-/Undo-Logik. Verwerfen ist NICHT Löschen.

Bestehendes Grid/List beibehalten. Verbessere Clipkarten: KI-Badge „Geprüft“, „Bitte prüfen“, „Läuft“ oder „Prüfung fehlgeschlagen“ plus konkrete Begründung und separate Freigabeaktion. Nutze einheitliche Styles und vorhandene Components, nicht überladen.

## 3. PHASE B: FORTSCHRITT + ECHTE PROGRESSIVE ERGEBNISSE

### B1 – zuerst sicher umsetzbar
- Aktueller Schritt und abgeschlossene Schritte klar anzeigen, Zeit vergangen, ETA als konservative **Spanne** statt falscher exakter Zeit.
- Fortschrittszahlen ausschließlich bei messbaren Einheiten (z. B. n/N Segmente). Wenn kein verlässlicher Nenner: indeterminierter Zustand und Text wie „Weitere Kandidaten werden geprüft“.
- Beim Phasenwechsel ETA sichtbar aktualisieren; unbekannte Dauer explizit „Wird ermittelt“.
- Job-Fortschritt global dezent sichtbar halten, auch wenn man in Projekte/Review navigiert; bei laufenden Jobs darf der Screen gewechselt werden, soweit bestehende Architektur es erlaubt.
- „Stoppen & behalten“ verständlicher beschriften und weiterhin exakt beibehalten. Stop/Discard klar trennen.

### B2 – echte Zwischenergebnisse, **nicht simulieren**
Prüfe die reale Enginepipeline. Stelle fest, ob Transkript, Kandidat, Rohpreview, Validierung, Render unabhängig / phasenweise verfügbar werden. Wenn ja:
- Emitte **persistente, idempotente** Lifecycle-Ereignisse: Kandidat gefunden, Rohpreview fertig, KI-Check abgeschlossen, exportbereit.
- Kandidaten früh in Projekte/Review sichtbar, mit eindeutiger Kennzeichnung `VORLÄUFIG`. Nicht so tun, als sei ein Kandidat schon qualitätsgeprüft.
- Wiederanlauf, Stoppen & behalten, Neustart, parallele Preview-Abfrage ohne Datenverlust und ohne Blockieren des Engineprozesses.
- Keine schwergewichtigen parallelen KI-Inferenzen auf M1 Pro (16 GB). Preview möglichst aus leichtem Quell-Proxy; niedrige Priorität; GPU/RAM-Ressourcen respektieren.
- Beim späteren globalen Ranking darf ein Kandidat umsortiert, zusammengeführt oder entfernt werden; selbst vorgenommene Notizen/Entscheidungen müssen entweder stabil dem entsprechenden Clip zuordenbar bleiben oder bei Konflikten kontrolliert gemeldet werden.
- Vorläufige Kandidaten dürfen nicht stillschweigend als final freigegeben/exportiert werden. Vorläufiger Export nur bei expliziter vorhandener Funktion + bewusster Nutzeraktion, sonst sperren.

Wenn die Architektur **noch keine** Zwischenstände liefert: B1 vollständig realisieren; B2 gezielt in der echten Engine ergänzen, soweit im Umfang möglich, ohne Laufzeitqualität zu riskieren. Falls struktureller Umbau erforderlich ist, dokumentiere die begründete Blockade mit konkretem Codebefund und implementiere einen ersten **realen** Zwischenstand (z. B. Transkript nach ASR), statt Fake-Clips/Timeouts.

## 4. PHASE C: EDITOR, NAVIGATION, DESIGN

Editor:
- Hauptansicht: vertikale Exportvorschau priorisieren; Quellbild/Tracking-Rahmen bei Bildausschnittbedarf zeigen.
- Werkzeuge als vier verständliche Aufgaben: Schneiden / Bildausschnitt / Untertitel & Titel / Export. Bestehende Bearbeitungsoperationen erhalten.
- Untertitel: zuerst Vorlagen, Schriftgröße, Position, Hervorhebungsfarbe, Animation; fortgeschrittene Regler unter „Erweitert“, nichts entfernen.
- Quell- und Zielzeitpunkte, exportierte Cliplänge und Cold-Opener-Segment klar visualisieren. Nächster/vorheriger offener Clip aus dem Editor.
- Bestehende non-destruktive Schnittoperationen, Undo/Redo und rendergleiche Vorschau beibehalten.
- Export-Preflight zunächst auf messbaren Prüfungen aufbauen: Safe Zones (wenn verfügbar), Track vorhanden, Ausgabeformat, fehlende Daten und vom Prüfer erkannte Timing-/Crop-Warnungen; direkte Navigation zum Problem. Keine subjektiven „garantiert okay“-Claims.

Navigation:
- Start, Projekte, Exporte, Vorlagen, Weitere Werkzeuge, Einstellungen als lesbare Hauptstruktur (angepasst an vorhandene Router/Sidebar).
- Live, Werkbank, Lernen, Modelle und Upload bleiben auffindbar, z. B. Weitere Werkzeuge, Einstellungen oder Exporte. Ein vorhandener zehnter Punkt bleibt erhalten.
- Auf Wunsch kompakte Icon-Sidebar; bei Icons Tooltips und Tastaturfokus. Nutzer kann häufiger genutzte Tools anheften, falls mit vorhandener Speicherung einfach möglich.

Design:
- Dunkel, kontrastreich, dezente Glasebenen mit ruhigen Arbeitsflächen. Apple-inspirierte Übergänge, reduzierte Bewegung beachten.
- Vorhandenes Styling-System/Tokens bevorzugen. `shadcn/ui`, Magic UI und Motion sind **Referenzen**, keine Pflicht-Dependencies.
- Barrierearme Kontraste, klare Focus States, keine Farbe ohne Icon/Textstatus, keine permanenten auffälligen Animationen, keine Performance-Drops während Verarbeitung.

## 5. Technische Integration

- Verwende vorhandene DB/Store/IPC/Worker-Strukturen; neues Datenmodell nur als **kompatible Erweiterung** mit Migration für alte Projekte.
- Doppelte Statusquellen vermeiden. Bei alten Clips „nicht_durchgefuehrt“ / „offen“ statt künstlich „bestanden“.
- Änderungen versionieren/fingerprintbinden, damit eine alte Freigabe nicht uneindeutig auf veränderte Inhalte zeigt.
- Abort, Suspend/Resume, Job-Finish, Partial Keep und Failure müssen definierte UI-Statusübergänge haben.
- Eventreihenfolge, Idempotenz und Replay bei Reload/Resume testen.
- Keine neuen Online-Aufrufe im Kernprozess, keine neuen Datenübertragungen.
- Die Referenzdatei `contracts/shortme-review-progress.reference.ts` ist **nur ein Typskizzenvorschlag**. Passe ihn den realen Datenstrukturen an, kopiere nicht blind.

## 6. GitHub-Referenzen – korrekt verwenden

Siehe `docs/06_GITHUB_REFERENZEN.md`. Vorrang haben Repo-Lesung und Ideenvergleich, nicht ganze Repos klonen/kopieren. Vor Quellcodeübernahme Commit, Lizenz, NOTICE, Dependencies, Electron-Security und Offline-Verhalten prüfen. OpenVideo ist dual-lizenziert; Rescript in aktuellen Releases PolyForm Noncommercial. Diese beiden **nur als Inspiration**, sofern keine separat geprüfte Nutzungsberechtigung vorliegt.

## 7. Qualitätsanforderungen und Testpflicht

Siehe `docs/07_ABNAHME_TESTS.md`. Mindestens:
- Typecheck/Lint/unit tests/build der vorhandenen App; aktualisiere relevante Tests;
- Mac ohne Engine-Umschalter, Windows mit bestehendem Umschalter; prüfen soweit CI/Umgebung möglich;
- bestehender Import, Projektöffnen, Cut, Subtitle edit, Crop, Cold Opener, Presets, Undo/Redo, Export unangetastet;
- Migration alter Clips; Freigabe und KI-Status über Neustart persistiert;
- 10 Clips nacheinander per Keyboard sichten und filtern;
- Jobstop mit Teilresultaten und Fehlerfällen ohne Datenverlust;
- kein erfundener Fortschritt, keine nicht vorhandenen Clips, keine UI-Blockierung unter realistischem Testjob;
- bei Screenshots dieselben 2540×1504 Referenzgrößen, plus schmales Fenster.

## 8. Vorgehensweise und Abschlussbericht

Arbeite eigenständig in **funktionalen vertikalen Scheiben**, nicht nur ein Planskelett. Reihenfolge A -> B1 -> B2 -> C, und nach jedem Abschnitt vorhandene Tests laufen lassen. Wenn Zeit / Ausführung begrenzt, priorisiere **voll funktionsfähige Phase A** statt überall halb eingebauter UI. Halte `checklists/UMSETZUNG.md` im Repo bzw. deinem Arbeitslog aktuell.

Liefere abschließend:
- geänderte Dateien und neue Komponenten;
- welche Funktionen real implementiert sind; welche nicht und warum;
- Tests (genaue Befehle, Erfolg/Misserfolg) und manuelle Prüfschritte;
- Bibliotheken samt Lizenzentscheidung;
- Screenshots oder Textbeschreibung des neuen Ablaufs;
- konkrete verbleibende Risiken; keine Behauptung „fertig“, wenn zentrale Bedingungen nicht geprüft sind.

**Nicht mit dem Plan aufhören. Implementiere, teste und liefere benutzbaren Code im bestehenden Shortme-Projekt.**
