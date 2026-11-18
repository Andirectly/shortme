# ShortMe für Mac — Überblick zum Paket

## Was ich gemacht habe

Ich habe beide hochgeladenen V4-Pakete überprüft: Sie enthalten technische Implementierungsunterlagen, Kriterien, Schemas, Test-/Evaluationsskripte und Beispielalgorithmen — aber **nicht den vollständigen Windows-App-Quellcode**. Deshalb ist diese ZIP ein konkreter, repo-bezogener **Entwicklungsauftrag für Claude Code**, kein fertiges installierbares ShortMe für macOS.

Enthalten:

1. Ein direkt einfügbarer Claude-Code-Masterprompt, um im **echten ShortMe-Repository** eine eigenständige `macNative`-Engine zu bauen und vorhandene Windows-Engines nicht zu verändern.
2. Ein detaillierter Portierungsplan: lokale ASR und Video-/Audio-Sichtung, unabhängige Highlight-Suche, Kontextprüfung, echte Schnittkanten, 9:16-Export, Captions, tatsächliche AV-Prüfung und Projektspeicherung.
3. Hardware-Autotuning **mit 16 GB als Haupt-Testfall**: Apple Silicon + Metal + Speicher erfassen; 8/16/24–32/64-GB-Profile; bei 16 GB schwere KI-Modelle nacheinander, stufenweise Analyse und Wiederaufnahme nach Speicherwarnungen.
4. Einen echten Swift-Quellcode-Startpunkt zur Mac-Hardwareerkennung und einen ausführbaren Python-Prototyp zur Profilwahl mit **11 erfolgreich ausgeführten Unit-Tests**. Der Swift-Code konnte hier **noch nicht auf einem echten Mac kompiliert** werden.
5. GitHub-/Reddit-/Apple-Quellen, Modellkandidaten und Lizenzhinweise, Abnahmetests, Nachweis-Vorlagen und das unveränderte geprüfte V4-Originalpaket als Referenz.

## Wichtigste technische Entscheidung

16 GB RAM heißt nicht, dass ShortMe nur den Anfang eines Videos scannt. Die komplette Quelle bekommt einen dokumentierten Basis-Scan über die gesamte Dauer; vielversprechende Stellen werden genauer untersucht. Modelle/Frames werden nacheinander verarbeitet und zwischengespeichert. Bei zu wenig freiem Speicher: Daten sichern, Modell entladen, Verarbeitung reduzieren oder pausieren, statt die App abstürzen zu lassen. Die tatsächliche Gleichwertigkeit der Ergebnisse muss auf realen Testvideos gemessen werden.

## So nutzen

1. ZIP entpacken.
2. **Inhalt** des Ordners `ShortMe_macOS_ClaudeCode_Kit_16GB` nach `<echtes ShortMe-Repo>/docs/implementation/shortme-mac/` kopieren.
3. Claude Code im **Root des echten ShortMe-Repositories** starten.
4. Den Text aus `docs/implementation/shortme-mac/01_CLAUDE_CODE_MASTER_PROMPT.md` eingeben.
5. Auf einem **echten Mac mit Apple Silicon / 16 GB** entwickeln und testen; die Paketskripte sind kein Ersatz für vollständigen Mac-/Video-End-to-End-Test.

## Noch offen

Originales ShortMe-App-Repo, reale Mac-Tests, Qwen3-VL-Embedding-2B-Kompatibilitätsnachweis, echte Autorisierten-Videos und humaner Qualitätsvergleich, Apple-Signing/Notarization. Claude muss diese Punkte prüfen und fehlende Tests als BLOCKED/NOT_MEASURED dokumentieren, keine Ergebnisse erfinden.


**GitHub-First V4:** Claude Code soll das echte, gegebenenfalls private ShortMe-Windows-Repository nach autorisierter Anmeldung finden, den Original-Quellcode bestätigen und erst danach in einem separaten Branch die gleiche UI und eine Mac-native Engine entwickeln. Start mit `04_CLAUDE_CODE_GITHUB_CONNECT_PROMPT.md`. Der Repository-Zugang und die 1:1 UI-Parität sind derzeit noch nicht verifiziert.
