# Vollständige Implementierung und Ersatz der Mac-Engine

Diese Anforderung konkretisiert den ausdrücklichen Nutzerwunsch: Nach der Programmierung soll die neue Engine die bisherige aktive Mac-Engine ersetzen. Alle Dateien dieses Gesamtpakets gehören zu einem einzigen Implementierungsauftrag.

## 1. Gewünschter Endzustand

Ein normaler Start der Mac-Analyse aus der bestehenden Shortme-Oberfläche verwendet standardmäßig die neue Pipeline: Vorbereitung und vier Suchwege, LFM-Beobachtung, Qwen3.5-Redaktion, echtes Rendern, LFM-Ausgabebeobachtung, Qwen-Inhaltsprüfung und technische Freigabe.

Die bisherige Mac-Analyse-/Auswahl-/Prüfsteuerung wird im aktiven Ablauf ersetzt. Wiederverwendbare Grunddienste wie Parakeet, SoundAnalysis, der Medienzugriff, Editor und Renderer dürfen erhalten bleiben und werden in die neue Steuerung integriert.

Die neue Engine ist beim Abschluss der Standardpfad für neue Mac-Runs. Ein experimenteller Schalter mit weiterhin aktiver alter Engine erfüllt den Auftrag nicht. Eine zulässige gezielte Gemma-Rückfrage ist Teil der neuen Pipeline und kein Rückfall auf die gesamte alte Engine.

## 2. Alle Verbindungen tatsächlich implementieren

Folgende Kette muss im echten Repository durchgehend verdrahtet sein:

1. Vorhandene UI-Aktion und vorhandener IPC-/Job-Einstieg.
2. Registrierung der neuen Mac-Pipeline und versionierte Run-Metadaten.
3. Reale lokale Modellinstallation beziehungsweise Erkennung bereits vorhandener Gewichte.
4. Reale MLX-Lade-/Inferenzaufrufe für LFM und Qwen.
5. Gemeinsame Vorbereitung, Kandidatenfusion und gemessene Kanten.
6. Validierte Modellantworten und tatsächlich angewandte Schnittpläne.
7. Echte Hochformat-MP4s, Untertitel und korrekte Zeitabbildung.
8. Prüfung des konkreten Renders und gegebenenfalls eine gezielte Reparatur.
9. Persistenz, Ergebnisliste, Editor, Projektwiederöffnung und Export.

Typdefinitionen, JSON-Vorgaben, dokumentierte Funktionsnamen oder Platzhalterantworten ersetzen keine dieser Verbindungen. Produktionspfade dürfen keine Dummy-Beobachtungen, simulierten Modellantworten oder pauschalen Erfolgswerte liefern.

Finde die tatsächlichen Typen und Funktionen im Repository. Erweitere oder ersetze sie passend. Die mitgelieferten TypeScript-Dateien sind Hilfsbausteine; verwende sie direkt oder übertrage ihre Regeln in die vorhandenen Schemas und Scheduler.

## 3. Modelle und Medien echt verwenden

LFM erhält echte Bilddaten und separat zugeführtes echtes Audio mit passenden Zeitreferenzen. Qwen erhält die tatsächlichen Transkriptbereiche, die Beobachtungen und die gemessenen Schnitt-IDs. Produktionsaufrufe müssen die festgelegten Modelle auf MLX ausführen.

Jede Beobachtung und jede Ausgabeprüfung muss auf die tatsächlich übergebenen Pakete zurückführbar sein. Paketabdeckung und Renderhash entstehen aus Host-/Worker-Daten. Ein Modelltext „alles geprüft“ erzeugt keine vollständige Abdeckung.

Die vollständige Tonlänge fertiger Clips muss nachgehalten werden. Nach einer Reparatur wird die veränderte Datei neu geprüft. Modell, Processor und Runtime auf nachweislich funktionierende Revisionen festlegen und nötige Anpassungen tatsächlich implementieren.

## 4. Die bisherige Engine sauber ablösen

- Normalen Mac-Startpunkt auf die neue Implementierung umstellen.
- Neue Runs eindeutig mit der neuen Pipelineversion kennzeichnen.
- Keine unbemerkte Weiterleitung an die bisherige vollständige Mac-Engine bei Modellfehlern.
- Alte Run-Daten und manuelle Änderungen weiterhin öffnen können.
- Beim erneuten Analysieren eines alten Projekts die neue Engine verwenden und die neue Analyse gesondert versionieren.
- Alte, nicht mehr verwendete Mac-Steuerung nach Prüfung ihrer Verweise aus dem aktiven Pfad entfernen; gemeinsam mit Windows genutzte Grundfunktionen erhalten.
- Während der Entwicklung in einer geeigneten lokalen Branch-/Worktree-Struktur arbeiten; Git-Historie und Benutzerdaten nicht löschen.

Eine zweite ungenutzte Parallel-Engine ist kein fertiger Ersatz. Windows-Routing, bestehender Editor und Dateiformate müssen weiterhin funktionieren. Der ausdrücklich gewünschte Cold-Opener-Regler ist die zulässige Ergänzung der vorhandenen Oberfläche.

## 5. Laufzeitsteuerung wirklich anschließen

05_LAUFZEITREGELN.md vollständig implementieren. Die Funktionen in 06_RUNTIME_POLICY.ts müssen vom echten Scheduler verwendet werden oder eine gleichwertige aktive Implementierung erhalten.

Initiale Pakete, Zusatzfragen, JSON-Korrekturen, Gemma-Rückfragen und Reparaturen müssen aus demselben tatsächlich geführten Aufgabenzähler ersichtlich sein. Pflichtprüfungen sind trotz weichem Zeitbudget vollständig.

