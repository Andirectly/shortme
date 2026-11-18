// Prüft runWithGraphFile gegen ein echtes FFmpeg (Standard: das gebündelte ffmpeg-static, älter als 6.1).
//   npx tsx --tsconfig tsconfig.node.json scripts/ffmpeg-graph-check.ts [ffmpeg.exe]
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ffmpegStatic from 'ffmpeg-static'
import { runBinary } from '../src/main/pipeline/ffmpeg'
import { runWithGraphFile } from '../src/main/shortme/render/filterScript'

const bin = process.argv[2] ?? (ffmpegStatic as unknown as string)
const dir = mkdtempSync(join(tmpdir(), 'graphcheck-'))
const script = join(dir, 'g.txt')
writeFileSync(script, '[0:v]scale=64:64[v]')
runWithGraphFile((b, a) => runBinary(b, a), bin, ['-hide_banner', '-y', '-f', 'lavfi', '-i', 'testsrc=d=1:s=128x128'], '[0:v]scale=64:64[v]', script, ['-map', '[v]', '-frames:v', '1', join(dir, 'o.png')])
  .then(() => console.log('PASS', bin))
  .catch((e: unknown) => { console.log('FAIL', bin, String(e).slice(0, 600)); process.exit(1) })
