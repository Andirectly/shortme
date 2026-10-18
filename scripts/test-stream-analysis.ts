/** Stream-Analyse an einer KOPIE eines Projekts (Original bleibt unverändert): Facecam suchen, Szenen, Layout je Clip.
 *   SHORTME_DATA=<Daten> npx tsx --tsconfig tsconfig.node.json scripts/test-stream-analysis.ts <hash> [typ] */
import { cp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { projectsRoot, loadMeta } from '../src/main/shortme/project'
import { loadClips, runAnalysis } from '../src/main/shortme/clips/analysis'

async function main(): Promise<void> {
  const [hash, kind = 'stream'] = process.argv.slice(2)
  const copy = 'zz_streamtest'
  await rm(join(projectsRoot(), copy), { recursive: true, force: true })
  await cp(join(projectsRoot(), hash), join(projectsRoot(), copy), { recursive: true })
  const pj = join(projectsRoot(), copy, 'project.json')
  const m = JSON.parse(await readFile(pj, 'utf8')); m.hash = copy; await writeFile(pj, JSON.stringify(m))
  const meta = (await loadMeta(copy))!
  const t0 = Date.now()
  await runAnalysis(meta, { contentType: kind as never, onProgress: (s, f, msg) => { if (f === 0 || f === 1) console.log(s, msg) } })
  const clips = (await loadClips(copy))!.clips
  console.log('CLIPS', clips.length, ((Date.now() - t0) / 1000).toFixed(0), 's')
  for (const c of clips.slice(0, 4)) console.log(c.score, c.title, '| shots:', (c.shots ?? []).map((s) => `${s.layout}${s.stream ? ':' + s.stream.preset : ''}@${s.start.toFixed(0)}-${s.end.toFixed(0)}`).join(' '), '| faceRatio', c.faceRatio)
  if (!process.env.KEEP) await rm(join(projectsRoot(), copy), { recursive: true, force: true })
}
main().then(() => process.exit(0)).catch((e) => { console.error('FAIL', e instanceof Error ? e.stack : e); process.exit(1) })
