# Engine-Vergleich

Erreichbar in der Clip-Liste über „Engines vergleichen“ (ab zwei fertigen Läufen). Nur Läufe **eines** Projekts (= eines Originalvideos).

## Originalvideo neu analysieren (`full-source-discovery`)
- Kasten „Dasselbe Originalvideo mit einer anderen Engine analysieren“: je Engine letzter Lauf oder „Mit dieser Engine analysieren“. Die Suche und Anzahl stammen aus dem letzten fertigen Lauf; Inhaltstyp und Bildausschnitt aus der aktuellen Auswahl (Unterschiede stehen in den Hinweisen des Vergleichs). Bestehende Läufe bleiben unverändert.
- „Vergleich erstellen“ friert die Lauf-IDs und deren Optionen ein (`frozenComparableOptions`) und warnt bei gleicher Engine, abweichenden Optionen oder unvollständigen Läufen.
- Zuordnung (`src/shared/compare.ts`): Ereignisse eines Laufs = Clips mit gleicher Ereignis-ID (Schnittvarianten), Engine 1 je Clip. Zwei Ereignisse gehören zusammen bei zeitlicher IoU ≥ 0,25 oder wenn der Anker im Fenster des anderen liegt; je Lauf höchstens ein Ereignis pro Match; knappe Zweitkandidaten → `ambiguous`. „Nur hier“ gilt für das Endergebnis, nicht für den Rohpool.
- Korrektur per Hand: „Trennen“, „Mit nächstem zusammenführen“; die Overrides bleiben gespeichert, die Zuordnung wird daraus neu berechnet.

## Wiedergabe
- **Gemeinsame Quellzeit:** eine Uhr, Play/Pause/Suchen für alle Spalten, Ton wählbar. Wo ein Clip die Quellzeit nicht enthält, pausiert die Spalte mit „im Schnitt ausgelassen“ bzw. „Clip beginnt später/ist hier zu Ende“. Zeigt das Original (ohne Ausschnitt, Untertitel).
- **Einzeln:** jeder Clip mit seinen eigenen Schnitten (übersprungene Abschnitte werden nicht gespielt).
- Nicht umgesetzt: gerenderte Vorschau mit Ausschnitt/Untertiteln nebeneinander; Bearbeiten/Exportieren direkt aus dem Vergleich (dafür den Clip in der Clip-Liste öffnen – die Bearbeitungen bleiben je Lauf getrennt).

## Blindbewertung
„Blind bewerten“: Spalten heißen Variante A/B/C, Reihenfolge je Match deterministisch gemischt (aus Vergleichs- und Match-ID), Urteil A/B/C, Gleich gut, Alle schwach. Gespeichert wird das Urteil samt Reihenfolge. Keine Aussage „X ist besser“ ohne diese Daten.

## Clip-Recheck (`clip-recheck`)
Eigener Kasten, eigene Datei (`<id>.rechecks.json`), nie in Matches oder „exklusiv“-Zahlen. Engine 2 bewertet den fertigen Clip neu (Bild, Ton, Text); Engine 1 hat keine Einzelclip-Bewertung und meldet das, statt etwas zu erfinden.

## Tests
`tests/engineCompare.test.ts` (Zuordnung, Overrides, Zeitabbildung, Blind-Reihenfolge). Nicht automatisiert getestet: die Oberfläche.
