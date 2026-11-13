# Shortme – Gesamtübersicht (Stand: Version 0.31.0, 13.11.2026)

Zweck dieses Dokuments: Es beschreibt vollständig, was Shortme heute kann, wie es gebaut ist, welche Messwerte es gibt und wo die Probleme liegen.
Es dient als Ausgangsbasis für eine Recherche (z. B. mit ChatGPT) mit der Frage: **Wie bekommen wir aus langen Videos (Podcasts, Streams, Twitch-VODs von 1–6 Stunden) Shorts, die so gut sind wie bei Opus Clip?**
Kapitel 2 fasst das Kernproblem zusammen, Kapitel 12 enthält die konkreten Rechercheaufträge. Der Rest ist Detailwissen zum Nachschlagen.

---

## 1. Kurzfassung

- **Was:** Lokale Windows-Desktop-App (Electron + TypeScript + React). Aus einem langen Video (Datei oder Link) entstehen vertikale 9:16-Shorts mit animierten Untertiteln, Titel-Einblendung, automatischem Bildausschnitt (Sprecher-Tracking, Facecam + Gameplay bei Streams) und einem Editor. Ersatz für Opus Clip, **komplett offline**, kein Cloud-Dienst.
- **Nutzung:** ausschließlich privat durch den Entwickler, zwei eigene Rechner (Hauptrechner RTX 5090 32 GB, Zweitrechner RTX 5070 Ti 16 GB). Keine Weitergabe. Lizenzen: Code aus MIT- und AGPL-Projekten darf übernommen werden.
- **Feste Randbedingungen:** kein Python zur Laufzeit; Modelle werden in der App heruntergeladen (nie ins Repo); ASR und LLM nie gleichzeitig im VRAM; keine Cloud-APIs; Ziel-Hardware NVIDIA ≥ 12 GB VRAM.
- **Stand der Entwicklung:** 277 Commits, 135 Testdateien, rund 1010 automatische Tests (alle grün), über 30 Meilensteine. Installer (260 MB, ohne Modelle), Updates über GitHub-Releases, Patch Notes in der App.
- **Das große offene Problem:** Die **Qualität der Clip-Auswahl bei langen Videos**, vor allem bei Streams/VODs (Kapitel 2 und 11). Alles andere (Layout, Untertitel, Export, Editor) funktioniert im Grundsatz.

---

## 2. Das Kernproblem (bitte zuerst lesen)

**Beobachtung des Nutzers:** Bei Opus Clip entstehen aus langen Videos (Podcasts, Twitch-VODs mit 2–6 Stunden) sehr gute Shorts. Shortme liefert bei VODs Clips, die technisch sauber sind (Grenzen, Untertitel, Bildausschnitt), aber **inhaltlich nicht die besten Momente**. Beispiel aus dem Test: Ein Streamer fängt spontan an zu rappen und imitiert einen Klischee-Streamer – genau solche Momente werden nicht gefunden, stattdessen kommen allgemeine Passagen wie „Abschluss des Tages“.

**Warum das bei uns schwierig ist (Kurzdiagnose, Details in Kapitel 11):**
1. Die Auswahl beruht fast vollständig auf dem **Transkript** (Text). Ein lokales 14B-Sprachmodell (Qwen3-14B, 4-Bit) bewertet Textabschnitte. Es sieht weder Bild noch Ton, nur wenige Markierungen wie „(lacht)“ oder „(Chat lacht)“.
2. Die **Bewertungsskala (0–4 je Kriterium) kollabiert bei Streams**: Etwa 75 % aller Kandidaten bekommen beim Hook die gleiche Note, weil Streamer-Sätze oft mit „Und“, „Also“, „Ja“ beginnen. Dadurch fehlt Trennschärfe.
3. Das Raster bevorzugt **erklärende, eigenständige Aussagen** (Hook/Payoff/Zitierbarkeit/Eigenständigkeit/Dichte), nicht Humor, Überraschung, Chaos oder Performance, die bei Streams den Reiz ausmachen.
4. Es gibt **keinen belastbaren Qualitätsmaßstab**. Der einzige objektive Test (YouTube „Most replayed“-Kurve) zeigte: Unsere Auswahl liegt bei 41 % Treffern, der Zufall bei 47 % (nicht belastbar, aber auch kein Beleg für Qualität).
5. Unsere Lernfunktion **sammelt** nur Daten (Bewertungen, Korrekturen), es wird noch nichts trainiert.

**Ziel:** Ein ähnliches Qualitätsniveau wie Opus Clip erreichen – lokal, ohne Cloud, auf einer Consumer-GPU, in vertretbarer Zeit (3-Stunden-VOD in ≲ 30–45 Minuten).

---

## 3. Architektur und Stack

