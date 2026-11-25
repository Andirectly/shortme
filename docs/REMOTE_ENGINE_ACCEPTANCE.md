# Remote Engine – Abnahme (fortlaufend)

Grundlage: `SHORTME_REMOTE_ENGINE_V4_CLAUDE_CODE.md` (24.11.2026) + Plan V3. Ergebnis je Zeile: PASS / FAIL / BLOCKED / NOT RUN.
`NOT RUN` heißt: nicht ausgeführt, nicht „bestanden“.

## Stand / Sicherung
- Version **0.52.0**, entwickelt auf `main-f8x95h`, gemergt nach `main`, GitHub-Push funktioniert (Zugriff repariert).
- Umgebung dieser Session: Linux-Container, keine GPU, kein macOS/Windows, kein Schlüsselbund, UDP nur auf 127.0.0.1.

## Transport-Entscheidung
- Upstream: AlterSend `v2.1.0` = `8c23d5b7d50cedae6c9dae66f82b1e235070c16a` (Apache-2.0).
- Übernommen (vendort, Herkunft im Dateikopf, `src/main/remote/drive/NOTICE` + `LICENSE`): `packages/drive` (Chunk-Engine mit Resume-Bitmap),
  Typdeklarationen aus `packages/core/src/types.d.ts`. Muster übernommen (nicht kopiert): Handshake-gebundener Code-Beweis (topic-auth),
  Gegendruck des Drive-Kanals (PeerDrive).
- Nicht übernommen: Bare-Worklet (ShortMe nutzt Hyperswarm direkt in Node/Electron – gleiche Bibliotheken, ein Prozess weniger),
  UI, Branding, Mobile/Web, Pro-/Entitlement-Tokens, Telemetrie, `legacyTopicProof`.
- Abhängigkeiten (npm, Apache-2.0/MIT laut Paketen, transitiv noch nicht vollständig geprüft): hyperswarm 4.17.2, hyperdht 6.37.0,
  protomux, compact-encoding, hypercore-crypto, b4a; nativ: sodium-native 5.2.2, udx-native 1.22.2 (in `asarUnpack`).
- Eigener Namespace: `shortme/pair/1`, `shortme/control/1`, `shortme/drive/1` – AlterSend-Clients werden nie als Worker akzeptiert.
- **Relay: BLOCKED.** AlterSend-Bedingungen (altersend.com/terms, /privacy, /self-host/setup) aus dieser Umgebung nicht erreichbar (DNS).
  Nicht geprüft = nicht genutzt. Umgesetzt: Standard „Direct only“; optional selbst gewählter Blind-Relay-Schlüssel (`relayKey`) ohne
  Mietpflicht. Route-Klassifizierung bei Relay: `unknown` (shortcut im Code markiert).

## Umgesetzt
| Bereich | Dateien |
|---|---|
| Identität (Ed25519, versiegelt via safeStorage, kein Klartext-Fallback) + Vertrauensliste | `src/main/remote/trust.ts` |
| P2P-Host: listen/joinPeer, Firewall, Kopplung (Code 5 min, einmalig, Fingerabdruck, beidseitige Bestätigung), Kontrollkanal (validiert, Absender = Noise-Schlüssel, Rechte, Replay), Herzschlag mit Nonce (5 s / 15 s), Drive-Kanal mit Gegendruck, Entkoppeln | `src/main/remote/host.ts` |
| App-Dienst: Einstellungen, IPC, Tray, Login-Autostart (`--hidden`), Weiterlaufen bei geschlossenem Fenster, Einzelinstanz, Abgleich alle 30 s | `src/main/remote/service.ts`, `src/main/index.ts` |
| Remote-Jobs: Worker (Annahme nur nach dauerhafter Speicherung, Dedup per Job-ID + Inhalts-Hash, SSRF, Preflight Modelle/Speicher, Stage-Neustart nach Absturz, Outbox bis Quittung), Client (Resume per Chunk-Bitmap, Länge + SHA-256, atomarer Projektimport mit Pfad-Umschreibung, vorhandenes lokales Projekt wird gesichert, idempotenter Clip-Import, Wächter bei hängender Übertragung) | `src/main/remote/jobs.ts` |
| Echte Pipeline für Remote-Jobs (dieselben Funktionen wie lokal: importUrl, runTranscription, runAnalysis, renderClips) | `src/main/remote/pipeline.ts`, `renderClips` in `src/main/shortme/ipc.ts` |
| UI: „Verarbeiten auf“ + Clipanzahl beim Link, Auftragsliste (Rechenstand / Verbindung / Übertragung getrennt), „Projekt öffnen“ | `StartScreen.tsx`, `RemoteDevices.tsx` |
| Preload-Brücke | `src/preload/index.ts` (`shortme.remote.*`) |
| UI Einstellungen › Remote-Geräte | `src/renderer/src/shortme/RemoteDevices.tsx` |
| Protokoll, Zustände, Freigabe-Schranke, Proxy-Bereiche, Speicherschutz, SSRF | `src/shared/remote/*`, `src/main/remote/urlGuard.ts` |

