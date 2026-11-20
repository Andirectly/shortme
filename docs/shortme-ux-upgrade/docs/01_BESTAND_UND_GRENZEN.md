# 01 – Bestand und Grenzen (vom Entwickler beschrieben, Shortme 0.45)

## Produktprofil
- Sprache: Deutsch; Mac + Windows, Electron + React; offline ohne Cloud-KI, ohne Accounts.
- Import: Datei oder URL zu YouTube/Twitch (URL-Download braucht naturgemäß Netzwerk).
- Output: 9:16, Untertitel animiert, Titel, Smart-Crop, Stream Facecam+Gameplay, Cold Opener, optionale Pausenentfernung.
- Transkription Parakeet, lokale multimodale KI, Postcheck.
- Mac: ausschließlich „Engine Mac“, keine Auswahl. Windows: mehrere Engines möglich.

## Referenzablauf
Start (Video + Optionen) -> 3 Verarbeitungsschritte -> Projekt/Clips-Grid oder Liste -> Editor -> Export -> optional Online-Upload.

## Ist-Zeiten (Beispiel 26 Minuten Quelle auf M1 Pro)
- Transkription ~1 Minute
- Analyse ~4,5 Minuten
- Clips finden ~25–30 Minuten
- Gesamt ~30–35 Minuten. Das sind Beobachtungen, keine versprochene Performance für andere Videos.

## Vorhandene Screens
- Start, Projekte, Clips-Grid, Clips-Liste, Editor, Stil-Studio, Upload, Live, Werkbank, Lernen, Modelle, Einstellungen.
- Angegebene Screenshotnamen: `shots/Start.png`, `Projekte.png`, `Clips.png`, `Clips-Liste.png`, `Editor.png`, `Stil-Studio.png`, `Upload.png`, `Live.png`, `Werkbank.png`, `Lernen.png`, `Modelle.png`, `Einstellungen.png`.
- PNGs **sind nicht Bestandteil dieses Pakets**. Wenn sie im echten Repo vorhanden sind, bei Implementierung visuell prüfen.

## Vordringliche UX-Probleme
1. Keine Ergebnisse bis zum Ende der Engine-Verarbeitung.
2. KI-Check / Unsicherheiten kaum auf Karten sichtbar.
3. Verwechselbare Zustände: KI-Qualität, „Stark/Mittel/Schlecht“-Lernwert und Nutzerfreigabe.
4. Viele selten verwendete Navigationspunkte.
5. Zu viele sichtbare Untertitel-Schieberegler.
6. Editor hat beachtliche Funktionen, aber zu viele Kontextwechsel.

## Defensiv ändern
- Vorhandenes Projektformat und Playback, Quell- und Zielvideo verlässlich abgleichen.
- Keine destruktiven Migrationen; ältere Projektdaten müssen weiter laden.
- Optionaler Online-Upload bleibt explizit getrennt und darf offline keine Fehler im Kern auslösen.
- Preview/Export-Parität hat Vorrang vor neuen UI-Effekten.
