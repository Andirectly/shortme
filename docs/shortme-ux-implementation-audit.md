# Shortme UX-Upgrade – Audit und Umsetzungsstand (Version 0.47.0)

Auftrag: `docs/shortme-ux-upgrade/CLAUDE_CODE_START_HERE.md` (Paket „Shortme 0.45 UX Upgrade“). Stand 20.11.2026, Windows-Rechner (RTX 5090). Mac nicht getestet.

## 1. Bestand (vor der Änderung, echte Pfade)

| Frage | Befund |
|---|---|
| Startseite, Projekte, Clipliste, Editor, Sidebar, Styles | `src/renderer/src/shortme/StartScreen.tsx`, `ProjectGrid.tsx` (+ `ProjectsScreen` in `ClipScreens.tsx`), `ClipScreens.tsx` (`ClipsScreen`, `ClipCard`, `RealProcessing`), `EditorScreen.tsx`, `Shell.tsx` (Navigation `NAV`), `tokens.css`; Navigation über `store.ts` (`Screen`, `go`) |
| Score, Qualitätsprüfung, Lernwertung, Nutzerstatus, Run-ID, Clipversion | Score + Begründung: `ShortmeClip.score/reason` (`src/shared/shortme.ts`). KI-Prüfung: `ShortmeClip.v2.verification` (`verified`/`needs-review`/`failed`) + `v2.uncertainty` – nur Engine 2/3/4/Mac, Engine 1 hat keine. Lernwertung: `projects/<hash>/ratings.json` (`src/main/shortme/clips/feedback.ts`, `RatingBar.tsx`). **Nutzerfreigabe gab es nicht.** Run-ID: `ShortmeClip.runId`, Läufe in `analysis/runs/<runId>/`, angezeigter Lauf `analysis/state.json` (`shown`). Clipversion: keine – Bearbeitungen sind ein Operationslog `projects/<hash>/edits/<clipId>.json` (`src/shared/edits.ts`) |
| Progress / Zwischenstände / Kandidaten / Preview / Prüfentscheidungen | Ein Job meldet `stage`, `progress`, `message` (`src/main/shortme/jobs.ts`, IPC `shortme:job`). Prozentbalken der Oberfläche kamen aus einer Zeitschätzung (`shared/estimate.ts` `fractionOf/spans`), nicht aus gemessener Arbeit. Echte Teilzähler stehen nur im Text („Bewerten (7/10)“). Zwischenergebnisse: Clips werden erst im Schritt „Bildausschnitt“ als `pending` veröffentlicht (`clips/analysis.ts` `publish`); vorher keine Kandidaten-Events. Engine 4 schreibt `candidates.json` u. a. im Laufordner, aber ohne Event an die Oberfläche |
| Speichern, Undo/Redo, Export, Stoppen & behalten | Editor: Operationslog mit Cursor, Autosave nach 400 ms (`EditorScreen.tsx` `persist`), Undo/Redo = Cursor. Export: `shortme:export` → `render/exporter.ts` (gleicher Plan wie Vorschau `previewPlan`). Stoppen & behalten: `jobs.stop` → Analyse entfernt unfertige (`pending`) Clips, fertige bleiben |
| Mac/Windows, Enginelauf vs. angezeigtes Ergebnis | `enginesFor(platform)` (`shared/engine.ts`), im Hauptprozess `isLocalEngine` (`clips/engines/control.ts`). Mac: nur Engine Mac, kein Umschalter (`EngineSwitch.tsx` gibt `null` bei < 2 Engines). Lauf und Anzeige getrennt (`state.selected` vs. `state.shown`) |

## 2. Umgesetzt

