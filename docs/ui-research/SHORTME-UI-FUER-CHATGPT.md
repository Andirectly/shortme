# Shortme – UI-Überblick für eine UX-Recherche

Stand: Version 0.45 (Entwicklung), 20.11.2026. Die Screenshots liegen im Ordner `shots/` daneben (2540×1504, macOS, dunkles Design).

## Rechercheauftrag

Bitte recherchiere, was wir an der Oberfläche von Shortme verbessern können, und begründe jede Empfehlung:
1. Vergleiche mit den Abläufen bei Opus Clip, Vizard, Klap, Submagic, CapCut (Auto-Clips) und Descript: Was ist dort beim Weg „langes Video → fertige Shorts“ schneller oder klarer?
2. Fortschrittsanzeige: Wie zeigt man eine 25–35-minütige lokale KI-Verarbeitung so an, dass sie sich kürzer anfühlt und die Zeit ehrlich bleibt? Was kann man währenddessen schon zeigen, z. B. erste fertige Clips?
3. Clip-Übersicht: Welche Infos braucht man, um 8–10 Vorschläge schnell zu sichten, freizugeben oder zu verwerfen? Wie zeigt man „geprüft“ und „bitte prüfen“ am besten?
4. Editor: Was fehlt, was ist zu viel? Gefragt sind Ideen für einen schnelleren Ablauf von Kürzen, Untertitel, Bildausschnitt und Export.
5. Navigation: Zehn Menüpunkte in der Seitenleiste. Was davon gehört zusammen oder versteckt?
6. Gib zu jeder Empfehlung Aufwand (klein, mittel, groß) und Nutzen an, sortiert nach Nutzen.

Rahmen: Die App ist privat, für einen Nutzer (den Entwickler, Content Creator). Sie läuft komplett offline auf eigenem Rechner, ohne Cloud und ohne Konten. Die Sprache ist Deutsch. Gestaltet ist sie dunkel, mit Glas-Ebenen und Bewegungen nach Apple-Vorbild. Electron + React.

## Was die App macht

Aus langen Videos (YouTube-/Twitch-Link oder Datei; Vlogs, Podcasts, Streams, 15 min bis 6 h) entstehen vertikale 9:16-Shorts mit animierten Untertiteln. Dazu kommen ein Titel, ein automatischer Bildausschnitt (folgt dem Sprecher; bei Streams Facecam + Gameplay) und ein optionaler Cold Opener. Alles läuft lokal:
- Die Transkription läuft mit Parakeet.
- Lokale KI-Modelle schauen Bild und Ton an, planen die Schnitte, ordnen die Clips und prüfen jeden fertigen Clip.

Auf dem Mac gibt es nur eine Engine („Engine Mac“). Auf Windows kann man zwischen mehreren Engines wählen; dort gibt es einen Umschalter, auf dem Mac ist er ausgeblendet.

Typische Dauer für ein 26-min-Video auf einem MacBook M1 Pro, insgesamt etwa 30–35 min:

| Schritt | Dauer |
|---|---|
| Transkription | ~1 min |
| Analyse | ~4,5 min |
| Clips finden | ~25–30 min |

## Ablauf und Screens

### Seitenleiste (immer sichtbar, nur Icons)
Start · Projekte · Stil-Studio · Live · Upload · Werkbank · Lernen · Modelle · Einstellungen. Oben stehen Logo und Version.

### Start (`shots/Start.png`)
- Überschrift „Aus langen Videos kurze Clips“, ein Feld für Link oder Datei per Drag & Drop, Knopf „Laden“.
- Darunter „Zuletzt geöffnet“.
- Nach dem Laden öffnet sich ein Optionen-Blatt:
  - Was ist das für ein Video? (Inhaltstyp, wird automatisch eingeschätzt)
  - Wonach suchen? (Freitext, z. B. „lustige Momente“)
  - Anzahl Clips (Auto oder Zahl), Cliplänge, Format, Bildausschnitt
  - Untertitel, Titel einblenden, Cold Opener, Sprechpausen entfernen
  - Workflow („Prüfen & Bearbeiten“), Auswahl-Engine (nur Windows)
  - „Erweitert“: Sprache, Modell, Sprecher unterscheiden
- Unten steht die geschätzte Gesamtdauer, daneben der Knopf „Clips erstellen“.

### Verarbeitung
- Überschrift „Clips werden erstellt …“ mit einer Marke für die Engine, dazu Videotitel, aktueller Schritt und **eine** Restzeit („Noch 30 Min“).
- Drei Balken: Transkribieren, Analysieren, Clips finden. Knöpfe: Pausieren, Fortsetzen, Stoppen & behalten, Verwerfen, Weiter.
- Man sieht während der Verarbeitung noch keine Clips, erst am Ende.

### Projekte (`shots/Projekte.png`)
- Kachelraster mit Vorschaubild, Titel, Dauer, Clip-Anzahl und Datum.
- Ein Etikett „Noch nicht analysiert“, wo das zutrifft.
- Rechtsklick öffnet: Link kopieren, Neu analysieren, Löschen.
- „Auswählen“ ist für Mehrfachlöschen.

