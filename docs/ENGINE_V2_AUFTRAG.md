# Implementierungsauftrag: Shortme Engine V2 mit Umschalter

Führe diesen Auftrag im vorhandenen Shortme-Repository aus. Implementiere die neue Auswahl-Engine vollständig bis zu einem benutzbaren Stand in der App. Ein Plan, ein UI-Schalter ohne Backend oder ein Gerüst mit Platzhaltern erfüllt den Auftrag nicht. Arbeite nach einer kurzen Bestandsaufnahme selbstständig weiter und prüfe die Änderungen. Keine Veröffentlichung oder Release-Auslieferung gehört zu diesem Auftrag.

## 1. Ziel und verbindlicher Rahmen

Shortme erzeugt technisch brauchbare Shorts, findet bei langen Streams aber häufig mittelmäßige Textpassagen und verpasst Unterhaltung wie spontane Raps, Imitationen, Reaktionen und visuelle Fails. Die neue Engine muss das Video über mehrere Informationsquellen erschließen, Ereignisse erkennen, daraus Schnitte entwickeln und die ausgearbeiteten Vorschläge vergleichen.

Der Nutzer muss jederzeit zwischen **„Bisherige Engine“** und **„Neue Engine (Beta)“** wählen können. Es ist genau eine Auswahl-Engine für den jeweiligen Analyselauf aktiv. Ergebnisse, Bewertungen und Bearbeitungen der anderen Engine bleiben erhalten.

Verbindliche Bedingungen:

- Windows-Desktop, bestehendes Electron-/TypeScript-/React-Projekt.
- Lokale Inferenz, keine Cloud-Inferenz-APIs. Downloads von Modellen und Laufzeitdateien über den vorhandenen Modellmanager sind erlaubt.
- Kein Python zur Laufzeit; auch kein versteckter Python-Server oder Docker-Pflichtweg. Python ist höchstens für eine einmalige Modellkonvertierung zulässig.
- Modelle nicht ins Git-Repo oder in den Installer aufnehmen. Den vorhandenen Download-/Prüfsummen-/USB-Importweg verwenden.
- ASR und LLM nie gleichzeitig im VRAM. Auch neue Bild-/Audiomodelle in die vorhandene Ressourcensteuerung einbinden.
- Hauptgeräte: RTX 5090 32 GB und RTX 5070 Ti 16 GB; Zielplattform ab 12 GB VRAM. Für 12 GB gegebenenfalls vorhandenes 8B-Textmodell nutzen.
- Deutsch ist die Hauptsprache, Podcasts und 1–6 Stunden lange Twitch-VODs sind Hauptfälle.
- Ziel: etwa 30–45 Minuten für drei Stunden Material bis zur Clipliste. Das ist ein zu prüfendes Ziel, kein bereits erzielter Wert.
- Vorschau und Export verwenden denselben Plan. Operationen-basiertes Undo/Redo, datenbasierte Untertitel sowie feste Ausschnitte pro Einstellung bleiben Grundlage.
- Die bisherige Engine einschließlich ihrer Auswahlprompts und Bewertungsregeln als Vergleich erhalten. Neue Bewertungsregeln gelten für V2.

Lies die aktuellen AGENTS.md-/CLAUDE.md-Dateien und die tatsächlich vorhandenen Module. Ältere Hinweise zu Cutawan, OpenAI-Schlüsseln oder Cloud-Whisper sind keine Erlaubnis, die hier verlangte Offline-Architektur durch Cloud-Aufrufe zu ersetzen. Vorhandene Nutzeränderungen erhalten; keinen fremden Arbeitsstand zurücksetzen. Routinemäßige Entscheidungen selbst treffen.

## 2. Bestandsaufnahme und vorhandene Integrationspunkte

Prüfe zuerst `git status`, aktuelle Version, Pipeline, Persistenz, Modellrollen und UI. Der für diesen Auftrag recherchierte öffentliche Stand war Version 0.31.0, Commit `a1fbd20fbb8d66558e6d5c2eba758135f7d21556`. Der lokale Stand ist maßgeblich; nicht auf den öffentlichen Stand zurücksetzen.

Wichtige Dateien im recherchierten Stand:

- `src/main/shortme/clips/analysis.ts`: `runAnalysis`, gemeinsame Signale, Auswahlaufruf, Layout und schrittweises Schreiben von `clips.json`.
- `src/main/shortme/clips/select.ts`: bestehende Auswahl; als Legacy-Verfahren erhalten.
- `src/main/shortme/project.ts`, `jobs.ts`, `ipc.ts`: Projektdateien, Jobs, IPC.
- `src/shared/shortme.ts`: gemeinsame Projekt-/Clip-/Jobtypen und `PreviewPlan`.
- `src/shared/edits.ts`: Shortme-Operationslog und wirksamer Clipzustand.
- `src/main/shortme/render/exporter.ts` und `render/timeline.ts`: `planExport`, `TimeMap`, `keepsFromCuts`, `buildPieces`.
- `src/main/engines/vram.ts`: vorhandener `VramSequencer`.
- `src/main/engines/sidecars.ts`: `LlamaServer`, Kindprozessverwaltung, vorhandenes `mmproj`-Argument.
- `src/main/engines/index.ts`, `manager.ts`, `catalog.ts`, `resources/models-catalog.json`: Modellwahl und Assets; tatsächliche Zuständigkeiten prüfen.
- `src/preload/index.ts`, `src/renderer/src/shortme/projectStore.ts`, `ClipScreens.tsx`, Erstellen-Dialog und Einstellungen.
- `src/main/learn/`, `src/shared/learnData.ts` und bestehende Werkbank/Blindtests.

