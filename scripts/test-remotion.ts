/** Remotion-Overlay auf einem Beispiel: SHORTME_DATA=<absolut> npx tsx --tsconfig tsconfig.node.json scripts/test-remotion.ts [Sekunden] */
import { BUILTIN_PRESETS } from '../src/shared/preset'
import { prepareRemotionBrowser, remotionFootprint, renderRemotionOverlay } from '../src/main/remotion/render'

async function main(): Promise<void> {
  const dur = Number(process.argv[2] ?? 6)
  const words = 'Das wird richtig gut und das sieht auch echt crazy aus finde ich'.split(' ').map((w, i) => ({ w, start: 0.3 + i * 0.4, end: 0.3 + i * 0.4 + 0.35, tag: i === 5 ? ('emphasis' as const) : undefined }))
  let t0 = Date.now()
  console.log('Browser:', await prepareRemotionBrowser((_f, m) => process.stdout.write(`\r${m}`)))
  console.log(`\nBrowser bereit in ${((Date.now() - t0) / 1000).toFixed(1)} s`)
  t0 = Date.now()
  const r = await renderRemotionOverlay({ preset: BUILTIN_PRESETS[5], words, highlight: true, titleText: 'So wurde ich fast gefeuert', titleSeconds: 3, durationSec: dur, workDir: '.tmp/rm-frames', onProgress: (_f, m) => process.stdout.write(`\r${m}      `) })
  console.log(`\n${r.frames} Bilder in ${((Date.now() - t0) / 1000).toFixed(1)} s → ${r.pattern}`)
  const fp = remotionFootprint()
  console.log(`Zusatzgröße ${(fp.bytes / 1e6).toFixed(0)} MB:`, fp.parts.map((p) => `${p.name} ${(p.bytes / 1e6).toFixed(0)}`).join(', '))
  process.exit(0)
}
main().catch((e) => { console.error('FAIL', e); process.exit(1) })
