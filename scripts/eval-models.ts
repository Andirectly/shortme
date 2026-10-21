/** Objektiver LLM-Vergleich mit „Most replayed“-Heatmap (YouTube) und Hochrechnung auf 60 min.
 *   SHORTME_DATA=<Daten> npx tsx --tsconfig tsconfig.node.json scripts/eval-models.ts heat <videoId,…> [Clipanzahl]
 *   SHORTME_DATA=<Daten> npx tsx --tsconfig tsconfig.node.json scripts/eval-models.ts long <Pfad-zum-60-min-Video> [Clipanzahl]
 * Die Heatmap fließt NICHT in die Auswahl ein (sonst zirkulär). Scores der Modelle werden nicht verglichen. Zwischenergebnisse: .tmp/eval/ */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { withLlmModel } from '../src/main/engines'
import { importFile, importUrl } from '../src/main/shortme/importer'
import { loadMeta } from '../src/main/shortme/project'
import { loadTranscript, runTranscription } from '../src/main/shortme/transcription'
import { ensureShots, ensureSignals } from '../src/main/shortme/clips/analysis'
import { loadHeat, heatScore, type HeatPoint } from '../src/main/shortme/clips/heat'
import { selectClips } from '../src/main/shortme/clips/select'

const OUT = join(process.cwd(), '.tmp', 'eval')
const MODELS: Array<[string, string]> = [['Qwen3-14B Q4_K_M', 'qwen3-14b'], ['Qwen3.8 27B Q4_K_M', 'qwen3-8-27b']]
type Clip = { start: number; end: number; score: number; title: string }
interface Run { hash: string; model: string; wanted: number; selectionSec: number; clips: Clip[]; words: number; durationSec: number }

const save = (name: string, v: unknown): Promise<void> => writeFile(join(OUT, name), JSON.stringify(v, null, 1))
const load = async <T>(name: string): Promise<T | null> => { try { return JSON.parse(await readFile(join(OUT, name), 'utf8')) as T } catch { return null } }

async function prepare(hash: string) {
  const meta = (await loadMeta(hash))!
  if (!(await loadTranscript(hash))) await runTranscription(meta, {})
  const t = (await loadTranscript(hash))!
  const signals = await ensureSignals(meta)
  const cuts = await ensureShots(meta)
  return { meta, t, input: { words: t.words, durationSec: meta.durationSec, signals, cuts, heat: null as HeatPoint[] | null, events: null } }
}

/** Alle Videos mit einem Modell: Server einmal laden, Laufzeit nur der Auswahlphase je Video messen. */
async function runModel(label: string, asset: string, hashes: string[], wanted: number): Promise<Run[]> {
  const prepared: Array<Awaited<ReturnType<typeof prepare>> & { h: string }> = []
  for (const h of hashes) prepared.push({ h, ...(await prepare(h)) })
  return withLlmModel(asset, async (url) => {
    const runs: Run[] = []
    for (const p of prepared) {
      const file = `run-${p.h}-${asset}-${wanted}.json`
      const hit = await load<Run>(file)
      if (hit) { runs.push(hit); console.log(`${label} ${p.h.slice(0, 8)}: aus Zwischenspeicher`); continue }
      const t0 = Date.now()
      const clips = await selectClips(p.input, { baseUrl: url, wanted, topicsCache: { load: async () => null, save: async () => undefined } })
      const selectionSec = (Date.now() - t0) / 1000
      if (clips.length && clips.every((c) => /^Heuristik/.test(c.reason))) throw new Error('Modell hat nicht geantwortet (Heuristik)')
      const run: Run = { hash: p.h, model: label, wanted, selectionSec: +selectionSec.toFixed(1), clips: clips.map((c) => ({ start: c.start, end: c.end, score: c.score, title: c.title })), words: p.t.words.length, durationSec: p.meta.durationSec }
      await save(file, run)
      runs.push(run)
      console.log(`${label} ${p.h.slice(0, 8)}: ${clips.length} Clips, Auswahlphase ${selectionSec.toFixed(0)} s (${p.t.words.length} Wörter)`)
    }
    return runs
  })
}

const overlaps = (c: Clip, s: HeatPoint): boolean => Math.min(c.end, s.end) - Math.max(c.start, s.start) > 0

/** Anteil der Clips, die ein Segment aus dem obersten Viertel der Heatmap überlappen. */
function topShare(clips: Clip[], heat: HeatPoint[]): number {
  const sorted = heat.map((h) => h.value).sort((a, b) => a - b)
  const thr = sorted[Math.floor(sorted.length * 0.75)]
  const top = heat.filter((h) => h.value >= thr)
  return clips.length ? clips.filter((c) => top.some((s) => overlaps(c, s))).length / clips.length : 0
}

