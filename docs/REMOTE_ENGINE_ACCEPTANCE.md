# Remote Engine – Abnahme (fortlaufend)

Grundlage: `SHORTME_REMOTE_ENGINE_V4_CLAUDE_CODE.md` (24.11.2026) + Plan V3. Ergebnis je Zeile: PASS / FAIL / BLOCKED / NOT RUN.
`NOT RUN` heißt: nicht ausgeführt, nicht „bestanden“.

## Stand / Sicherung
- Branch `main-f8x95h`, Basis 0.51.0 (`e1ff097`). **GitHub-Push: FAIL (HTTP 403)** – Claude GitHub App hat keinen Zugriff auf
  `Andirectly/shortme`. Fix: https://github.com/apps/claude/installations/select_target → Konto *Andirectly* → `shortme`,
  dann https://claude.ai/connect-github. Bis dahin liegen die Commits nur im Cloud-Container.
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
| App-Dienst: Einstellungen, IPC, Tray, Login-Autostart (`--hidden`), Weiterlaufen bei geschlossenem Fenster, Einzelinstanz | `src/main/remote/service.ts`, `src/main/index.ts` |
| Preload-Brücke | `src/preload/index.ts` (`shortme.remote.*`) |
| UI Einstellungen › Remote-Geräte | `src/renderer/src/shortme/RemoteDevices.tsx` |
| Protokoll, Zustände, Freigabe-Schranke, Proxy-Bereiche, Speicherschutz, SSRF | `src/shared/remote/*`, `src/main/remote/urlGuard.ts` |

## Gates
| Gate | Ergebnis | Nachweis / Grund |
|---|---|---|
| G0 Transport-Spike | **teilweise** | PASS (Container): Kopplung, Nachricht, Ping, 5-MB-Datei SHA-256 gleich, Neustart ohne Re-Pairing, Unpair, Fremdgerät, falscher Code – echtes HyperDHT-Testnetz (`tests/remoteHost.test.ts`); native Module laden + verbinden in Electron 35.7.5. NOT RUN: gepackte Mac/Windows-Builds, Resume nach Abbruch, getrennte Anschlüsse. BLOCKED: Relay. safeStorage: Electron 35 nur synchron (shortcut markiert). |
| G1 Pairing/Worker | NOT RUN | Code + UI vorhanden; braucht zwei echte Rechner. Im Container verweigert die App korrekt den Start ohne Schlüsselbund (geprüft per CDP). |
| G2–G6 | NOT RUN | Remote-Job, Clip-Outbox/Import, Proxys/Re-Render, Recovery, Abnahme: noch nicht verdrahtet. |

## Tests T01–T28
| Test | Ergebnis |
|---|---|
| T02 Pairing + Neustart | PASS nur im Testnetz (Unit/Integration), NOT RUN auf Hardware |
| T03 LAN / getrennte Anschlüsse | NOT RUN |
| T04 Relay | BLOCKED (kein freigegebener Relay) |
| T05 Fenster/Tray/Login | NOT RUN (Code vorhanden) |
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
