/** Pose-Test: Personen/Kopfboxen auf Einzelbildern. SHORTME_DATA=.tmp/fresh npx tsx --tsconfig tsconfig.node.json scripts/test-pose.ts <video> <sek>... */
import { execFileSync } from 'node:child_process'
import { FFMPEG_PATH } from '../src/main/pipeline/ffmpeg'
import { detectPose, poseAvailable } from '../src/main/pipeline/pose'

async function main(): Promise<void> {
  const [video, ...times] = process.argv.slice(2)
  if (!poseAvailable()) throw new Error('Pose-Modell fehlt')
  const W = 1280, H = 720
  for (const t of times) {
    const rgb = execFileSync(FFMPEG_PATH, ['-hide_banner', '-loglevel', 'error', '-ss', t, '-i', video, '-frames:v', '1', '-vf', `scale=${W}:${H}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 1 << 28 })
    const t0 = Date.now()
    const ps = await detectPose(rgb, W, H)
    console.log(`t=${t}s (${Date.now() - t0} ms): ${ps.map((p) => `[${p.source}${p.noseVisible ? '' : ' ohne Nase'} Person ${p.box.x1.toFixed(2)}-${p.box.x2.toFixed(2)} Kopf ${p.head ? p.head.x1.toFixed(2) + '-' + p.head.x2.toFixed(2) : '-'}]`).join(' ') || 'niemand'}`)
  }
  process.exit(0)
}
main().catch((e) => { console.error('FAIL', e); process.exit(1) })
