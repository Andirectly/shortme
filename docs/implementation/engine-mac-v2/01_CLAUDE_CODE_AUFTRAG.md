# Claude Code: Neue Mac-Engine vollständig implementieren und ersetzen

## Verbindliches Lieferziel: vollständige Ersatz-Engine

Implementiere die neue Mac-Engine produktiv und integriere sie vollständig in den echten App-Ablauf. Am Ende startet jeder normale neue Mac-Run standardmäßig die neue Pipeline; die bisherige aktive Mac-Steuerung wird ersetzt. Bewährte Grunddienste dürfen wiederverwendet werden. Die Windows-Engine, vorhandene Projekte und manuelle Bearbeitungen bleiben funktionsfähig.

08_IMPLEMENTIERUNG_UND_ABNAHME.md ist verbindlicher Bestandteil dieses Auftrags. Echte lokale Modelladapter, Worker, Scheduler, Renderer, Ausgabeprüfung, Persistenz und UI-/IPC-Routing implementieren und ausführen. Alle Regeln aus 05_LAUFZEITREGELN.md in den realen Ablauf integrieren. Einen neuen ungenutzten Pfad oder einen deaktivierten Prototyp nicht als Fertigstellung melden.

Arbeite im echten bestehenden Shortme-Repository. Setze diesen Auftrag um, statt erneut eine breite Modellrecherche oder ein neues Benchmarkprojekt zu beginnen. Die private lokale Nutzung ist vom Nutzer bestätigt. Alle folgenden Anforderungen sind gewünschter Implementierungsumfang.

## Ausgangspunkt und Ziel

MacBook Pro M1 Pro, 16 GB gemeinsamer Speicher. Gute, eigenständig verständliche Shorts aus deutschen und englischen Vlogs, Podcasts und Streams. Die Verarbeitung läuft nach der Modellinstallation vollständig lokal.

Bestehende Electron-/TypeScript-Oberfläche, Editor, Projektformat und manuelle Bearbeitungen weiterverwenden. Die Windows-Engine funktionsfähig halten. Bestehende Richtlinien im Repository lesen. Prüfe zuerst die tatsächlichen Dateien für Mac-Orchestrator, MLX-Worker, Transkription, Kanten, Rangfusion, Renderer, Untertitel, Ergebnisprüfung und IPC. Verwende deren Typen und Erweiterungspunkte; erfinde keine zweite App.

Das Paket enthält keinen aktuellen App-Quellcode und behauptet keine bereits ausgeführten M1-Modelltests. Ordne vor Änderungen die tatsächlichen Integrationspunkte im vorhandenen Repository zu.

## Festgelegte Rollen

- Bestehendes Parakeet TDT 0.6B v3 über sherpa-onnx: Transkription und Wortzeiten zunächst beibehalten.
- Apple SoundAnalysis, Pegelsprünge, günstige Bildwechsel und bestehendes Qwen3-VL-Embedding-2B: als Suchwege beibehalten.
- `LiquidAI/LFM3-Omni-2B-MLX-8bit`: tatsächliche Bild-/Tonbeobachtung vor und nach dem Rendern.
- `mlx-community/Qwen3.5-9B-4bit`: ersetzt Qwen3-8B für Sprachsuche, redaktionelle Auswahl, Schnittplanung, Titel und Inhaltsprüfung.
- Vorhandener Gemma-4-E4B-Adapter: ausschließlich für konkrete ungelöste Medienfragen. Keine obligatorische Gemma-Gesamtbewertung jedes Clips.

Große Modelle laufen phasenweise, nie gleichzeitig. Innerhalb einer Phase mehrere Aufträge seriell bearbeiten, nicht das Modell für jeden Kandidaten neu laden. Vor der nächsten Modellphase Speicher freigeben und tatsächlichen Speicherdruck prüfen. Schätzwerte für kurze Pakete: LFM 4–7 GB, Qwen 7–9 GB; das sind keine gemessenen M1-Spitzen.

## Schritt 1 – Vorbereitung und Cache

Quelle mit Codec, Rotation, Tonspuren und rationaler Zeitbasis erfassen. Ton und benötigte Analysebilder einmal erzeugen und über Suchwege und Untersuchung wiederverwenden. AV1 nicht für jeden Schritt erneut vollständig dekodieren; bei sinnvoller Wiederverwendung einen Analyse-Proxy nutzen. Dessen Erstellung gehört zur Laufzeit.

VideoToolbox-Fähigkeiten des gebündelten FFmpeg tatsächlich prüfen und passende vorhandene Hardwarepfade aktivieren. Ein neues Binary nur bereitstellen, wenn das vorhandene nötige Fähigkeiten nicht enthält. Original-PTS und Proxy-Zuordnung durchgehend erhalten.

## Schritt 2 – Suche über die gesamte Quelle

