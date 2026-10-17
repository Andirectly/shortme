/**
 * M5-Abnahme: Layout-Planung auf den echten Clips der Testvideos (clips.json aus M4 nötig → vorher test-clips.ts).
 * Prüft: lückenlose Shots, feste Ausschnitte, kein Ping-Pong (kein Wechsel < 1 s Abstand außer Kamerawechsel),
 * keine leeren Ausschnitte (fit ohne Gesicht), Gesichtsquote; gibt Shot-Listen zur Sichtprüfung aus.
 *
 *   SHORTME_DATA=.tmp/fresh npx tsx --tsconfig tsconfig.node.json scripts/test-layout.ts [video...]
 */
import { existsSync } from 'node:fs'
import { importFile } from '../src/main/shortme/importer'
import { loadClips } from '../src/main/shortme/clips/analysis'
import { ensureShots } from '../src/main/shortme/clips/analysis'
import { layoutForClip } from '../src/main/shortme/layout/run'

const args = process.argv.slice(2)
const list = args.length ? args : ['test-videos/podcast-2p.mp4', 'test-videos/solo.mp4', 'test-videos/nofaces.mp4'].filter(existsSync)
let failures = 0
const check = (ok: boolean, msg: string): void => { console.log(`${ok ? 'PASS' : 'FAIL'} ${msg}`); if (!ok) failures++ }

async function main(): Promise<void> {
  for (const v of list) {
    const imp = await importFile(v)
    const file = await loadClips(imp.meta.hash)
    if (!file) { console.log(`übersprungen ${v}: keine clips.json`); continue }
    const cuts = await ensureShots(imp.meta)
    for (const c of file.clips) {
      const t0 = Date.now()
      const l = await layoutForClip(imp.meta, c, cuts)
      const dur = c.end - c.start
      const s = l.shots
      console.log(`LAYOUT ${v} ${c.id} ${dur.toFixed(0)} s: ${s.length} Shots, Gesichtsquote ${(l.faceRatio * 100).toFixed(0)} % (Abzug ${l.penalty}), ${((Date.now() - t0) / 1000).toFixed(0)} s`)
      console.log('  ' + s.map((x) => `${x.start.toFixed(1)}-${x.end.toFixed(1)} ${x.layout}${x.layout === 'smart' || x.layout === 'split' ? '@' + x.cx.toFixed(2) + (x.cx2 !== undefined ? '/' + x.cx2.toFixed(2) : '') : ''}`).join(' | '))
      check(Math.abs(s[0].start) < 1e-6 && Math.abs(s[s.length - 1].end - dur) < 0.25, `${c.id}: Shots decken den Clip lückenlos`)
      check(s.every((x, i) => i === 0 || Math.abs(x.start - s[i - 1].end) < 1e-6), `${c.id}: keine Lücken/Überlappungen`)
      const quick = s.filter((x, i) => i > 0 && x.end - x.start < 0.75)
      check(quick.length === 0, `${c.id}: kein Shot kürzer als 0,75 s (kein Flackern/Ping-Pong), kurze: ${quick.length}`)
      check(s.every((x) => x.cx >= 0 && x.cx <= 1), `${c.id}: Ausschnitte im Bild`)
      check(s.every((x) => x.layout !== 'smart' || x.track !== undefined), `${c.id}: smart-Shots haben ein Subjekt (nie leerer Ausschnitt)`)
    }
  }
  console.log(failures === 0 ? 'PASS alles' : `FAIL ${failures} Prüfung(en)`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((e) => { console.error('FAIL', e); process.exit(1) })