Wichtig: Es gibt bereits Signal-Kandidaten, überlappende Textfenster, Paarvergleiche, VRAM-Sequenzierung und einen Teilstück-Renderplan. Diese Fähigkeiten nicht erneut erfinden. `StudioScreen.tsx` ist im recherchierten Stand das Stil-Studio, nicht der richtige Hauptplatz für den Analyse-Umschalter. Andere alte Clip-/Edit-Typen im Repo nicht mit dem tatsächlich genutzten Shortme-Pfad verwechseln.

Notiere kurz die konkreten Integrationspunkte und implementiere anschließend weiter.

## 3. Sichtbarer Umschalter: bestehende gegen neue Engine

Verwende einen gegenseitig ausschließenden, beschrifteten Zweifachschalter im vorhandenen UI-Stil:

- **Bisherige Engine**
- **Neue Engine (Beta)**

Platziere ihn im Erstellen-/Analysebereich und in der Projekt-Clipliste nahe „Neu berechnen“. Beide Stellen steuern dieselbe im Main-Prozess persistierte Projektauswahl. Keine zwei unabhängigen Ein/Aus-Schalter, bei denen beide Engines gleichzeitig aktiv sein könnten.

Verhalten:

1. Bestehende Projekte ohne neues Feld werden als Legacy interpretiert. Die Auswahl bleibt nach App-Neustart erhalten. Ein Standardwert für neue Projekte kann in die vorhandenen Einstellungen aufgenommen werden; zunächst Legacy, bis der Nutzer etwas anderes wählt.
2. Klick auf die andere Engine: Bereits vorhandene, zu den aktuellen Eingaben passende Ergebnisse dieser Engine unmittelbar anzeigen. Sonst nach der Modellprüfung einen Lauf der gewählten Engine starten.
3. Vorhandenes Transkript, Audio, Signale und Kamerawechsel wiederverwenden. Ein Enginewechsel allein löst keine neue komplette Transkription aus.
4. Fehlen benötigte Modelle, zeige die konkrete Voraussetzung und eine Aktion zum Öffnen/Installieren im bestehenden Modellmanager. Kein stiller Wechsel auf eine andere Engine.
5. Während eines laufenden Analysejobs den Enginewechsel sperren und einen kurzen Hinweis sowie den vorhandenen Abbruchweg anbieten. „Stoppen & behalten“ bleibt möglich. Nach bestätigtem Jobende ist der Schalter wieder bedienbar. Kein Hot-Swap mitten in einem Modellaufruf.
6. Bei einem neuen Lauf dürfen die bisherigen Ergebnisse sichtbar bleiben, müssen aber eindeutig als Ergebnisse der bisherigen Anzeige gekennzeichnet sein. Gewählte Engine, laufender Job und angezeigter Ergebnislauf sind getrennte Zustände.
7. „Neu berechnen“ verwendet die gewählte Engine und die tatsächlich aktuellen Werte für Suchwunsch, Inhaltstyp, Längen-/Anzahlgrenzen und Bildausschnitt.
8. Erneuter Klick, Doppelklick, IPC-Wiederholung und mehrere Fenster erzeugen keine konkurrierenden Analysen desselben Projekts.
9. Neue Engine fehlgeschlagen: verständlicher Fehler, Wiederholen und Rückwechsel möglich. Legacy-Ergebnisse bleiben verfügbar.

Zeige die Enginezugehörigkeit einer Clipliste knapp an. Technische Merkmalslisten gehören in Testlab/Diagnose, nicht als Pflichtdialog vor jeden normalen Lauf.

## 4. Architektur: echter Engine-Dispatcher

Führe einen expliziten Typ ein, beispielsweise:

```ts
type SelectionEngineId = 'legacy' | 'multimodal-v2';
```

Ein gemeinsamer Dispatcher wählt anhand des beim Jobstart eingefrorenen Werts genau einen Auswahlpfad. Legacy ruft den vorhandenen Auswahlalgorithmus auf. V2 hat eigene Orchestrierung, Prompts, Datenverträge und Versionierung. Gemeinsame Extraktions-, Layout- und Renderfunktionen weiterverwenden.

Sinnvolle Modulverantwortlichkeiten unter `src/main/shortme/clips/engines/` oder einer gleichwertigen, zum Repo passenden Struktur:

- Registry/Dispatcher und Legacy-Adapter.
- V2-Orchestrierung.
- Ereignissuche und Ereignisindex.
- Ton-/Bildbelege und Modelladapter.
- Inhaltsspezifische Bewertung und globaler Vergleich.
- Schnittplanung und Prüfung.
- Analyse-Läufe, Fingerprints und Persistenz.

Namen an die vorhandene Architektur anpassen; keine unnötige zweite Pipeline für Untertitel, Layout oder Export bauen.

Die bisherigen Felder `mode: 'llm' | 'texttiling'` und `source` nicht heimlich zur Engine-ID umdeuten. Ergänze gemeinsame Typen sauber und passe alle betroffenen Verbraucher an. Keine `any`-/Type-Cast-Abkürzung, die ungültige V2-Daten als Legacy-Clips tarnt.

## 5. Analyse-Läufe und Daten getrennt halten

