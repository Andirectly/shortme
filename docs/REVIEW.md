# Review-Checkliste (menschliches Urteil)

## M0
- [ ] ASR: 50 Wörter aus `spikes/out/asr-parakeet.json` / `asr-whisper.json` gegen das Audio prüfen (z. B. 230–250 s in podcast-2p) – welches Modell macht weniger Fehler?
- [ ] Tracking: 20 Momente aus podcast-2p (`npx tsx --tsconfig tsconfig.node.json scripts/test-asd.ts test-videos/podcast-2p.mp4 200 260 --annotate .tmp/asd`) – ist die als sprechend markierte Person (grüne Box) richtig? Ziel ≥ 18/20
- [ ] LLM: `spikes/out/llm-*.json` – sind die gewählten Clips inhaltlich sinnvolle Mikro-Geschichten? Qwen3 vs. Gemma
- [ ] Untertitel: `spikes/out/subs-out.mp4` ansehen – Qualität/Sync ok?

## Vorgemerkt für fehlendes `nofaces.mp4` (M5, M3, M4)
- [ ] M3: Transkription eines Videos ohne Sprache/mit Musik: kein Halluzinieren von Text in Stille (Silero-VAD prüfen)
- [ ] M4: Clip-Auswahl funktioniert ohne Sprecher-/Gesichtssignale
- [ ] M5: nie ein leerer Ausschnitt – Fallback `fit` greift in jedem Shot ohne Gesicht
- [ ] M5: Gesichtsquote-Warnung (< 60 %) erscheint, Ranking-Abzug sichtbar
- [ ] M6: Export von `fit`-Layout (unscharfer Hintergrund) visuell prüfen

## M1 (Oberfläche ansehen: `npm run dev`)
- [ ] Mica/Titelleiste im echten Fenster (Windows 11): Mica sichtbar, native Fensterknöpfe rechts, Drag-Region ok (nur im Electron-Fenster prüfbar, ich habe die Seite im Browser-Pane getestet)
- [ ] Gesamteindruck: Glas, Akzent nur bei KI-Bezug (Score, Navigation, KI-Button), Typografie
- [ ] Feder-Gefühl: Sheet hochziehen/wegwerfen (Wurf mit Geschwindigkeit), Press-Feedback, Navigations-Glanz wandert
- [ ] Zeitleisten-Griffe: heben sich beim Greifen, rasten an Wortgrenzen, folgen 1:1
- [ ] Windows „Animationen aus“ (reduzierte Bewegung) einschalten → nur Überblenden, keine Federn
- [ ] Windows „Transparenzeffekte aus“ → feste Flächen
- [ ] Scrollen der Clip-Übersicht mit 100+ Karten flüssig (ich habe nur 10 Beispielkarten gemessen: 144 fps, p95 7,1 ms)
- [ ] Hover-Vorschau der Karten (derzeit Zoom-Effekt als Platzhalter, echtes stummes Video folgt mit M6)

## M2
- [ ] Einrichtungs-Assistent im echten Fenster: frischen Datenordner testen (`SHORTME_DATA=C:\temp\fresh npm run dev`) → Assistent erscheint, „Alles installieren“, Fortschrittsbalken, Pausieren/Fortsetzen in „Modelle“
- [ ] Ordner-Import (USB): Ordner mit den Modelldateien (z. B. `Qwen3-14B-Q4_K_M.gguf`) wählen → wird erkannt und geprüft
- [ ] Zweiter Rechner (12-GB-Karte?): Profil „kompakt“/KV-Cache-Kompression wird empfohlen und läuft (nicht von mir getestet)
- [ ] Task-Manager nach dem Schließen: kein `llama-server.exe`/`node.exe` (Laufzeit) bleibt zurück

## M3
- [ ] Im echten Fenster: Video auf Start ziehen → Sheet zeigt echtes Standbild/Dauer/Auflösung; „Clips finden“ startet echte Transkription; Pausieren/Fortsetzen/Stoppen/Verwerfen in der Verarbeitung
- [ ] App während der Transkription hart beenden (Task-Manager) und neu starten → gleiches Video erneut importieren → setzt fort statt neu zu beginnen
- [ ] Transkript-Qualität stichprobenartig (siehe M0-Liste): fehlende Einwürfe, Eigennamen
- [ ] Sprecher-Erkennung (Option „Sprecher unterscheiden“) bei Dialog-Videos: sinnvoll oder zu viele Sprecher? (bei mir 4 statt 2)
- [ ] nofaces.mp4 (wenn vorhanden): Transkription ohne Sprache/Musik → keine erfundenen Wörter in Stille
- [ ] URL-Import (YouTube-Link) einmal ausprobieren – von mir nicht automatisch getestet (kein Testlink)

## M4
- [ ] Alle Clips der Testvideos: beginnen/enden sie nie mitten im Wort oder Satz? (Berichte: .tmp/clips-report-*.md bzw. scripts/test-clips.ts erneut laufen lassen)
- [ ] Stichprobe: ist jeder Clip ohne Vorwissen verständlich? (Podcast-Clip 3 beginnt mit „Flipo war zum Glück …“ – Kontext fehlt evtl.)
- [ ] Sind 57–81 s lange Clips zu lang? Wunschlänge in den Einstellungen/Prompt anpassen
- [ ] Scores plausibel (Ranking der Finalisten), Tags (Betonung) sinnvoll
