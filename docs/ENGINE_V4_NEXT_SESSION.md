# Engine 4 – Übergabe für die nächste Sitzung

Basis-Git `306c0af` + uncommittete Engine-4-Änderungen (siehe `git status`). Stand: Core-Gate 48/50, Quality-Gate 48/54 (rot).

## Offene IDs
| ID | Grund | Was es braucht |
|---|---|---|
| V4-044 | 12/16-GB-GPU nicht vorhanden | Lauf auf dem zweiten Rechner (5070 Ti 16 GB): `ENGINE=engine4 PROFILE=fast SHORTME_DATA=<Daten> npx tsx --tsconfig tsconfig.node.json scripts/engine-run.ts <projekt> auto 3`; MiniCPM-o bf16 braucht ≥ 22 GB → dort erwartbar Abbruch mit klarer Meldung; int4-Variante wäre ein neuer Katalogeintrag + Messung |
| V4-045 | frischer Windows-Rechner | Installer `npm run package` auf sauberem Rechner, Engine 4 wählen, Laufzeiten/Modelle über App installieren, einen Lauf ausführen |
| V4-050–053 | externe Qualitätsdaten | ≥ 20 autorisierte Quellen (podcast/twitch/gaming/rap/no-speech/negative) mit Goldlabels, 2 Blind-Reviewer, dann `docs/ENGINE_V4_QUALITY_EVIDENCE.json` + `tools/v4_eval.py` |

## Repro-Befehle
- Unit/Regression: `npx vitest run` · `npx tsc --noEmit -p tsconfig.node.json` · `npx tsc --noEmit -p tsconfig.web.json`
- Echter Lauf: `ENGINE=engine4 PROFILE=balanced SHORTME_DATA=<Daten mit Junctions models/runtime> npx tsx --tsconfig tsconfig.node.json scripts/engine-run.ts f6b279f9 auto 3` (App vorher schließen)
- Nachweise: `scripts/v4-repair-check.ts`, `v4-run-proof.ts`, `v4-compare-proof.ts`, `v4-cancel-check.ts`, `v4-silent-check.ts`, `v4-asr-check.ts`, `v4-e2e-verify.ts`
- Eintragen: `node scripts/v4-evidence-map.cjs <proofRunId> <hash> <de-hash> <en-hash>` dann `node scripts/v4-evidence.mjs [IDs]`
- Gate/Status: `python docs/implementation/shortme-engine-v4/tools/v4_gate.py --repo . --level core --json` · `node scripts/v4-status.mjs <python>`

## Hinweise
- Engine-4-Läufe liegen in einem Test-Datenordner im Scratchpad (Kopien echter Projekte). Wird er gelöscht, sind Run-Proof-Pfade ungültig → Proof-Lauf in der echten App wiederholen.
- Nächste sinnvolle Arbeit ohne externe Eingaben: Laufzeit der AV-Phase senken (Cut-Judge-Kandidaten, Keyframe-Scan auf langen Videos), Engine-4-Lauf in der installierten App.