Enginewahl, Ergebnislauf und bearbeiteter Clip müssen eindeutig identifizierbar sein. Ein Lauf benötigt mindestens:

- `runId`, `engineId`, Engine-/Schemasversion, Erstellungszeit und Status.
- Eingabefingerprint und eingefrorene Analyseoptionen.
- Verwendete Modell-, Projektor-, Runtime- und Promptrevisionen.
- Tatsächlich verfügbare/geprüfte Modalitäten, Fehler und erreichte Abdeckung.
- Kandidaten, Belege, Vergleichsentscheidungen, Schnittpläne, Ergebnisse und Laufzeitdaten.

Ein möglicher Speicherort ist `projects/<hash>/analysis/runs/<runId>/`. Gleichwertige Lösungen sind erlaubt, sofern die Isolation bewiesen ist.

Anforderungen:

- Gemeinsame Quelldaten wie Originalvideo, Audio und versioniertes ASR nicht pro Engine duplizieren.
- Ergebnisse, automatische Schnitte, Layoutdateien, Thumbnails, Clipkorrekturen und Editlogs einem eindeutigen Lauf zuordnen. Bestehende Bewertungen und Undo-Verläufe dürfen beim Umschalten nicht vermischt werden.
- V2-Clip-IDs müssen kollisionsfrei gegenüber alten IDs und anderen Läufen sein. Sichere interne IDs verwenden, keine vom Modell erzeugten Dateipfade.
- Bestehendes `clips.json` und bestehende Clip-Artefakte über einen Kompatibilitätsadapter als Legacy-Ergebnis zugänglich halten. Falls ein Snapshot nötig ist, vor der ersten potenziell überschreibenden Aktion atomar und idempotent anlegen. Keine destruktive Startmigration.
- Alle bisherigen Schreibstellen berücksichtigen: `runAnalysis` publiziert im recherchierten Stand auch während der Layoutphase mehrfach nach `clips.json`; außerdem schreiben Layout-Nachberechnung, Thumbnails, Personen-/Wortkorrekturen und Lernen weitere Dateien. Eine Isolation nur beim letzten Schreibvorgang reicht nicht.
- Renderer, IPC, Editor, Exporte und Lernprotokoll referenzieren den konkreten Lauf. Ein laufender Export darf nach einem Enginewechsel nicht plötzlich andere Clips lesen.
- Projektbezogene Sprecher-/Personenzuordnungen dürfen gemeinsam bleiben, wenn ihre Herkunft und Version eindeutig sind. Clipbezogene Änderungen bleiben laufbezogen.
- Fingerprint umfasst Medienidentität, relevante ASR-/Signalrevisionen, Analyseoptionen, Modelle/Projektoren, Prompt- und Algorithmusversion. Änderung des Eingabeinhalts invalidiert abhängige Stufen, nicht willkürlich alle Rohdaten.
- Eine zusätzliche Clip-ASR darf den Eingabestand anderer Läufe nicht unbemerkt verändern. Korrekturen als laufbezogene Daten behandeln oder eine neue Transkriptrevision mit korrekter Invalidierung anlegen.
- Projektweite `stages`-/`markStage`-Flags nicht als Nachweis verwenden, dass die Auswahl der jeweils anderen Engine schon erledigt ist. Auswahl- und Nachbearbeitungsstatus laufbezogen führen; gemeinsame Extraktionsstufen über ihre eigene Eingabeversion wiederverwenden.
- Atomare Schreibvorgänge, laufbezogene Checkpoints und konsistente Statusübergänge. Unterbrochene Läufe nicht als vollständig ausgeben.
- Beim alten laufenden Job dürfen verspätete Antworten keine inzwischen aktive Ergebnisansicht überschreiben. Job-ID, Run-ID und aktive Ansicht prüfen.

Nicht jedes Umschalten erzeugt einen neuen Lauf: passende vorhandene Ergebnisse werden wiederverwendet; eine bewusst verlangte Neuberechnung bekommt einen neuen Ergebnislauf.

## 6. Ereignisse, Belege und Schnitte als eigene Daten

Ein Ereignis ist noch kein fertiger Clip. Definiere getestete Schemas, die mindestens Folgendes ausdrücken:

```ts
type EvidenceModality = 'text' | 'audio' | 'visual' | 'chat';
type EvidenceState = 'signal-only' | 'observed' | 'unknown' | 'failed';

interface HighlightEvent {
  id: string;
  start: number;       // Quellsekunden
  end: number;
  anchor: number;
  kind: string;        // z.B. Aussage, Geschichte, Witz, Performance, Reaktion, Gameplay
  summary: string;
  evidenceIds: string[];
  requiredModalities: EvidenceModality[];
  missingContext: string[];
}

interface EditorialPlan {
  eventId: string;
  variantId: string;
  keep: Array<{ start: number; end: number }>;
  reason: string;
  verification: 'verified' | 'needs-review' | 'failed';
}
```

Das sind fachliche Mindestinformationen, keine Verpflichtung, diese Typen unbesehen zu kopieren. Ergänze genaue Belegtypen mit Quelle, Zeitbereich, Beobachtung, Modellrevision, Wort-/Frame-IDs und Unsicherheitsgründen.

Zeiten müssen endlich, geordnet und innerhalb des Videos liegen. Modellantworten referenzieren vorgegebene IDs oder werden gegen den erlaubten Zeitbereich geprüft. Fehlende Evidenz ist kein Qualitätswert null. Modell-„Confidence“ nicht als kalibrierte Wahrscheinlichkeit anzeigen.