| Bereich | Technik |
|---|---|
| App | Electron 35, TypeScript, React 19 (Vite), Zustand (State), Motion (Animation), Tailwind nur für Layout-Hilfen |
| Prozesse | Main (Pipeline, Jobs, Dateien), Renderer (UI), Preload (IPC-Brücke, nur `@shared`-Typen) |
| Transkription | sherpa-onnx, Modell **Parakeet TDT 0.6B v3 (int8)**; läuft als Kindprozess in eigener Node-22-Laufzeit (in Electron stürzt das native Modul ab). Wortzeiten nativ. Echtzeitfaktor ~0,04 |
| Sprachmodell | **llama.cpp `llama-server`** (CUDA 13), OpenAI-kompatible API auf localhost, Kontext 16384, JSON-Schema erzwungen. Standard **Qwen3-14B Q4_K_M** (13,6 GB VRAM); Alternativen im Katalog: Qwen3-8B, Gemma 3 12B, Qwen3.8 27B (21 GB VRAM) |
| Bilderkennung | ONNX Runtime (DirectML/CPU): YuNet (Gesichter), SCRFD-10G (Alternative), YOLOv8n-Pose (Köpfe/Personen), LR-ASD (aktiver Sprecher), MobileFaceNet (Gesichter wiedererkennen), TransNetV2 (Kamerawechsel), YAMNet (Lachen/Applaus/laut) |
| Sprach-Aktivität | Silero VAD; pyannote-Segmentierung + WeSpeaker (Diarisierung, standardmäßig AUS) |
| Video/Audio | FFmpeg (gebündelt ffmpeg-static + optional GPU-fähiges FFmpeg mit NVENC), yt-dlp (gebündelt, selbst-aktualisierend, mit Node als JS-Laufzeit für YouTube) |
| Untertitel | `@tscaps/engine` (CSS → versteckte Electron-Seite → WebCodecs), Fallback ASS/libass; zusätzlich Remotion als Test-Renderer |
| Twitch | Streamlink (Live-Puffer), TwitchDownloaderCLI (Chat), yt-dlp (VODs) – alle werden bei Bedarf nach `<Daten>/bin` geladen |
| Datenhaltung | Dateien statt Datenbank: `<Daten>/projects/<hash>/…` (JSON/JSONL), Hash = Dateigröße + 3×4 MB Stichprobe |
| Updates | electron-updater gegen GitHub-Releases (öffentliches Repo `Andirectly/shortme`), Installer NSIS, nicht signiert |
| Tests | Vitest; Echtfenster-Tests per Chrome-DevTools-Protokoll (`scripts/cdp.cjs`) |

**Ordner (Auszug):** `src/main/shortme/` (Projekte, Import, Jobs, Export, Rendern), `src/main/shortme/clips/` (Auswahl: `select.ts`, `analysis.ts`, `topics.ts`, `signals.ts`, `peaks.ts`, `heat.ts`, `audioEvents.ts`, `snap.ts` …), `src/main/shortme/layout/` (Tracking, Facecam, Planer), `src/main/shortme/render/` (FFmpeg-Graph, Untertitel, Titel), `src/main/engines/` (Modell-Manager, ASR, Sidecars), `src/main/learn/` (Lernen, Werkbank, Katalog), `src/main/twitch/`, `src/main/upload/`, `src/shared/` (reine, getestete Logik), `resources/prompts/` (alle LLM-Prompts als Textdateien), `resources/profiles/` (Inhaltstyp-Profile), `docs/`.

**Wichtige Designentscheidungen (nicht neu diskutieren):** Vorschau = Export (gleicher Planungs- und Render-Code); Bearbeitungen als Operationen (Undo/Redo); Untertitel als reine Daten (Wörter + Zeit + Tags + Preset); feste Kamera pro Einstellung, harter Schnitt bei Sprecherwechsel.

---

## 4. Ablauf der Verarbeitung (Ist-Stand)

Import → Vorabprüfung → Audio → Transkription → Lückensuche → Signale → Kamerawechsel → **Clip-Auswahl** → Grenzen einrasten → Layout/Tracking → Untertitel-Korrektur → Export. Jede Stufe schreibt Checkpoints in den Projektordner; ein Abbruch setzt dort fort.

1. **Import:** Datei (Drag & Drop) oder Link (YouTube, Twitch-VOD/-Clip/-Kanal, andere yt-dlp-Seiten). Twitch-VODs optional mit Zeitbereich. Vorabprüfung: Dauer, Speicher, Audiospur. Ambient-Standbild. YouTube liefert zusätzlich die „Most replayed“-Kurve.
2. **Transkription:** Audio 16 kHz mono, Parakeet in ~15-s-Fenstern, Silero-VAD-Vorfilter, Segment-Checkpoints (`asr.jsonl`). Ergebnis: Wörter mit Start/Ende, Satzzeichen. Cache je Datei.
3. **Lückensuche (zweiter ASR-Durchgang):** empfindliche VAD findet Sprache ohne Wort (≥ 1,5 s), diese Stellen werden ohne VAD-Vorfilter neu dekodiert und zeitgenau eingefügt. Wirkung klein (< 1 % der Wörter).
4. **Signale (je Sekunde, pro Video normalisiert, p5→0, p95→1):** Lautheit, Sprechtempo, „Burst“ (laut bei wenig Sprache, lacht-/applaus-artig), Stille. Dazu **Audio-Ereignisse** (YAMNet: Lachen, Applaus, laute Stimme; Pausen ≥ 2 s) → Markierungen `[lacht] [Applaus] [laut] [Pause]` im LLM-Transkript.
5. **Kamerawechsel:** TransNetV2 (GPU/DirectML; 3 h in ~4 Minuten gemessen).
6. **Optionale Zusatzsignale:** YouTube „Most replayed“ (Bonus −8…+16 Punkte), Twitch-Chat (Standard AUS; Nachrichten/s, um 15 s zurückgerechnet, Bonus −10…+24; Lach-Emotes → `[Chat lacht]` im Transkript), stumm geschaltete Twitch-Abschnitte werden ausgeschlossen.
7. **Clip-Auswahl (Kapitel 5).**
8. **Grenzen einrasten:** Wortgrenze → Satz → nächste Stille → Kamerawechsel (≤ 0,5 s), max. 90 s, keine Überlappung, ≤ 0,6 s Nachlauf.
9. **Layout/Tracking (Kapitel 6).**
10. **Untertitel-Korrektur:** LLM korrigiert Zeichensetzung/Schreibweise je Clip (index-treu, Abweichungen verworfen).
11. **Export (Kapitel 7).**

