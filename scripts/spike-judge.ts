/**
 * Spike: blinde Gegenbewertung. Alle Clips der drei Modelle (spikes/out/*__<video>.json) werden mit zwei Richter-Modellen
 * (Qwen3.8-27B und Gemma 4 12B) nach derselben Rubrik bewertet (rate-Prompt, 2 Proben, Summe 0–20); Mittelwert je Modell.
 * Der Richter sieht weder Modellname noch Titel/Begründung des Clips – nur den Text.
 *   SHORTME_DATA=<absolut> npx tsx --tsconfig tsconfig.node.json scripts/spike-judge.ts <video>
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { importFile } from '../src/main/shortme/importer'
import { loadTranscript } from '../src/main/shortme/transcription'
import { splitSentences } from '../src/main/shortme/clips/sentences'
import { chatJson, loadPrompt } from '../src/main/shortme/clips/llm'
import { RATE_SCHEMA, critSum, mergeRatings, validateRate } from '../src/main/shortme/clips/select'
import { LlamaServer, killAllSidecars } from '../src/main/engines/sidecars'

const SPIKE = resolve('.tmp/spike-models')
const JUDGES = [
  { name: 'qwen38-27b', model: join(SPIKE, 'Qwen3.8-27B-IQ3_S-3.23bpw.gguf') },
  { name: 'gemma4-12b', model: join(SPIKE, 'gemma-4-12b-it-qat-q4_0.gguf') }
]
const CANDIDATES = ['qwen3-14b', 'gemma4-12b', 'qwen38-27b']

interface SpikeClip { start: number; end: number; title: string; score: number }

async function main(): Promise<void> {
  const video = process.argv[2]
  const stem = basename(video, '.mp4')
  const imp = await importFile(video)
  const t = (await loadTranscript(imp.meta.hash))!
  const sentences = splitSentences(t.words)
  const sets = Object.fromEntries(CANDIDATES.map((m) => [m, (JSON.parse(readFileSync(`spikes/out/${m}__${stem}.json`, 'utf8')) as { clips: SpikeClip[] }).clips]))
  const textOf = (c: SpikeClip): string => sentences.filter((s) => s.start >= c.start - 0.5 && s.end <= c.end + 0.5).map((s) => `[S${s.index}] ${s.text}`).join('\n')
  const result: Record<string, Record<string, number[]>> = {}
  for (const j of JUDGES) {
    const srv = new LlamaServer()
    const url = await srv.start({ model: j.model, ctx: 16384 })
    result[j.name] = {}
    for (const m of CANDIDATES) {
      result[j.name][m] = []
      for (const c of sets[m]) {
        const text = textOf(c)
        const samples = []
        for (let k = 0; k < 2; k++) {
          const p = await loadPrompt('rate', { topic: '', query: '', clip: text })
          samples.push(await chatJson(url, p, { schema: RATE_SCHEMA, validate: validateRate, maxTokens: 800, temperature: k === 0 ? 0.2 : 0.5 }).catch(() => null))
        }
        const ok = samples.filter((s): s is NonNullable<typeof s> => !!s)
        result[j.name][m].push(ok.length ? critSum(mergeRatings(ok, text).criteria) : NaN)
      }
      const v = result[j.name][m].filter((x) => !Number.isNaN(x))
      console.log(`JUDGE ${j.name} bewertet ${m}: Ø ${(v.reduce((a, b) => a + b, 0) / Math.max(1, v.length)).toFixed(1)} von 20 (${v.length} Clips)`)
    }
    await srv.stop()
  }
  writeFileSync(`spikes/out/judge__${stem}.json`, JSON.stringify(result, null, 1))
  await killAllSidecars()
  process.exit(0)
}
main().catch((e) => { console.error('FAIL', e); process.exit(1) })
