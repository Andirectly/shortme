# Remote Engine – Stand

Grundlage: `SHORTME_REMOTE_ENGINE_IMPLEMENTIERUNGSPLAN_V3.pdf` (24.11.2026). Nichts davon ist in der UI aktiv.

## Phase 0 – Repo-Audit (Ist-Zustand 0.51.0)
- Electron `^35`, electron-vite 3, vitest 4. Fenster: `sandbox`, `contextIsolation`, kein `nodeIntegration` (main/index.ts).
- Vorhanden: JobQueue mit Stufen + Zeitmessung (main/shortme/jobs.ts), Projekte `<userData>/projects/<hash>/`,
  Engines je Plattform (`enginesFor`, `isLocalEngine`), Clipversion `clipRevision` (shared/review.ts, Hash-String),
  Engine-Urteile `v2.verification` (`verified|needs-review|failed`) bzw. `decideMac2`, atomare Dateien (atomic.ts).
- **Nicht vorhanden:** Tray, Login-Autostart, Hintergrund-Worker ohne Fenster, safeStorage, Gerätekennung, Pairing,
  P2P/Relay-Transport, Schema-Bibliothek (kein zod → eigene Validatoren in `parseMessage`).
- Abweichung vom Plan: `clipRevision` ist ein String-Hash, keine Zahl. Plan-Typen entsprechend angepasst.
- safeStorage-Async-API (`encryptStringAsync`) in Electron 35 noch nicht geprüft → bei Phase 1 klären (ggf. Electron-Update).

## Umgesetzt (geräteunabhängiger Kern, getestet: `npx vitest run tests/remoteEngine.test.ts`)
| Datei | Plan-Kapitel |
|---|---|
| `src/shared/remote/protocol.ts` | 13/14 – versionierte Nachrichten, Validierung an der Vertrauensgrenze, Rechte je Nachricht, Replay-Schutz |
| `src/shared/remote/states.ts` | 7/18 – vier getrennte Zustände, erlaubte Übergänge, Clip-Kacheln, „3 Ready / 2 Processing / 1 Needs review“ |
| `src/shared/remote/releaseGate.ts` | 9/10/12 – Freigabe nur bei `accepted` zum exakten Render-Hash/Attempt/Revision, idempotenter Import, ACK-Prüfung |
| `src/shared/remote/proxyRanges.ts` | 11 – Handles, Intervall-Merging, nur fehlende Bereiche nachladen, Priorisierung |
| `src/shared/remote/storage.ts` | 8 – Leases schützen Originale/nicht quittierte Renders, Bereinigung blockiert statt löscht |
| `src/main/remote/urlGuard.ts` | 6/14 – SSRF: Schema, Zugangsdaten, localhost, private/Link-Local/CGNAT-Adressen (v4/v6) |

## Offen (braucht echte Geräte bzw. eine Entscheidung)
1. **Transport + Relay (Phase-0-Gate):** AlterSend vs. iroh mit gepackten Mac-arm64/Windows-x64-Builds testen;
   Relay-Betreiber festlegen (eigener Server oder Anbieter, Kosten). Ohne diese Entscheidung kein Phase-1-Code für Transport.
2. Phase 1: Geräteschlüssel (safeStorage/Keychain/DPAPI), Pairing-UI, Worker-Prozess, Tray, Login-Autostart – nur auf echten Rechnern prüfbar.
3. Phase 2–6: Worker-Host um die vorhandene JobQueue, Outbox/Inbox, Proxy-Erzeugung (FFmpeg + PTS-Map), Remote-Re-Render, UI.
4. Kein Test aus der Testmatrix (Kap. 17) ist auf echter Hardware gelaufen.