Inhaltstypen (`resources/profiles/*.json`): Podcast/Interview, Vlog, Solo/Talking Head, Stream/Gaming, Vortrag. Der Typ bestimmt Bildausschnitt-Standard, Tracking-Regeln, Ranking-Gewichte (Signal/Heat/Chat) und einen Zusatzsatz im Auswahl-Prompt. Beispiel Stream: Gewichte Signal 8, Heat 1, Chat 1,3; Prompt „starke Reaktionen und Ausbrüche, überraschende Wendungen, Highlights im Spiel (Siege, Fails, knappe Szenen), witzige Sprüche …“. Der Typ wird beim Import vorgeschlagen (Facecam gefunden → Stream, zwei große Gesichter → Podcast …).

---

## 5. Die Clip-Auswahl im Detail (`src/main/shortme/clips/select.ts`)

### 5.1 Eingaben
Wörter mit Zeiten → Sätze (Abkürzungen/Dezimalzahlen sind keine Satzenden); Signale; Audio-Ereignisse; Kamerawechsel; optional Heatmap/Chat; Inhaltstyp-Profil; Nutzer-Wunsch („Wonach suchen?“, Freitext).

### 5.2 Zielgrößen
- Wunschzahl Clips = Dauer / 150 s, mindestens 4, höchstens 50 (oder vom Nutzer gewählt).
- Kandidaten-Budget = 3 × Wunschzahl, mindestens 10, höchstens 90 (je Kandidat 3–5 LLM-Aufrufe, deshalb gedeckelt).
- Clip-Länge: mindestens 15 s, Standard-Obergrenze 75 s, absolut 90 s; weiche Längenvorgabe: Sweetspot 22–50 s, Abzug darüber/darunter.

### 5.3 Schritte
0. **Themenkarte** (Map-Reduce, `topics.md`): Abschnitte à ~2 200 Wörter → je 1–4 Themen (Titel, Ein-Satz-Zusammenfassung, Satzbereich); ein zweiter Aufruf verschmilzt zu ≤ 24 Themen und nennt das Hauptthema. Die Karte geht in Start-Prüfung und Bewertung als Kontext ein und dient der Themenvielfalt.
1. **Kandidaten je Fenster** (`candidates.md`): Transkript in Fenster zu ~3 000 Wörtern (≈ 20 Minuten, 6 Sätze Überlappung); das LLM nennt je Fenster einige Satzbereiche (Start/End als Satznummern, höchstens `Budget/Fensterzahl + 1`). Der Prompt verlangt: Mikro-Geschichten mit Hook → Aufbau → Pointe, Beginn ohne Vorwissen verständlich, Ende erst bei abgeschlossenem Gedanken, **spontane Einlagen (Rap, Imitation, Rollenspiel, Ausraster) ausdrücklich mitnehmen**, Kandidaten über das ganze Transkript verteilen. Längen werden an Satzgrenzen angepasst; Dubletten (> 50 % Überlappung) verworfen.
2. **Signal-Kandidaten (neu in 0.29):** bis zu 30 % des Budgets (höchstens Dauer/300 s Stück) kommen **allein aus Ton/Chat** – unabhängig vom Transkript. Auffälligkeit je Sekunde = 0,6·Burst + 0,3·Lautheit + Lachen/Applaus/Chat-Lacher (+1) + laut (+0,5) + Chat-/Heat-Kurve; 5-s-Mittel; Spitzen ≥ 0,45 mit ≥ 90 s Abstand; Ausschnitt 25 s davor bis 15 s danach an Satzgrenzen.
3. **Gleichmäßige Ausdünnung** auf das Budget über die ganze Zeitachse (früher wurden die letzten Kandidaten abgeschnitten – ein Fehler, der lange Videos auf die erste Hälfte beschränkte; behoben in 0.27).
4. **Je Kandidat:**
   - *Start-Prüfung* (`standalone.md`, bis 2 Runden): „Versteht ein Fremder den Anfang?“ plus Regex für Fortsetzungs-Satzanfänge (Und/Aber/Also/Dann/… bzw. „er/sie/das ist“); bei Nein werden 1–2 vorhergehende Sätze angehängt.
   - *Bewertung* (`rate.md`): Reihenfolge Belege vor Noten – `hook_quote` und `payoff_quote` (wörtlich aus dem Clip), `missing_context`; dann Noten 0–4 für **hook, payoff, quotable, standalone, emotion**; dazu Titel, Hook-Text, Ein-Satz-Begründung, Schlüsselwort-Tags für die Untertitel. Zitat nicht wörtlich im Clip → Note −1. Noten × 5 ergibt je 0–20, Summe 0–100 („density“ = Emotion).
   - *End-Prüfung* (`endcheck.md`): Gedanke abgeschlossen? sonst bis zu 3 weitere Sätze; bei Verlängerung Payoff mindestens 10.
5. **Zweite Probe** (höhere Temperatur) für die obere Hälfte (mindestens Wunschzahl + 2, ~60 %); je Note der Median.
6. **Paarvergleich** (`pair.md`): Finalisten = min(max(Wunschzahl + 2, 1,6 × Wunschzahl), 12); die **besten 6** werden paarweise in beiden Reihenfolgen verglichen („welcher Clip würde eher viral gehen und besser ohne Vorwissen funktionieren? Kriterien: Hook, Pointe, ohne Vorwissen verständlich, Emotion/Humor/Meinung, kein Leerlauf“); Uneinigkeit = Unentschieden; Rangfolge nach Siegen.
7. **Endwert** = 0,6 × Rubrik-Summe + 0,4 × Rang-Wert (100 … 40) + Signalgewicht × mittlere Lautheits-/Burst-Stärke (5 bzw. 8 bei Streams) + Heat-/Chat-Bonus − Längenabzug.
8. **Auswahl:** nach Endwert, Themenvielfalt (jeder weitere Clip aus demselben Thema −7 Punkte), Einrasten der Grenzen, keine Überlappung. Bei kurzen Videos zuerst „solide“ Clips (Hook ≥ 8 und Eigenständigkeit ≥ 8 von 20). Bei **langen Videos (Wunschzahl > 12)**: die ersten 12 werden immer gefüllt, danach nur noch Clips mit Rubrik-Summe über dem Median aller bewerteten Kandidaten, mindestens 90 s Abstand zwischen Clips.
9. **Fallback ohne LLM:** TextTiling-Themensegmente mit heuristischem Score aus Lautheit, Tempo, Burst, Stille.