Nichtsprachliche Kandidaten sind erlaubt. Gibt es dort keine ASR-Wörter, dürfen keine Dummy-Wörter oder ungültigen Wortindizes erzeugt werden. Passe die notwendigen Clip-/Untertitel-Verbraucher typisiert und rückwärtskompatibel an.

## 7. V2-Verarbeitung: verpflichtender funktionsfähiger Kern

### A. Gemeinsame Eingaben und breite Suche

Übernimm die vorhandene ASR, VAD, Kamerawechsel, Signale und optional bereits importierte Heatmap-/Chatdaten. Zuschauerinformationen bleiben optional; kein Cloud-Aufruf ist Voraussetzung für die Auswahl.

Erzeuge getrennte Vorschlagsquellen:

- **Text:** kürzere überlappende Kontextfenster über das gesamte Video. Startkonfiguration etwa 180 Sekunden mit etwa 30 Sekunden Überlappung; Wort-/Tokenbudget zusätzlich begrenzen. Erlebnisse, ungewöhnliche Aussagen, Geschichten, Witze, Konflikte, Darbietungen und Auflösungen suchen.
- **Audio:** vorhandenes YAMNet breiter auswerten, insbesondere Singing/Rapping und verschiedene Reaktionen; Klassen aus der zum konkreten Modell gehörenden Klassenliste prüfen. Peak/oberes Quantil, Dauer, lokale Veränderung und Kontrast zum Umfeld erhalten. Hintergrundmusik und Alerts dürfen nicht automatisch als starker Clip gelten.
- **Bild:** eine günstige Abdeckung der gesamten Zeitachse plus bildbasierte Änderungen und gezielte Nachblicke. Bildprüfung darf nicht ausschließlich auf den besten Textkandidaten stattfinden. Stille visuelle Ereignisse brauchen einen unabhängigen Zugang.
- **Chat/Heat:** vorhandene, zulässige lokale Daten als zusätzliche Hinweise. Herkunft und Zeitunsicherheit erhalten. Fehlenden Chat nicht als negative Evidenz behandeln.

Rohvorschläge zusammenführen, Dubletten als Ereignisse clustern und die Fundquellen erhalten. Kleine Reserven pro Suchquelle sichern die Prüfung, erzwingen aber keine fertigen schwachen Clips. Keine starre 90-s-Unterdrückung vor der Ereignisbildung, die verschiedene nahe Momente vernichtet.

V2-spezifische Audioereignisse mit zusätzlichen Klassen in einem eigenen versionierten Cache speichern oder aus einem gemeinsam versionierten Rohscore-Cache ableiten. Das bisherige `events.json` und die Legacy-Ereignistypen nicht unbemerkt mit anderer Semantik überschreiben.

Ein größerer Rohpool ist erlaubt, weil nicht jeder Eintrag mehrere LLM-Prüfungen bekommt. Konfigurierbare Startgrößen für drei Stunden: einige hundert Rohvorschläge und eine Detailprüfung im Bereich von ungefähr 40–60 Ereignissen. Das sind experimentelle Budgets, keine gemessenen Optimalwerte. Vollständige zeitliche Abdeckung und Kosten protokollieren.

### B. Tatsächliche Medienbeobachtungen

Führe echte Inferenz auf Bild- und Audioeingaben aus. Ein Transkript mit zusätzlichen Markierungen allein erfüllt diese Stufe nicht.

**Bildweg:** Qwen3-VL-4B-Instruct GGUF plus passendem Projektor über eine geprüfte llama.cpp-Version. FFmpeg sampelt Bilder; Kontaktbögen oder Bildsequenzen tragen eindeutige Frame-IDs und eine separate Zuordnung zu Originalzeiten. Pro Detailprüfung zunächst eine kleine, begrenzte Zahl von Bildern, dichter um das Ereignis. Gesamtbild und Facecam nur zeigen, wenn es für die Frage nötig ist. Ein einzelnes Standbild ist kein Beleg für einen vollständigen Ablauf.

Ausgabe: beobachtbare Handlung, sichtbare Reaktion, Ergebnis, nötiger Vorlauf, Frame-Belege, Unsicherheit. Vorhandene Texte/Scoreboards nur übernehmen, wenn sichtbar erkennbar. Keine Aufforderung „gib einen Viralitätsscore“ als Ersatz für Beobachtungen.

**Audioweg:** implementiere eine echte lokale Roh-Audioprüfung kurzer ausgewählter Ausschnitte. Erster Integrationskandidat ist Voxtral-Mini-3B-2507 in passender GGUF-Konvertierung über llama.cpp. Das Original ist Apache-2.0, nennt Deutsch und Audioverständnis; seine Eignung für Imitation/Humor ist trotzdem zu prüfen. Verwende den Audioverständnis-/Instruct-Pfad, nicht bloß eine erneute ASR. Beachte modellabhängige Promptformate; die Originalkarte nennt für Voxtral keine Systemprompt-Unterstützung.

Audio in modellgerechtem Format extrahieren, lange Einlagen in überlappende kurze Prüfbereiche teilen und Zeitangaben wieder auf das Original beziehen. Erfrage etwa Wechsel zwischen Sprechen/Gesang/Rap, Stimm-/Rhythmuswechsel, hörbare Reaktionen und Grenzen einer Darbietung. Das Modell darf Unsicherheit melden. Eine Imitation nicht allein aus einem Wort wie „Streamer“ im Text behaupten.

