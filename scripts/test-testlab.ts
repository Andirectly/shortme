/** Testlab-Abnahme ohne UI. SHORTME_DATA=<absolut> npx tsx --tsconfig tsconfig.node.json scripts/test-testlab.ts [face|tracking] [video] [start] [dauer] */
import { runLab, labSources } from '../src/main/testlab/lab'
import { modelsView } from '../src/main/testlab/registry'
import { killAllSidecars } from '../src/main/engines/sidecars'

const PAIRS: Record<string, [string, string]> = { face: ['yunet', 'scrfd_10g'], tracking: ['iou_tracks', 'botsort_reid'] }

async function main(): Promise<void> {
  const [slot = 'face', video = 'podcast-2p.mp4', start = '60', dur = '30'] = process.argv.slice(2)
  const src = (await labSources()).find((s) => s.label.includes(video))
  if (!src) throw new Error('Quelle nicht gefunden: ' + video)
  const v = await modelsView()
  console.log('Plätze:', v.slots.map((s) => `${s.id}=${v.active[s.id]}`).join(' '))
  const [a, b] = PAIRS[slot]
  const r = await runLab({ slot, modelA: a, modelB: b, source: src.id, start: +start, dur: +dur }, (p) => console.log(`  ${p.side}: ${p.message}`))
  for (const [n, x] of [[`A ${a}`, r.a], [`B ${b}`, r.b]] as const) console.log(`${n}: ${x.runtimeSec} s, VRAM +${x.vramPeakMb} MB, Sprechzeit mit Gesicht ${x.speechFaceShare === null ? '–' : Math.round(x.speechFaceShare * 100) + ' %'} (${x.speechSec} s Sprache), ${x.tracks.length} Spuren, ID-Wechsel ${x.idSwitches} [${x.context}]`)
  await killAllSidecars()
  process.exit(0)
}
main().catch((e) => { console.error('FAIL', e); process.exit(1) })