### 5.4 Alle Prompts (Kurzfassung)
Liegen als Textdateien in `resources/prompts/`: `candidates.md`, `rate.md`, `pair.md`, `standalone.md`, `endcheck.md`, `topics.md`, `topicsMain.md`, `proofread.md`, `caption.md` (TikTok-Bildunterschrift + Hashtags). Antworten sind immer JSON gegen ein Schema; ungültige Antworten werden einmal wiederholt.
Kern des Bewertungs-Prompts (`rate.md`): „Du bist Redakteur für Kurzvideos … Du siehst nur den Clip-Text … Noten 0–4, Anker: 0 fehlt, 1 schwach, 2 in Ordnung, 3 stark, 4 außergewöhnlich (selten!) … hook: Weckt der erste Satz sofort Neugier? Ein Satz, der mit ‚Und‘, ‚Aber‘, ‚Dann‘, ‚Also‘, ‚Genau‘ oder einem unklaren ‚das/er/sie‘ beginnt, bekommt höchstens 1 … emotion: Emotion, Humor, Streit, Überraschung oder starke Meinung?“

### 5.5 Qualitäts-Hilfsmittel
- Themen-/Kontextkarte, Belege (Zitatprüfung), grobe Skala mit zwei Proben und Median (14B-Modelle kollabieren bei feinen Skalen), Paarvergleich in beiden Reihenfolgen gegen Positions-Bias (Literatur: arXiv 2602.02219).
- Rubrik-Einzelwerte, Kandidaten-Schicksale (`candidates.json`) und alle Entscheidungen werden für das Lernen gespeichert.

---

## 6. Bildausschnitt, Tracking, Layouts

- **Erkennung (5 fps):** YuNet-Gesichter (SCRFD optional), YOLOv8n-Pose für Köpfe im Profil, Tracks per IoU (BoT-SORT-ReID als Testlab-Alternative), LR-ASD für den aktiven Sprecher, MobileFaceNet-Wiedererkennung über Schnitte; „Wer ist wer?“-Dialog bei unsicherer Zuordnung.
- **Regeln:** feste Ausschnitte je Kameraeinstellung (kein Schwenk/Zoom-Atmen), harter Schnitt bei Sprecherwechsel (Herausforderer ≥ 1,25× aktiver und ≥ 1 s Sprechzeit), Hintergrundgesichter < 10 % ignoriert, Drift > 12 % der Bildbreite → weiterer fester Ausschnitt, > 3 s ohne Sprecher → Bildmitte.
- **Layouts je Shot:** `smart` (fester Crop auf Sprecher), `split` (zwei Sprecher übereinander, mit Zoom), `fit` („Ganzes Bild“, 16:9 mittig mit unscharfem Hintergrund), `fixed` (Vollbild-Mitte), **`stream` (Facecam + Gameplay)**: Facecam oben 1/3 : 2/3 (auch 50:50, unten, kleines Fenster), Gameplay volle Höhe mittig, weicht Facecam und Chat aus; Szenen ohne Facecam → Smart-Ausschnitt.
- **Facecam-Erkennung:** 14 Stichproben, kleines ortsfestes Gesicht (Mittelpunktabstand ≤ 1,5 Gesichtsgrößen – Kopfbewegung), Rahmen aus zeitlich beständigen Kanten (Median über alle Zeilen/Spalten; Bildrand zählt als Kante), Wahl nach Seitenverhältnis 16:9/4:3/1:1. Kanal-Layouts werden pro Twitch-Kanal gespeichert und automatisch angewendet.
- **Sicherheitsnetz:** > 0,5 s ohne Person im Ausschnitt → automatisch „Ganzes Bild“ (markiert im Editor). Gesichtsquote < 60 % → Abzug im Ranking (nicht bei Streams).

---

## 7. Untertitel, Titel, Export, Editor, Upload

- **Untertitel:** Reine Daten (Wörter + Zeit + Tags + Preset). Einzeilige Gruppierung nach Zeichenbudget; 8 eingebaute Presets (u. a. „Glow Karaoke“ Standard, Kinetisch, Glas), eigene Presets (JSON, Import/Export), 5 lokale Schriften (TikTok Sans, Montserrat, Inter, Poppins, Anton) plus eigene Schriften. Animationen: Erscheinen (Einblenden/Pop/Hochgleiten/Blur-In), aktives Wort (Farbe/Vergrößerung/Glow), Bewegungsgefühl, Verschwinden. LLM-Schlüsselwörter (emphasis/entity/hook) werden hervorgehoben. Vorschau und Export nutzen dieselbe CSS (tscaps), ASS/libass als Fallback, Remotion als Test-Renderer.
- **Titel (TikTok-Stil):** Box je Zeile mit runden Ecken, Overlay als PNG-Folge aus einem versteckten Fenster, optional pro Clip; Standard aus.
- **Rendern:** FFmpeg-Filtergraph aus Datei (`-/filter_complex`, bei älterem FFmpeg automatisch `-filter_complex_script`), Pausen entfernen (Dreifachprüfung: keine Wörter, leise, VAD ohne Stimme; 0,15 s bleiben), Sprung-Zoom 1,0 ↔ 1,08 an Schnitten, Lautheit −14 LUFS, NVENC (sonst CPU), 1080×1920, 30 fps, Zielordner wählbar, Dateiname = KI-Titel.
- **Editor (nicht-destruktiv):** echtes Video mit Export-Geometrie, Zeitleiste mit Filmstreifen/Wellenform/Shot-Spur, Wörter per Doppelklick herausschneiden, Beschnitt-Griffe mit Wort-Einrasten, Text ändern, Hook/Titel, Stil-Reiter (Schrift, Größe, Kontur, Farben, Animation, Position), Layout je Szene oder ganzer Clip, „Person anklicken“ (fester Schnitt auf Person), Facecam-/Gameplay-Rahmen verschieben, Undo/Redo (Operationen-Log, Autosave), Inhaltstyp ändern + „Neu berechnen“, Bewertungsleiste (Tasten 1/2/3).
- **Stil-Studio:** Presets bearbeiten, speichern, überschreiben, als Standard setzen, auf alle Clips anwenden.
- **Upload (TikTok):** offizieller Entwurf-Modus der Content-Posting-API (Desktop-PKCE, Tokens in der Windows-Anmeldeinformationsverwaltung), Teilstück-Upload mit Fortsetzen, Tageslimit 5 Entwürfe/24 h, Bildunterschrift/Hashtags vom lokalen LLM. **Praktisch noch nicht benutzbar:** Die Anmeldung scheiterte bisher an der Einrichtung im TikTok-Entwicklerportal (Redirect-URI).
- **Live (Twitch):** Letzte N Minuten eines laufenden Streams, Live-Puffer (Streamlink, Ringpuffer 5–60 Min) mit „Letzte N Min sichern“, Werbung wird gefiltert, optionaler Chat-Mitschrieb (Standard aus).

