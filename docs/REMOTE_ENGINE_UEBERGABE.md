# ShortMe Remote Engine – Übergabe (24.11.2026)

## Ziel
Zwei eigene Rechner (Mac M1 Pro + Windows-PC mit NVIDIA-GPU) werden einmalig gekoppelt. Auf dem einen Rechner
gibt man einen Video-Link ein, der andere lädt herunter, rechnet die komplette KI-Pipeline und schickt fertige,
geprüfte Clips plus editierbare Vorschau-Puffer zurück. Grundlage: `SHORTME_REMOTE_ENGINE_IMPLEMENTIERUNGSPLAN_V3.pdf`
(18 Seiten, 22 Kapitel, Phasen 0–6). Nutzung nur privat, keine Cloud-KI.

## Stand
- App-Version 0.51.0 (Electron 35, React, Vite, vitest). Repo `Andirectly/shortme`, Arbeitsbranch `main-f8x95h`.
- **Fertig und getestet** (13 Tests grün, Typprüfung und Lint sauber) – nur Logik, noch nicht in der App verdrahtet:
  - `src/shared/remote/protocol.ts` – versionierte Nachrichten, Prüfung jeder eingehenden Nachricht, Rechte, Replay-Schutz
  - `src/shared/remote/states.ts` – vier getrennte Zustände (Rechnen / Verbindung / Übertragung / Freigabe), „3 Ready / 2 Processing / 1 Needs review“
  - `src/shared/remote/releaseGate.ts` – Clip nur bei `accepted`-Audit zum exakten Render-Hash; idempotenter Import, ACK
  - `src/shared/remote/proxyRanges.ts` – Puffer ±30 s, überlappende Bereiche zusammenführen, nur Lücken nachladen
  - `src/shared/remote/storage.ts` – reservierte Originale nie automatisch löschen, sonst Job blockieren
  - `src/main/remote/urlGuard.ts` – SSRF-Schutz für Video-Links
  - `tests/remoteEngine.test.ts`, `docs/REMOTE_ENGINE.md` (Repo-Audit + offene Punkte)
- **Nicht vorhanden:** Gerätekopplung, Geräteschlüssel, Transport, Hintergrund-Worker, Tray, Autostart, UI.

## Probleme
1. **GitHub-Push scheitert (403):** „Claude doesn't have GitHub access to Andirectly/shortme“. Vermutlich ist das
   zweite Konto **Andirectli** verbunden oder die Claude GitHub App ist für das Repo nicht freigegeben.
   Folge: Die Commits oben liegen nur im Cloud-Container und sind auf GitHub NICHT sichtbar.
   Lösung: https://github.com/apps/claude/installations/select_target → Konto Andirectly → `shortme` freigeben,
   dann https://claude.ai/connect-github neu verbinden.
2. **Transport / Relay nicht entschieden (Phase-0-Blocker laut Plan).** Der Plan verlangt Direct P2P **plus**
   verbindlichen E2E-Relay-Fallback (Kap. 2, 3, 16). Hintergrund: Zwei Rechner hinter Heim-Routern finden sich nicht
   von selbst – ein Vermittler tauscht die Adressen aus, danach laufen die Daten direkt (Hole Punching). Scheitert
   das (Handy-Hotspot, DS-Lite/CGNAT), leitet ein Relay die verschlüsselten Daten weiter.
   Wunsch des Nutzers: **keinen Server mieten**, alles soll zwischen den PCs laufen.
   Optionen:
   - **iroh mit kostenlosen öffentlichen n0-Relays** (Empfehlung): nichts mieten, E2E-verschlüsselt; offiziell „für
     Entwicklung/Tests“ und gedrosselt – bei gelungener Direktverbindung egal.
   - Heim-PC selbst erreichbar machen (IPv6 oder Portfreigabe + dynamisches DNS, z. B. MyFRITZ!): ganz ohne Dritte,
     aber Router-Einrichtung, und manche Netze blocken.
   - Tailscale (kostenlos privat): am einfachsten, aber Zusatzprogramm auf beiden Rechnern.
   - AlterSend (im Plan genannt): per Websuche nicht auffindbar, ungeprüft.
3. **iroh in Electron:** offen, welche Node-/Electron-Anbindung (iroh-ffi o. ä.) für Mac-arm64 und Windows-x64
   gepackt funktioniert. Muss im Phase-0-Test mit echten gepackten Builds geprüft werden.
4. **Geräteschlüssel:** Plan verlangt asynchrones `safeStorage` (`encryptStringAsync`). Ob Electron 35 das hat, ist
   ungeprüft → ggf. Electron-Update nötig. Kein Klartext-Fallback erlaubt.
5. **Keine echten Tests möglich in der Cloud:** Worker, Tray, Autostart, Pairing und die Testmatrix (Kap. 17)
   brauchen beide echten Rechner. Bisher ist kein Test auf echter Hardware gelaufen.

## Nächste Schritte
1. GitHub-Zugriff reparieren und Branch `main-f8x95h` pushen.
2. Transport entscheiden (Empfehlung: iroh + n0-Relays) und in `docs/REMOTE_ENGINE.md` festhalten.
3. Phase 0 auf den echten Rechnern: Mini-Spike mit gepackter App (Pairing, Reconnect, Direct P2P, Relay-Fallback,
   Chunk-Resume) zwischen Mac und Windows in zwei verschiedenen Netzen.
4. Phase 1: Geräteschlüssel, Pairing-UI, eigenständiger Worker-Prozess, Tray, Login-Autostart (beide Systeme).
5. Phase 2–6 laut Plan: Remote-Job mit Preflight, Clip-Outbox/Import, Proxys, Remote-Re-Render, Abnahme.