/** Zufallsbasis: gleich lange Clips an zufälligen Stellen (deterministischer Zufall). */
function randomBaseline(clips: Clip[], heat: HeatPoint[], total: number): number {
  let seed = 12345
  const rnd = (): number => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296 }
  let sum = 0
  const N = 400
  for (let i = 0; i < N; i++) {
    const fake = clips.map((c) => { const len = c.end - c.start; const s = rnd() * Math.max(1, total - len); return { ...c, start: s, end: s + len } })
    sum += topShare(fake, heat)
  }
  return sum / N
}

async function heatEval(ids: string[], wanted: number): Promise<void> {
  const hashes: string[] = []
  for (const id of ids) {
    const file = `import-${id}.json`
    let hash = (await load<{ hash: string }>(file))?.hash
    if (!hash || !(await loadMeta(hash))) {
      console.log(`Import ${id} …`)
      hash = (await importUrl(`https://www.youtube.com/watch?v=${id}`, () => undefined)).meta.hash
      await save(file, { hash })
    }
    hashes.push(hash)
  }
  const results = new Map<string, Run[]>()
  for (const [label, asset] of MODELS) results.set(label, await runModel(label, asset, hashes, wanted))
  console.log('\n| Video | Länge | Wörter | Modell | Clips | Spitzen-Anteil | Zufall | Ø Heat-Wert | Auswahlphase |\n|---|---|---|---|---|---|---|---|---|')
  const agg = new Map<string, { hit: number; n: number; sec: number; rnd: number; heat: number }>()
  for (const h of hashes) {
    const heat = (await loadHeat(h))!
    const meta = (await loadMeta(h))!
    for (const [label] of MODELS) {
      const r = results.get(label)!.find((x) => x.hash === h)!
      const share = topShare(r.clips, heat)
      const rnd = randomBaseline(r.clips, heat, meta.durationSec)
      const mean = r.clips.reduce((n, c) => n + heatScore(heat, c.start, c.end), 0) / Math.max(1, r.clips.length)
      console.log(`| ${meta.title.slice(0, 38)} | ${Math.round(meta.durationSec / 60)} min | ${r.words} | ${label} | ${r.clips.length} | ${(share * 100).toFixed(0)} % | ${(rnd * 100).toFixed(0)} % | ${mean.toFixed(2)} | ${r.selectionSec} s |`)
      const a = agg.get(label) ?? { hit: 0, n: 0, sec: 0, rnd: 0, heat: 0 }
      a.hit += share * r.clips.length; a.n += r.clips.length; a.sec += r.selectionSec; a.rnd += rnd * r.clips.length; a.heat += mean * r.clips.length
      agg.set(label, a)
    }
  }
  console.log('\n| Modell | Clips gesamt | Spitzen-Anteil | Zufallsbasis | Ø Heat-Wert | Auswahlphase gesamt |\n|---|---|---|---|---|---|')
  for (const [label, a] of agg) console.log(`| ${label} | ${a.n} | ${((a.hit / a.n) * 100).toFixed(0)} % | ${((a.rnd / a.n) * 100).toFixed(0)} % | ${(a.heat / a.n).toFixed(2)} | ${a.sec.toFixed(0)} s |`)
}

async function longEval(path0: string, wanted: number | undefined): Promise<void> {
  const path = path0 === 'long60' ? join(process.cwd(), 'test-' + 'videos', 'long-60.mp4') : path0
  const hash = (await importFile(path)).meta.hash
  const meta = (await loadMeta(hash))!
  const want = wanted ?? Math.max(2, Math.round(meta.durationSec / 150))
  const results: Run[] = []
  for (const [label, asset] of MODELS) results.push(...(await runModel(label, asset, [hash], want)))
  console.log(`\n60-min-Messung (${Math.round(meta.durationSec / 60)} min, ${results[0].words} Wörter, ${want} Clips gewünscht)`)
  for (const r of results) console.log(`| ${r.model} | ${r.clips.length} Clips | Auswahlphase ${r.selectionSec} s (${(r.selectionSec / 60).toFixed(1)} min) |`)
}

const [mode, arg, n] = process.argv.slice(2)
mkdir(OUT, { recursive: true })
  .then(() => (mode === 'heat' ? heatEval(arg.split(','), Number(n ?? 6)) : longEval(arg, n ? Number(n) : undefined)))
  .then(() => process.exit(0))
  .catch((e) => { console.error('FAIL', e instanceof Error ? e.stack : e); process.exit(1) })
void existsSync