Alle vier bestehenden Suchwege erhalten. Qwen durchsucht begrenzte, an Satzgrenzen ausgerichtete Fenster; Startkonfiguration ungefähr 180 Sekunden mit 30 Sekunden Überlappung, zusätzlich durch Tokenbudget begrenzt. Keine Zusammenfassung allein aus den ersten Minuten.

Bildsuchanfragen an Videotyp und Transkript anpassen. Food-Beispiele: erster Biss, Essen zeigen, sichtbare Reaktion. Solche Anfragen sind Suchhypothesen, keine bereits beobachteten Ereignisse.

Globale Vorschlagsmenge bilden, anschließend auswählen. Kein `slice(0, K)` einer chronologisch entstandenen Kandidatenliste als Qualitätsauswahl. Zeitliche Überschneidungen und dieselben Ereignisse zusätzlich per Code zusammenführen. Die Clipnummerierung darf später chronologisch sein; die Auswahl der Gewinner muss vorher redaktionell erfolgt sein.

## Schritt 3 – LFM untersucht begrenzte Kandidatenpakete

Zunächst nur die aussichtsreichen Ereignisgruppen vertiefen. Als Startprofil 6–8 gezielt ausgewählte Bilder plus ein kurzes Tonpaket und den passenden Transkriptauszug verwenden. Bei Bewegung oder kleinen Details gezielt nachfordern. Lange Tonstrecken teilen und deren vollständige Abdeckung nachhalten.

Im dokumentierten LFM-MLX-Pfad die Tonspur ausdrücklich separat zuführen. MP4-Eingabe allein ist kein Nachweis für gehörten Ton. Passende Video-Metadaten und Zeitreferenzen verwenden. Textausgabe ausdrücklich anfordern: `Respond with text.`

LFM liefert beobachtete, abgeleitete oder unbekannte Befunde mit vorhandenen Beleg-IDs. Keine erfundenen Sekunden oder Viralitätszahlen. Eine Nachforderung braucht eine konkrete Frage und einen Anker. Zunächst höchstens eine gezielte Kontexterweiterung pro Kandidat.

Die teure TransNet-/Bildkantensuche auf die Kandidaten- und benötigten Kontextbereiche begrenzen; den günstigen globalen Bildwechselweg erhalten.

## Schritt 4 – Qwen entscheidet über Schnitt und Titel

Qwen erhält die Beobachtungen, Originaläußerungen einschließlich des nötigen Umfelds, eine kompakte Abschnittsübersicht und die gemessenen Schnittkanten.

Es wählt eigenständige, unterschiedliche Geschichten beziehungsweise Aussagen und legt Start/Ende ausschließlich über erlaubte Kanten-IDs fest. Originalwörter um Einstieg und Ende dürfen nicht nur durch eine Zusammenfassung ersetzt werden.

Podcasts benötigen keine sichtbare körperliche Aktion: ein vollständiger Gedanke oder eine Erkenntnis genügt. Vlogs und Streams können zusätzlich von sichtbarem Ereignis und Reaktion leben. Keine pauschale Ablehnung „keine Aktion“.

Titel in der Sprache des Clips, kurz und konkret, aus dem enthaltenen Inhalt. Keine Beispielplatzhalter oder erfundenen Superlative übernehmen. Titel nach inhaltlicher Schnittreparatur erneut prüfen.

Bei Qwen3.5 direkte strukturierte Antworten über das unterstützte Chat-Template konfigurieren. Nicht auf den alten Textschalter `/nothink` verlassen. Modell, Processor und Runtime auf funktionsfähige Revisionen pinnen; keine ungetesteten CLI-Parameter aus dieser Planungsdatei ableiten.

## Schritt 5 – Cold Opener nur auf Wunsch

Einen Regler im Stil der vorhandenen Einstellungen ergänzen: Zielwert 0–5 Sekunden, Standard 0 = aus. Alte Projekte ohne dieses Feld bleiben chronologisch.

Bei Aktivierung einen geeigneten Originalausschnitt an den Anfang setzen, danach den Hauptclip von seinem normalen Beginn abspielen. Der vorgezogene Moment kommt später im Zusammenhang erneut vor. Wort-/Satzgrenzen haben Vorrang vor einer exakt erzwungenen Reglerdauer.

Cold Opener als geordnete Segmentliste abbilden, nicht durch eine falsche einzige Start-/Endspanne. Wiederholte Quellstellen innerhalb dieser Variante sind beabsichtigt. Untertitel, Ton, Crop und Zeitabbildung folgen der Ausgabe-Timeline. Kein neuer Ganzvideo-Suchlauf beim Ändern des Reglers.

## Schritt 6 – Rendern

Vorhandenen 9:16- und Untertitelpfad nutzen. Neben Gesichtern auch entscheidende Objekte und Bildschirmgeschehen beachten. Bei unklarer enger Bildwahl eine geeignete vorhandene breitere Darstellung verwenden.

Für Podcasts kann Mundbewegung zusammen mit Tonenergie eine günstige Sprecherhilfe sein. Diese Heuristik ist keine sichere Sprecheridentifikation. Kein zusätzliches großes Modell allein für diese Layoutentscheidung einführen.

