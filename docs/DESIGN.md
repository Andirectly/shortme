# Design

Leitbild: ruhig, hochwertig, Apple-artig. Dunkel als Standard, Inhalte (Clips) leuchten, nicht die UI.
Bewegung und Interaktion folgen dem Skill `.claude/skills/apple-design/SKILL.md`.

## Fenster
- Rahmenlos mit eigener Titelleiste (Drag-Region, Fenster-Buttons rechts im Windows-Stil)
- Windows 11: Mica als Fensterhintergrund (`backgroundMaterial: 'mica'` in Electron, auf Zielversion prüfen);
  Windows 10: einfarbiger Fallback
- Ambient-Hintergrund: weichgezeichnetes Standbild des aktuellen Projekts (vorberechnet, kein Live-Blur)

## Tokens
```css
:root {
  --glass-panel: rgba(255,255,255,0.06);
  --glass-card: rgba(0,0,0,0.28);
  --glass-blur: blur(24px) saturate(160%);
  --edge: rgba(255,255,255,0.08);
  --edge-highlight: rgba(255,255,255,0.14); /* Lichtkante oben */
  --text-1: rgba(255,255,255,0.95);
  --text-2: rgba(255,255,255,0.60);
  --text-3: rgba(255,255,255,0.38);
  --accent: #A855F7;                         /* NUR für KI-Bezug: Score, KI-Aktionen, aktive Navigation */
  --accent-glow: 0 0 24px rgba(168,85,247,0.35);
  --r-window: 16px; --r-panel: 22px; --r-card: 14px; --r-pill: 999px;
  --font: "Segoe UI Variable", "Segoe UI", system-ui, sans-serif;
}
```
- Buttons: Primär = massiv weiß, dunkle Schrift · Sekundär = Pille mit dünnem Rand · Tertiär = runder Geister-Button
- Typo: Überschriften `letter-spacing: -0.02em`, enge Zeilenhöhe; Fließtext neutral, 1.5
- Pillen für Suche, Umschalter, Tags, Badges

## Bewegung
- Bibliothek: Motion (Framer Motion). Standard-Feder: Dämpfung 1.0, Response 0.35
- Bounce (Dämpfung 0.8, Response 0.3) nur nach Zieh-/Wischgesten und für Sheets
- Feedback beim Drücken (scale 0.97), nie erst beim Loslassen
- Alle Animationen unterbrechbar; Drag 1:1 mit Grab-Offset
- `prefers-reduced-motion` → Überblenden statt Federn; `prefers-reduced-transparency` → feste Flächen

## Performance-Regeln
- `backdrop-filter` nur auf statischen Flächen (Sidebar, Panels, Toolbars), NIE über laufendem Video
- Max. 2 übereinanderliegende Glas-Ebenen

## Navigation
Schwebende, schmale Icon-Leiste links (Pille). Aktiver Punkt: Glas-Schimmer + `--accent-glow`.
Punkte: Start · Projekte · Stil-Studio · Modelle · Einstellungen.

## Screens

### Start / Import
Große gläserne Drop-Fläche („Video hierher ziehen“), darunter Link-Feld (Pille), darunter letzte Projekte als Karten.

### Erstellen-Sheet (nach dem Drop, fährt von unten hoch, Sheet-Feder)
Oben Standbild. Abschnitte (häufigste zuerst), letzte Auswahl wird gemerkt:
| Bereich | Optionen | Standard |
|---|---|---|
| Format | 9:16 · 1:1 · 16:9 | 9:16 |
| Bildausschnitt | Smart · Ganzes Bild · Split · Fest | Smart |
| Cliplänge | Automatisch · ≤30 s · 30–60 s · 60–90 s | Automatisch |
| Untertitel | Preset-Kacheln mit animierter Vorschau · Aus | Standard-Preset |
| Sprechpausen entfernen | An/Aus | An |
| Workflow | Automatisch · Prüfen & Bearbeiten | Prüfen & Bearbeiten |
| Wonach suchen? | Freitext | leer |
„Erweitert“ (eingeklappt): Sprache, Modellwahl. Primär-Button: „Clips finden“.

### Verarbeitung
Stufen als ruhige Fortschrittsliste (Transkribieren, Analysieren, Clips finden, Rendern) mit Restzeit.
Steuerung: Pausieren · Stoppen & behalten · Verwerfen. Fertige Clips erscheinen bereits darunter.

### Clip-Übersicht
Raster aus 9:16-Karten (Umschalter Raster/Liste als Pille). Pro Karte: Score-Pille oben links (Akzent),
Titel, Dauer, Warnsymbol bei niedriger Gesichtsquote. Hover: Vorschau spielt stumm.
Sortierung nach Score. Mehrfachauswahl → „Auf alle anwenden“, „Exportieren“.
Score-Detail (Popover): 5 Kriterien als Balken + 1-Satz-Begründung.

### Editor
- Mitte: Vorschau (9:16), daneben optional die Quelle (16:9) synchron
- Links: Transkript; Klick = Springen; Text direkt editierbar; Zeilen abwählbar = herausschneiden
- Unten: Zeitleiste mit Wellenform, Griffe für Start/Ende (rasten an Wortgrenzen ein, 1:1 Drag,
  heben sich beim Greifen leicht an), satzweise verlängern/kürzen, Button „Ende prüfen“ (letzte 2,5 s abspielen)
- Rechts: Inspector mit Reitern
  - **Untertitel**: Text · Stil (Preset + Regler) · Position (Drag in Vorschau, Sicherheitszonen-Overlay
    für TikTok/Reels/Shorts) · Hervorhebung (LLM-Tags an/aus) · Abschnitte ausblenden · Farbe 2. Sprecher
  - **Bildausschnitt**: Layout pro Shot, Person in Vorschau anklicken = Kamera folgt ihr ab hier
  - **Hook**: Text, Stil, Dauer
- Undo/Redo (Strg+Z/Strg+Y), Autosave

### Stil-Studio
- Links: Preset-Kacheln (eigene + mitgelieferte tscaps-Vorlagen) mit animierter Vorschau
- Mitte: Beispielclip in Schleife (eigener Clip wählbar)
- Rechts: Regler (Schrift, Größe, Stärke, Farben, Umriss, Box, Erscheinen-Animation, Hervorhebungsfarbe,
  Position, Wörter pro Zeile, Groß/klein); eingeklappt: CSS-Reiter
- Marken-Kit: Schriften hochladen, Markenfarben, Logo/Wasserzeichen (Ecke, Größe, Deckkraft), Hook-Stil
- Preset als Standard setzen; Import/Export als Datei. Format = tscaps-Vorlagenordner (template.json + CSS)

### Modelle
Installierte Modelle, Größe, Status; Download mit Fortschritt/Fortsetzen/Prüfsumme; Ordner-Import (USB).
Empfehlung nach erkannter Hardware.

### Einstellungen
Export-Profile (TikTok/Reels/Shorts/Eigenes: Auflösung, fps, Qualität 3 Stufen, Encoder Auto/NVENC/CPU,
Untertitel eingebrannt/SRT/beides), Zielordner, Dateinamen nach KI-Titel, Systemcheck
(FFmpeg, yt-dlp, llama-server, ONNX/GPU, freier Speicher), Logs öffnen.
