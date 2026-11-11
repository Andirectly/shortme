# Bewertungskatalog über GitHub teilen

Bewertungen (stark / mittel / schlecht + Gründe) liegen lokal im Projekt und zusätzlich in `<Daten>/learn/catalog.json`. Über ein **privates** GitHub-Repo
(`Andirectly/shortme-data`, Datei `catalog.json`) werden sie zwischen Rechnern abgeglichen. Das Repo ist privat, weil der Katalog Videotitel und Textanfänge enthält.

## Einrichten (einmal pro Rechner)

1. GitHub → Settings → Developer settings → Personal access tokens → **Fine-grained tokens** → Generate new token.
2. *Repository access*: Only select repositories → `shortme-data`. *Permissions* → Repository → **Contents: Read and write**. Ablauf nach Wunsch (bei Ablauf einfach neu anlegen).
3. Shortme → Einstellungen → „Bewertungen teilen (GitHub)“ → Repo eintragen, Token einfügen → **Verbinden**. Der Token liegt danach nur in der Windows-Anmeldeinformationsverwaltung (Ziel `Shortme/GitHub`), nie in Dateien.

## Was passiert

- Jede Bewertung wird in den Katalog geschrieben und nach etwa einer Minute abgeglichen; außerdem beim Start (nach 45 s) und über „Jetzt abgleichen“.
- Schon vorhandene Bewertungen werden beim ersten Abgleich nachgetragen.
- Je Clip gewinnt die jüngere Bewertung; eine zurückgenommene Bewertung wird ebenfalls abgeglichen. Gleiches Video = gleicher Schlüssel über Link (Twitch-VOD-ID, YouTube-ID), sonst Datei-Hash.
- Bewertungen zu Videos, die es auf diesem Rechner nicht gibt, zählen im Lernbereich mit (Zähler, Muster, Paare).
- „Alle Lerndaten löschen“ entfernt nur die lokale Kopie; die Datei auf GitHub bleibt und kommt beim nächsten Abgleich zurück.
- „Trennen“ entfernt den Token; der lokale Katalog bleibt.