## Schritt 7 – Tatsächliche Ausgabedatei prüfen

LFM beschreibt Bild und Ton des echten Renders, zunächst ohne die positive Auswahlbegründung des Directors. Qwen prüft anhand dieser Befunde und des tatsächlich enthaltenen Texts Einstieg, Zusammenhang, Ertrag und natürlichen Abschluss. Gesamte Tonlänge berücksichtigen, auch bei längeren Clips.

Technische Messungen prüfen unter anderem Stille, Schwarz-/Standbilder, Wortanschnitte, Schnittnähte und gültige Zeitabbildung. Ausgabebefunde an den Hash der konkreten Renderdatei binden; nach einer Änderung ungültig machen.

Kein „90–100 Punkte für alles“. Fehlende Befunde, unbekannte Ergebnisse und Widersprüche ergeben Prüfbedarf, kein Bestehen. Die mitgelieferten TypeScript-Regeln unterstützen diese Freigabelogik, beweisen aber keine korrekte Interpretation von Bild und Ton.

## Schritt 8 – Reparatur und Ergebnis

Nur konkrete Fehler reparieren und die davon betroffene Ausgabe erneut prüfen. Initial höchstens eine automatische Reparaturrunde pro Clip. Gemma nur mit einer konkreten ungelösten Frage hinzuziehen. Danach unklare Ergebnisse nachvollziehbar als „prüfen“ speichern; ungeeignete verwerfen.

Bestandene, eigenständige Clips nach oben; unterschiedliche Inhalte bevorzugen. Weniger gute Clips liefern, wenn die Quelle wenig hergibt, statt die Qualitätsschwelle zu senken.

Arbeitsumfang an gewünschter Clipzahl, Quellenlänge, Ausgabelänge und Unsicherheiten ausrichten. Startwerte: 10 Minuten Quelle / 3–4 Clips → 5–7 vertiefte Kandidaten; 20 Minuten / 5–6 Clips → 8–12. Bei Bedarf gezielt erweitern. Die günstige Suche bleibt vollständig.

## Integration und Abnahme

`02_ENGINE_PLAN.json` enthält gewünschte Einstellungen, keine Bibliotheks-API. `03_ENGINE_CONTRACTS.ts` liefert wiederverwendbare Regeln. Vorhandene Zod-/JSON-Schemas und Typen erweitern, statt blind eine zweite parallele Datenstruktur aufzubauen. Die Prüfbausteine setzen eine bereits erfolgte strukturelle Schema-Prüfung voraus.

Beleg-IDs, Paketabdeckung, gemessene Kanten und Renderhash stammen aus Host/Worker-Messungen. Ein Modell darf diese vertrauenswürdigen Register nicht selbst erzeugen oder umschreiben.

Führe vorhandene Projektchecks und notwendige Funktionsprüfungen aus: Bild plus deutscher Ton, fehlende/erfundene IDs, vollständige Tonabdeckung, optionaler Hook, Untertitel nach Umordnung, längerer Clip, AV1, Abbruch/Fortsetzen und vorhandene Projekte. Ladeprüfung und Speichererfassung auf realem Mac gehören zum Einbau. Keine neue breite Modellvergleichsphase.

Entwicklungsziel: 10 Minuten H.264 mit 3–4 guten Shorts in etwa 8–15 Minuten einschließlich Rendern; rund 20 Minuten dürfen ungefähr eine halbe Stunde beanspruchen. Berichte tatsächliche Zeiten einschließlich Modellladen, Proxy und Reparatur. Das Ziel ist noch keine gemessene Leistung.

Zum Abschluss: geänderte Dateien, tatsächlich laufender Ablauf, ausgeführte Checks und verbleibende Einschränkungen nennen. Nicht ausgeführte Mac-Inferenz nicht als bestanden melden. Keine Cloud-Fallbacks, keine unnötigen Rückfragen zur bereits bestätigten privaten Nutzung und kein Umbau der gesamten Oberfläche.

## Verbindlicher Laufzeit-Nachtrag

Implementiere zusätzlich 05_LAUFZEITREGELN.md. Diese Ergänzung konkretisiert die bisherigen Arbeitspaketgrößen und Wiederholungsregeln. Verwende 06_RUNTIME_POLICY.ts beziehungsweise die äquivalenten vorhandenen Scheduler-Typen. Pro Kandidat die erforderlichen Grundpakete für vollständige Beobachtung vorab zählen. Darüber hinaus teilen sich Kontextnachfrage und JSON-Korrektur ein gemeinsames Budget von höchstens einer Zusatzanfrage. Zähle echte Medienpakete statt pauschal einen Endprüfaufruf pro Clip. Weise Rendern, Modellprüfung und Reparatur getrennt aus. Zeitlimits müssen die reale Arbeit stoppen. Die vollständige Qualitätsprüfung darf nicht durch das weiche Zeitbudget entfallen.