Modell- und Runtime-Kompatibilität, konkrete Gewichte und Lizenzhinweise vor Integration prüfen. Beim Qwen2.5-Omni-7B-GGUF von ggml-org widersprach in der Recherche die Lizenzmetadaten-Kennzeichnung der Apache-2.0-Karte des Originalmodells; diesen Quant nicht ungeprüft als freigegebenen Standard einsetzen. Einen nachweislich passenden, erlaubten Konvertierungsweg wählen. Kein stiller Rückgriff auf eine Cloud-API.

V2 benötigt einen echten Bildweg und einen echten Audioprüfpfad. Sind deren Pflicht-Assets nicht installiert, muss die App die Einrichtung ermöglichen und den Analysebeginn sauber blockieren. Fehlschläge einzelner Beobachtungen dürfen als unvollständig behandelt werden, aber weder als bestätigtes Verständnis noch als gelungener vollständiger Medienlauf erscheinen.

Die Ereigniskarte verbindet Transkript, Signale und Beobachtungen. Textabhängige, tonabhängige und bildabhängige Momente dürfen unterschiedliche Belege benötigen. Ein ungeprüfter nichtsprachlicher Kandidat wird nicht mit einer schwachen Textnote verworfen.

### C. Inhaltsspezifische Bewertung und Vorauswahl

Verwende echte getrennte Kriterien/Anker je Inhaltstyp beziehungsweise Ereignisart:

- Podcast: konkrete Erkenntnis, Geschichte, Verständlichkeit, Relevanz.
- Unterhaltung/Just Chatting: Überraschung, Humor, Interaktion, Timing, Reaktionsabschluss.
- Performance/Imitation: Besonderheit und Verlauf der Darbietung, notwendiger Kontext, vollständiger Abschluss.
- Gaming: tatsächliches Spielereignis, Spannung, Ergebnis, Reaktion.

Trenne Ereignisqualität von Qualität des aktuellen Schnitts. Verwende tatsächliche Belege und wörtlich geprüfte Textzitate, soweit sinnvoll. Fehlender Ton/Bildbeleg ergibt „ungeprüft“, keine erfundene Pointe.

Für V2 entfernen: pauschales Hook-Cap bei „Und/Also/Ja“, künstliche Payoff-Anhebung nach Endverlängerung und erzwungenes Auffüllen der ersten zwölf Clips. Gewünschte Clipzahl als Obergrenze verstehen. Null gute Vorschläge ist ein zulässiges Ergebnis mit nachvollziehbarem Grund.

Keine Scheingenauigkeit durch bloßes Wechseln von 0–4 auf 0–100. Bewertungsverteilung, Gleichstände und Unsicherheit diagnostizierbar machen. Keine automatisch hochskalierten Noten, nur damit die Liste hochwertig aussieht.

### D. Schnittvarianten konstruieren

Für aussichtsreiche Ereignisse wenige Varianten erzeugen: kurzer verständlicher Einstieg, notwendiges Setup, Kernmoment und erkennbarer Abschluss. Der Vorschlag muss auf Originalmaterial zurückführbar bleiben.

Die erste V2 unterstützt zusammenhängende Ausschnitte und einfache chronologische Kürzungen innerhalb desselben Ereignisses, zunächst höchstens drei erhaltene Teilstücke pro Variante. Keine beliebige Umstellung ferner Aussagen oder doppelte Hook-Voranstellung als Standard. Pausen, die zur Pointe oder Reaktion gehören, schützen. Stummgeschaltete Twitch-Bereiche weiterhin berücksichtigen.

Vorhandene Nutzergrenzen für Länge und Anzahl respektieren; im recherchierten Stand waren das mindestens 15 Sekunden, normalerweise höchstens 75 und absolut höchstens 90 Sekunden pro Clip. Der Kontext zur Prüfung darf breiter sein, der Schnitt bleibt innerhalb dokumentierter Grenzen. Keine stundenweiten Quellbereiche für eine kleine Montage durch die Layout- oder Renderstufe schicken.

Die bestehende `TimeMap`-/`planExport`-/`PreviewPlan.pieces`-Logik erweitern und wiederverwenden. Automatische Schnittintervalle getrennt von manuellen Wortlöschungen speichern, damit sie nicht doppelt angewendet werden. Sie müssen im Editor nachvollziehbar und wiederherstellbar sein; Änderungen werden über das vorhandene Operationslog mit Undo/Redo ausgeführt. Falls dafür zusätzliche Range-Cut-/Restore-Operationen nötig sind, diese in die tatsächlich genutzte Shortme-Editarchitektur integrieren.

Wort-/Untertitelzeiten, Tags, Sprecherwechsel und Shots für jedes erhaltene Teilstück aus den Originalzeiten ableiten. Entfernte Wörter verschwinden aus Untertiteln und Wiedergabe. Längenprüfung verwendet die tatsächliche Ausgabelänge, nicht nur `end - start` des umschließenden Quellbereichs.

Schnittnaht prüfen: Nachbarwörter und wichtige Reaktion nicht abschneiden; bei sprachlichen Kürzungen kann eine kurze erneute ASR des zusammengesetzten Übergangs helfen. Reelsaws Ansatz als Referenz verwenden, dessen englischen CTC-Pfad nicht ungeprüft auf Deutsch übertragen. ASR-Nachprüfungen in eine separate Phase mit freigegebenem VRAM bündeln. Eine unbestätigte automatische Kürzung verwerfen und innerhalb derselben V2 auf die sichere zusammenhängende Variante zurückgehen.