### Phase A – Review (vollständig)
- **Drei getrennte Achsen**, reine Logik in `src/shared/review.ts` (Tests `tests/clipReview.test.ts`):
  - Freigabe `offen / freigegeben / zur_pruefung / verworfen` → neu `projects/<hash>/review.json` (`src/main/shortme/review.ts`, IPC `shortme:reviewState`, `shortme:reviewSet`). Schreibvorgänge je Projekt serialisiert; idempotent.
  - KI-Prüfung `nicht_durchgefuehrt / ausstehend / bestanden / bitte_pruefen / fehlgeschlagen` → **abgeleitet** aus `v2.verification` (keine zweite Quelle); Engine 1 = `nicht_durchgefuehrt`, nie künstlich „bestanden“.
  - Lernwertung bleibt `ratings.json`, wird nirgends als Freigabe gedeutet.
- **Clipversion**: `clipRevision` = Fingerabdruck aus Clipgrenzen, Auto-Kürzungen und wirksamen Edit-Operationen (bis Undo-Cursor). Freigabe speichert ihn; später bearbeitet → Status bleibt „freigegeben“ mit „seit Freigabe verändert“. KI-Befund nach Bearbeitung → „(vor Bearbeitung)“.
- **Migration**: alte Projekte ohne `review.json` → alles „offen“; kaputte Einträge werden verworfen, nie als Freigabe gelesen.
- **Review-Ansicht** `ReviewScreen.tsx` (Screen `review`): großer 9:16-Player mit derselben Geometrie wie der Export (`previewPlan` + `drawLayout`, Pausenschnitte übersprungen; ohne Untertitel-Ebene), rechts Titel, Länge, Quellbereich, Score + Begründung, KI-Status + Befunde, Freigabe, Lernbewertung; unten Clipleiste. Filter Alle / Offen / Bitte prüfen (KI) / Freigegeben / Verworfen; entschiedene Clips bleiben bis zum Filterwechsel sichtbar. Tasten: Leertaste, N/P (auch Pfeile), E, 1/2/3 – nicht in Eingabefeldern oder mit Strg/Alt. Gemerkt je Projekt: Filter + aktueller Clip; aus dem Editor zurück → dort bearbeiteter Clip.
- **Clipliste**: „Review starten“, Filterleiste mit Anzahl, Karten mit Quellzeit, KI-Abzeichen (Umriss) und Freigabe (gefüllte Pille) + erstem Befund; „Freigegebene exportieren (n)“. Verwerfen löscht nichts; Löschen bleibt der bisherige Knopf.
- **Editor**: Zurück führt zum Review (wenn von dort geöffnet), Vorheriger / Nächster offener Clip (speichert vorher), Review-Abzeichen im Kopf.

### Phase B1 – Fortschritt (umgesetzt)
- Phasen aus der echten Job-Stufe: erledigt / läuft / ausstehend, **keine erfundenen Prozentbalken**. Ein Balken nur bei echtem Zähler aus der Engine-Meldung (`measuredStep`, z. B. „7 von 10“).
- Vergangene Zeit ab echtem Jobstart (`JobInfo.startedAt`), Restzeit als Spanne (`etaRange`: −20 %/+30 %), am Anfang „wird ermittelt“. Engine Mac behält ihre gemessene Restzeit.
- Globaler Laufstatus unten links auf jedem Bildschirm (`Shell.tsx` `JobPill`), Klick → Fortschritt.
- „Beenden, Ergebnisse behalten“ (gleiche Funktion wie zuvor), Verwerfen mit Rückfrage.
- Tests `tests/progressHonest.test.ts`.

### Phase B2 – progressive Ergebnisse (teilweise, begründet)
- **Umgesetzt (nur echte Daten)**: „Transkript bereit“, sobald die Job-Stufe die Transkription verlassen hat; „n Clips vorläufig ansehen“, sobald der laufende Lauf Clips mit ausstehendem Bildausschnitt veröffentlicht (bestehender `pending`-Mechanismus) – frühere Läufe werden nicht als vorläufig gezählt.
- **Nicht umgesetzt**: persistente Lifecycle-Events (`candidate.discovered`, `preview.ready`, `quality.updated`) während der Suche. Befund: Engines 1–4 bestimmen die endgültigen Clips erst nach globalem Ranking (`rankFinal` in `clips/engines/v4/core.ts`, `selectClips` in `clips/select.ts`); vor dem Schritt „Bildausschnitt“ gibt es keine stabilen Clip-IDs, nur Kandidaten ohne Schnitt. Eine frühere Veröffentlichung bräuchte stabile Kandidaten-IDs über das Ranking hinweg und eine Zuordnung von Nutzerentscheidungen bei Zusammenführung – ein Umbau der Engine-Orchestratoren, der die Laufqualität gefährdet. Bewusst nicht simuliert.