---

## 8. Lernen, Werkbank, Katalog (Ziel: das Auswahlverfahren messbar verbessern)

Wichtig: **Es wird nichts trainiert und nichts automatisch verändert** – nur gesammelt, verglichen, ausgewertet und vorgeschlagen.

- **Bewertung:** Jeder Clip kann „stark / mittel / schlecht“ bekommen (Tasten 1/2/3, optionale Gründe-Chips). Gespeichert je Projekt (`ratings.json`).
- **Korrektur-Protokoll:** Jede Änderung am Vorschlag (Anfang/Ende verschoben, Sätze herausgeschnitten, Titel/Hook, Bildausschnitt, gelöscht, exportiert, Wiedergabedauer) wird mit Zustand davor/danach protokolliert.
- **Datensatz** (`<Daten>/dataset/*.jsonl`, idempotent aus den Projektdateien gebaut): pro Kandidat (auch nicht gewählte) Video, Inhaltstyp, Start/Ende, Transkript, Ton-Markierungen, Rubrik-Einzelwerte, Heatmap-Mittel/Maximum, Bewertung, Korrekturen, Quelle (Shortme/Creator/Referenz), Split Training/Test je Video (80/20). Paare „A besser als B“ mit Gewicht: Bewertung (1,0), Korrektur (1,0), Creator (0,6), Heatmap (0,35), Blindtest (0,2). Zeilen im Rhapsody-Format.
- **Werkbank:** Stapelverarbeitung für YouTube-Kanäle/-Videos im Hintergrund: lädt zu einem Langvideo die **eigenen Shorts des Kanals**, ordnet sie per **Tonabgleich** (Kreuzkorrelation von Spektralmerkmalen) dem Langvideo zu, lässt Shortme **ohne Kenntnis** der Creator-Shorts eigene Clips erzeugen und vergleicht (Überlappung, Abweichung von Anfang/Ende, normalisierte Leistung = Aufrufe / Median der Shorts des Kanals ±60 Tage, Verlust-Stufe verpasster Momente). Referenz-Clips (z. B. von Opus) per Drag & Drop als dritte Spalte; **Blindtest** (links/rechts, Herkunft verborgen).
- **Lernen-Bereich:** Zähler, Muster in Klartext (z. B. „Enden verlängerst du im Schnitt um 2,1 s“), Eichung (Übereinstimmung der Rubrik-Summe mit den Bewertungen, Treffer auf Heatmap-Spitzen, Treffer auf Creator-Momente), Regelvorschläge (nur Grenz-Verschiebungen) zum Übernehmen/Ablehnen, Stufenanzeige Sammeln → Muster → Regeln → Modell → Vergleich → Übernommen. Schwellen: „Muster“ ab 50 Korrekturen, „Modell trainieren“ ab 1 000 Einträgen mit Heatmap/Creator-Short.
- **Bewertungskatalog über GitHub (neu, 0.30):** Bewertungen aller Rechner werden über ein **privates** Repo abgeglichen (je Clip gewinnt die jüngere Bewertung); Bewertungen zu Videos, die ein Rechner nicht hat, zählen im Lernbereich mit. Token nur in der Windows-Anmeldeinformationsverwaltung. Die echte Verbindung mit GitHub wurde noch nicht mit einem Token getestet.
- **Ergebnis bisher:** Die Maschinerie steht, aber es gibt **sehr wenige echte Bewertungen** und nur wenige Werkbank-Läufe. Ein erster Creator-Vergleich (1 Folge, 1 Short) ergab 0 von 5 Treffern, nicht aussagekräftig. Fertige Datensätze: Rhapsody (Podcast-Highlights, Daten gesperrt, Lizenz nur Forschung) und Repurpose-10K (nur Clip-Grenzen, Sprache/Lizenz unbestätigt) – nichts heruntergeladen (siehe `docs/REFERENCES.md`).

---

## 9. Plattform und Werkzeuge

