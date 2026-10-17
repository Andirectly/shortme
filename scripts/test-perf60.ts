/**
 * M8-Leistungsprüfung: 60-min-Video Ende-zu-Ende (Import → Transkription → Analyse/Clips/Layouts → Export von 3 Clips).
 *   SHORTME_DATA=.tmp/fresh-perf npx tsx --tsconfig tsconfig.node.json scripts/test-perf60.ts [video]
 * Ausgabe: Dauer je Stufe, Echtzeitfaktoren, Anzahl Clips; schreibt .tmp/perf60.json
 */
import { writeFile } from 'node:fs/promises'
import { importFile } from '../src/main/shortme/importer'
import { runTranscription } from '../src/main/shortme/transcription'
import { ensureSignals, runAnalysis } from '../src/main/shortme/clips/analysis'
import { exportClip } from '../src/main/shortme/render/exporter'
import { killAllSidecars } from '../src/main/engines/sidecars'

const video = process.argv[2] ?? 'test-videos/long-60.mp4'
const t = (): number => Date.now()
const res: Record<string, number | string> = {}

async function main(): Promise<void> {
  let t0 = t()
  const imp = await importFile(video)
  res.import_s = (t() - t0) / 1000
  const dur = imp.meta.durationSec
  console.log(`IMPORT ${dur.toFixed(0)} s Video, preflight ok=${imp.preflight.ok} in ${res.import_s} s`)

  t0 = t()
  let last = ''
  const tr = await runTranscription(imp.meta, { onProgress: (p) => { const k = `${p.stage}${Math.floor(p.fraction * 10)}`; if (k !== last) { last = k; console.log(`  ${((t() - t0) / 1000).toFixed(0)}s ${p.stage} ${(p.fraction * 100).toFixed(0)}%`) } } })
  res.transcribe_s = (t() - t0) / 1000
  console.log(`TRANSCRIBE ${tr.words.length} Wörter in ${res.transcribe_s} s = ${(Number(res.transcribe_s) / dur).toFixed(3)}× Echtzeit`)

  t0 = t()
  last = ''
  const an = await runAnalysis(imp.meta, { onProgress: (s, f, m) => { const k = `${s}${Math.floor(f * 4)}`; if (k !== last) { last = k; console.log(`  ${((t() - t0) / 1000).toFixed(0)}s ${s} ${(f * 100).toFixed(0)}% ${m}`) } } })
  res.analyze_s = (t() - t0) / 1000
  res.clips = an.clips.length
  res.mode = an.mode
  console.log(`ANALYSE ${an.clips.length} Clips (${an.mode}) in ${res.analyze_s} s = ${(Number(res.analyze_s) / dur).toFixed(3)}× Echtzeit`)

  const signals = await ensureSignals(imp.meta)
  t0 = t()
  let secOut = 0
  for (const clip of an.clips.slice(0, 3)) {
    const r = await exportClip(imp.meta, clip, tr, signals, { outDir: '.tmp/perf-out', srt: false })
    secOut += r.durationSec
  }
  res.export3_s = (t() - t0) / 1000
  res.export3_out_s = secOut
  console.log(`EXPORT 3 Clips (${secOut.toFixed(0)} s Material) in ${res.export3_s} s`)

  res.total_s = Number(res.import_s) + Number(res.transcribe_s) + Number(res.analyze_s)
  res.total_with_export_s = Number(res.total_s) + Number(res.export3_s)
  res.peak_rss_mb = Math.round(process.memoryUsage().rss / 1e6)
  console.log(`GESAMT bis Clipliste ${(Number(res.total_s) / 60).toFixed(1)} min (${(Number(res.total_s) / dur).toFixed(2)}× Echtzeit), inkl. 3 Exporte ${(Number(res.total_with_export_s) / 60).toFixed(1)} min`)
  await writeFile('.tmp/perf60.json', JSON.stringify(res, null, 1))
  await killAllSidecars()
  process.exit(0)
}

main().catch(async (e) => { console.error('FAIL', e); await killAllSidecars(); process.exit(1) })
