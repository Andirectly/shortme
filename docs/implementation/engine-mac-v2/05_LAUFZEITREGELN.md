# Laufzeitsteuerung und ehrlicher Fortschritt – verbindliche Ergänzung

Anlass: Bei einem 40-Minuten-Video waren Transkription und erste Analyse schnell, während die angezeigte Zeit beim „Clippen“ von 30 auf 40 und 55 Minuten stieg. Diese Anzeige belegt weder die bereits verstrichene Zeit noch die Ursache. Der laufende Run wurde hier nicht untersucht.

Die bisherige Planung enthält weniger Modellaufrufe und eine begrenzte Reparaturrunde. Das allein verhindert keine langen Renderphasen, versteckten Wiederholungen oder falschen Restzeitschätzungen. Die folgenden Regeln gehören deshalb zur Umsetzung.

## 1. „Clippen“ in echte Arbeitsschritte aufteilen

Zeit und Fortschritt getrennt für: Medienaufbereitung, Kandidatenuntersuchung, Schnittplanung, Hochformat/Untertitel/Encoding, Bild-/Ton-Endprüfung und Reparatur.

Für jede Aufgabe Typ, Kandidat, Paket, Modell, Ladezeit, Vorbereitung, Inferenz beziehungsweise Encoding, Wiederholungsgrund und Ergebnis erfassen. Große Speicherbelegung, Speicherdruck und tatsächliche Rendergeschwindigkeit protokollieren. Erst damit lässt sich feststellen, ob das Problem KI, Dekodierung, Untertitel, Encoding oder Nachfragen sind.

Im vorhandenen Fortschrittsbereich verständliche Zähler anzeigen, beispielsweise „Clip 3 von 6 rendern“ oder „Tonpaket 2 von 3 prüfen“. Die gesamte Quellenlänge ist kein ausreichender Maßstab für diese Phase.

## 2. Eine begrenzte Warteschlange

Die gewünschte Clipzahl steuert die teure Untersuchung. Als obere Startgrenze zunächst 2 × gewünschte Clipzahl; höchstens vier zusätzliche Ereignisgruppen automatisch nachuntersuchen. Vorher deduplizieren und über alle Videoabschnitte auswählen.

Beispiel: 40 Minuten Quelle, 6 gewünschte Shorts → zunächst höchstens 12 vertiefte Kandidaten, insgesamt höchstens 16. Das ist ein Arbeitslimit, kein Qualitätsversprechen oder pauschales Soll von 16. Bei weniger geeigneten Momenten entsprechend weniger untersuchen.

Die schnelle Suche deckt weiter die ganze Quelle ab. Ungeprüfte zusätzliche Kandidaten bleiben als solche dokumentiert. Mehr oder längere gewünschte Shorts erfordern ausdrücklich mehr Pflichtarbeit.

## 3. Geteilte Aufruf- und Wiederholungsgrenzen

- Die erforderlichen kurzen Medienpakete eines Kandidaten bilden seine geplante Grundmenge. Zusätzlich höchstens eine Anfrage für Kontext oder JSON-Korrektur; beide teilen denselben Zusatz-Zähler. Ein längerer Kandidat darf die für vollständige Beobachtung nötigen Grundpakete erhalten. Beispiel: ein Grundpaket plus höchstens eine Zusatzanfrage; drei Grundpakete plus höchstens eine Zusatzanfrage.
- Höchstens eine automatische Reparaturrunde pro ausgegebenem Clip.
- Gemma höchstens für zwei konkrete Rückfallfragen pro Run automatisch laden.
- Jede notwendige Ton-/Bildaufteilung als echte Aufgabe zählen. Ein 60-Sekunden-Clip ist nicht automatisch „ein Prüfanruf“.
- Keine zusätzlichen ungezählten Retries im SDK, Adapter oder Scheduler.

Wenn die Grenzen erreicht sind, bleibt ein unsicheres Ergebnis „prüfen“. Weder fehlende Medienabdeckung noch ein unbekanntes Kriterium werden zu „bestanden“.

## 4. Weiches Zeitbudget mit Reserve für Fertigstellung

Für das normale Profil zunächst ein konfigurierbares Zielbudget von 30 Minuten Gesamtlaufzeit vorsehen. Dies ist ein weiches Arbeitsbudget, keine Zusage oder harte Export-Deadline.

