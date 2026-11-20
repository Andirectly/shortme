# 05 – Visuelle Richtung: Shortme Dark Studio

Dies sind Richtlinien, kein Zwang zum Austausch des vorhandenen CSS-Systems. Implementierung beginnt mit vorhandenen Design-Tokens.

## Leitlinie
- Apple-inspirierte dunkle Arbeitsumgebung: ein ruhiger Hauptbereich, halbtransparente Navigations-/Überlagerungsschichten, zurückhaltende Blur- und Motion-Effekte.
- Video bleibt die stärkste visuelle Hierarchie; UI darf nicht die Vorschau überstrahlen.
- Eine Primäraktion pro Kontext: `Clips erstellen`, `Freigeben`, `Exportieren`.

## Token-Orientierung (Referenzwerte, an vorhandenes Theme anpassen)
- Hintergrund `#090C12`, Canvas `#10141B`, Surface `#171C26`, Hover `#222938`, Border `rgba(255,255,255,.11)`.
- Text `#F4F6FA`, Subtext `#A3ACBC`.
- Akzent bevorzugt kühles Blau/Violett (bestehendes Shortme-Branding respektieren); Statusfarben nie allein für Bedeutung verwenden.
- Radien: 12–18 px für Cards, 8–10 px für Knöpfe, größere Overlays 20–24 px.
- Glass: backdrop-blur nur für Sidebar/Popover, nicht unter Textkörpern/Timeline dauerhaft.

## Funktionale Motion
- Überblendung und Panelwechsel 120–220ms, keinen künstlichen Delay.
- Bei `prefers-reduced-motion` keine parallax/auto-animation, höchstens kurze Zustandswechsel.
- Keine Daueranimierten Glasgradienten während schwerer Renderjobs.
- CPU-/GPU-Messung während laufender Engine nach Änderungen.

## A11y / UX
- Jede Icon-Only-Action Tooltip + aria-label + Tastaturfokus.
- 44px bevorzugte Interaktionsflächen auf kompakten Buttons, wo platzmäßig möglich.
- Aktiver Clip per Rahmen + Icon, nicht nur Farbumschlag.
- `Geprüft` / `Bitte prüfen` als Text mit Icon; KI-Check und manuelle Freigabe unterschiedlich aussehen lassen.
- Kontrast im Editor/Transkript mindestens WCAG AA anstreben.
- Schrift- und Panelgrößen bei Window-Resize nicht zusammenbrechen lassen.

## Review-Visualisierung
- Player 9:16 dominant, nicht 10 Autoplay-Videokarten.
- Quellenposition, Länge, Grund und Status schnell erfassbar.
- Detailregler nur in Editor; Review nur Play/Pause, Freigabe, Prüfung, Verwerfen, Editieren.

## Editor-Visualisierung
- Rechtes Panel im Standardmodus: Vorlage, Schriftgröße, Untertitelposition, Highlight-Farbe, Animation.
- `Erweitert` bewahrt alle bestehenden Regler (Kontur, Glow, Box, Schatten, Wortzahl, Zeilenabstand etc.).
- Quelle mit Crop-Rahmen nur bei Bedarf sichtbar; hochauflösende Exportvorschau bleibt zentral.

## Design-Referenz
Clipr AI als Inspiration für reduzierte, moderne UI – **kein Pixel-Klon**. shadcn/ui, Magic UI, React Bits, Motion nur gezielt und nur, wenn mit bestehendem Stack und Offline-Anforderung vereinbar.
