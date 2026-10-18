/** Ähnlichkeit von Gesichts-Embeddings: SHORTME_DATA=.tmp/fresh npx tsx --tsconfig tsconfig.node.json scripts/test-embed.ts <video> <sek>... */
import { execFileSync } from 'node:child_process'
import { FFMPEG_PATH } from '../src/main/pipeline/ffmpeg'
import { detectFacesYuNet } from '../src/main/pipeline/yunet'
import { cosine, cropFaceForEmbed, embedFace } from '../src/main/pipeline/faceEmbed'

async function main(): Promise<void> {
  const [video, ...times] = process.argv.slice(2)
  const W = 1280, H = 720
  const embs: Array<{ label: string; e: Float32Array }> = []
  for (const t of times) {
    const rgb = execFileSync(FFMPEG_PATH, ['-hide_banner', '-loglevel', 'error', '-ss', t, '-i', video, '-frames:v', '1', '-vf', `scale=${W}:${H}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 1 << 28 })
    const faces = (await detectFacesYuNet(rgb, W, H)).sort((a, b) => a.x1 - b.x1)
    for (const f of faces) embs.push({ label: `${t}s@${((f.x1 + f.x2) / 2).toFixed(2)}`, e: await embedFace(cropFaceForEmbed(rgb, W, H, f).tensor) })
  }
  console.log('      ' + embs.map((x) => x.label.padEnd(10)).join(''))
  for (const a of embs) console.log(a.label.padEnd(10) + embs.map((b) => cosine(a.e, b.e).toFixed(2).padEnd(10)).join(''))
  process.exit(0)
}
main().catch((e) => { console.error('FAIL', e); process.exit(1) })