Timeouts müssen reale Worker beziehungsweise Renderprozesse stoppen. Ein lediglich abgelehntes Promise reicht nicht. Abbruch aus der Oberfläche muss den aktuellen Job stoppen, den Modell-/Renderprozess freigeben und einen konsistenten Projektzustand hinterlassen.

Zeige Fortschritt aus der echten Warteschlange. Erfasse Vorverarbeitung, Modellladen, Inferenz, Encoding, Endprüfung und Reparatur getrennt. Keine künstlich gedeckelte Restzeitanzeige und keine ausgedachten Zeitmessungen.

## 6. Cold Opener im tatsächlichen Renderpfad

Der Regler ist standardmäßig 0 = aus. Bei Aktivierung muss die Segmentliste im Renderer wirklich angewandt werden: Teaser mit Originalton, dann regulärer Hauptclip. Untertitel, Crop und Ton folgen der Ausgabe-Timeline.

Prüfe eine echte Ausgabe mit ausgeschaltetem und eine mit eingeschaltetem Cold Opener. Die beabsichtigte Wiederholung der Quellstelle darf nicht vom Dublettenfilter zwischen verschiedenen Clips entfernt werden. Beim Ändern des Reglers darf keine vollständige erneute Quellensuche stattfinden.

## 7. Funktionsfähige Mac-Lieferung

Die erforderlichen lokalen Worker, Runtime-Abhängigkeiten, Startskripte und Modellpfade so integrieren, dass die Mac-App sie tatsächlich findet. Vorhandene Paketierungs-/Buildwege nutzen und bei Bedarf korrigieren. Nicht ausschließlich auf eine manuell präparierte Entwickler-Shell vertrauen.

Modellinstallation einmalig ermöglichen; danach einen Offline-Run unterstützen. Ein fehlendes Modell oder eine defekte Laufzeit führt zu einem konkreten Fehler mit Wiederaufnahmemöglichkeit, nicht zu einem Cloud-Aufruf oder vorgetäuschtem Erfolg.

## 8. Abschluss anhand tatsächlicher Ausführung

Die vorhandenen Projektchecks ausführen und notwendige Integrationsprüfungen ergänzen. Vor allem den echten UI-/IPC-Einstieg mit dem neuen Standardrouting überprüfen, nicht nur isolierte Hilfsfunktionen.

Auf einem verfügbaren Apple-Silicon-Mac mindestens einen realen vollständigen Lauf mit Sprache, Bild, Ton, Untertiteln und gespeichertem MP4 durchführen. Weitere relevante Fälle: Deutsch/Englisch, Podcast ohne sichtbare Aktion, längerer Clip mit mehreren Tonpaketen, Cold Opener an/aus, AV1, Abbruch und Wiederöffnung.

Verwende vorhandene lokale Testmedien. Dokumentiere die tatsächlich ausgeführten Medien, Einstellungen und Ergebnisse. Ein optionales erzeugtes Laufprotokoll soll unter anderem enthalten:
- Git-Revision und tatsächlich aktive Pipelineversion.
- Eingabe-Hash, Dauer, Codec und Hardware.
- Geladene Modelle, Runtime-/Processor-Revisionen und reale Aufrufzahlen.
- Zeiten je Phase, Wiederholungsgründe und gemessene Speicherwerte.
- Echte Ausgabedateien mit Hash, Laufzeit, Untertiteln und Prüfstatus.
- Ergebnis von Offline-Verarbeitung, Abbruch und Projektwiederöffnung.

Die 30 bestehenden Hilfsprüfungen im Paket beweisen nur die dort implementierten Regeln. Sie beweisen weder MLX-Inferenz noch Mac-Leistung oder Clipqualität.

Wenn die aktuelle Umgebung kein Apple Silicon beziehungsweise keinen Zugriff auf das echte Repository bietet: den konkreten Ausführungsblocker nennen, alle unabhängig möglichen Implementierungsarbeiten abschließen und einen reproduzierbaren Mac-Prüfweg bereitstellen. Eine nicht ausgeführte Mac-Prüfung darf nicht als bestanden erscheinen. Fehlende technische Voraussetzungen sind konkret zu benennen; daraus keine neue allgemeine Konzeptphase machen.

## 9. Wann der Auftrag noch nicht fertig ist

Unvollständig ist insbesondere:
- Nur Dokumentation, Konfiguration, Typen oder ein Architekturvorschlag wurden erstellt.
- Reale Modelladapter oder Teile der Render-/Prüfkette bleiben TODOs oder Stubs.
- Die Oberfläche startet weiterhin die bisherige Mac-Engine.
- Die neue Engine ist ausschließlich hinter einem deaktivierten Entwicklungsflag erreichbar.
- Die Endprüfung untersucht nur den ursprünglichen Ausschnitt statt der fertigen Ausgabe.
- Ein gemeldeter Abbruch lässt GPU- oder Renderarbeit weiterlaufen.
- Nur die mitgelieferten 30 Hilfsprüfungen wurden ausgeführt.
- Ergebnisse oder Mac-Messungen wurden simuliert.

## 10. Gewünschte Abschlussmeldung

Berichte kurz, welche produktiven Dateien geändert wurden, wie die neue Standardroute erreichbar ist, welche echten Läufe und Projektchecks ausgeführt wurden und wo die tatsächlichen MP4-Ergebnisse liegen.

Falls ein Teil technisch blockiert oder ungeprüft ist, benenne genau diesen Teil. Behaupte dann keine vollständig abgenommene Mac-Engine.

Ziel ist die vollständig implementierte, in die bestehende App integrierte Ersatz-Engine. Die private lokale Nutzung ist bestätigt. Eine weitere allgemeine Modellvergleichsrunde oder eine zusätzliche Erlaubnis für bereits beschriebene Änderungen ist nicht nötig.