- **Modell-Manager:** Katalog mit Prüfsummen, Download mit Fortsetzen (Range, SHA-256), Pause/Abbruch, Import „Von USB“, Hardware-Erkennung (empfiehlt LLM nach VRAM), Systemcheck (FFmpeg, yt-dlp, Modelle, NVENC). Ersteinrichtungs-Assistent nur beim ersten Start. Etwa 10 GB Modelle (Parakeet 0,5 GB, Qwen3-14B 9 GB, Rest klein).
- **Testlab:** Plätze (Gesichtserkennung, Personen-Tracking, Clip-Transkription, Clip-Auswahl/LLM, Untertitel-Renderer, Ton-Ereignisse) mit A/B-Vergleich (zwei Modelle auf demselben Ausschnitt, Messwerte Laufzeit/VRAM).
- **Installer/Updates:** `npm run package` baut den NSIS-Installer; `npm run release` veröffentlicht Installer + `latest.yml` auf GitHub; die App prüft in den Einstellungen auf Updates (suchen → laden → neu starten). Patch Notes werden nach einem Update einmal angezeigt und stehen in den Einstellungen.
- **Weitere Einstellungen:** YouTube-Anmeldung als letzter Ausweg bei „Bot-Prüfung“ (Firefox-Cookies oder cookies.txt), Twitch-Token/Chat/Live-Puffer, Zielordner, Kanal-Layouts.

---

## 10. Messwerte (gemessen, nicht geschätzt)

**Geschwindigkeit (Hauptrechner RTX 5090):**
- 3,05-Stunden-Twitch-VOD, vollständiger Lauf bis zur Clipliste: **25,9 Minuten** (Transkription inkl. Lückensuche ~7 min, Kamerawechsel ~4 min, Themenkarte + Kandidaten + Bewertung ~10 min, Layout ~3 min). Nur Auswahl + Layout erneut: ~14 min.
- 60-Minuten-Video: Transkription 3,8 min; Auswahlphase 6,2 min (Qwen3-14B) bzw. 13,7 min (Qwen3.8 27B, 2,2×).
- Export: ~0,15× Echtzeit mit NVENC; 60-s-Clip mit tscaps-Untertiteln ~21 s.

**Qualität (alle mit Vorbehalt, siehe Kapitel 11):**
- „Most replayed“-Test (5 YouTube-Videos, 60 min, 29–30 Clips): Anteil gewählter Clips, die ein Segment aus dem obersten Viertel der Wiedergabe-Kurve überlappen: **Qwen3-14B 41 %, Qwen3.8 27B 50 %, Zufall 46–47 %**. Standardfehler ≈ 9 Punkte, nicht belastbar; die Kurve misst Wiedergabeverhalten, nicht „guter Clip“; englische Videos liefen durch deutsche Prompts.
- Test-VOD (Twitch 2923337293, „SIDEQUEST LIVE“, Stream/Gaming, 3,05 h, Deutsch): 80 Kandidaten im ersten Lauf (davon 27 aus Signal-Spitzen), Bewertung: **Hook-Note 5 bei 60 von 69 Kandidaten**, Eigenständigkeit 10 bei 43 von 69; „solide“ (Hook ≥ 8 und Eigenständigkeit ≥ 8) nur 3–5 von ~70. Rubrik-Summe min/Median/max 23/35/54. Gewählte Clips: 24 über das ganze Video verteilt, Titel allgemein („Automatisierung im Spiel …“, „Abschluss des Tages …“). Ob echte Highlights dabei sind, wurde nicht bewertet.
- ASR: ~259 von 2 045 Wörtern (Referenz Qwen3-ASR) fehlen in Parakeet, überwiegend kurze Funktionswörter im schnellen Gespräch (ja, also, ist, jetzt …).

---

## 11. Bekannte Schwierigkeiten (nach Wichtigkeit)

### A. Auswahlqualität bei langen Videos (das Hauptproblem)
1. **Reine Text-Sicht.** Das LLM sieht nur Transkript + vereinzelte Markierungen. Tonfall, Betonung, Lachen des Streamers, Mimik, Gameplay-Ereignisse, Chat-Reaktionen (nur wenn Chat aktiv) fließen nicht als echtes Verständnis ein. Humor, der aus Stimme, Timing oder Bild entsteht (Rap, Imitation, Fail-Szenen), ist im Text nicht erkennbar.
2. **Trennschärfe der Bewertung.** Grobe 0–4-Skala mit Ankern; bei Streams nahezu alle Kandidaten gleich („Hook 5/20“), weil Sätze mit Füllwörtern beginnen und der Prompt das hart abstraft. Das Raster belohnt „eigenständig und erklärend“ statt „unterhaltsam“. Folge: Rangfolge nahe Zufall, Auswahl tendiert zu Zusammenfassungs-Passagen.
3. **Kandidaten-Recall.** Je 20-Minuten-Fenster liefert das LLM nur wenige Kandidaten (3–9); gute Momente, die nicht auffallen, gehen schon hier verloren. Signal-Kandidaten (Ton/Chat, 30 % des Budgets) sind ein erster Gegenmittel-Versuch, bisher an einem Lauf gesehen; sie werden anschließend wieder nur vom Text-LLM bewertet.
4. **Keine globale Vergleichbarkeit.** Jeder Kandidat wird einzeln bewertet; nur die besten 6 werden paarweise verglichen. Über 3 Stunden und 70–90 Kandidaten gibt es keinen globalen Vergleich (Positions-/Fenster-Bias, Modell-Rauschen).
5. **Kein Maßstab für „gut“.** Offline-Messung nur über YouTube-„Most replayed“ (nur YouTube, nur bei genug Aufrufen; die Werkbank speichert die Kurve ab 50 000 Aufrufen) und Creator-Shorts (Werkbank). Beides zeigt bisher kein klares Signal, Stichprobe winzig. Bei Streams kein Wiedergabe-Signal; Twitch-Clips der Zuschauer wären eine mögliche Quelle (nicht genutzt).
6. **Modellgröße.** Lokales 14B-Modell (4-Bit) gegen die vermutlich deutlich größeren/multimodalen Cloud-Modelle der Konkurrenz. Qwen3.8 27B war 2,2× langsamer und im Test nicht klar besser.
7. **Hooks/Titel generisch.** Titel nennen den Inhalt statt zu neugierig zu machen; „Hook-Text“-Einblendung standardmäßig aus.
8. **Grenzen und Dramaturgie.** Clips sind zusammenhängende Ausschnitte ≤ 90 s; kein Zusammenschneiden von Setup und Pointe aus verschiedenen Stellen, kein Neuschreiben/Straffen von Anfang oder Ende, Pausen-Entfernung nur technisch. Anfänge liegen gelegentlich mitten im Gedanken, Enden können abgeschnitten wirken.
9. **Diversität.** Themenvielfalt per Abzug (−7) und 90 s Abstand bei langen Videos; trotzdem können mehrere Clips denselben Gedanken wiederholen.
10. **Lernen noch ohne Wirkung.** Bewertungen/Korrekturen werden gesammelt; es gibt kein Modell, das daraus Ranking verbessert; Regelvorschläge nur für Grenz-Verschiebungen.

