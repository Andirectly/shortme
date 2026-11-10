# Zweiter Rechner

Installer: `Shortme-Setup-<Version>.exe` aus <https://github.com/Andirectly/shortme/releases/latest>.

1. Ausführen (Windows SmartScreen: „Weitere Informationen“ → „Trotzdem ausführen“, die App ist nicht signiert).
2. Beim ersten Start öffnet sich die Einrichtung und lädt die Modelle (Transkription, Sprachmodell, Vision) mit einem Klick. Später: Einstellungen → Modelle → „Alles laden“. Ohne Internet: Modelle-Seite → „Von USB“.
3. Updates: Einstellungen → Updates → „Nach Updates suchen“ → „Update laden“ → „Neu starten und installieren“. Daten, Projekte und Modelle bleiben erhalten.

Neue Version veröffentlichen (auf dem Hauptrechner): Version in `package.json` erhöhen, Abschnitt in `CHANGELOG.md` schreiben, `npm run release` (baut, lädt Installer + `latest.yml` + Blockmap als Release hoch; `gh` muss angemeldet sein).

Nicht im Installer: Modelle, yt-dlp, llama-server und Node-Laufzeit (werden bei Bedarf geladen).
