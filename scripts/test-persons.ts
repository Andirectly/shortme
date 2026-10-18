/** Personen-Zuordnung auf vorhandenen Clips: SHORTME_DATA=.tmp/fresh npx tsx --tsconfig tsconfig.node.json scripts/test-persons.ts <video> */
import { importFile } from '../src/main/shortme/importer'
import { ensureShots, loadClips } from '../src/main/shortme/clips/analysis'
import { layoutForClip } from '../src/main/shortme/layout/run'
import { buildPersons } from '../src/main/shortme/clips/persons'

async function main(): Promise<void> {
  const imp = await importFile(process.argv[2])
  const file = await loadClips(imp.meta.hash)
  if (!file) throw new Error('keine clips.json')
  const cuts = await ensureShots(imp.meta)
  const layouts = []
  for (const c of file.clips) { const l = await layoutForClip(imp.meta, c, cuts); layouts.push(l); console.log(`${c.id}: ${l.identities.length} Tracks mit Gesicht, ${l.input.tracks.length} Tracks`) }
  const pf = await buildPersons(imp.meta, file.clips, layouts)
  console.log(`Personen: ${pf.persons.map((p) => `${p.id} ${p.seconds}s`).join(', ')} · Sicherheit ${pf.confidence.toFixed(2)} · Nachfrage ${pf.needsReview}`)
  const perClip = new Map<string, Set<string>>()
  for (const [k, p] of Object.entries(pf.assignment)) { const c = k.split(':')[0]; perClip.set(c, (perClip.get(c) ?? new Set()).add(p)) }
  for (const [c, s] of perClip) console.log(`  ${c}: ${[...s].join(',')}`)
  process.exit(0)
}
main().catch((e) => { console.error('FAIL', e); process.exit(1) })