### Clips eines Projekts (`shots/Clips.png`, `shots/Clips-Liste.png`)
- Videotitel, „N Clips · nach Score sortiert · Laufzeit“.
- Rechts:
  - „Neu berechnen“, Etikett „Angezeigt: Engine Mac“, Hinweis, ob die Modelle bereit sind
  - „Wer ist wer?“ (Personen benennen)
  - Umschalter Raster/Liste
- Karten im 9:16-Format zeigen ein bewegtes Vorschaubild, den Score (0–100, Klick zeigt Details/Begründung), Titel, Länge und Engine. Dazu kommen ein Auswahlkreis für den Sammel-Export und die Bewertung Stark / Mittel / Schlecht (Lerndaten) sowie Löschen.
- Ein Klick auf die Karte öffnet den Editor.
- Die Engine kennzeichnet intern Clips als „bitte prüfen“ oder „geprüft“. Die Oberfläche zeigt das heute kaum. Das ist eine Frage an die Recherche.

### Editor (`shots/Editor.png`)
- **Kopfzeile:**
  - Zurück, Cliptitel
  - Layout-Modus: Smart (folgt Sprecher), Fest, Vollbild, Split
  - Bewertung
  - „Gespeichert“
  - Rückgängig/Wiederholen
  - „Exportieren“
- **Links – Transkript des Clips:** Das aktuelle Wort ist hervorgehoben. Man kann Text ändern (korrigiert den Untertitel) und Stellen herausschneiden.
- **Mitte:**
  - Das Quellbild zeigt den Ausschnittrahmen. Ein Klick auf eine Person wählt, wem die Kamera folgt.
  - Daneben steht die 9:16-Vorschau, identisch mit dem Export.
- **Rechts – Reiter Untertitel, Animation, Titel, Bildausschnitt:**
  - Vorlagen speichern, als Standard setzen oder auf alle Clips anwenden; Import und Export
  - Schrift: Größe, Zeilenabstand, Wörter pro Zeile, Position
  - Farben: Text, Hervorhebung, Großbuchstaben
  - Effekte: Kontur, Schatten, Glow, Box
  - Hervorhebung nach KI-Tags, Sicherheitszonen (TikTok, Reels, Shorts)
- **Unten – Zeitleiste:**
  - Abspielen, ±5 s, Ton
  - Filmstreifen und Wellenform des Quellvideos, darauf der Clipbereich mit Griffen
  - Werkzeuge: „Ab hier markieren“, „Ende prüfen“, „Satz verlängern“, „Satz kürzen“
  - Anzeige der Exportlänge nach dem Kürzen
- Alle Änderungen sind nicht-destruktiv (Undo/Redo).

### Stil-Studio (`shots/Stil-Studio.png`)
Dieselben Untertitel-, Animations- und Titel-Einstellungen wie im Editor, aber als globale Vorlagen mit großer Vorschau.

### Upload (`shots/Upload.png`)
Liste der exportierten Clips, Ziel TikTok, YouTube oder Instagram, Text und Beschreibung, Verbinden über eigene API-Schlüssel, Entwürfe hochladen.

### Live (`shots/Live.png`)
Puffer für einen laufenden Twitch-Stream: „Puffer starten“, die letzten Minuten sichern („Gesicherte Ausschnitte“) und daraus Clips machen.

### Werkbank (`shots/Werkbank.png`)
Stapelverarbeitung vieler Videos, z. B. um eigene veröffentlichte Shorts mit den Vorschlägen der App zu vergleichen. Knöpfe: Hinzufügen, Pausieren, Videodatei nach Auswertung löschen.

### Lernen (`shots/Lernen.png`)
Die Bewertungen (Stark/Mittel/Schlecht) und die Korrekturen werden als Lerndaten gesammelt. Man kann sie exportieren oder löschen.

### Modelle (`shots/Modelle.png`)
Liste der lokalen Modelle mit Größe und Status (empfohlen, installiert), „Weitere Modelle“ und Import „Von USB“. Fehlende Modelle lädt die App beim Start selbst nach.

### Einstellungen (`shots/Einstellungen.png`)
- Reiter: Allgemein, Modelle & Updates, Konten & Dienste, System
- Darstellung: Hintergrund Glas oder Schwarz
- Export:
  - Profil TikTok, Reels, Shorts oder Eigenes
  - Qualität Normal, Hoch oder Maximal
  - Encoder
  - Untertitel eingebrannt, als SRT oder beides
  - Dateinamen nach KI-Titel, Zielordner
- Updates kommen in der App über GitHub-Releases, mit Patch Notes.

## Bekannte Schwachstellen (aus Sicht des Entwicklers)
- Die Verarbeitung dauert lange (30 min), und man sieht erst am Ende Ergebnisse.
- Ob ein Clip geprüft oder unsicher ist, sieht man auf der Karte nicht.
- Die Seitenleiste hat viele Punkte, die man selten nutzt (Werkbank, Lernen, Modelle).
- Viele Untertitel-Regler: mächtig, aber unübersichtlich.
