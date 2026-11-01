# Upload: TikTok einrichten (Teil 0)

Stand der Prüfung: offizielle TikTok-Doku, Seiten „Upload Video“, „Media Transfer Guide“, „Login Kit Desktop“, „Manage User Access Tokens“ sowie README von aaronckj/tiktok-studio-mcp.

## Machbarkeit
Ja. Nur offizielle Schnittstellen, Modus **Entwurf** (`/v2/post/publish/inbox/video/init/`, Berechtigung `video.upload`). Das Video landet als Benachrichtigung in der TikTok-App, dort wird fertig gepostet.

| Punkt | Wert laut Doku |
|---|---|
| Anmeldung Desktop | `https://www.tiktok.com/v2/auth/authorize/`, PKCE Pflicht, Rückleitung nur `http://localhost:<Port>/` oder `127.0.0.1` (Port Pflicht, ohne Parameter) |
| Token | `POST https://open.tiktokapis.com/v2/oauth/token/` (form-urlencoded), `client_secret` ist auch bei PKCE Pflicht |
| Laufzeit | Zugriff 24 h, Erneuerung 365 Tage; Erneuerung kann einen neuen Refresh-Token liefern → immer speichern |
| Init-Limit | 6 Aufrufe/Minute je Nutzer-Token; Upload-Adresse 1 h gültig |
| Datei | MP4/WebM/MOV, H.264/H.265/VP8/VP9, 23–60 fps, 360–4096 px je Seite, bis 10 min, bis 4 GB |
| Teilstücke | 5–64 MB, letztes bis 128 MB, 1–1000 Stück, < 5 MB am Stück; Antwort 206 (weiter), 201 (fertig), 403 abgelaufen, 416 falscher Bereich |

## Offene Punkte / Risiken (nicht sicher aus der Doku)
1. **PKCE-Verschlüsselung:** Die Desktop-Seite nennt SHA-256 mit **Hex**, Standard ist Base64url. Wir probieren beim ersten Test Hex, bei „invalid code_challenge“ Base64url.
2. **Freigabe der Berechtigungen:** Ohne Prüfung durch TikTok (Audit) laufen Apps im Sandbox-Modus, nur für eingetragene **Zielnutzer** (dein eigenes Konto). Für privaten Gebrauch reicht das; der Audit ist nicht nötig. Ob `video.upload` im Sandbox-Modus ohne Prüfung geht, zeigt erst der erste echte Versuch.
3. **Tageslimit:** `spam_risk_too_many_pending_share` = zu viele offene Entwürfe (laut Vorgabe max. 5 je 24 h, wir zählen mit).
4. `client_secret` liegt lokal in der Anmeldeinformationsverwaltung; Shortme ist privat, das ist vertretbar.

## Schritte für dich
1. https://developers.tiktok.com öffnen, mit deinem TikTok-Konto anmelden, Entwicklerkonto anlegen (E-Mail bestätigen).
2. **Manage apps → Connect an app** (Organisation: „Individual“). Name z. B. „Shortme privat“, Kategorie beliebig, Beschreibung kurz. Symbol (512×512) und Links für Nutzungsbedingungen/Datenschutz verlangt TikTok im Formular; für den Sandbox-Betrieb reicht eine beliebige erreichbare Seite (z. B. dein GitHub-Profil).
3. **Products → Add products:** Login Kit, Content Posting API, Display API.
4. **Login Kit → Redirect URI:** Typ **Desktop**, Wert `http://localhost:8902/` (dieser Port ist in Shortme fest eingestellt).
5. **Content Posting API:** „Direct Post“ **nicht** aktivieren (wir posten nicht direkt).
6. **Scopes:** `user.info.basic`, `video.upload`, `video.list`. Kein `video.publish`.
7. **Sandbox:** Oben auf „Sandbox“ wechseln, **Target users** → dein TikTok-Konto hinzufügen (Anmeldung mit deinem Konto bestätigen). Für Sandbox sind keine Prüfung/Freigabe nötig.
8. **Client key** und **Client secret** kopieren (App-Seite). Beides in Shortme unter Upload → TikTok → „Zugangsdaten“ eintragen (kommt mit Teil 1).
9. Verbinden: „Verbinden“ klicken → Browser öffnet sich → zustimmen → Fenster „Verbunden“.

Wichtig: Die Sandbox-Zugangsdaten (Client key/secret) unterscheiden sich von denen der Produktion. Nimm die aus dem Sandbox-Reiter.
