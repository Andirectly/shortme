/**
 * Modell-Spike (M13): gleiche Clip-Auswahl mit verschiedenen lokalen Modellen – Qualität (Clips zum Sichten), VRAM, Laufzeit.
 *
 *   SHORTME_DATA=<absolut> npx tsx --tsconfig tsconfig.node.json scripts/spike-llm.ts <modell> <video> [--audio]
 *   modell: qwen3-14b | gemma4-12b | qwen38-27b | <Pfad.gguf>[,<mmproj.gguf>]
 * Schreibt spikes/out/<modell>__<video>.json (Clips, Zeiten, VRAM). --audio: Gemma-Audio-Test für die Finalisten (siehe unten).
 */
import { execFileSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { importFile } from '../src/main/shortme/importer'
import { loadTranscript } from '../src/main/shortme/transcription'
import { ensureShots, ensureSignals } from '../src/main/shortme/clips/analysis'
import { selectClips } from '../src/main/shortme/clips/select'
import { LlamaServer, killAllSidecars } from '../src/main/engines/sidecars'
import { assetDir } from '../src/main/engines/paths'

const SPIKE = resolve('.tmp/spike-models')
const MODELS: Record<string, { model: string; mmproj?: string }> = {
  'qwen3-14b': { model: join(assetDir('qwen3-14b'), 'Qwen3-14B-Q4_K_M.gguf') },
  'gemma4-12b': { model: join(SPIKE, 'gemma-4-12b-it-qat-q4_0.gguf'), mmproj: join(SPIKE, 'mmproj-gemma-4-12b-it-qat-q4_0.gguf') },
  'qwen38-27b': { model: join(SPIKE, 'Qwen3.8-27B-IQ3_S-3.23bpw.gguf'), mmproj: join(SPIKE, 'mmproj-qwen38-bf16.gguf') }
}

const vramMb = (): number => { try { return Number(execFileSync('nvidia-smi', ['--query-gpu=memory.used', '--format=csv,noheader,nounits'], { encoding: 'utf8' }).split('\n')[0]) } catch { return -1 } }

async function main(): Promise<void> {
  const [name, video] = process.argv.slice(2)
  const m = MODELS[name] ?? { model: name.split(',')[0], mmproj: name.split(',')[1] }
  const imp = await importFile(video)
  const t = (await loadTranscript(imp.meta.hash))!
  const signals = await ensureSignals(imp.meta)
  const cuts = await ensureShots(imp.meta)
  const base = vramMb()
  const srv = new LlamaServer()
  const t0 = Date.now()
  let url: string
  try { url = await srv.start({ model: m.model, mmproj: m.mmproj, ctx: 16384 }) } catch (e) { console.log(`START FEHLGESCHLAGEN ${name}: ${String(e).slice(0, 600)}`); await killAllSidecars(); process.exit(2) }
  const loadSec = (Date.now() - t0) / 1000
  const loaded = vramMb()
  let peak = loaded
  const poll = setInterval(() => { peak = Math.max(peak, vramMb()) }, 2000)
  const t1 = Date.now()
  let err = ''
  let clips: Awaited<ReturnType<typeof selectClips>> = []
  try {
    clips = await selectClips({ words: t.words, durationSec: imp.meta.durationSec, signals, cuts }, { baseUrl: url, report: () => undefined })
  } catch (e) { err = String(e).slice(0, 500) }
  clearInterval(poll)
  const sec = (Date.now() - t1) / 1000
  const out = { model: name, video: basename(video), loadSec, selectSec: sec, vramBaseMb: base, vramLoadedMb: loaded, vramPeakMb: peak, error: err, clips: clips.map((c) => ({ start: +c.start.toFixed(1), end: +c.end.toFixed(1), score: c.score, title: c.title, reason: c.reason, criteria: c.criteria })) }
  await mkdir('spikes/out', { recursive: true })
  await writeFile(join('spikes/out', `${name.replace(/[^\w.-]/g, '_')}__${basename(video, '.mp4')}.json`), JSON.stringify(out, null, 1))
  console.log(`SPIKE ${name} ${basename(video)}: ${clips.length} Clips, laden ${loadSec.toFixed(0)} s, Auswahl ${sec.toFixed(0)} s, VRAM geladen ${loaded - base} MB / Spitze ${peak - base} MB${err ? `, FEHLER ${err}` : ''}`)
  await srv.stop()
  await killAllSidecars()
  process.exit(0)
}
main().catch((e) => { console.error('FAIL', e); process.exit(1) })