Prüfe den bearbeiteten Vorschlag erneut: Setup, Pointe/Ergebnis und Abschluss müssen im tatsächlich erhaltenen Material liegen. Ein vor dem Kürzen gültiger Beleg darf nicht ungeprüft die gekürzte Fassung legitimieren.

### E. Globaler Vergleich der ausgearbeiteten Vorschläge

Erstelle aus Ereignissen verschiedener Suchquellen eine gemeinsame Vergleichsgruppe. Vergleiche ausgearbeitete Schnittvarianten anhand des geplanten Inhalts und der zugehörigen Medienbelege; medienabhängige Grenzfälle gezielt am zusammengesetzten Ausschnitt nachprüfen.

Verwende budgetierte Paarvergleiche mit wechselnder A/B-Position, Gleichstand und „beide schwach“. Ergebnisse zusammenhängend über die Zeitfenster vergleichen. Wenn eine Vergleichsgruppe über ein Turnier-/Bradley-Terry-Verfahren geordnet wird, muss der Vergleichsgraph zusammenhängen. Nicht verglichene Kandidaten bekommen keinen erfundenen Paar-Rang.

Als Startversuch sind 24 Finalisten und etwa 36 Begegnungen mit beiden Reihenfolgen, also 72 Modellurteilen, denkbar. An tatsächliche Zeitbudgets und gewünschte Anzahl anpassen; Unsicherheit nahe der Auswahlgrenze priorisieren. Keine quadratische Vollpaarung aller Rohkandidaten.

Mehrere Varianten desselben Ereignisses nicht als verschiedene Highlights ausgeben. Themenvielfalt, zeitliche Überlappung und semantische Wiederholung berücksichtigen. Titel, Hook-Overlay und Caption-Schlüsselwörter erst für die endgültigen Vorschläge erzeugen; ein erfundener Titel darf keine fehlende Stärke im Original kaschieren.

## 8. Modellverwaltung und VRAM

- Vorhandenen `AssetManager`, Resume, SHA-256, Import und Systemcheck benutzen. URLs, Größen und Hashes tatsächlich verifizieren; nichts erfinden und keine blind wechselnden `main`-Downloads ohne Versionsbindung als reproduzierbar ausgeben.
- Rollen für Text, Bild und Audio getrennt konfigurieren; V2 darf die dauerhaft gewählte Legacy-LLM-Einstellung nicht durch ein Bildmodell ersetzen.
- Modell/Projektor/Runtime als kompatibles Paket behandeln. Bei einem für V2 nötigen Backendupgrade den geprüften Legacy-Laufzeitweg erhalten, erforderlichenfalls über versionierte Runtime-Assets.
- Den vorhandenen `VramSequencer` erweitern, statt einen zweiten unabhängigen GPU-Lock zu bauen. Kein verschachteltes `use()`/`withLlm()`, das auf sich selbst wartet.
- Insbesondere V2 nicht vollständig in den bestehenden `withLlm`-Callback aus `runAnalysis` einschließen und darin erneut Bild-/Audiomodelle anfordern. Die einzelnen Modellphasen erwerben die Ressource selbst.
- Inferenz nach Modellphasen bündeln, statt je Kandidat mehrfach ASR, Bild-, Audio- und Textmodell zu laden.
- `LlamaServer.start()` gibt im recherchierten Stand bei laufendem Prozess dessen URL zurück. Eine Wiederverwendung muss aber Modell, Projektor und relevante Startparameter abgleichen. Kein Request an das versehentlich noch geladene falsche Modell.
- Kindprozesse über die vorhandene Verwaltung starten/stoppen, Healthchecks und Abbruch unterstützen und beim App-Ende aufräumen. IPC und lokale Inferenzdaten validieren.
- Kleinere Kontexte, Bildzahl und Batchgrößen auf knappen GPUs anpassen. Keine garantierten VRAM-Werte aus Gewichtedateigrößen ableiten.

## 9. Forschungsadapter: sinnvoll, aber kein Vorwand für ein unfertiges Kernprodukt

Zuerst den oben beschriebenen Weg mit realen vorhandenen/integrierten lokalen Laufzeiten fertigstellen. Anschließend zusätzliche Backends nur anschließen, wenn sie wirklich ausführbar sind:

- **Marlin-2B über SkyVision.cpp:** alternativer visueller Ereignisindex. MIT-Engine, Apache-2.0-Modell, separates Backend. Community-GGUF von SkyContact ist nicht allgemein llama.cpp-kompatibel. Runtime und Ausgabe gegen eine Referenz prüfen; kein Python als Laufzeitabhängigkeit.
- **TripleSumm:** zusätzlicher gelernter Fusionsscore. MIT-Code und MIT-gekennzeichnete Checkpoints, aber passende Merkmalsextraktion und ein validierter Export sind notwendig. Original-Ranking und neue Scorequelle separat vergleichen.

Keine Dummyadapter mit konstanten Scores, leeren Belegen oder angeblich erfolgreichen Antworten einbauen. Ein noch nicht ausführbarer Forschungsweg wird als nicht implementiert dokumentiert und nicht in der normalen Modellauswahl als fertig angeboten. Er blockiert nicht die Fertigstellung des funktionierenden V2-Kernwegs. Keine LoRA-Trainingspipeline oder neue Datenbank als Voraussetzung für diesen Auftrag aufbauen.

