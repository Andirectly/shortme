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
| G1 Pairing/Worker | NOT RUN (Hardware) | Code + UI vorhanden; im Container verweigert die App korrekt den Start ohne Schlüsselbund (geprüft per CDP). |
| G2 Remote-Job | teilweise | PASS im Testnetz mit Stellvertreter-Pipeline (`tests/remoteJobs.test.ts`): Annahme, Dedup, Heimnetz-Link + falscher Absender abgelehnt. Echte Pipeline verdrahtet, aber NOT RUN (keine Modelle/GPU hier). |
| G3 Einzelclip-Übertragung | teilweise | PASS im Testnetz: nur `verified` wird veröffentlicht, Client 12-h-Offline-Fall verkürzt (offline während Render → Nachlieferung ohne Duplikat), Quittungen leeren Outbox. |
| G4 Editierbare Projekte | Abweichung | Ganzes Projekt + ganze Quelle werden übertragen (voll editierbar, Re-Render lokal). ±30-s-Proxys und Remote-Re-Render: NOT DONE (shortcut in `jobs.ts`). |
| G5/G6 | NOT RUN | Hardware-Abnahme auf Mac + Windows steht aus. |

## Tests T01–T28
| Test | Ergebnis |
|---|---|
| T02 Pairing + Neustart | PASS nur im Testnetz (Unit/Integration), NOT RUN auf Hardware |
| T03 LAN / getrennte Anschlüsse | NOT RUN |
| T04 Relay | BLOCKED (kein freigegebener Relay) |
| T05 Fenster/Tray/Login | NOT RUN (Code vorhanden) |
| T07/T08 Link-Job je Richtung | NOT RUN (Hardware); Logik PASS im Testnetz |
| T09 Origin offline | PASS im Testnetz (verkürzt) |
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

## Selbst prüfen (auf beiden Rechnern)
1. Branch holen, `npm install`, `npm run package` (Windows) bzw. `npm run package -- --mac --publish never` (Mac), installieren.
2. Einstellungen › Remote-Geräte › „Remote-Worker aktivieren“ auf beiden Rechnern.
3. Rechner A: „Code erzeugen“ → kopieren → Rechner B: einfügen → „Verbinden“. Beide zeigen denselben Code (z. B. `A1B2-C3D4-E5F6`) → beide „koppeln“.
4. „Verbindung testen“ → Antwortzeit + „direkt“. Beide Apps neu starten → Geräte kommen ohne neuen Code wieder online.
5. Fenster schließen → Tray-Symbol bleibt; „Worker beenden“ beendet. „Nach der Anmeldung starten“ an → Neustart → Worker läuft versteckt.
6. Startseite → Link einfügen → „Verarbeiten auf“: anderen Rechner wählen, Clipanzahl → „Laden“. Fortschritt erscheint unter „Auf anderen Rechnern“.
7. Fertig: „Projekt öffnen“ → normales Projekt im Editor; freigegebene Clips liegen im Exportordner (Upload-Seite).
