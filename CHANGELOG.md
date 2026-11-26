# Changelog

Notable changes per release. Full commit history and downloadable builds are on
the [releases page](https://github.com/JeremySNR/cutawan/releases).

This project uses [semantic versioning](https://semver.org/), loosely: while
still pre-1.0, minor bumps carry new features and patch bumps carry fixes.

## [0.53.0] - 2026-11-26

### Added

- Engine 6 (Windows, optional – nicht Standard): sucht über Sprache, Ton, Bild und Chat, ordnet die Kandidaten redaktionell nach ihrem vollständigen Wortlaut, untersucht nur offene Fragen in Bild und Ton (bei Bedarf mit Originalausschnitt) und prüft die tatsächlich exportierte Datei in ganzer Länge (Technik, Bild/Ton, Inhalt). Im Test auf zwei Videos (10 und 12 Min) 55 % bzw. 33 % schneller als Engine 4 bei gleich vielen oder mehr geprüften Clips, liefert aber weniger Clips, weil nur Clips ohne Mindestmangel veröffentlicht werden. Eine menschliche Qualitätsbewertung steht noch aus.
- Clipliste bei Engine 6: „#Rang“ statt Punktzahl, Sortierung nach Rang; der Export übernimmt die geprüfte Datei unverändert, solange du nichts änderst (nach einer Bearbeitung wird neu gerendert und der Prüfstatus gilt nicht mehr).
- Engine-Vergleich und „Clip prüfen“ kennen Engine 6.

### Changed

- Remote: Eine angeforderte Engine, die der andere Rechner nicht kennt (andere Plattform oder ältere Version), wird dort mit klarer Meldung abgelehnt statt still durch die Standard-Engine ersetzt.

### Fixed

- Ein zweites Shortme-Profil (eigene Geräteidentität) blockierte die normale App wegen der Einzelinstanz-Sperre.
- Python-Laufzeit wurde nach jedem Update neu installiert, weil die Prüfsumme der Paketliste von den Zeilenenden abhing.
- Release-Prüfung im Test auf die Shortme-Dateinamen angepasst.

## [0.52.0] - 2026-11-24

### Added

- Remote-Geräte (Einstellungen › Remote-Geräte): Mac und Windows-PC einmal mit Code und Prüfcode koppeln; danach verbinden sie sich direkt (Peer-to-Peer, Ende-zu-Ende verschlüsselt, ohne Server) und nach jedem Neustart automatisch wieder. Verbindung testen, Entkoppeln.
- Auf anderem Rechner verarbeiten: beim Link unter „Verarbeiten auf“ einen gekoppelten Rechner wählen. Er lädt das Video selbst, transkribiert, analysiert und rendert mit seinen Modellen; das fertige Projekt (voll bearbeitbar) und die geprüften Clips kommen automatisch zurück – auch nachdem dieser Rechner offline war.
- Remote-Worker im Hintergrund: Fenster schließen beendet ihn nicht (Symbol in Taskleiste/Menüleiste, „Worker beenden“); optional Start nach der Anmeldung.

### Changed

- Shortme läuft nur noch einmal gleichzeitig; ein zweiter Start holt das vorhandene Fenster nach vorn.

## [0.51.0] - 2026-11-20

### Added

- Engine 4 und Engine Mac: Twitch-Chat als eigene Suchspur (nur mit Chat-Schalter) – zählt verschiedene Schreiber gegen die letzten 5 Minuten, Spam eines Nutzers zählt einmal.
- Engine 4 und Engine Mac lernen aus deinen Review-Entscheidungen, welche Suchspuren gute Clips finden (wirkt ab 30 Freigaben/Verwürfen, vorsichtig begrenzt).
- Engine 4 und Engine Mac: die Sprachsuche wird gespeichert – ein erneuter Lauf mit gleichem Transkript überspringt sie.

### Changed

- Clipliste: Klick auf einen Clip öffnet ein Fenster in der Mitte (Hintergrund abgedunkelt) mit großem Video im Export-Ausschnitt und den Details; ← → wechselt den Clip, Esc oder ✕ schließt. Die Karten nutzen wieder die volle Breite.
- Editor: passt jetzt auch ins kleinste Fenster (1080 px); unter 1280 px steht die Ausschnitt-Schnellwahl nur im Reiter „Bildausschnitt“.

### Fixed

- Begründungen und KI-Befunde, die mitten im Wort abgeschnitten waren („… hastig durchwü“), enden jetzt auf dem letzten ganzen Wort mit „…“; doppelte Befunde in den Details entfallen.

## [0.50.0] - 2026-11-20

### Changed

- Exporte & Upload neu: Projekt wählen, nach Status filtern (noch nicht gesendet / gesendet / Fehler), Titel suchen, Clips als Galerie; mehrere Clips auswählen und nacheinander mit je eigenem Textvorschlag senden; rechts große Vorschau, „Im Ordner zeigen“, Text und Senden.
- Live neu: Status oben, Puffer-Länge und Chat direkt einstellbar, Kanalprüfung als Karte, während der Aufnahme Kennzahlen (Laufzeit, Puffer, Speicher, Chat) und große „Moment sichern“-Knöpfe; gesicherte Ausschnitte mit Vorschaubild und Clip-Anzahl.
- Start: „Neues Video“ mit Ablegen, Datei wählen und Link in einer Karte, daneben „Weitermachen“ (letztes Projekt bzw. laufende Analyse).

### Fixed

- Review: Text und Knöpfe ragten über den Rand der rechten Spalte.

## [0.49.0] - 2026-11-20

### Added

- Clipliste: Clip-Inspector rechts – Klick auf eine Karte zeigt Vorschau im Export-Ausschnitt, Begründung, KI-Prüfung, deine Entscheidung (Freigeben/Prüfen/Verwerfen) und Lernbewertung getrennt; Doppelklick öffnet den Editor, „Review“ startet ab diesem Clip. Ersetzt das Score-Popup auf der Karte.
- Befehlssuche mit ⌘K (Mac) bzw. Strg+K (Windows): Seiten, Projekte und Aktionen per Tastatur; auch als Lupe in der Seitenleiste.
- Tastenkürzel-Übersicht mit „?“.
- Seitenleiste mit Beschriftungen (Schalter unten in der Leiste).

### Changed

- Erstellen-Dialog breiter und in Gruppen: „Clip-Ziel“ (Videotyp, Suche, Anzahl, Länge, Workflow, Engine), „Look“ (Format, Bildausschnitt, Untertitel, Titel, Cold Opener) und „Feintuning“; „Clips finden“ bleibt unten fest.

### Fixed

- Editor: Rückgängig/Wiederholen auf dem Mac auch mit ⌘Z / ⌘⇧Z.

## [0.48.0] - 2026-11-20

### Changed

- Exportieren im Editor öffnet immer einen kurzen Bestätigungsdialog mit den Prüfhinweisen (vorher startete ein Klick sofort den Export).
- Restzeit: Startschätzung und Restzeit während der Verarbeitung passen zusammen (Engine Mac zählt das parallele Rendern nicht doppelt und eine gespeicherte Bildsuche nicht mit); über die Stundengrenze steht „ca. 45 Min – 1 Std 15 Min“.
- Engine Mac: aktuelle Beschreibung im Erstellen-Dialog.

### Fixed

- Ein gestoppter oder pausierter Lauf zeigte bei „Clips finden“ weiter „läuft“.
- Score-Details auf der Clipkarte wurden abgeschnitten und nannten bei Engine-Mac-Clips „Engine 4“.
- Zeitleiste im Editor: überlappende Beschriftungen bei vielen kurzen Kameraeinstellungen.

## [0.47.0] - 2026-11-20

### Added

- Review: „Review starten“ in der Clipliste – Clips nacheinander im Export-Bildausschnitt ansehen und mit 1 (Freigeben), 2 (Zur Prüfung), 3 (Verwerfen) entscheiden; Leertaste spielt ab, N/P wechselt, E öffnet den Editor. Entscheidungen bleiben gespeichert; „Verwerfen“ löscht nichts.
- Getrennte Angaben je Clip: KI-Prüfung (geprüft / bitte prüfen / nicht bestanden / keine), deine Freigabe und die Lernbewertung (Daumen) – mit Hinweis, wenn ein Clip seit der Freigabe verändert wurde.
- Clipliste: Filter (Alle, Offen, Bitte prüfen, Freigegeben, Verworfen), Quellzeit und erster Prüfbefund auf den Karten, „Freigegebene exportieren“.
- Editor: zurück zum Review, vorheriger und nächster offener Clip; Prüfung vor dem Export (fehlende Quelle, Einstellungen ohne Person mit Sprung zur Stelle, Länge, fehlende Untertitel, verworfen).
- Werkzeuge: Live, Werkbank, Lernen, Modelle und Testlab gesammelt unter einem Punkt.

### Changed

- Fortschritt: Phasen zeigen erledigt / läuft / ausstehend statt geschätzter Prozente; Zähler nur, wenn die Engine sie wirklich meldet (z. B. „7 von 10“); vergangene Zeit und Restzeit als Spanne; „Transkript bereit“ und vorläufige Clips, sobald sie wirklich vorliegen. Ein kleiner Laufstatus unten links bleibt auf jedem Bildschirm sichtbar.
- Navigation: Start · Projekte · Exporte & Upload · Vorlagen · Live · Werkzeuge · Einstellungen.
- Editor: Untertitel zuerst mit Größe, Position und Hervorhebungsfarbe; alle übrigen Regler unter „Erweitert“.
- „Stoppen & behalten“ heißt jetzt „Beenden, Ergebnisse behalten“; „Verwerfen“ fragt nach.

## [0.46.0] - 2026-11-20

### Changed

- Gemeinsamer Stand für Windows und Mac: Design- und Bedienänderungen gelten auf beiden Systemen (u. a. Verarbeitung mit einer einzigen Restzeit und Überschrift „Clips werden erstellt …“, Editor-Layout, Twitch-Zeitbereich zum Ziehen, Download pausieren/abbrechen mit Restzeit, Projektstatus).
- Windows zeigt nur seine eigenen Engines (1–4); Mac-Engine, Mac-Modelle und Mac-Optionen sind unter Windows nicht sichtbar und können auch nicht gestartet werden.
- Patch Notes zeigen nur, was das eigene System betrifft.

### Fixed

- Projekt öffnen zeigte manchmal die Clips des zuletzt bearbeiteten Projekts.
- Updates unter Windows: Die neueste Version hatte keine Windows-Update-Datei, Windows fand daher kein Update.

## [0.45.0] - 2026-11-20

### Added

- Fehlerprotokoll: Die App schreibt alles mit – Meldungen und Fehler der App und der Oberfläche, jeden Job-Schritt (Start, Stufe, Fehler mit FFmpeg-Fehlerzeile). Jede Sitzung bekommt eine eigene Datei (die letzten 30 bleiben).
- „Fehlerbericht exportieren“ (Einstellungen → System, und direkt bei einem fehlgeschlagenen Export im Editor): Systeminfo (Version, Windows, GPU, FFmpeg-Versionen, Export-Encoder) und die letzten Sitzungen als Textdatei in Downloads.
- Automatischer Upload der Logs ins private GitHub-Repo (logs/<Rechner>/), sobald dort Repo und Token eingerichtet sind (Einstellungen → Konten → Bewertungen). Abgeschlossene Sitzungen werden beim nächsten Start hochgeladen.

### Changed

- Verarbeitung: eine einzige Restzeit für den ganzen Lauf (keine zweite, widersprüchliche Zahl mehr); Überschrift „Clips werden erstellt …“ statt „Transkribiert …“; die veraltete Zeile „Rendern – folgt …“ ist weg.
- Engine Mac: Kamerawechsel werden parallel zur Clipsuche erkannt, es werden nur noch so viele Kandidaten angesehen wie geplant, kürzere Beobachtungen.
- Mac: nur noch Engine Mac wählbar, der Engine-Umschalter erscheint nur, wenn es mehr als eine Engine gibt.

### Fixed

- Projekt öffnen zeigte manchmal die Clips des zuletzt bearbeiteten Projekts.
- Falsche Warnung „Für Engine Mac fehlt …“ (die Modellprüfung nutzte immer Engine 2).

## [0.44.0] - 2026-11-19

### Changed

- Engine Mac: Schnittpläne aus ganzen Sätzen (Satznummern statt Zeitstempel), das Ende reicht bis zur Mitte der Pause – kein angeschnittenes Wort vom nächsten Satz.
- Engine Mac: Clips werden schon während der Schnittplanung im Hintergrund gerendert; lehnt die Prüfung Clips ab, rücken die nächsten geplanten Clips der Rangfolge nach (eine Runde, im Zeitbudget).
- Engine Mac: „nicht eigenständig verständlich“ allein lehnt einen Clip nicht mehr ab, er wird zum Prüfen markiert. Abgelehnt wird bei fehlender Pointe, fehlendem Kernereignis oder drei Kernfehlern.
- Engine Mac: Reparaturen nur noch für Ende und Leerlauf (andere Reparaturen haben im Test nie geholfen und kosteten Minuten).

## [0.43.1] - 2026-11-19

### Changed

- Engine Mac schneller: Rendern und Prüfen der fertigen Clips laufen überlappend, Qwen3.5 rechnet den gleichbleibenden Teil der Anweisung nur einmal (Zwischenspeicher), kürzere Prompts, Schnittpläne nur für die aussichtsreichsten Kandidaten, Kandidaten in einem 30-s-Paket.
- Engine Mac: Cold Opener aus beobachteten Reaktionen; Untertitel beginnen nach dem Vorspann in einer neuen Zeile.

### Fixed

- Engine Mac: Eine Reparatur, die schlechter bewertet wird als vorher, ersetzt die geprüfte Vorversion nicht mehr.
- Engine Mac: abgeschnittene Beobachtungen (zu wenig Antwortlänge) und doppelt angesehene Kandidaten.

## [0.43.0] - 2026-11-19

### Added

- Engine Mac neu: LFM3-Omni sieht und hört jeden Kandidaten und später den fertigen Clip (Bilder + Ton, in 30-s-Paketen, ganze Tonlänge), Qwen3.5 plant die Schnitte nur an gemessenen Kanten, vergibt Titel, ordnet alle Vorschläge im direkten Vergleich und prüft den fertigen Clip. Unklare Kriterien gelten als „prüfen“, nie als bestanden. Höchstens eine Reparatur je Clip; Gemma 4 nur noch für einzelne ungelöste Fragen.
- Fortschritt der Engine Mac mit echten Zählern („Clip 3 von 6 rendern“, „Kandidat 4 von 10 ansehen und anhören“) und Restzeit aus der verbleibenden Arbeit.
- Cold Opener (Erstellen-Dialog, Standard aus): ein starker Moment des Clips wird beim Export 1–5 s vorangestellt, danach läuft der Clip von Anfang an.
- AV1-Videos: einmalige Analyse-Kopie (H.264 über die Mac-Hardware), damit nicht jeder Schritt das langsame AV1 neu entpackt.

### Changed

- Engine Mac ersetzt den bisherigen Mac-Ablauf (Engine 4 mit Gemma); Windows-Engines unverändert.
- Zeitlimits und Abbrechen beenden den Modellprozess wirklich (keine weiterrechnende GPU).

## [0.42.1] - 2026-11-18

### Added

- Downloads: Restzeit und Tempo während des Herunterladens; Download pausieren/fortsetzen (Mac) und abbrechen (bereits geladene Teile werden gelöscht).
- Twitch: VODs, deren Stream noch läuft, sind markiert („läuft noch“); „Ganzes VOD“ lädt dort alles bis jetzt.

### Fixed

- Downloads liefen nach dem Beenden der App weiter und konnten mehrfach in dieselbe Datei schreiben; jetzt werden sie beim Beenden gestoppt, doppelte Downloads hängen sich an den laufenden an, Reste einer alten Sitzung werden beim Start beendet.
- „Ganzes VOD“ eines laufenden Streams nahm den Livestream bis zum Streamende auf (Download endete nie).

## [0.42.0] - 2026-11-18

### Added

- Engine Mac (nur Apple Silicon): eigene Clip-Auswahl für den Mac – Apple-Tonanalyse (Lachen, Jubel, Rufen), Bildsuche auf der Mac-GPU und Gemma 4, das jeden Kandidaten sieht und hört, Schnitte wählt und den fertigen Clip prüft. Modelle laufen nacheinander, damit 16 GB reichen. Auf dem Mac stehen Engine 1, 2 und Mac zur Wahl, unter Windows wie bisher Engine 1–4.
- Twitch: Zeitbereich eines VODs per Leiste ziehen – zwei Griffe mit Zeitanzeige, Raster 1/5/10 Minuten, Pfeiltasten.
- Projekte: Karten zeigen „Noch nicht analysiert“ bzw. „Wird analysiert …“, solange es noch keine Clips gibt.

### Changed

- YouTube-Downloads kommen bevorzugt als H.264: AV1 wird auf M1/M2-Macs nur per Software entschlüsselt und machte Bildschritte bis zu 100-mal langsamer.

### Fixed

- Engine 4: Clip-Titel waren manchmal der Platzhalter aus der Modellanweisung („Kurzer deutscher Titel“).
- Engine 4: Fällt die Sprach-Suche komplett aus, gilt der Lauf als unvollständig statt fertig.

## [0.41.0] - 2026-11-18

### Added

- Mac-Version (Apple Silicon): Shortme läuft jetzt auch auf dem Mac – gleiche App, gleiche Projekte, LLM über Metal.
- Mac: Streamlink richtet sich beim Einrichten von selbst ein (ohne Homebrew).
- Fehlende Modelle lädt die App beim Start still nach; nach Netzabbruch geht der Download weiter.
- Twitch: Für jedes VOD wählbar – ganzes VOD oder nur ein Zeitbereich (vorher nur bei VODs über 1 Stunde).

### Changed

- Versionsnummer steht jetzt oben neben „Shortme“.
- Editor nutzt die Breite besser (weniger Rand rechts).
- Qwen3-8B (kleinere Rechner) wählt Clips aus dem ganzen Video statt nur aus dem Anfang.

### Fixed

- Editor: Knöpfe „Satz verlängern“, „Satz kürzen“ usw. brechen bei kleinem Fenster nicht mehr um.
- Editor: dünnere Trimm-Griffe; Scroll-Balken bleiben in den runden Ecken; „Exportieren“ wird oben nicht mehr abgeschnitten.

## [0.40.1] - 2026-11-18

### Fixed

- Editor: Zeitanzeige zählt ab Clipbeginn (nicht ab dem Puffer davor); der Abspielkopf startet am Clipbeginn, auch wenn das Quellvideo fehlt.

## [0.40.0] - 2026-11-18

### Added

- Live: Beim Eintippen prüft die App den Twitch-Kanal – gibt es ihn, ist er gerade live (mit Stream-Titel)? „Puffer starten“ geht nur bei einem Kanal, der sendet.

### Changed

- Live: Gesicherte Aufnahmen werden nur als Projekt angelegt, nicht sofort analysiert. Beim Öffnen des Projekts erscheint der Start-Dialog (Engine, Profil, Format) – „Clips finden“ startet Transkription und Analyse.
- Projekte ohne Clips öffnen beim Anklicken den Start-Dialog (vorher passierte nichts).

## [0.39.0] - 2026-11-18

### Changed

- Live: „Stoppen & sichern“ beendet die Aufnahme und sichert alles bis dahin Aufgenommene als Projekt (inkl. Analyse). „Verwerfen“ beendet ohne Sichern (mit Rückfrage).
- Live: Während einer Aufnahme leuchtet das ganze Live-Symbol in der Navigation rot.
- Editor: Transkript-Spalte breiter und ruhiger gesetzt; beim Öffnen springt sie zum Clipbeginn.

## [0.38.0] - 2026-11-18

### Added

- Editor: Die Zeitleiste zeigt 60 Sekunden vor und nach dem Clip – Start und Ende lassen sich in beide Richtungen ziehen (früher anfangen, später aufhören).
- Editor: Bereich in der Mitte löschen – „Ab hier markieren“, zur Endstelle spulen, „Bis hier löschen“. Gelöschte Bereiche sind in der Zeitleiste markiert; ein Klick stellt sie wieder her.

### Changed

- Fenster-Hintergrund: echter Glas-Effekt (Windows-Acrylic) statt eines festen Hintergrundbilds.
- Projekte: „Auswählen“ steht oben rechts neben der Überschrift.

### Fixed

- Clip-Karten: Bewertungsknöpfe überlappen Titel und Dauer nicht mehr.
- Lerndaten: Clips von Engine 3 und 4 werden mit ihrer richtigen Engine gespeichert (vorher als Engine 2).

## [0.37.0] - 2026-11-18

### Added

- Projekte: „Auswählen“ markiert mehrere Projekte per Klick (Schnellauswahl „Alle“ und „Letzte 30 Tage“) und löscht sie auf einmal – wahlweise mit den eigenen Originaldateien. Projekte, die gerade verarbeitet werden, bleiben erhalten.

## [0.36.1] - 2026-11-18

### Fixed

- Export: Scheitert das Einblenden des Titels, wird der Clip ohne Titel exportiert statt gar nicht; die Meldung am Ende nennt den Grund.
- Export: Fortschritt läuft während des Renderns weiter (stand vorher lange bei 10 %); FFmpeg wartet nicht mehr auf Tastatureingaben.
- Fehlermeldungen von FFmpeg zeigen die eigentliche Fehlerzeile statt der Stream-Infos.
- Projekte: Ein Projekt, das gerade verarbeitet wird, öffnet beim Anklicken die Fortschrittsanzeige (vorher passierte nichts).

## [0.36.0] - 2026-11-18

### Fixed

- Export: Auf Rechnern mit älterem FFmpeg (z. B. eigenes GPU-FFmpeg) brach der Export mit „Unrecognized option '/filter_complex'“ ab. Der Filtergraph geht jetzt direkt an FFmpeg, das versteht jede Version.

### Changed

- Engine 4 rendert schneller: Der nächste Prüf-Clip wird schon gerendert, während der aktuelle bewertet wird, und der Bildausschnitt wird nicht mehr zweimal berechnet.

### Added

- Werkzeuge für die Qualitätsmessung gegen echte Creator-Shorts (`scripts/quality-eval.mjs`, `scripts/quality-batch.cjs`).

## [0.35.0] - 2026-11-17

### Added

- Laufzeit: Nach jeder Analyse steht in der Clip-Übersicht, wie lange der ganze Lauf gedauert hat (Transkription bis fertige Clips); beim Darüberfahren die Zeit je Schritt.

### Changed

- „Automatisch“ liefert ab 10 Minuten Material mindestens 10 Clips zur Auswahl (vorher etwa einen je 2,5 Minuten).
- Engine 4 ist schneller: doppelte Ereignisse werden vor dem Schneiden aussortiert, weniger Schnittprüfungen je Ereignis, weniger verworfene Modellantworten. Gemessen: 160 statt 254 Sekunden je Clip.

## [0.34.1] - 2026-11-17

### Fixed

- Engine 4: Clips mit großem gemeinsamem Abschnitt kommen nicht mehr beide in die Auswahl.
- Engine 4: Grafikkarten mit zu wenig Speicher für MiniCPM-o brechen sofort mit klarer Meldung ab, statt stundenlang in den Arbeitsspeicher auszulagern.
- Herkunftsansicht zeigt bei Reparaturen den Schnitt vorher und nachher.

## [0.34.0] - 2026-11-17

### Added

- Engine 4 (Beta): sucht über vier Spuren (Sprache, Ton, Bild, Bild+Text-Embedding), prüft jeden Kandidaten mit MiniCPM-o in Bild und Ton nach, setzt Schnitte nur an gemessenen Kanten (Satz, Pause, Bildwechsel), rendert 2–3 Varianten, bewertet das fertige Video und repariert bis zu zweimal. Vierter Schalter im Erstellen-Dialog und in der Clip-Liste.
- „Herkunft“ an Engine-4-Clips: zeigt Fundspuren, Modellaufrufe und Bewertungen des Clips.
- Engines vergleichen mit bis zu vier Läufen (A–D), Clip-Recheck auch mit Engine 4.

### Fixed

- Export: Titel mit Apostroph oder Komma brachen den Export ab; sehr lange Titel überschritten die Windows-Pfadgrenze; Videos ohne Tonspur ließen sich nicht exportieren.
- MiniCPM-o: Speicherverbrauch wuchs mit jedem Aufruf; Clips ohne Ton scheiterten; abgeschnittene Antworten bei langen Ausgaben.

## [0.33.0] - 2026-11-15

### Added

- Engine 3 (Adaptive AI, Beta): sucht per Bild-Embedding (Qwen3-VL-Embedding-2B, lokal) über das ganze Video, mit Profilen Schnell/Ausgewogen/Gründlich. Dritter Schalter im Erstellen-Dialog und in der Clip-Liste. Braucht die Python-Laufzeit (Knopf „Python-Laufzeit installieren") und das Modell (ca. 4,3 GB, Modell-Manager).
- Engine 3 prüft Ereignisse jetzt mit MiniCPM-o (Bild und Ton gemeinsam) und sucht zusätzlich mit Lighthouse (zeitliche Verortung). Dafür eine zweite Python-Umgebung und zwei Modelle (ca. 19 GB), die App installiert die Umgebung selbst, die Modelle kommen aus dem Modell-Manager.
- Engines vergleichen: gemeinsame Quellzeit-Wiedergabe und Einzelwiedergabe, Re-Analyse des Originals mit anderer Engine, Clip-Recheck getrennt von der Analyse, blinde Bewertung als Variante A/B/C.
- Engines vergleichen (Grundfunktion): Ergebnisse mehrerer Läufe desselben Videos Ereignis für Ereignis zuordnen, blind bewerten (A/B/C), Zuordnung per Hand trennen/zusammenführen.

## [0.32.0] - 2026-11-14

### Added

- Neue Auswahl-Engine (Beta): schaut sich Bild und Ton wirklich an (Qwen3-VL und Voxtral, lokal), sucht über das ganze Video, plant Schnitte und vergleicht die Vorschläge. Umschalter im Erstellen-Dialog und in der Clip-Liste neben „Neu berechnen“; die bisherige Engine bleibt unverändert und ihre Ergebnisse bleiben erhalten. Die zwei neuen Modelle (ca. 6,5 GB) werden im Modell-Manager geladen.
- Klar sichtbar, welche Engine läuft und angezeigt wird (farbiges Kennzeichen in Clip-Liste und Fortschrittsanzeige, „Neue Engine“ an den Clips) und ob die Modelle der neuen Engine installiert sind.
- Neuer Hintergrund „Schwarz“ (Einstellungen → Allgemein → Darstellung) neben dem transparenten Glas-Look.
- Editor: Untertitel lassen sich in der Vorschau per Ziehen vertikal verschieben (wie die Überschrift); die gesetzte Position gilt auch im Export.
- Editor: automatische Kürzungen der neuen Engine lassen sich zurücknehmen und wieder anwenden (mit Rückgängig).

### Fixed

- Editor-Vorschau: Beim Abspielen wird der Ausschnitt jetzt zusammen mit jedem Videobild gezeichnet, sodass das erste Bild einer neuen Szene nie mehr kurz den Ausschnitt der vorigen Person bekommt.
- Podcast mit Kamerawechsel zwischen den Sprechern: Personen werden jetzt getrennt erkannt (vorher wurden beide zu einer Person zusammengezogen). Der Bildausschnitt wechselt genau auf dem Schnitt zur jeweiligen Person; vorher war am Schnitt kurz der Ausschnitt der anderen Person zu sehen (Leerfläche), und bei schnellem Hin und Her landete der Ausschnitt zwischen den Personen.
- Neue Engine bei Gesprächen: Aussagen und Geschichten bekommen mehr Kontext (mindestens 28 s, Pointen 22 s).
- Facecam verschieben: gilt jetzt standardmäßig nur für die aktuelle Szene; bei „Ganzer Clip“ bleiben Szenen mit eigener Facecam (andere Person/Position) unberührt. Neuer Knopf „Facecams pro Szene erkennen“ im Editor erkennt die Facecam jeder Szene eines schon berechneten Clips neu.
- Facecam-Ausschnitt: Kopffreiheit bleibt, überstehender Rand wird vor allem unten abgeschnitten statt über dem Kopf.
- Bewertungsfenster (Daumen) mit den Gründen schließt nicht mehr, bevor man es anklicken kann.
- Restzeit-Anzeige springt nicht mehr (10 → 45 Minuten): die neue Engine hat eine eigene Zeitschätzung und meldet ihren Fortschritt gleichmäßig je Stufe.
- Streams mit wechselnder Facecam: Wechselt der Stream auf die Ansicht eines anderen Streamers, wird dessen Facecam erkannt und genauso eingebunden (Facecam + Gameplay) statt als Smart-Ausschnitt ohne Facecam (gilt für neu berechnete Clips).
- Layout-Wechsel (z. B. Vollbild ↔ Smart) sitzen jetzt exakt auf dem Videoschnitt statt ein Bild später: Schnittzeiten werden an den echten Bildern nachgemessen, und die Wechsel rasten darauf ein (gilt für neu berechnete Clips).
- Der Wechsel zwischen Bisheriger und Neuer Engine zeigt vorhandene Ergebnisse sofort an, statt neu zu rechnen. Geänderte Optionen wirken erst bei „Neu berechnen“.

### Changed

- Facecam + Gameplay: Die Überschrift am Anfang erscheint jetzt in der Mitte an der Naht zwischen Facecam und Gameplay (nicht mehr oben im Bild). Die Untertitel rutschen dann knapp darunter. Selbst gesetzte Positionen bleiben unverändert.
- Alle Seiten nutzen die Fensterbreite (Spalten passen sich an, bei kleinem Fenster einspaltig). Einstellungen sind in vier Bereiche gegliedert (Allgemein, Modelle & Updates, Konten & Dienste, System).
- Clips werden je Lauf getrennt gespeichert; Bewertungen und Lernen merken sich Engine und Lauf.

## [0.31.0] - 2026-11-13

### Added

- Patch Notes in der App: Nach einem Update erscheint einmal „Neu in Version …“; die letzten Versionen stehen jederzeit in den Einstellungen unter „Patch Notes“.

### Fixed

- Export schlug auf Rechnern mit älterem FFmpeg fehl („Unrecognized option '/filter_complex'“). Der Export weicht jetzt automatisch auf die ältere Schreibweise aus.
- Das Einrichtungsfenster für die Modelle erscheint nur noch beim allerersten Start. Fehlende Modelle zeigen weiter die Einstellungen und die Seite „Modelle“ mit „Alles laden“.

## [0.30.0] - 2026-11-12

### Added

- Bewertungskatalog über GitHub: Bewertungen (stark/mittel/schlecht + Gründe) werden in ein privates Repo abgeglichen und auf allen Rechnern zusammengeführt (Einstellungen → „Bewertungen teilen“, Anleitung in docs/CATALOG.md). Bewertungen zu Videos, die es auf einem Rechner nicht gibt, zählen im Lernbereich mit.

## [0.29.0] - 2026-11-12

### Added

- Rechtsklick auf ein Projekt: „Link kopieren“ (bei lokalen Dateien „Dateipfad kopieren“) und „Neu analysieren“ (mit dem bisherigen Inhaltstyp; fehlt das Quellvideo, wird es bei Links neu geladen).
- Lange Videos: Bis zu 30 % der Kandidaten kommen allein aus Ton- und Chat-Spitzen (Lachen, Applaus, Lautstärke, Chat), unabhängig vom Transkript – für Stellen, die im Text flach wirken. Ab dem 13. Clip nur noch Clips über dem Median der Bewertungen, mindestens 90 s Abstand.

### Fixed

- Facecam bei Streams wurde oft nicht erkannt (mittiger Ausschnitt, Person fehlt oder verschoben): Das kleine Facecam-Gesicht bewegt sich mit dem Kopf, die Erkennung verlangte aber 50 % Überdeckung der Gesichtsrahmen. Jetzt zählt der Abstand der Mittelpunkte relativ zur Gesichtsgröße.

## [0.28.0] - 2026-11-11

### Added

- Dauer der Analyse: vor dem Start „Dauer etwa …“ (nach Videolänge und Clip-Anzahl), während des Laufs „Noch … Min“. Die Schätzung lernt aus dem letzten kompletten Lauf auf diesem Rechner.
- Clip-Anzahl bis 50 wählbar (vorher 30).
- Nach dem Export steht der Zielpfad in der Leiste (Clip-Liste und Editor); Fehler beim Export werden im Editor angezeigt.

### Fixed

- Fortschrittsbalken: Themenkarte und Untertitel-Prüfung fehlten in der Anzeige, der Balken sprang dort auf etwa 3 % zurück. Der Balken ist jetzt nach der echten Dauer der Stufen gewichtet (bei langen Videos dauern Kamerawechsel und Bewertung am längsten).

## [0.27.0] - 2026-11-11

### Fixed

- Lange Videos (VODs, Podcasts): Von den gefundenen Kandidaten wurden nur die ersten behalten, das Ende des Videos kam nie dran (bei einer 1,8-h-Folge lagen alle Kandidaten in der ersten Hälfte). Die Kandidaten werden jetzt gleichmäßig über das ganze Video verteilt.

### Added

- Bis zu 50 Clips (vorher 30) und bis zu 90 bewertete Kandidaten (vorher 48); die automatische Zahl bleibt etwa ein Clip je 2,5 Minuten.
- Kandidatensuche sucht gezielt nach spontanen Einlagen (Rappen, Imitationen, Rollenspiel, Ausraster) und verteilt die Treffer über das ganze Transkript.
- Einstellungen: Zielordner für Exporte wählbar (vorher fest `Videos\Shortme`), „Standard“ setzt zurück.

## [0.26.2] - 2026-11-11

### Fixed

- YouTube-Import ohne Anmeldung: yt-dlp lief ohne JavaScript-Laufzeit (nur eine Warnung, die wir unterdrückt haben) und bekam dadurch schneller die „Bot-Prüfung“. Es nutzt jetzt die mitgelieferte Node-Laufzeit; bei einem yt-dlp-Fehler wird wie früher einmal selbst aktualisiert und wiederholt. Die Anmeldung bleibt nur der letzte Ausweg.
- `npm run release` nutzt die Repo-Route der GitHub-API (die `gh release create`-Route liefert 404).

## [0.26.1] - 2026-11-11

### Fixed

- Parakeet-Download schlug mit „SHA-256 stimmt nicht überein“ fehl, weil das Archiv bei k2-fsa am 07.11. neu hochgeladen wurde; neue Prüfsumme eingetragen (Modell mit Wortzeiten getestet).
- Fehlt das Transkriptionsmodell, meldet der Job das jetzt klar statt „Please check your config!“.
- YouTube-Links mit „Bot-Prüfung“: Einstellungen → „YouTube-Anmeldung“ (Firefox oder cookies.txt), gilt für Import und Werkbank; die Meldung nennt den Weg auf Deutsch.

## [0.26.0] - 2026-11-10

### Added

- Einstellungen: Updates aus GitHub (suchen, laden, neu starten) und Hinweis auf fehlende Modelle mit „Alles laden“.
- `npm run release` baut den Installer und lädt ihn als GitHub-Release hoch (`Andirectly/shortme`).

## [0.25.1] - 2026-11-01

### Added

- Upload: Zugangsdaten (Client key/secret) nachträglich ändern; die alte TikTok-Verbindung wird dabei getrennt.

## [0.25.0] - 2026-11-01

### Added

- Tab "Upload": exportierte Clips als TikTok-Entwurf senden (Anmeldung im Browser, Tokens in der Windows-Anmeldeinformationsverwaltung, Teilstück-Upload mit Fortsetzen, Tageslimit, Bildunterschrift und Hashtags vom lokalen LLM).
- Editor: Schnellwahl des Ausschnitts oben (Smart/Fest/Vollbild/Split).

## [0.24.0] - 2026-11-01

### Added

- **Clips erscheinen fortlaufend**: Die Übersicht öffnet sich beim ersten fertigen Clip, unfertige sind ausgegraut mit Prozentwert und noch nicht anklickbar.
- Editor: Lautstärkeregler (nur Vorschau, nicht im Export).
- **Testlab-Schalter** wirkt auf die Pipeline: aus = nur Standard-Modelle.

### Changed

- Ohne klaren Sprecher springt der Ausschnitt nie mehr in die Bildmitte: sichtbare Person verfolgen, bei zwei getrennten Personen Split, sonst Vollbild.
- "Vollbild" = ganzes 16:9 im Hochformat; "Fest" = fester Mittelausschnitt.

## [0.23.0] - 2026-11-01

### Added

- **Twitch**: VOD-, Clip- und Kanal-Import, "Letzte Minuten" eines laufenden Streams, Live-Puffer, Erkennung stummer Abschnitte, optionaler Token und Chat-Signal.
- **Inhaltstyp** (Podcast, Vlog, Solo, Stream, Vortrag) mit Profilen und automatischem Vorschlag; Layout **Facecam + Gameplay** mit Erkennung, Rahmen im Editor und Kanal-Layouts.
- **Transkript-Lücken** werden gesucht und gefüllt; Testlab-Plätze "Clip-Transkription" und "Clip-Auswahl (LLM)" (Qwen3.8 27B, Qwen3-ASR als Kandidaten).
- **Sicherheitsnetz**: ohne Person im Ausschnitt wechselt der Abschnitt automatisch auf Vollbild (im Editor markiert).
- Editor: Lautstärkeregler (nur Vorschau); Versionsanzeige unten links.

### Changed

- "Vollbild" heißt jetzt das ganze 16:9-Bild im Hochformat (vorher "Ganzes Bild"); der feste Mittelausschnitt heißt "Fest".

## [0.14.0] - 2026-10-13

### Added

- **OpenRouter** is now a connection in first-run setup and Settings. Add an OpenRouter key (encrypted with your system keychain), then pick the clip-finding model from OpenRouter's full model list. The list is searchable, suggests models at the top, and shows prices, context size and image support. Transcription can use local Whisper on your computer or one of OpenRouter's Whisper models (Whisper, Whisper Large v3, Whisper Large v3 Turbo). These are the only OpenRouter transcription models that return the per-word timestamps captions need, so other transcription models aren't offered. **Check key** validates the key without making a model request.
- OpenRouter transcription sends five-minute audio chunks so each request finishes inside OpenRouter's 60-second limit. A reply without word timestamps fails with a message saying what to change, rather than producing captions that can't be timed.

### Improved

- The setup wizard no longer shows the unavailable "Claude subscription" card. Claude models can be used through OpenRouter instead.

### Fixed

- The macOS download no longer opens with "Cutawan is damaged and can't be opened". The app is now ad-hoc signed, so macOS shows its usual unidentified-developer prompt and **System Settings → Privacy & Security → Open Anyway** works. It is still not signed with an Apple Developer ID or notarised. For an earlier release, run `xattr -cr /Applications/Cutawan.app` once in Terminal.

## [0.13.0] - 2026-09-25

### Added

- Optional editorial ranking (beta) reviews retained speech, surrounding context and sampled frames using common hook, clarity, value, payoff and audience-fit criteria. It marks uncertainty, defers repeated ideas, preserves the old ranking for offline comparison, and shows reasons and evidence in the editor. Extra analysis calls are shown before enabling it.
- Optional **Find visual moments (beta)** scans sampled frames across the source before selecting clips, then inspects promising demonstrations, reveals and reactions more closely. It can suggest clips without spoken audio. Completed scans are cached by source content, transcript, provider/model and instructions; failed scans remain retryable.
- Visual discovery reports show successful and failed source sections, sampling gaps and rejected proposals. The scan uses at most twelve additional analysis calls plus provider retries. Sparse frames can miss brief events; this is not continuous-video understanding or a measured improvement in engagement.
- Offline quality comparisons now support blind publishability decisions, measured repair time, severe defects, reviewer coverage and source-separated summaries. Missing clips and missing reviews remain visible, with a protocol for collecting untouched human-labelled holdouts.

### Improved

- Score badges distinguish editorial assessments from legacy scores. Changed source selections require review again; a high score is not presented as a prediction of virality or certification of the export.
- Visual candidates preserve their observed action and crossing speech boundaries, start with conservative framing, and keep pause removal and auto zoom off. Candidates that cannot fit completely are rejected. Final overlap removal runs after visual-payoff repair.

### Validation

- Automated regressions use scripted model responses; they do not establish human preference or superiority over OpusClip. Run the documented human comparison workflow before making those claims.
- A bounded live ChatGPT check exercised editorial review, visual discovery and refinement. The API route was not live-tested. See `docs/provider-smoke.md` for the recorded results and limits.

## [0.12.1] - 2026-09-23

### Fixed

- If Cutawan couldn't restart itself after updating a source checkout, trying again now finishes the update instead of reporting "already up to date".
- On Windows, a Python or other command launcher (such as one from conda) is no longer mistaken for a broken Codex install.
- AI connections that don't support strict JSON output (some local and OpenAI-compatible models) are now told exactly what shape to reply in, and a malformed reply is retried instead of failing.
- A size-limited export that still ends up over the limit now says so plainly.

## [0.12.0] - 2026-09-23

### Added

- Edit clips on the timeline: split at the playhead (S or ⌘K), click a piece and press Delete to cut it, and click a cut to put it back. Pauses that were removed automatically now show on the timeline; click one to keep it.
- Cut words straight from the transcript: drag across them and press Delete or "Cut selection". Cut words are struck through.
- Undo and redo for clip edits (⌘Z / ⇧⌘Z), plus Premiere-style keys: Space or K to play and pause, J and L to step a second, arrow keys to step a frame, and I and O to set the in and out points.
- Split screen for conversations: when two people trade quick turns in the same shot, both are shown, one above the other. Turn it off per clip in the editor.
- The trim bar shows how long the clip actually plays after pauses and cuts.
- "What's new" after each update, and any time from Settings → Updates. When an update is available, you can read what's in it before downloading.

### Improved

- Clips appear as soon as they're found. Framing for the top clips finishes in the background, marked "Framing…" on each card.
- Following the speaker is about 40% faster, and close-ups where a face fills the frame are now recognised.
- Steadier framing: the crop stays still while the speaker stays near the centre and only moves when they really move, keeping faces centred more reliably.
- Pause removal only cuts where there's actual silence, so it no longer clips the ends of words, laughter or the other person's reactions. Filler words such as "um" are still removed.
- Much faster exports on Apple Silicon Macs, which now use the built-in hardware encoder at the same quality. Split-screen and layout exports are faster on every computer.
- Faster local transcription on Apple Silicon Macs. Re-run local Whisper setup in Settings to turn it on.

### Fixed

- Exported videos could be very slightly squashed horizontally in some players.
- Auto zoom stuttered in the editor preview (exports were not affected).

### Validation

- Measurements, failed trials and remaining limits: `docs/speed-and-framing-validation.md`.

## [0.11.4] - 2026-09-21

### Fixed

- Repair rejected screen/presenter source bounds instead of immediately preserving a letterbox. Supply specific geometric feedback and cap source proposals at two per shot; keep existing quality thresholds.
- Ask for a single contiguous presenter panel rather than combining disconnected webcam overlays.
- Add per-clip **Retry automatic layout** for failed automatic results. Preserve manual corrections, join retries before export, and protect successful retries against stale saves and concurrent trim changes.

### Validation and limits

- Repaired and inspected the reported comparison-slide case. The two-webcam email demo still fails content selection; it is explicitly unresolved. See `docs/rejected-layout-repair.md` for all seven requests, failed trials, timings and remaining work.

## [0.11.3] - 2026-09-21

### Improved

- Detect large screen transitions before composing individual shots, avoiding a failed whole-clip layout attempt first.
- Scan content crop edges locally between ordinary review samples. Reused crops request fresh bounds on an alert; fresh proposals add suspect moments to rendered review so incidental editing guides do not force an unnecessary full-frame fallback.
- Use rejected temporal review frames in one bounded region proposal. Keep decoding, image counts, cancellation and scan duration bounded.

### Validation

- 515 tests plus type checking, lint and build. Tested local scan timing and a targeted repair on the original T3.GG recording. Documented the initial false alarm, revised result, timings and remaining limitations in `docs/temporal-layout-validation.md`. Moving panels, faster events and arbitrary-video quality remain unfinished.

## [0.11.2] - 2026-09-21

### Improved

- Let independent layout reviews overlap without occupying local decoding/inference slots while waiting for cloud responses. Bound analysis requests across API and ChatGPT providers separately from local processing.
- Reuse checked screen compositions from the same source as proposals for recurring layouts. Every candidate requires fresh rendered verification; rejected candidates fall back to ordinary analysis.
- Veto reused crops when sampled local pixels indicate a feature cut at the content boundary. Label comparison panels explicitly to reduce confusion between source references and the actual output.

### Validation

- Tested recurring and changing graph content plus three rearranged presenter-corner variants from the original T3.GG footage. A moving-title failure found by inspection drove the edge guard. Measurements, failed trials and remaining limitations are recorded in `docs/layout-reuse-validation.md`; arbitrary-video quality is not established.

## [0.11.1] - 2026-09-21

### Fixed

- Allow up to two independent ChatGPT analysis requests at once on machines with at least 8 GiB RAM; keep daily-budget reservations serialized, ledger writes atomic, and identical requests deduplicated.
- Screen recordings now choose content and presenter regions during the existing visual review and skip dense active-speaker inference. Camera and mixed footage retain speaker tracking. Proposed panels still require rendered verification.
- Changing screen layouts use a low-resolution local scene-change pass and per-section narration. Brief app/dialog transitions stay intact instead of triggering repeated AI requests and flickering crops.
- Enlarge the content area in presenter layouts, with containment margins around automatically proposed content. Avoid treating unrelated application sidebars as essential content.
- Save each completed clip layout immediately. A later cancellation or failed request keeps those results, and later pipeline saves preserve concurrent framing and manual-region edits.
- Automatically revisit older generated letterbox results when opened or exported, without replacing accepted compositions, custom crops or manual source corrections. Preserve the upgrade when an ordinary edit saves during analysis.

### Validation

- Exercised the automatic path on the original T3.GG recording, including a graph, calculator, posts and a graph-to-dashboard change. Recorded timings and remaining limits in `docs/layout-first-validation.md`; these are bounded examples, not a guarantee for arbitrary footage or every machine.

## [0.11.0] - 2026-09-20

### Added

- Compose a separate presenter inset and screen content into a 9:16 clip, regardless of the inset's source corner. Choose content-first, stacked or content-only layouts, or enter source regions manually without an AI connection.
- Review automatic compositions using actual rendered sample frames, with one alternate layout attempt. Reject invalid regions, excessive presenter enlargement and insufficient content enlargement; uncertain results keep the full scene and show a review notice.
- Keep preview and export on the same crop geometry and one video/audio clock. Reserve space for captions and hide hook titles that would cover the presenter.

### Improved

- Bound concurrent face-analysis, composition and export jobs across projects according to available memory and CPU capacity. Limit FFmpeg threads and prioritize queued exports.
- Spill large face-crop collections to temporary files while retaining the speaker model's temporal context. Stop decoders and clean up temporary crops on cancellation or consumer failure.
- Validate export dimensions, duration, audio presence and complete decoding before replacing an existing output file, including downscaled size-limited encodes.
- Evaluate small insets using native-resolution crops, including 4K sources. Region edits at the trim end retain the other shots.
- Preserve manual source-region corrections when background analysis finishes. If a longer trim exceeds their coverage, keep the full scene and show a review notice instead of reverting to a portrait crop. Refresh paused composition previews when decoded frames arrive.

### Validation and limitations

- 484 automated tests, type checking, lint and production build pass locally. Real FFmpeg tests cover all four inset corners, timed layout switching, single audio output and failed-export preservation. Native Electron checks cover paused preview, manual creation, layout changes, saved corrections, playback, seeking and resizing.
- AI decisions are mocked in automated tests; sampled model review does not certify every frame or editorial quality. Moving/resizing insets, broad category benchmarks and audience-retention improvements remain unproven. Existing completed clips are not automatically reanalysed.
- See [implementation status and remaining work](docs/adaptive-clipping-status.md). The broader adaptive-clipping roadmap remains in progress.

## [0.10.3] - 2026-09-20

### Fixed

- Isolate native face and speaker inference in a child process, and process speaker-model inputs in bounded batches to reduce Mac memory spikes and keep native inference failures from closing the editor.
- Bundle an Apple Silicon native ffprobe and fix audio channel-layout negotiation during Mac exports.
- Prevent update restarts while saves, imports, analysis or exports are active, and show installation failures with a retryable action.

### Improved

- Check for updates on launch and every six hours, with retries after failed checks or reconnection. The toolbar opens Updates directly and shows download progress and readiness.
- Download and SHA-256 verify the correct Mac installer inside the app, with cancel, retry, cached-download recovery and an Open installer action. Mac releases remain unsigned: quit Cutawan and replace the app in Applications to finish; saved projects and settings remain separate.
- Keep update download state in the main process so closing and reopening the window does not lose progress. Windows/Linux installation requires an explicit restart.
- Build and verify all platform installers and update manifests before publishing a release. Verify uploaded installer checksums before making the draft public.

### Validation and requirements

- Unit tests, type checking, lint, packaged Mac inference/export checks and update UI checks passed locally. A real GitHub Mac installer download passed size and checksum verification.
- A full 86-second speaker-analysis segment completed in the isolated worker with a measured peak of approximately 272 MB.
- Mac builds target Apple Silicon and are not Developer ID signed or notarized. Windows/Linux installer replacement still requires an actual old-to-new upgrade test; library lifecycle tests do not replace that validation.

## [0.10.2] - 2026-09-19

### Fixed

- Detect the Codex CLI in the standalone install location on macOS/Linux even when the desktop app does not inherit the terminal's `PATH`; show an actionable path hint if it still cannot be launched.
- Preserve the first-run setup choice across refreshes and check saved local Whisper files so an existing installation is shown as ready instead of appearing to need another download.

## [0.10.1] - 2026-09-19

### Fixed

- Give the first-run wizard a fully opaque backdrop and a solid, bordered panel so setup options remain readable over the app, including on macOS with window vibrancy enabled.

## [0.10.0] - 2026-09-19

### Added

- A first-run setup wizard for ChatGPT sign-in through Codex, an OpenAI-compatible API, or local-only full-video captions. Existing installations keep their settings and skip onboarding.
- In-app local Whisper setup: after Python 3.10+ is installed, Cutawan creates a private environment, installs faster-whisper, and downloads a Small or Large v3 model on request. Setup can be cancelled, retried, and checked without making an AI request.
- Optional local Whisper transcription alongside API-based clip analysis, so API users can keep speech recognition on their computer.

### Changed

- Full-video captions can now be transcribed and exported without an API key when local Whisper is configured. AI clip finding still requires ChatGPT/Codex or an API connection.
- Onboarding explains that Claude subscriptions are not connected to third-party apps through a personal login; Cutawan does not route automated requests against Claude subscription limits.

### Validation and requirements

- 440 tests, typecheck, lint, and the production build passed during release preparation. Project saves now replace JSON atomically, so background readers cannot encounter a half-written file.
- Local Whisper setup requires a separately installed Python 3.10+ and a model download from Hugging Face. The ChatGPT route additionally requires an installed Codex CLI signed in with ChatGPT. The model download itself was not exercised in the test environment.

## [0.9.0] - 2026-09-19

### Improved

- Preserve speech endings and visual demonstration payoffs, and recover omitted speech at long-video transcription joins.
- Improve small-face detection and speaker framing, with conservative layouts when tracking evidence is weak.
- Add shot-specific framing and enlarged screen-detail layouts with consistent preview/export timing.
- Reject incomplete or incoherent clip candidates based on retained content.
- Fix composition analysis for still frames and rotated video.

### Added

- Optional **ChatGPT subscription via Codex (beta)** for analysis, with local Whisper transcription. Requires an installed, signed-in Codex CLI, Python with faster-whisper, and a downloaded speech model; see [setup instructions](https://github.com/JeremySNR/cutawan/blob/main/docs/chatgpt-subscription.md).
- Luna with low reasoning as the subscription default, cached analysis, configurable daily request limits, and no automatic paid-API fallback.

### Validation and known limitations

- 430 tests and CI checks pass. The resumed public-corpus run produced 23 exports; packaged Windows export and copied-project compatibility checks passed.
- Existing projects remain usable. Saved transcripts and completed framing are not automatically regenerated.
- Some slides remain too small, moving speakers can reach crop edges, repeated selections and caption errors remain possible. Review clips before publishing. This release does not claim OpusClip parity.

## [0.8.0] - 2026-09-06

### Changed

- **Clip boundaries are chosen on sentences.** The model now reads the
  transcript as one sentence per line (derived from word punctuation, with
  unpunctuated rambles split at their longest pauses) instead of Whisper's
  segments, which break mid-sentence, and is told to start and end every clip
  on a line. The ending and opening reviews work on the same sentences. When
  a start still lands inside a sentence, the clip opens that sentence rather
  than skipping to the next; an end inside a sentence completes it.
- **Tightened clips keep their tails.** Removing pauses used to trim the room
  after the last word down to 0.3 s, so the export's 0.4 s fade ducked the
  final syllable. Tightening now keeps 0.7 s after the last word and 0.3 s
  before the first.
- **Long videos come back in minutes, not an hour.** Speaker-framing analysis
  (face tracking plus active speaker detection at 25 fps) is the slowest
  per-clip stage by a wide margin. The pipeline now runs it only for the top
  tier of clips (the eight highest-scoring, extended to twelve for scores of
  80 or more) and leaves the rest pending. A pending clip is analysed the
  moment it is opened in the editor, or before it is exported, and the
  editor says so while it waits. The analysis uses the clip's current trim,
  so a clip extended before opening is tracked end to end.
- **Captions lay out by width, not word count.** Groups are broken into lines
  from a per-style character budget derived from the font's measured glyph
  widths and the output aspect ratio, capped at two lines. The same layout
  feeds the preview and the ASS export (which now carries explicit line
  breaks with libass wrapping off), so a caption can no longer wrap
  differently in the file than it did in the editor.
- **Captions hold briefly after a sentence.** A finished group stays up for
  up to 1.5 s, cut short by the next group, instead of leaving an empty frame
  on every pause.
- **Loudness normalisation is two-pass.** Exports measure the clip first and
  apply one linear gain instead of the single-pass gain rider, which pumped
  audibly on speech: through loudnorm's linear mode when the peaks allow it
  (with the range target raised to the measured range, which that mode
  requires), otherwise a plain gain into a true-peak limiter. Falls back to
  single-pass only when the source cannot be measured.

### Fixed

- **The "fit under N MB" field could not be cleared or retyped.** It was bound
  straight to the saved setting, so an empty field snapped back and every
  keystroke rewrote the settings file. It now edits a draft and commits on
  blur or Enter.
- **Exported captions sat higher than the preview.** The ASS style was
  bottom-aligned on the anchor line while the preview centred its block
  there, so two-line captions rendered about half a block too high. Events
  are now positioned middle-centre on the anchor.
- **Whisper hallucinations reached captions and the clip picker.** Segments
  Whisper itself flags as silence (high no-speech probability with
  low-confidence text) or as looped output (high compression ratio) are now
  dropped at stitch time, along with their words, and never primed into the
  next chunk.
- **Words with zero or negative duration never lit up in karaoke captions.**
  Word timings are now made monotonic and given a minimum on-screen duration
  when the transcript is stitched.

### Added

- **`scripts/eval-clips.ts`.** Measures clip boundaries on saved projects
  (mid-sentence opens and closes, clipped or dead-air tails, length spread),
  and with `--rerun` compares them against fresh detection on the same
  transcript, so prompt changes can be checked instead of guessed.

- **"Fit under N MB" export.** A size cap in Settings and the editor export
  panel, so clips land under Discord, email or WhatsApp limits. The encoder
  already knew how; this is the missing control, plus the achieved file size
  (and a note when the planner had to downscale) after export.
- **OpenAI-compatible API endpoints.** Settings now takes a chat base URL
  (Azure, OpenRouter, Groq, LM Studio, Ollama) and an optional separate
  transcription URL, so a local Whisper server can sit next to a hosted LLM.
  Structured-output calls fall back from `json_schema` to `json_object` (and
  then a plain JSON completion) when the provider does not support OpenAI's
  strict schema mode. `OPENAI_BASE_URL` still overrides Settings when set.
- **winget publishing path.** A manifest generator (`scripts/print-winget-manifest.mjs`)
  and a Release workflow job that updates
  [microsoft/winget-pkgs](https://github.com/microsoft/winget-pkgs) once the
  first listing exists. See [docs/winget.md](docs/winget.md).

### Removed

- **The WorkVivo posting integration.** It was specific to one organisation's
  internal comms platform and depended on an undocumented endpoint set, which
  made it an odd fit for a general-purpose tool. Everything it did that was not
  WorkVivo-specific stayed: the size-targeted two-pass encode
  (`src/shared/uploadBudget.ts`) is still here and still tested, and brand voice
  now steers the TikTok/Reels/Shorts post captions rather than only the internal
  ones.

### Changed

- Brand voice settings (name, tone, style, things to avoid) now feed the AI post
  caption writer. Previously they only affected the internal posting captions,
  so the setting appeared to do nothing for most users.

## [0.7.0] - 2026-09-02

### Added

- **"Caption the whole video" mode.** A second way to work alongside AI clip
  finding: give it a 16:9 video and it comes back as one vertical, captioned
  edit you can trim, restyle and export, with optional speaker tracking and
  auto zoom. Both modes work on the same project and share the transcript, so
  switching between them never pays for transcription twice.
- **Full-quality WorkVivo uploads.** Clips now upload through the presigned
  flow rather than inline through the Customer API, which rejected anything
  beyond a few megabytes. Needs a one-off browser sign-in in Settings; the API
  remains the fallback.
- **Custom caption fonts.** Upload any TTF or OTF. Families are matched on the
  name embedded in the file rather than the filename, so previews and exports
  agree.
- **Size-targeted rendering.** When an upload has a hard byte cap, the bitrate
  is planned up front and the clip is encoded once to hit it, instead of
  rendering at a quality target and re-compressing afterwards.

### Fixed

- **Burned-in captions rendered at roughly 58% of their intended size.** CSS
  `font-size` sets the em square, but libass sizes text against the font's OS/2
  window ascent plus descent. Em sizes were being passed straight through as
  ASS `Fontsize`. This was the gap between the live preview and the exported
  file.
- Very long edits could build zoom filter graphs large enough to choke ffmpeg.
  Zoom events are now capped per clip.

## [0.6.18] - 2026-08-03

### Fixed

- Black screen after updating from a source checkout, and the app now reports a
  failed relaunch instead of disappearing silently.
- Source updates no longer rebuild when the pull brought nothing.
- `media://` no longer serves `settings.json` or session cookies to the
  renderer.
- Concurrent project saves could lose edits. Writes are now serialised.
- Every OpenAI request has a per-attempt timeout, so a hung connection no
  longer stalls the pipeline indefinitely.

## [0.6.17] - 2026-07-23

### Fixed

- B-roll image search froze the app on restricted networks (#44).

## [0.6.16] - 2026-07-07

### Added

- **Video type selector.** Tell Cutawan what kind of footage it is and it
  steers 9:16 layout and face tracking accordingly.
- Screencasts are detected and letterboxed for 9:16 rather than cropped into
  unreadable text.

### Fixed

- Face tracking now bails out early when it finds no usable faces, instead of
  producing a bad crop.
- Several active-speaker content classification fixes.

## [0.6.15] - 2026-07-07

### Added

- WorkVivo posting, with brand-voiced AI captions and a settings page.

### Fixed

- WorkVivo caption posting and space pagination.
- Empty captions are now respected rather than replaced.

## Earlier releases

0.6.14 and earlier predate this changelog. See the
[releases page](https://github.com/JeremySNR/cutawan/releases) for the
history.
