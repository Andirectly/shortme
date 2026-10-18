/** Facecam + Gameplay: Clip eines Projekts mit erkannter Facecam rendern (ohne das Projekt zu verändern).
 *   SHORTME_DATA=<Daten> npx tsx --tsconfig tsconfig.node.json scripts/test-stream.ts <hash> [preset] [gap] */
import { join } from 'node:path'
import { loadMeta } from '../src/main/shortme/project'
import { loadTranscript } from '../src/main/shortme/transcription'
import { loadClips, ensureSignals } from '../src/main/shortme/clips/analysis'
import { exportClip } from '../src/main/shortme/render/exporter'
import { findFacecam } from '../src/main/shortme/layout/facecam'
import { defaultStream, type StreamPreset } from '../src/shared/streamLayout'
import { BUILTIN_PRESETS } from '../src/shared/preset'

async function main(): Promise<void> {
  const [hash, preset = 'top', gap = '0'] = process.argv.slice(2)
  const meta = (await loadMeta(hash))!
  const t = (await loadTranscript(hash))!
  const clip = (await loadClips(hash))!.clips[0]
  const cam = await findFacecam(meta.sourcePath, clip.start, clip.end)
  if (!cam) throw new Error('keine Facecam')
  const stream = defaultStream({ width: meta.width, height: meta.height }, cam.cam, preset as StreamPreset, Number(gap))
  const shots = [{ start: 0, end: clip.end - clip.start, layout: 'stream' as const, cx: 0.5, zoom: 1, stream }]
  const signals = await ensureSignals(meta)
  const out = join(process.cwd(), '.tmp', 'stream-test')
  const style = BUILTIN_PRESETS.find((p) => p.id === 'glow-karaoke') ?? BUILTIN_PRESETS[0]
  const r = await exportClip(meta, { ...clip, shots, stream }, t, signals, { outDir: out, style, hook: true, hookText: 'Marineford Sprengung beginnt', engine: 'tscaps' })
  console.log('PASS', r.path, r.durationSec.toFixed(1), r.captionEngine)
}
main().then(() => process.exit(0)).catch((e) => { console.error('FAIL', e instanceof Error ? e.stack : e); process.exit(1) })
