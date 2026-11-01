/** LEER-Diagnose: Sicherheitsnetz auf ein Projekt anwenden (vorher/nachher), Bilder für einen Zeitpunkt rendern, clips.json aktualisieren.
 *   SHORTME_DATA=<Daten> npx tsx --tsconfig tsconfig.node.json scripts/leer-guard.ts <hash> <clipId> <Sekunde> */
import { join } from 'node:path'
import { loadClips, loadLayoutInput } from '../src/main/shortme/clips/analysis'
import { writeFileAtomic } from '../src/main/shortme/atomic'
import { projectFile, loadMeta } from '../src/main/shortme/project'
import { FFMPEG_PATH, runBinary } from '../src/main/pipeline/ffmpeg'
import { videoChain } from '../src/main/shortme/render/graph'
import { guardEmptyShots } from '../src/shared/layoutPlan'
import type { ShortmeShot } from '../src/shared/shortme'

async function main(): Promise<void> {
  const [hash, id, sec] = process.argv.slice(2)
  const meta = (await loadMeta(hash))!
  const file = (await loadClips(hash))!
  let nOld = 0, sec0 = 0
  for (const c of file.clips) {
    const inp = (await loadLayoutInput(hash, c.id))!
    const before = (c.shots ?? []).filter((s) => !s.auto)
    const after = guardEmptyShots(before, inp)
    const auto = after.filter((s) => s.auto)
    if (auto.length) { nOld++; sec0 += auto.reduce((n, s) => n + s.end - s.start, 0); console.log(`${c.id} ${c.start.toFixed(0)}-${c.end.toFixed(0)}: ${auto.map((s) => `${(c.start + s.start).toFixed(1)}-${(c.start + s.end).toFixed(1)}`).join(' ')} → Ganzes Bild (auto)`) }
    c.shots = after
  }
  console.log(`${nOld} von ${file.clips.length} Clips mit automatischem Ganzes Bild, zusammen ${sec0.toFixed(1)} s`)
  await writeFileAtomic(projectFile(hash, 'clips.json'), JSON.stringify(file, null, 1))
  // Bilder zum Zeitpunkt: vorher (geplanter Ausschnitt ohne Netz) und nachher
  const t = Number(sec)
  const c = file.clips.find((x) => t >= x.start && t < x.end)!
  const inp = (await loadLayoutInput(hash, c.id))!
  void inp
  const after = c.shots!.find((s) => t - c.start >= s.start && t - c.start < s.end)!
  const planned = (await loadLayoutInput(hash, c.id)) && after.auto ? ({ ...after, layout: 'fixed', cx: 0.5, auto: undefined } as ShortmeShot) : after
  for (const [name, sh] of [['vorher', planned], ['nachher', after]] as const) {
    const chain = videoChain({ src0: 0, src1: 0.2, zoom: 1, shot: sh } as never, 0, { width: meta.width, height: meta.height }, 0)
    const out = join(process.cwd(), 'docs', 'leer', `${name}-${sec}.png`)
    await runBinary(FFMPEG_PATH, ['-y', '-loglevel', 'error', '-ss', sec, '-i', meta.sourcePath, '-filter_complex', `${chain};[v0]scale=360:-2[t]`, '-map', '[t]', '-frames:v', '1', out])
    console.log(name, sh.layout, 'cx', sh.cx.toFixed(2), out)
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error('FAIL', e instanceof Error ? e.stack : e); process.exit(1) })
