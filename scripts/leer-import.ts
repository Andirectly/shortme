/** LEER-Diagnose Schritt 1: Video importieren (oder vorhandenes Projekt nutzen), ffprobe/cropdetect melden.
 *   SHORTME_DATA=<Daten> npx tsx --tsconfig tsconfig.node.json scripts/leer-import.ts <youtube-url> */
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { FFMPEG_PATH, FFPROBE_PATH } from '../src/main/pipeline/ffmpeg'
import { importUrl } from '../src/main/shortme/importer'
import { projectsRoot } from '../src/main/shortme/project'

async function main(): Promise<void> {
  const url = process.argv[2]
  let hash = ''
  let path = ''
  for (const h of await readdir(projectsRoot())) {
    try { const m = JSON.parse(await readFile(join(projectsRoot(), h, 'project.json'), 'utf8')); if (m.sourceUrl === url) { hash = h; path = m.sourcePath } } catch { /* weiter */ }
  }
  if (!hash) { const r = await importUrl(url, () => undefined); hash = r.meta.hash; path = r.meta.sourcePath; console.log('importiert') } else console.log('vorhandenes Projekt')
  console.log('HASH', hash, 'PFAD', path)
  const probe = JSON.parse(execFileSync(FFPROBE_PATH, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name,profile,width,height,r_frame_rate,avg_frame_rate,sample_aspect_ratio,display_aspect_ratio,pix_fmt,color_space,nb_frames,duration,time_base:stream_tags=rotate:side_data=rotation', '-of', 'json', path], { encoding: 'utf8', maxBuffer: 1 << 28 }))
  console.log('FFPROBE', JSON.stringify(probe.streams[0]))
  // Zeitstempel-Abstände der ersten 600 Frames: fest oder variabel?
  const pts = execFileSync(FFPROBE_PATH, ['-v', 'error', '-select_streams', 'v:0', '-read_intervals', '%+20', '-show_entries', 'frame=pts_time', '-of', 'csv=p=0', path], { encoding: 'utf8', maxBuffer: 1 << 28 }).split('\n').map(Number).filter((x) => Number.isFinite(x))
  const d = pts.slice(1).map((x, i) => +(x - pts[i]).toFixed(4))
  console.log('PTS-Abstände (20 s):', 'min', Math.min(...d), 'max', Math.max(...d), 'verschiedene', [...new Set(d)].slice(0, 6).join(','))
  // Schwarze Balken
  const crop = execFileSync(FFMPEG_PATH, ['-hide_banner', '-ss', '60', '-t', '60', '-i', path, '-vf', 'cropdetect=24:2:0', '-f', 'null', '-'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).toString()
  void crop
}
main().then(() => process.exit(0)).catch((e) => { const out = e.stderr?.toString() ?? ''; const m = [...out.matchAll(/crop=\S+/g)].map((x) => x[0]); if (m.length) { const c = new Map<string, number>(); for (const x of m) c.set(x, (c.get(x) ?? 0) + 1); console.log('CROPDETECT', [...c.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).join(' | ')); process.exit(0) } console.error('FAIL', e instanceof Error ? e.message : e); process.exit(1) })
