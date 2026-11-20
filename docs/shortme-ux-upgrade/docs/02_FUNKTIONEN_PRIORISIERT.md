# 02 – Feature-Priorisierung

Aufwand: K=klein, M=mittel, G=groß; relativer Aufwand im vorhandenen Repo, nach Audit anpassen.

| Rang | Feature | Aufwand | Nutzen | Direkt messbare Abnahme |
|---|---|---|---|---|
| P0-1 | Review-Modus mit Freigeben/Zur Prüfung/Verwerfen + Keys | M | Sehr hoch | 10 Clips ohne Editor-Rundreisen sichten |
| P0-2 | Separater KI-Prüfstatus / Freigabestatus | K–M | Sehr hoch | Status eindeutig, persistent, migriert |
| P0-3 | Clipkarten: Quellzeit, Länge, Score-Begründung, Prüfgründe | K–M | Sehr hoch | Problem ohne Detailmodal auffindbar |
| P0-4 | Fortschrittsphasen + ehrliche ETA | M | Sehr hoch | Keine erfundene Prozentzahl, Dauer-Spanne |
| P1-5 | Progressive Kandidaten und Rohvorschau aus echten Engine-Events | G | Sehr hoch | Erste echte Kandidaten vor Jobende sichtbar |
| P1-6 | Sidebar konsolidieren, seltene Tools behalten | K–M | Hoch | Alle 9+ ursprünglichen Tools erreichbar |
| P1-7 | Editor: Schnellmodus und erweiterte Untertitel | K–M | Hoch | Alle alten Regler weiterhin erreichbar |
| P1-8 | Nächster offener Clip und Review-Back im Editor | K | Hoch | Kein unnötiges Zurück zur Galerie |
| P1-9 | Export-Preflight auf realen Prüfungen | M | Hoch | Problem -> Zeitpunkt oder Komponente |
| P2-10 | Quellvideo-Suche per Transkript/Ereignisindex | M | Hoch | Keine erzwungene Komplettanalyse |
| P2-11 | Duplikate/Varianten gruppieren | M–G | Hoch | Nicht-destruktives Gruppieren |
| P2-12 | Drag-and-drop Untertitelposition | M | Mittel–hoch | Vorschau und Export bleiben identisch |
| P2-13 | „Mehr davon finden“ im selben Projekt | M–G | Mittel–hoch | Wiederverwendung bestehender Daten |
| P3-14 | Natürlichsprachliche Editorbefehle | G | Mittel–hoch | Vorschau + Undo + deterministische Ops |
| P3-15 | Kapitel-/Ereigniskarte (2–6h Streams) | G | Mittel | Ereignisse transparent verortet |
| P3-16 | Animation/Glas-Feinschliff | K–M | Mittel | Gute Performance und Reduce Motion |

## Phase-Fokus
- **A:** P0-1/2/3 + P1-6 + Tastatur + Persistenz/Migration.
- **B:** P0-4, danach P1-5.
- **C:** P1-7/8/9 + visuelle Vereinheitlichung.
- **Nur bei ausreichend Zeit:** P2/P3.

## Keine Produktversprechen
- „Erster Clip nach 5 Minuten“ ist **kein** verbindliches Ziel. Ein Segment lässt sich erst zeigen, wenn die reale Engine es ausgibt.
- Die absolute Laufzeit sinkt durch UI-Arbeit nicht zwingend. Ziel ist geringere Wartefriktion und schnellere menschliche Auswahl.
- Score 87 ist kein kalibrierter Qualitätsbeweis. Prüfbefunde und Score-Erklärung getrennt halten.