## Gates
| Gate | Ergebnis | Nachweis / Grund |
|---|---|---|
| G0 Transport-Spike | **teilweise** | PASS (Container): Kopplung, Nachricht, Ping, 5-MB-Datei SHA-256 gleich, Neustart ohne Re-Pairing, Unpair, Fremdgerät, falscher Code – echtes HyperDHT-Testnetz (`tests/remoteHost.test.ts`); native Module laden + verbinden in Electron 35.7.5. NOT RUN: gepackte Mac/Windows-Builds, Resume nach Abbruch, getrennte Anschlüsse. BLOCKED: Relay. safeStorage: Electron 35 nur synchron (shortcut markiert). |
| G1 Pairing/Worker | **PASS (Windows, ein Rechner, zwei Profile)** / BLOCKED (Mac) | 25.11.: installierte 0.52.0 (A) ↔ zweites Profil (B, `CUTAWAN_USER_DATA`), echtes HyperDHT: Code, gleicher Fingerabdruck beidseitig, Bestätigung, „Verbindung testen“ direkt 1 ms; Neustart beider → ohne neuen Code online. Mac nicht erreichbar (keine Mac-Sitzung online). |
| G2 Remote-Job | **PASS (Windows)** / BLOCKED (Mac) | 25.11.: A → B YouTube-Link (27 min Vlog), B: Download 0:20, ASR 2 min, Engine 4 ~20 min, Render; echte Modelle (Parakeet, Qwen3-14B, MiniCPM-o, Embedding). |
| G3 Einzelclip-Übertragung | **PASS (Windows)** | A war während Render/Veröffentlichung offline (16:00–16:03); nach Neustart von A: Projekt importiert, 2 freigegebene Clips als Exporte, 2 „zur Prüfung“ nur im Projekt; keine Duplikate (2 Exporte, 2 eindeutige Clip-IDs). |
| G4 Editierbare Projekte | Abweichung | Ganzes Projekt + ganze Quelle werden übertragen (voll editierbar, Re-Render lokal). ±30-s-Proxys und Remote-Re-Render: NOT DONE (shortcut in `jobs.ts`). |
| G5/G6 | teilweise | Windows-Hardware: siehe Tests unten (PASS). Mac ↔ Windows über zwei Rechner: BLOCKED (MacBook in dieser Sitzung nicht erreichbar) – Restliste unten. |

## Tests T01–T28
| Test | Ergebnis |
|---|---|
| T02 Pairing + Neustart | PASS im Testnetz; **PASS auf Windows-Hardware (zwei Profile)**, Mac BLOCKED |
| T03 LAN / getrennte Anschlüsse | NOT RUN |
| T04 Relay | BLOCKED (kein freigegebener Relay) |
| T05 Fenster/Tray/Login | PASS auf Windows (Login simuliert per `--hidden`), Mac NOT RUN |
| T07/T08 Link-Job je Richtung | T07 PASS auf Windows (A → B, echte Engine 4); T08 NOT RUN |
| T09 Origin offline | PASS im Testnetz und auf Windows-Hardware (3 min offline, keine Duplikate) |
| T10 Worker-Neustart | teilweise: abgeschlossene Jobs werden nicht neu gestartet (Test); laufende starten nach Neustart die Stage neu (Code, NOT RUN) |
| T12 Einzelclip vor Gesamtende | Logik PASS (Clip wird je Render veröffentlicht) |
| T13 Review/Repair/alter Hash | PASS (Unit: releaseGate; Testnetz: needs-review-Clip nicht veröffentlicht) |
| T14 verlorener ACK / Submit-Wiederholung | PASS im Testnetz (ein Job, ein Import) |
| T22 URL ins Heimnetz | PASS (Worker lehnt `192.168.x` ab); yt-dlp-Redirects nach dem ersten Hop: NOT DONE |
| T15 fehlerhafte Assetdaten | teilweise: SHA-256-Vergleich im Test; Import-Verweigerung noch nicht verdrahtet |
| T22 URL/Redirect/Rebinding | teilweise: `urlGuard` getestet, noch nicht im Downloader |
| T23 Fremder Peer / Replay / Unpair | PASS im Testnetz (Firewall, Replay-Guard, Unpair) |
| alle übrigen | NOT RUN |

Lokale Regression: gesamte Suite 1187 PASS / 19 FAIL – die 19 schlagen identisch auf der Basis 0.51.0 fehl (Container ohne passende Medien/FFmpeg-Fixtures), nicht durch Remote verursacht.

