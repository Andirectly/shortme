/** LEER-Diagnose Schritt 3: Debug-Overlay + Kontaktbogen (0,5-s-Raster) für einen Zeitbereich.
 *   SHORTME_DATA=<Daten> npx tsx --tsconfig tsconfig.node.json scripts/leer-overlay.ts <hash> <von> <bis> [Ausgabeordner] */
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { analyzeClipASD, ASD_FPS } from '../src/main/pipeline/asd'
import { detectFacesYuNet } from '../src/main/pipeline/yunet'
import { detectPose } from '../src/main/pipeline/pose'
import { FFMPEG_PATH, runBinary } from '../src/main/pipeline/ffmpeg'
import { loadMeta } from '../src/main/shortme/project'
import { loadClips, ensureShots } from '../src/main/shortme/clips/analysis'
import { grabFrame } from '../src/main/shortme/layout/facecam'
import { cropBox } from '../src/shared/framing'

const FONT = 'C\\:/Windows/Fonts/arial.ttf'
const esc = (s: string): string => s.replace(/[:'\\]/g, '')

async function main(): Promise<void> {
  const [hash, from, to, outArg] = process.argv.slice(2)
  const t0 = Number(from), t1 = Number(to)
  const meta = (await loadMeta(hash))!
  const out = outArg ?? join(process.cwd(), '.tmp', 'leer')
  await mkdir(out, { recursive: true })
  const clips = (await loadClips(hash))!.clips
  const cuts = (await ensureShots(meta)).filter((c) => c >= t0 - 5 && c <= t1 + 5)
  console.log('KAMERAWECHSEL (TransNetV2) im Bereich:', cuts.map((c) => c.toFixed(2)).join(' ') || 'keine')
  const asd = await analyzeClipASD(meta.sourcePath, t0, t1)
  console.log('ASD: Spuren', asd?.tracks.length ?? 0, 'sceneCuts(Frames)', (asd?.sceneCuts ?? []).map((f) => (t0 + f / ASD_FPS).toFixed(2)).join(' '))
  const W = meta.width, H = meta.height
  const rows: string[] = ['t;shot;cx;crop_x0-x1;faces(YuNet %Fläche);pose;spuren(box %Fläche, ASD);person_im_ausschnitt']
  const files: string[] = []
  for (let t = t0; t < t1; t += 0.5) {
    const f = await grabFrame(meta.sourcePath, t)
    const faces = (await detectFacesYuNet(f.rgb, f.w, f.h)).filter((b) => b.score > 0.5)
    const poses = await detectPose(f.rgb, f.w, f.h).catch(() => [])
    const clip = clips.find((c) => t >= c.start && t < c.end)
    const sh = clip?.shots?.find((s) => t - clip.start >= s.start && t - clip.start < s.end)
    const cb = sh ? cropBox({ width: W, height: H }, sh.cx, 9 / 16, sh.zoom) : null
    const kx0 = cb ? cb.x / W : 0, kx1 = cb ? (cb.x + cb.w) / W : 0
    // Spuren zu dieser Zeit (ASD_FPS-Raster)
    const fi = Math.round((t - t0) * ASD_FPS)
    const tr = (asd?.tracks ?? []).map((tk, id) => { const k = fi - tk.start; return k >= 0 && k < tk.boxes!.length ? { id, b: tk.boxes![k], s: tk.scores[k] } : null }).filter((x): x is NonNullable<typeof x> => !!x)
    const inCrop = (cx: number): boolean => !!cb && cx >= kx0 && cx <= kx1
    const personIn = [...faces.map((b) => (b.x1 + b.x2) / 2), ...tr.map((x) => (x.b.x1 + x.b.x2) / 2)].some(inCrop)
    const area = (b: { x1: number; y1: number; x2: number; y2: number }): string => (((b.x2 - b.x1) * (b.y2 - b.y1)) * 100).toFixed(1)
    rows.push([t.toFixed(1), sh ? sh.layout : '-', sh ? sh.cx.toFixed(3) : '-', cb ? `${kx0.toFixed(2)}-${kx1.toFixed(2)}` : '-', faces.map((b) => `${((b.x1 + b.x2) / 2).toFixed(2)}:${area(b)}%`).join(' ') || '-', poses.length ? String(poses.length) : '0', tr.map((x) => `#${x.id}@${((x.b.x1 + x.b.x2) / 2).toFixed(2)}:${area(x.b)}%/${x.s.toFixed(1)}`).join(' ') || '-', cb ? (personIn ? 'ja' : 'NEIN') : '-'].join(';'))
    // Overlay: Gesichter grün, Spuren gelb, Ausschnitt rot, Beschriftung
    const px = (v: number, d: number): number => Math.round(v * d)
    const parts: string[] = []
    for (const b of faces) parts.push(`drawbox=x=${px(b.x1, W)}:y=${px(b.y1, H)}:w=${px(b.x2 - b.x1, W)}:h=${px(b.y2 - b.y1, H)}:color=lime:t=6`)
    for (const x of tr) parts.push(`drawbox=x=${px(x.b.x1, W)}:y=${px(x.b.y1, H)}:w=${px(x.b.x2 - x.b.x1, W)}:h=${px(x.b.y2 - x.b.y1, H)}:color=yellow:t=3`)
    if (cb) parts.push(`drawbox=x=${cb.x}:y=0:w=${cb.w}:h=${H}:color=red:t=10`)
    const label = esc(`${t.toFixed(1)}s ${sh?.layout ?? '-'} cx ${sh ? sh.cx.toFixed(2) : '-'} F${faces.length} P${poses.length} T${tr.length}${cb ? (personIn ? '' : ' LEER') : ''}`)
    parts.push(`drawtext=fontfile='${FONT}':text='${label}':x=20:y=20:fontsize=64:fontcolor=white:box=1:boxcolor=black@0.6`)
    const png = join(out, `f${String(Math.round(t * 10)).padStart(5, '0')}.png`)
    await runBinary(FFMPEG_PATH, ['-y', '-loglevel', 'error', '-ss', t.toFixed(2), '-i', meta.sourcePath, '-frames:v', '1', '-vf', `${parts.join(',')},scale=480:-2`, png])
    files.push(png)
  }
  await writeFile(join(out, 'protokoll.csv'), rows.join('\n'))
  console.log(rows.slice(0, 1).join('\n')); console.log(rows.slice(1).filter((r) => r.endsWith('NEIN')).join('\n') || '(keine Stellen ohne Person im Ausschnitt)')
  // Kontaktbogen: 8 Spalten
  await runBinary(FFMPEG_PATH, ['-y', '-loglevel', 'error', '-framerate', '1', '-pattern_type', 'glob', '-i', join(out, 'f*.png').replace(/\\/g, '/'), '-vf', 'tile=8x:padding=4:color=black', '-frames:v', '1', join(out, 'kontaktbogen.png')]).catch((e) => console.log('Kontaktbogen:', String(e).slice(0, 120)))
  console.log('fertig', out, files.length, 'Bilder')
}
main().then(() => process.exit(0)).catch((e) => { console.error('FAIL', e instanceof Error ? e.stack : e); process.exit(1) })
