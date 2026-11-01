# LEER-Diagnose – Ausschnitt zeigt ins Leere (YouTube 1zmTYbX3aeo, um 1:24)

Stand 01.11.2026. Skripte: `scripts/leer-import.ts`, `leer-analyze.ts`, `leer-overlay.ts`, `leer-plan.ts`, `leer-guard.ts`. Bilder: `docs/leer/`.

## 1. Video (ffprobe)
AV1 (Main), 1920×1080, **25 fps fest** (`r_frame_rate` = `avg_frame_rate` = 25/1, Zeitstempel-Abstände 0,04 s), SAR 1:1 (DAR 16:9), **keine Rotation**, `cropdetect` über 60 s: `crop=1920:1080:0:0` (keine schwarzen Balken), 24:19 min. → Umrechnungsfehler (Balken, Rotation, SAR, variable Bildrate) **ausgeschlossen**.
Inhalt: Gespräch zweier Personen **nebeneinander im 16:9-Bild** (Gesichter bei x ≈ 0,27 und 0,70, je ≈ 0,9 % der Bildfläche), dazwischen Wasser/Tretboot; ab ≈ 83 s einzelne Aufnahme im senkrechten Mittelstreifen (Person bei x ≈ 0,55).

## 2. Fehlerstelle
Die Clip-Auswahl ist nicht deterministisch (LLM): meine Läufe lieferten 5 bzw. 10 verschiedene Clips, **der Clip des Fehlerberichts war nicht identisch**. 1:24 selbst lag in meinem Lauf in `clip-730` (73,0–106,7 s) und war **in Ordnung** (Person bei 0,55 im Ausschnitt 0,34–0,66). Im Bereich 1:00–2:00 (120 Bilder im 0,5-s-Raster, Overlay mit Gesichtern/Spuren/Ausschnitt, `docs/leer/kontaktbogen-60-120.png`, Protokoll mit Zahlen: `.tmp/leer/protokoll.csv`) gibt es **genau eine Fehlerstelle: 60,0–61,7 s** (in `clip-137`, Shot 54,7–61,7 s `fixed cx=0,50`): beide Personen links/rechts, der Ausschnitt (x 0,34–0,66, rot) zeigt nur das Tretboot – `docs/leer/leer-60.png` (YuNet: 2 Gesichter, 2 Pose-Personen, 2 Spuren, Sprecher #0 bei 0,72 mit LR-ASD +2,3…+3,2).

## 3. Ursache (Beweis)
| Hypothese | Befund |
|---|---|
| Übersehener Kamerawechsel | nein: TransNetV2 (…58,9 59,6 61,8…) und die Szenenerkennung der ASD melden dieselben Schnitte |
| Zeitversatz | nein: die Mitte zwischen den Personen bleibt auch bei ±1 s leer; Schnitte stimmen in Analyse (Sekunden) und Bild überein |
| Falsches Ziel / kleines Gesicht | nein: beide Gesichter erkannt, Sprecher klar (ASD > 0) |
| Umrechnung/Balken/Rotation/SAR | nein (siehe 1) |
| **Rückfall-Position** | **ja** |

**Mechanismus** (`shared/layoutPlan.ts` `planShots`): Wechseln die Sprecher schnell (hier 50,7–66,5 s: 8 Spuren-IDs, 6 Kamerawechsel), entsteht ein „Ping-Pong-Fenster“, das für den Dialog gedacht ist (Split). Das Fenster wird an Kamerawechseln in Segmente zerschnitten, und nach jedem Schnitt hat die Person eine **neue Spur-ID**. Enthält ein Segment nur **eine** Spur (z. B. 54,7–58,9 s: nur #23), findet der Dialog-Zweig keine zwei Personen und fällt in den allgemeinen Zweig „kein aktiver Sprecher“ → **`fixed`, cx = 0,5** (Bildmitte). Bei zwei Personen links und rechts liegt die Mitte genau zwischen ihnen = leer. Zusätzlich liefert derselbe Rückfall bei `speech`-Lücken kurze `fixed`-Stücke (35 von 120 Rasterpunkten waren `fixed`, nur 4 davon leer, weil die Person dort zufällig mittig stand).

**Offene Auffälligkeit:** In meinem allerersten Lauf hatten alle 5 Clips einen einzigen `fixed 0,5`-Shot über die ganze Länge (Plan-Eingaben identisch gespeichert, später zweimal nicht reproduzierbar: 15 bzw. 10 Shots je Clip). Ursache nicht gefunden; falls das in der App auftritt, bitte Projektordner sichern.

## 4. Kleinste Korrektur (Vorschlag, nicht umgesetzt)
Im Dialog-Zweig und im Rückfall nicht die Bildmitte nehmen, sondern **die zuletzt/als nächstes aktive Person der Nachbar-Segmente** (Position per Personen-Gleichsetzung über Schnitte, `SAME_PERSON` = 0,15 gibt es schon) bzw. bei zwei Personen **Split** erzwingen. Das Sicherheitsnetz unten fängt die Folgen ab, behebt aber nicht die Planung.

## 5. Sicherheitsnetz (umgesetzt)
`guardEmptyShots` (`shared/layoutPlan.ts`): Liegt im geplanten Ausschnitt (smart/fixed) über **mehr als 0,5 s keine erkannte Person** (Gesicht oder Pose – beides steckt in den Spuren), wird genau dieser Abschnitt auf **„Ganzes Bild“ mit unscharfem Hintergrund** gestellt und mit `auto: 'empty'` markiert. Läuft in der Analyse nach der Planung; Vorschau und Export lesen dieselben Shots (Vorschau = Export). Im Editor trägt der Abschnitt in der Layout-Leiste „· auto“ (gestrichelter Rahmen, Tooltip „automatisch: keine Person im Ausschnitt“); der Nutzer überschreibt ihn wie jeden Shot mit der Layout-Wahl (Operation `layout`). Split, Ganzes Bild und Facecam-Layouts bleiben unberührt. Abweichung zur Vorgabe: das Netz ist in den Shots der Analyse gespeichert (nicht als eigene Operation im Edit-Log), damit Teilstrecken eines Szenen-Shots möglich sind – `layout`-Operationen gelten ganze Kameraeinstellungen.
**Vorher/nachher** (`docs/leer/vorher-nachher-60.5.png`, t = 60,5 s): links leere Mitte, rechts Ganzes Bild mit beiden Personen. Auf dem Fehlervideo wurden 8 von 10 Clips angefasst, zusammen **31,4 s** (z. B. `clip-137`: 50,9–52,1, 54,7–58,9, 59,7–61,7 s). Test: `tests/guardEmpty.test.ts`.
**Nicht geprüft:** Export des kompletten Clips mit dem Netz (nur Einzelbilder über dieselbe Filterkette), Verhalten bei Personen nur als Rückenansicht (keine Pose erkannt → Netz greift).
