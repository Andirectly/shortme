/**
 * Engine 4 – Vergleich aller vier Engines auf DERSELBEN Originalquelle (V4-040/049) und ein echter Clip-Recheck durch Engine 4 (V4-041).
 * Nimmt je Engine den neuesten fertigen Lauf des Projekts, legt einen Vergleich an (eingefrorene Lauf-IDs/Optionen) und lässt Engine 4 einen Clip
 * von Engine 2 am gerenderten Ergebnis neu bewerten. Der Recheck wird getrennt gespeichert und fließt nicht in die Zuordnung ein.
 *   SHORTME_DATA=<Daten> npx tsx --tsconfig tsconfig.node.json scripts/v4-compare-proof.ts <projekt-hash>
 */
import { writeFile } from 'node:fs/promises'
import { killAllSidecars } from '../src/main/engines/sidecars'
import { loadState } from '../src/main/shortme/clips/engines/state'
import { LEGACY_RUN_ID } from '../src/shared/engine'
import { addRecheck, createComparison, getComparison } from '../src/main/shortme/clips/compare'
import { loadClips } from '../src/main/shortme/clips/analysis'

async function main(): Promise<number> {
  const hash = process.argv[2]
  const st = await loadState(hash)
  const latest = (e: string): string | undefined => [...st.runs].reverse().find((r) => r.engineId === e && r.status === 'done')?.runId
  const ids = [LEGACY_RUN_ID, latest('multimodal-v2'), latest('adaptive-v3'), latest('engine4')]
  if (ids.some((x) => !x)) { console.log('FAIL: nicht für jede Engine ein fertiger Lauf', ids); return 1 }
  const c = await createComparison(hash, ids as string[])
  const v2clip = (await loadClips(hash, ids[1]))?.clips[0]
  if (!v2clip) { console.log('FAIL: Engine-2-Lauf ohne Clip'); return 1 }
  const before = JSON.stringify((await getComparison(hash, c.comparisonId))!.eventMatches)
  const rechecks = await addRecheck(hash, c.comparisonId, v2clip.id, 'engine4')
  const after = JSON.stringify((await getComparison(hash, c.comparisonId))!.eventMatches)
  const r = rechecks[rechecks.length - 1]
  const out = { comparisonId: c.comparisonId, kind: c.kind, runIds: c.runIds, sourceMediaId: c.sourceMediaId, warnings: c.warnings, matches: c.eventMatches.map((m) => ({ kind: m.kind, runs: m.members.map((x) => x.runId), anchor: Math.round(m.alignment.sourceAnchorSec) })), recheck: { kind: r.kind, byEngine: r.byEngine, clipId: r.clipId, status: r.status, decision: r.qualityLabel, outputSha256: r.outputSha256, note: r.note }, matchesUnchangedByRecheck: before === after }
  await writeFile('docs/ENGINE_V4_COMPARE_PROOF.json', JSON.stringify(out, null, 2) + '\n', 'utf8')
  console.log(JSON.stringify(out, null, 1))
  const ok = c.runIds.length === 4 && r.kind === 'clip-recheck' && r.status === 'done' && before === after
  console.log(ok ? 'PASS' : 'FAIL')
  return ok ? 0 : 1
}
main().then(async (c) => { await killAllSidecars(); process.exit(c) }).catch(async (e) => { console.error('FAIL', e); await killAllSidecars(); process.exit(1) })
