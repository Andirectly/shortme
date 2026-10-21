/** A1: VAD-Parameter und Lückenfüllung auf Ausschnitten messen (je 10 min aus podcast-2p, solo, long-60).
 *   SHORTME_DATA=<Daten mit Parakeet> npx tsx --tsconfig tsconfig.node.json scripts/test-vad.ts [name …]
 *   Ausschnitte vorher: ffmpeg → .tmp/asr/<name>.wav (16 kHz mono). */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fillGaps, transcribeWav } from '../src/main/engines/asr/client'
import { VAD_DEFAULTS, type AsrSegment, type Range, type VadParams } from '../src/main/engines/asr/protocol'
import { mergeFilled } from '../src/main/shortme/transcription'

const CONFIGS: Array<[string, VadParams]> = [
  ['Standard (0,5 / 0,4 / 0,25)', VAD_DEFAULTS],
  ['Schwelle 0,4', { ...VAD_DEFAULTS, threshold: 0.4 }],
  ['0,35 / 0,3 / 0,2', { ...VAD_DEFAULTS, threshold: 0.35, minSilence: 0.3, minSpeech: 0.2 }],
  ['Standard + Polster 0,15 s', { ...VAD_DEFAULTS, pad: 0.15 }],
  ['0,35 / 0,3 / 0,2 + Polster 0,15 s', { ...VAD_DEFAULTS, threshold: 0.35, minSilence: 0.3, minSpeech: 0.2, pad: 0.15 }]
]

async function main(): Promise<void> {
  const names = process.argv.slice(2).length ? process.argv.slice(2) : ['podcast', 'solo', 'long']
  for (const name of names) {
    const wav = join(process.cwd(), '.tmp', 'asr', `${name}.wav`)
    if (!existsSync(wav)) { console.log('fehlt', wav); continue }
    console.log(`\n== ${name}`)
    for (const [label, vad] of CONFIGS) {
      const t0 = Date.now()
      const r = await transcribeWav(wav, { vad })
      const words = r.segments.reduce((n, s) => n + s.words.length, 0)
      const sec = (Date.now() - t0) / 1000
      const g = await fillGaps(wav, r.segments.flatMap((s) => s.words.map((w) => [w.start, w.end] as Range)))
      const m = mergeFilled(r.segments as AsrSegment[], g.found, g.segments)
      console.log(`${label.padEnd(36)} Wörter ${String(words).padStart(5)} | Lücken gefunden ${m.report.found} (${m.report.foundSec} s), gefüllt ${m.report.filled}, +${m.report.wordsAdded} Wörter | nach Füllung ${words + m.report.wordsAdded} | ASR ${sec.toFixed(0)} s, Suche ${(g.scanMs / 1000).toFixed(0)} s + Füllen ${(g.decodeMs / 1000).toFixed(0)} s`)
    }
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error('FAIL', e instanceof Error ? e.stack : e); process.exit(1) })