Vor zusätzlicher Suche prüfen:
verstrichene Zeit + erwartete nächste Untersuchung + Reserve für bereits geplantes Rendern und vollständige Endprüfung.

Passt das nicht mehr ins Ziel, keine zusätzlichen Kandidaten nachladen. Bereits geplante Pflichtprüfungen durchführen beziehungsweise verbleibende Ausgaben als unvollständig speichern. Keine halbfertig geprüften Clips freigeben.

Die erste begrenzte Kandidatenrunde und Pflichtarbeit werden durch diese Zusatzsuche-Regel nicht übersprungen. Fehlen Messwerte, darf die Zusatzsuche keine kostenlose Dauer von null annehmen. Dann erst die laufenden Aufgaben abschließen und die Reserve aktualisieren.

Das tatsächliche Rendering kann trotz Budget länger dauern. Ein Zeitbudget ersetzt keine Beschleunigung des realen Renderpfads. Die Geschwindigkeit muss beim Einbau mit den tatsächlich gewünschten Clips und Einstellungen erfasst werden.

## 5. Zeitlimits müssen Arbeit wirklich beenden

Als anfängliche Schutzwerte 120 Sekunden je Medien-/Textanfrage und Modellladevorgang konfigurieren; an reale, begrenzte Paketgrößen anpassen. Ein Timeout darf nicht nur ein Promise ablehnen, während die GPU weiterrechnet.

Abbruch im echten Worker implementieren, bei Bedarf den isolierten Prozess kontrolliert beenden und dessen Speicherfreigabe abwarten. Ein verkleinertes Paket darf nur innerhalb desselben Anfragebudgets erneut versucht werden. Die gesamte Tonabdeckung bleibt über mehrere kleine Pakete erhalten.

Beim Rendern echte FFmpeg-Fortschrittswerte auswerten. Zwei Minuten ohne tatsächlichen Fortschritt lösen Diagnose und Abbruch des betroffenen Jobs aus. Ein Prozess-Heartbeat ist kein Renderfortschritt. Langsames, aber fortschreitendes Rendern gesondert sichtbar machen und den Hardware-/Untertitelpfad untersuchen.

## 6. Restzeit aus Restarbeit berechnen

Pro Aufgabentyp Laufzeit je Einheit aus tatsächlich erledigten Aufgaben gewinnen, beispielsweise Sekunden je Medienpaket oder Sekunden je zu renderndem Frame. Auflösung, Codec und Paketgröße bei der Zuordnung berücksichtigen. Modellladen separat zählen.

Restzeit aus der tatsächlichen Warteschlange berechnen. Bei zu wenigen Daten Zähler und „Zeit wird ermittelt“ anzeigen. Danach einen Bereich aus gemessenen typischen und langsameren Werten anzeigen. Für fehlende zukünftige Phasen keine null Sekunden unterstellen.

Neue Aufgaben, zusätzliche Tonpakete, Reparaturen und gemessene Verlangsamung aktualisieren die Restarbeit samt nachvollziehbarem Grund. Keine eingefrorene oder künstlich gedeckelte Anzeige.

## 7. Renderpfad gezielt beschleunigen

Nur ausgewählte Gewinner rendern, keine große Menge verworfener Schnittvarianten. Gemeinsame Frames und Audio verwenden. Für AV1 die wiederholte Dekodierung vermeiden. Verfügbare VideoToolbox-Pfade tatsächlich aktivieren.

Untertitelvorbereitung, Crop/Tracking und Encoding getrennt messen. Das schnellste Modell hilft wenig, wenn jede 9:16-Datei langsam über CPU und mehrfach gelesene Originalframes aufgebaut wird.

## 8. Entwicklungsabnahme

Ein realer Run muss geplante und tatsächliche Anfragen, Wiederholungen, Renderzeit und Endprüfzeit erklären können. Die Aufrufgrenzen müssen auch bei ungültigem JSON oder fehlendem Kontext halten. Abbruch muss den Worker tatsächlich stoppen. Pflichtprüfungen bleiben vollständig.

Die TypeScript-Helfer in 06_RUNTIME_POLICY.ts unterstützen Grenzen und Restzeitberechnung. Sie stoppen selbst keine Worker und ersetzen keine Integration in den echten Scheduler.

Diese Ergänzung macht den Einbauauftrag konkreter. Sie ist kein Nachweis, dass der aktuell laufende 40-Minuten-Run schon schneller wird oder die neue Engine bereits integriert ist.