### B. Eingabequalität
11. **ASR-Lücken und Namen:** kurze Wörter fehlen, Eigennamen/Streamer-Slang falsch (Parakeet); Diarisierung (Sprecher-Zuordnung im Text) übersegmentiert (4 statt 2 Sprecher) und ist deshalb aus. Bei Podcasts fehlt damit „wer sagt was“ für die Auswahl.
12. **Sprache:** Prompts und Annahmen sind deutsch; englische Inhalte nur eingeschränkt getestet.

### C. Darstellung (nachrangig)
13. Facecam-Ausschnitt zeigt am rechten Rand einen schmalen hellen Streifen (Rahmenkante knapp daneben); Gameplay wird zentriert, nicht auf das Geschehen gelenkt.
14. Keine dynamischen Zooms/Reaktionseffekte, keine B-Roll, kein Musik-/Soundeffekt-Mix, keine Emojis in Untertiteln.
15. Schnittfenster ohne frei gesetzte Schnitte/Zuschnitt je Stelle, kein manueller Fokus von Schnitt zu Schnitt (Nutzerwunsch, offen).

### D. Betrieb
16. **Laufzeit:** Der KI-Teil wächst mit der Kandidatenzahl (~9 s je Kandidat auf der 5090; Zweitrechner mit 16 GB vermutlich 1,5–2× langsamer, nicht gemessen).
17. Zweitrechner: ältere FFmpeg-Version (gebündelt) – Export-Fehler wurde in 0.31 behoben, auf dem Zweitrechner noch nicht bestätigt.
18. TikTok-Upload: Anmeldung am Entwicklerportal nicht gelungen.

---

## 12. Rechercheaufträge (bitte beantworten)

**Rahmen für jede Empfehlung:** läuft lokal auf Windows mit einer NVIDIA-Karte (12–32 GB VRAM), ohne Python zur Laufzeit (C++/ONNX/llama.cpp/TypeScript, Python nur zum einmaligen Konvertieren von Modellen), keine Cloud-APIs, Nutzung rein privat (MIT/Apache/AGPL ok, „nur Forschung“-Lizenzen nur zum Lernen), Deutsch ist die Hauptsprache, Twitch-VODs von 1–6 Stunden und Podcasts sind die Hauptfälle. Zeitbudget: 3-Stunden-VOD in etwa 30–45 Minuten.