## 10. Prompts, Fortschritt und Diagnostik

Neue Prompts separat, zum Beispiel unter `resources/prompts/v2/`, versioniert speichern:

- Ereignisvorschläge aus Text und Kontext.
- Bildbeobachtungen mit Frame-IDs.
- Audiobeobachtungen mit erlaubten Zeitbereichen.
- Ereignisfusion und fehlender Kontext.
- Bewertung je Inhaltstyp.
- Schnittplanung und Nachprüfung.
- Paarvergleich.

Antworten gegen Schemas prüfen; begrenzte Reparatur/Wiederholung, verständliche Fehler und Abbruch. Video-/Chattexte als Daten behandeln, nicht als Handlungsanweisungen. Modellspezifische Promptvorlagen berücksichtigen.

Echte Fortschrittsstufen anzeigen: Quellen vorbereiten, Ereignisse suchen, Bild/Ton prüfen, Schnitte planen, Vorschläge vergleichen, Layout vorbereiten. Fortschritt stammt aus tatsächlich erledigter Arbeit. Keine Demo-Clipliste, simulierte Prozentanzeige oder versteckter Legacy-Aufruf als V2-Ergebnis.

Im Testlab/Diagnosebericht erfassbar machen:

- Rohkandidaten je Quelle, Zusammenführungen, geprüfte Modalitäten und Verwerfungsgründe.
- Untersuchte Quellzeiten, nicht untersuchte Bereiche und erreichte Abdeckung.
- Modellaufrufe, Tokens soweit vorhanden, Ladezeiten, Stufenlaufzeiten, Cachetreffer und Fehler.
- Nicht gemessenen Peak-VRAM explizit als nicht gemessen ausgeben.
- Auswahl-/Vergleichsurteile, Schnittvarianten und final benutzte Belege.

Bewertungen, Korrekturen und Blindurteile mit Engine-/Run-/Ereignis-ID an das bestehende Lernen anbinden. Export und Wiedergabe sind Verhaltenssignale, keine automatisch perfekte Qualitätswahrheit. Training/Test weiterhin mindestens nach Originalvideo trennen; Varianten oder zwei Engines desselben Videos gehören nicht in verschiedene Splits.

## 11. Laufzeit und Qualität prüfen

Begrenze Rohpool, Detailprüfungen, Bildzahl, Audiofenster, Ausgabe-Tokens, Wiederholungen und Vergleichsaufrufe über eine dokumentierte Konfiguration. Grenzen dürfen nicht wieder nur das erste Drittel langer Videos bevorzugen. Abdeckung und Qualitätsverlust durch ein ausgeschöpftes Budget protokollieren.

Nutze vorhandene lokal zugängliche Testvideos. Der bekannte verpasste Rap ist ein Debugfall, nicht der alleinige Qualitätsnachweis. Vergleiche V1 und V2 mit gleichen Eingaben und einem festen K; getrennt messen:

1. Ist ein bekannt gutes Ereignis im Rohpool vorhanden?
2. Kommt es in der engeren Auswahl vor?
3. Ist der fertige Schnitt menschlich gut?
4. Welche Variante gewinnt verblindet, und wie viel Nacharbeit ist nötig?
5. Wie lange dauert der gesamte Lauf einschließlich Modellladen und Medienaufbereitung?

Die neue Engine muss technisch funktionieren, ohne dass vorab eine große Bewertungsdatenbank aufgebaut wird. Qualitätsmessung begleitet die Implementierung. Keine erfundenen Prozentverbesserungen und kein „Opus-Niveau erreicht“ aus grünen Unit-Tests ableiten.

## 12. Erforderliche Tests

Nutze die vorhandenen Vitest-/IPC-/CDP-Möglichkeiten. Teste die tatsächlichen Risiken dieser Änderung:

- Altes Projekt öffnen, als Legacy interpretieren und unverändert bearbeiten/exportieren.
- V1 → V2 → V1 wechseln; alte Clips, Bewertungen, Untertitelkorrekturen und Undo-Verläufe erhalten.
- Enginewahl über Neustart erhalten; Anzeigenlauf und nächste Jobauswahl korrekt unterscheiden.
- Cache der anderen Engine wieder anzeigen, ohne ASR oder Auswahl neu auszuführen.
- Modelle fehlen, Download pausiert, Projektor falsch, Inferenz fehlerhaft: eindeutiger Zustand ohne falsches V2-Ergebnis.
- Doppelklick, parallele IPC-Anfragen und mehrere Fenster: genau ein Analysejob pro Projekt.
- Abbruch, Wiederaufnahme, App-Neustart und verspätete Antworten: keine Vermischung von Läufen oder Artefakten.
- Fehler beim Beenden/Laden eines Residents: keine gleichzeitige GPU-Residenz und kein Deadlock durch verschachtelte Locks.
- Modellrollenwechsel: Request geht an das richtige geladene Modell samt Projektor.
- Nichtsprachlicher Kandidat ohne Wörter wird erhalten und kann ohne erfundene Untertitel verarbeitet werden.
- Textarmer Audio-/Bildkandidat wird nicht vor seiner passenden Prüfung durch Textnoten entfernt.
- Schnitt mit mehreren erhaltenen Quellintervallen: gleiche Zeitabbildung in Vorschau und Export; korrekte Untertitel, Tags, Shots und Ausgabelänge.
- Unbestätigte Audio-Schnittnaht: sichere zusammenhängende Variante bleibt erhalten; manuelle Änderungen werden nicht still verworfen.
- Transkriptrevision oder relevante Konfiguration ändert sich: passende Cache-Invalidierung und keine falschen Wortindizes.

