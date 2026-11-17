# Anti-Shortcut-Protokoll: Claude darf keinen halbfertigen V4-Stand als fertig melden

## Zero-guess Statusregeln

Lies `requirements/v4_requirements.json` und halte für **jede der 54 IDs** einen Eintrag in `docs/ENGINE_V4_EVIDENCE.json`. `tools/v4_gate.py --init --repo .` erzeugt das Schema. Nach jedem Test/Run aktualisieren, nie massenhaft auf `passed` setzen. **Keine Statistik aus Freitext**, sondern `--json` auf tatsächlichen Evidence-Manifest rechnen.

| Zustand | Verbindliche Bedeutung |
|---|---|
| `pending` | Nicht implementiert oder keine echten Nachweise |
| `in_progress` | Teilkomponenten laufen, mindestens ein Muss-Gate fehlt |
| `blocked` | konkreter externer Blocker: Hardware, Film, Reviewer, lizenzierter Asset; Repro/Alternativen dokumentiert |
| `failed` | echter negativer Test oder Regression |
| `passed` | Code, automatischer Test mit Exit 0, Testlog + dessen SHA256 und – für gekennzeichnete IDs – realer Medienrun vorhanden |

**Nicht** möglich: `passed` mit leerer Code-Datei, ausschließlich Dokument, generischem Testname oder Claim „Claude meint“. Ein Statusupdate ohne Run-Proof für reale multimodale IDs heißt `in_progress`.

## Was beim Zwischenfragen „Wie weit bist du?“ zu berichten ist

```text
Engine V4 – vierte eigenständige Engine
Git SHA/Branch: ...
54 Muss-IDs: passed n / in_progress n / pending n / blocked n / failed n
Core gate: PASS/FAIL (Exitcode und fehlende IDs)
Quality gate: PASS/FAIL/NOT_MEASURED
Tatsächlich lauffähig: [konkrete E2E Schrittkette]
Nur geplant/Stub: [IDs]
Letzter realer Test: <Befehl> – <Exit> – <Log>
Quelle: <run-id, SHA, Minuten> / Render: <clip path, SHA, AV probe>
GPU/Modelle (wirklich getestet): [Revisions, VRAM, Inputmodalitäten]
Nächste Schritte: konkrete 3 Repo-Code-Arbeiten
Externe Blocker: [welche und warum]
```

## Absicherungen

- `tools/v4_gate.py` **schlägt absichtlich fehl**, solange der echte Shortme-Repo-Code und Evidenzen fehlen. Das ist das richtige Verhalten.
- Keine Umgehung durch editierte JSON-Anforderungsliste, test files ohne Behauptung, Fake-Judge-`pass`, `CI_SKIP`, `pytest -k 'not slow'` als Real-AV-Gate. Halte Anforderungspaket als source-of-truth immutable unter Git.
- `--level core` vs `--level all`: technische Vollständigkeit vs Quality Freigabe; beide getrennt reporten.
- Wenn Session endet bevor fertig: persistierter Handoff mit git status, unvollständigen IDs, zuletzt grünem Test und nächsten Task-IDs; nicht „fertig“ sagen. Die nächste Session startet durch erneutes Lesen der Evidence und Weiterbearbeiten.
- Schreib private/geschützte Testmedien nicht ins Repo oder Git. Nur Pfade/Hashes und Offline-Review-Ergebnisse speichern.

## Wichtige Einschränkung

Ein generischer Evidence-Gate kann absichtliche Fälschung nicht kryptografisch verhindern. Daher müssen ein unabhängiger Entwickler und der Nutzer in der tatsächlich laufenden App den Output überprüfen. Die Kombination aus maschinellen Checks, Run-Proof, echter Hardware und menschlicher Review ist deutlich belastbarer als eine bloße Prompt-Anweisung.