### Phase C – Editor, Navigation, Design (teilweise)
- **Navigation** (`Shell.tsx`, neu `ToolsScreen.tsx`): Start · Projekte · Exporte & Upload · Vorlagen · Werkzeuge · Einstellungen. Unter „Werkzeuge“: Live, Werkbank, Lernen, Modelle, Testlab (wenn aktiviert). Live erscheint während einer Aufnahme zusätzlich direkt (rot leuchtend). Alle Direktlinks bleiben gültig.
- **Untertitel im Editor** (`StyleControls.tsx` `compact`): Standard = Größe, Position, Hervorhebungsfarbe; „Erweitert“ (gemerkt) enthält alle bisherigen Regler. Vorlagen (Stil-Studio) zeigen weiterhin alles.
- **Export-Vorabprüfung** (`src/shared/preflight.ts`, Tests `tests/exportPreflight.test.ts`): Quelle fehlt (blockiert), sehr kurz/zu lang, Einstellungen ohne Person (mit „Zur Stelle“), keine Untertitel-Wörter, als verworfen markiert, KI-Befund (nur Hinweis). Warnungen fragen nach, Hinweise exportieren direkt.
- **Nicht umgesetzt**: Werkzeug-Reiter „Schneiden / Bildausschnitt / Untertitel & Titel / Export“ (die vorhandenen Reiter Untertitel/Animation/Titel/Bildausschnitt bleiben), Cold-Opener-Visualisierung in der Timeline, anheftbare Werkzeuge, P2/P3-Funktionen.

## 3. Tests und Prüfungen
- `npx vitest run`: 155 Dateien, 1179 Tests grün (3 Mac-Tests übersprungen). Neu: `clipReview`, `progressHonest`, `exportPreflight`.
- `npx tsc --noEmit -p tsconfig.node.json` / `tsconfig.web.json`: sauber.
- `npx eslint` auf neuen/geänderten Dateien: keine neuen Fehler außer einem Compiler-Hinweis („Memoisierung nicht übernommen“) an `togglePlay` im Editor; übrige Meldungen in `EditorScreen.tsx`/`ClipScreens.tsx` bestanden schon vorher.
- Im echten Fenster (Electron, CDP) mit echten Projektdaten: 10-Clip-Projekt, Review per Tastatur (1 gibt frei und springt weiter, 3 verwirft, N/P, Leertaste spielt mit Export-Bildausschnitt), Neustart → Entscheidungen erhalten; E → Editor → Nächster offener Clip → Zurück zum Review; „seit Freigabe verändert“ nach Kürzen, wieder weg nach Rückgängig; Vorabprüfung mit echtem Befund „ohne Person“ und „verworfen“; echter Engine-1-Lauf zeigt „erledigt / erledigt / 7 von 10“, „Transkript bereit“, vergangene Zeit.

## 4. Bibliotheken
Keine neuen Abhängigkeiten. Referenz-Repos aus `06_GITHUB_REFERENZEN.md` nur als Ideen gelesen, kein Code übernommen.

## 5. Risiken / offen
- Review-Player zeigt keine Untertitel-Ebene (Bild, Ausschnitt, Ton und Schnitte sind exportgleich).
- Mac nicht getestet (gemeinsamer Renderer; Engine-Mac-Clips nutzen dieselben Felder `v2.verification`).
- Restzeit-Spanne basiert auf der bisherigen Schätzung (kein P25–P75 aus Laufhistorie).
- Projekte mit alten, nach „Stoppen“ hängengebliebenen `pending`-Clips zählen diese nicht im Review (sie sind dort ausgeblendet).