## Hardware-Abnahme Windows (25.11.2026, RTX 5090, installierte 0.52.0 aus dem Release + zweites Profil)
Aufbau: A = installierte App (`Shortme.exe`, Release-Build v0.52.0), B = zweite Instanz mit eigenem Profil und Datenordner (`CUTAWAN_USER_DATA`, `SHORTME_DATA`, Modelle per Verknüpfung) – eigene Geräteidentität, echtes HyperDHT, gleicher Rechner (also kein Netzwerk-Test über zwei Anschlüsse). Gesteuert per CDP.

| Test | Ergebnis | Beobachtung |
|---|---|---|
| Worker aktivieren | PASS | beide `enabled`, eigene deviceId |
| Koppeln mit Code | PASS | Code von A, B tritt bei, beide sehen `84ED-62BF-5C56`, beidseitig bestätigt |
| Verbindung testen | PASS | `ok, 1 ms, direct` in beide Richtungen |
| T02 Neustart beider Apps | PASS | ohne neuen Code wieder online, Test `ok` |
| T05 Fenster schließen | PASS | Prozess läuft weiter, B erreicht A (`ok, 1 ms`); Tray-Symbol nicht per Screenshot geprüft |
| T05 Nach der Anmeldung starten | PASS (simuliert) | Run-Eintrag `Shortme.exe --hidden` gesetzt/entfernt; Start mit `--hidden`: kein Fenster, Worker erreichbar. Echte Ab-/Anmeldung nicht durchgeführt |
| T07 Link-Job A → B (echte Engine) | PASS | Engine 4, 27-min-Vlog, Fortschritt in A sichtbar (Download → Transkription → Analyse → Render) |
| T09 Origin offline | PASS | A 3 min offline während Render/Veröffentlichung, danach Nachlieferung ohne Duplikat |
| Projekt öffnen | PASS | Clipliste mit 4 Clips (2 KI-geprüft, 2 zur Prüfung), „Im Editor“ lädt Video/Untertitel/Zeitleiste |
| T08 Richtung B → A, T03 zwei Anschlüsse, T04 Relay, Mac ↔ Windows | NOT RUN / BLOCKED | MacBook nicht erreichbar; Relay weiterhin nicht freigegeben |

Gefundene und behobene Fehler:
- Eigenes Profil (`CUTAWAN_USER_DATA`) startete nicht neben der normalen App: die Einzelinstanz-Sperre lief vor `app.setPath('userData')` → Sperre jetzt je Profil (Commit bdc8c0c).
- Engine-Anfrage, die der Worker nicht kennt (andere Plattform, ältere Version), wurde still durch die Standard-Engine ersetzt → Worker lehnt jetzt mit `VERSION_INCOMPATIBLE` ab (`isUnsupportedEngine`, Branch `feat/engine6`; Worker ≤ 0.52 bleiben betroffen).
- Beobachtung (nicht behoben): Fortschritt der Remote-Analyse springt zwischen Unterstufen von 1,0 auf 0,5 zurück („Analyse“); dasselbe Video wurde vorher lokal schon einmal importiert – der Remote-Download ergab einen anderen Datei-Hash und damit ein zweites Projekt (kein Doppelimport desselben Jobs).
- Die vollständige Liste T01–T28 (Spezifikation `SHORTME_REMOTE_ENGINE_V4_CLAUDE_CODE.md`) liegt nicht im Repo; nicht aufgeführte Nummern bleiben NOT RUN.

## Selbst prüfen (auf beiden Rechnern)
1. Branch holen, `npm install`, `npm run package` (Windows) bzw. `npm run package -- --mac --publish never` (Mac), installieren.
2. Einstellungen › Remote-Geräte › „Remote-Worker aktivieren“ auf beiden Rechnern.
3. Rechner A: „Code erzeugen“ → kopieren → Rechner B: einfügen → „Verbinden“. Beide zeigen denselben Code (z. B. `A1B2-C3D4-E5F6`) → beide „koppeln“.
4. „Verbindung testen“ → Antwortzeit + „direkt“. Beide Apps neu starten → Geräte kommen ohne neuen Code wieder online.
5. Fenster schließen → Tray-Symbol bleibt; „Worker beenden“ beendet. „Nach der Anmeldung starten“ an → Neustart → Worker läuft versteckt.
6. Startseite → Link einfügen → „Verarbeiten auf“: anderen Rechner wählen, Clipanzahl → „Laden“. Fortschritt erscheint unter „Auf anderen Rechnern“.
7. Fertig: „Projekt öffnen“ → normales Projekt im Editor; freigegebene Clips liegen im Exportordner (Upload-Seite).