Mocks sind für reine Logik- und Protokolltests erlaubt. Sie ersetzen nicht den Nachweis, dass der produktive Pfad Bild und Audio tatsächlich an lokale Modelle übergibt. Führe, soweit die Umgebung es ermöglicht, einen echten Inferenz-Smoke-Test und einen kurzen Export mit denselben Planungsdaten aus. Fehlende GPU/Modelle konkret dokumentieren, alle davon unabhängigen Arbeiten trotzdem abschließen.

Führe die vorhandenen Typecheck-, Test-, Lint- und Build-Kommandos gemäß aktuellem Repo aus. Unterscheide vorbestehende Fehler von Regressionen. Keine fremden Tests löschen oder die Prüfungen umgehen, um Grün zu erhalten.

## 13. Umsetzung und Lieferumfang

Arbeite in dieser Reihenfolge, ohne nach jedem Schritt auf eine zusätzliche Freigabe zu warten:

1. Bestandsaufnahme und minimale Ausgangsprüfung.
2. Dispatcher, Laufidentität, Datenisolation, kompatible Leser und Umschalter.
3. Reale Modellrollen/Medienadapter und Ereignisindex.
4. V2-Suche, Belege, Bewertung, Schnittplanung und globaler Vergleich.
5. Editor-/Render-/Lernanbindung, Wiederaufnahme und Diagnose.
6. Gezielte Tests, echter Smoke-Test soweit möglich und Dokumentation.

Lieferumfang im Repository:

- Funktionsfähige V2 mit gegenseitig ausschließendem Umschalter und erhaltener Legacy-Engine.
- Echte lokale Inferenzadapter, Modellmanager-Anbindung und versionierte V2-Prompts.
- Getrennte, rückwärtskompatible Analyseläufe und Artefakte.
- Konsistenter Schnittplan für Vorschau, Editor und Export.
- Sinnvolle Tests für Umschalten, Datenintegrität, Laufzeitsteuerung und Zeitabbildung.
- `docs/ENGINE_V2.md`: Architektur, Modelle, Einrichtung, Umschalter und Dateiformate.
- `docs/ENGINE_V2_STATUS.md`: tatsächlich implementiert/getestet, exakte Testbefehle, gemessene Werte, konkrete Restprobleme und nicht ausführbare Forschungsadapter.
- Notwendige Quellen-/Lizenzhinweise für übernommenen Code. Version/Patchnotes nur nach dem bestehenden Projektablauf anpassen.

Am Ende kurz berichten: Wo ist der Schalter? Was passiert beim ersten Klick auf „Neue Engine“? Welche Modelle werden gebraucht? Was wurde real getestet? Was bleibt konkret unbestätigt? Keine bloße Liste angelegter Dateien als Erfolgsnachweis.

## 14. Quellen und übertragbare Referenzen

Diese Links sind technische Referenzen, keine Aufforderung, ganze fremde Apps zu integrieren. Vor einer Übernahme prüfen, ob entsprechende Logik in Shortme bereits existiert.

- llama.cpp, lokale multimodale Eingaben: https://github.com/ggml-org/llama.cpp/blob/master/docs/multimodal.md
- Bildmodell: https://huggingface.co/Qwen/Qwen3-VL-4B-Instruct-GGUF
- Audioverständnis und Original-Lizenz: https://huggingface.co/mistralai/Voxtral-Mini-3B-2507
- Audio-GGUF: https://huggingface.co/ggml-org/Voxtral-Mini-3B-2507-GGUF
- YAMNet-Klassen: https://raw.githubusercontent.com/tensorflow/models/master/research/audioset/yamnet/yamnet_class_map.csv
- HotClip, Bildaufbereitung und Prüfung, AGPL-3.0: https://github.com/xixihhhh/hotclip/tree/ebd0dae5b869276b9afdeb7473dad27eb9431b10
- Reelsaw, Auswahl und geprüfte Audionähte, AGPL-3.0: https://github.com/osbytes/reelsaw/tree/1b0ff08b072c70b45efb31148afe289f250a38b9
- MM-VID, beschreibende Zwischenrepräsentation, MIT: https://github.com/yongliang-wu/MM-VID
- NumPro, nummerierte Frames, MIT: https://github.com/yongliang-wu/NumPro
- HIVE, Highlight/Anfang-Ende/Kürzung als getrennte Aufgaben: https://aclanthology.org/2025.emnlp-industry.185/
- Optional Marlin: https://huggingface.co/NemoStation/Marlin-2B
- Optional SkyVision.cpp, MIT: https://github.com/SkYContact/SkyVision.cpp
- Kompatibilität des SkyContact-Marlin-GGUF: https://huggingface.co/SkyContact/Marlin-2B-GGUF
- Optional TripleSumm-Code: https://github.com/smkim37/TripleSumm
- Optional TripleSumm-Checkpoints: https://huggingface.co/smkim37/TripleSumm

Beginne jetzt mit der Bestandsaufnahme im vorhandenen Repository und setze den Auftrag anschließend um.