1. **Wie arbeitet Opus Clip (und Vizard, Munch, Submagic, Klap, 2short.ai, Eklipse, StreamLadder, Wayin, OpenClip …) bei der Auswahl aus Langvideos?** Öffentlich Belegbares sammeln (Blogs, Dokumentation, Patente, Interviews, Entwicklervorträge, Support-Antworten, „ClipAnything“, „Virality Score“): welche Signale (Text, Ton, Bild, Chat, Engagement-Daten)? Multimodales Modell oder reines Transkript? Wie entsteht der Virality-Score? Wie wird bei Streams ohne Chat entschieden? Bitte klar trennen: belegt / plausibel / Spekulation.
2. **Forschung zu Highlight-/Moment-Erkennung in langen Videos, Podcasts und Livestreams:** Rhapsody, Repurpose-10K, MR.HiSum, KLive, AntPivot, HiVid, LiveHL u. ä.; Methoden zur Verarbeitung mehrstündiger Eingaben (hierarchische/Gleitfenster-Ansätze, grob-zu-fein, globales Neu-Ranking, LLM-as-judge mit Paarvergleich, Merge-Sort-Ranking). Was ist reproduzierbar, welcher Code ist frei, wie groß ist der Gewinn gegenüber reiner Text-LLM-Bewertung?
3. **Open-Source-Clipper im Detail** (Clips Studio, openclip, OpenShorts, autoclip, AICW Video …): Wie genau erzeugen und bewerten sie Kandidaten bei Langvideos (Fenstergrößen, Signal-Fusion, Schwellen, Re-Ranking)? Was davon ist besser als unser Ansatz aus Kapitel 5? Lizenz und Aktivität prüfen.
4. **Humor-, Reaktions- und Unterhaltungserkennung statt reiner Text-Rubrik:** Ton (Lachen, Aufschreie, Prosodie, Gesang/Rap, Stimmen-Imitation), Bild (Mimik, Reaktionsmoment, Gameplay-Ereignisse, Kill-Feeds, Siege/Fails), Chat (Emote-Spitzen, Nachrichten/s). Welche **lokal lauffähigen** Modelle gibt es (Audio-Event-Modelle wie YAMNet/PANNs/BEATs/AST, Emotionserkennung aus Sprache, kleine Video-/Bild-Sprachmodelle wie Qwen2.5-VL/Qwen3-VL/Qwen-Omni, Gemma 3n, SmolVLM, InternVL, Whisper-basierte Merkmale), wie gut sind sie für Deutsch, welche VRAM-/Zeitkosten pro Stunde Material?
5. **Bessere Bewertung mit demselben lokalen LLM:** Prompt-/Rubrik-Gestaltung für Streams und Unterhaltung (statt „Hook/Eigenständigkeit“), Skalen jenseits 0–4, Paarvergleiche im Turnier-/Swiss-System über viele Kandidaten, Kalibrierung über Fenster hinweg, Self-Consistency, kleine Fine-Tunes/LoRA mit eigenen Bewertungen, Reranker-Modelle. Was bringt bei geringem Aufwand am meisten?
6. **Kandidaten-Recall verbessern:** Mehr und breitere Kandidaten billig erzeugen und billig vorfiltern (z. B. Signal-Spitzen + Embedding-Neuheit/Überraschung + Themenwechsel), bevor das teure LLM bewertet; zweistufige Trichter mit kleinem Modell/Heuristik.
7. **Messen ohne eigene große Datenbank:** Wie bewertet man Clip-Auswahl objektiv? Proxy-Signale (YouTube „Most replayed“, Twitch-Zuschauer-Clips, Creator-Shorts mit Leistung relativ zum Kanal), menschliche Paarvergleiche (wie viele Urteile für aussagekräftige Aussagen?), Rangkorrelationen, Stichprobengrößen. Wo gibt es deutsche oder mehrsprachige Evaluations-Datensätze und unter welcher Lizenz?
8. **Lernen aus eigenen Daten:** Ab wie vielen Bewertungen lohnt Learning-to-Rank (z. B. gradient-boosted auf Rubrik-/Signal-Merkmalen, Bradley-Terry aus Paaren)? Welche Merkmale tragen? Wie vermeidet man Überanpassung bei einigen hundert Bewertungen?
9. **Dramaturgie der Shorts:** Setup+Payoff aus verschiedenen Stellen schneiden, Anfang straffen/umstellen (Hook voranstellen), tote Stellen entfernen, Länge nach Plattform; was machen erfolgreiche Tools und was ist technisch lokal machbar?
10. **Streams speziell:** Wie erkennt man Highlights in Just-Chatting/IRL/Gaming ohne Chat und mit Chat? Rolle von Spielereignissen (OCR/Kill-Feed/Sound-Cues), von Streamer-Reaktionen (Facecam-Mimik, Stimme), von Raids/Subs/Donations/Bits (Alerts), von Clips/Markern der Zuschauer.
11. **Empfehlung:** Eine **priorisierte Liste konkreter, umsetzbarer Änderungen** an Shortme (Kapitel 5), jeweils mit erwartetem Nutzen, Aufwand, Laufzeit-/VRAM-Kosten, Lizenz, Quellen (Links), Risiko und wie man den Nutzen misst. Dazu eine Empfehlung, ob sich ein **multimodaler Durchgang** (Bild + Ton) lohnt und welches lokale Modell dafür am ehesten taugt.

**Gewünschte Form der Antwort:** zuerst Zusammenfassung (10 Zeilen), dann Tabelle der Empfehlungen (Idee | erwarteter Gewinn | Aufwand | Kosten Laufzeit/VRAM | Lizenz | Quelle), danach Details und Quellenliste. Belegtes und Vermutetes klar kennzeichnen; Quellen mit Datum; keine erfundenen Zahlen.

---

## 13. Was wir nicht wissen

- Wie Opus Clip intern arbeitet (nur öffentliche Aussagen, keine eigene Messung). Der direkte Vergleich auf demselben Video steht noch aus; die Werkbank kann Opus-Clips als dritte Spalte laden (Tonabgleich) und einen Blindtest durchführen, wurde aber noch nicht mit echten Opus-Ergebnissen genutzt.
- Wie gut unsere Auswahl auf Podcasts im Vergleich zu Streams ist (die Tests konzentrierten sich auf Vlogs, zwei Podcast-Testvideos und eine Stream-VOD).
- Wie viel besser ein größeres oder multimodales lokales Modell die Auswahl macht (27B Text-Modell: kein klarer Vorteil im kleinen Test; multimodale Modelle nicht getestet).
- Laufzeit auf dem Zweitrechner (16 GB) für 3–6-Stunden-VODs.
- Ob die neuen Signal-Kandidaten (Ton/Chat) tatsächlich bessere Momente bringen (ein Testlauf, keine Bewertung durch den Nutzer).

---

## 14. Anhang: Quelldateien zum Nachlesen

- Auswahl: `src/main/shortme/clips/select.ts`, `peaks.ts`, `topics.ts`, `signals.ts`, `audioEvents.ts`, `heat.ts`, `snap.ts`, `analysis.ts`; Prompts `resources/prompts/*.md`; Profile `resources/profiles/*.json`.
- Layout/Facecam: `src/main/shortme/layout/` (`facecam.ts`, `plan.ts`), `src/shared/camEdges.ts`, `streamLayout.ts`.
- Render: `src/main/shortme/render/exporter.ts`, `graph.ts`, `filterScript.ts`, `src/shared/captions.ts`, `preset.ts`.
- Lernen: `src/main/learn/` (`dataset.ts`, `workbench.ts`, `catalog.ts`), `src/shared/learnData.ts`, `learnStats.ts`, `catalog.ts`.
- Doku: `docs/PIPELINE.md` (Plan, teils älter als der Ist-Stand: z. B. keine SQLite-Datenbank, sondern Dateien), `docs/HIGHLIGHTS.md` (Recherche Auswahlqualität), `docs/PROGRESS.md` (Protokoll aller Meilensteine mit Messwerten), `docs/REFERENCES.md`, `docs/DESIGN.md`, `docs/CATALOG.md`, `docs/UPLOAD-SETUP.md`, `docs/SECOND-PC.md`.
