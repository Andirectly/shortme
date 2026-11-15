/**
 * Echter Smoke-Test des Python-Workers (Engine 3): Start, health, Modell laden, Bilder eines Videos als Fenster einbetten, Textanfragen einbetten,
 * Suche per Kosinus, Entladen, Beenden – mit echten Messwerten.
 *   SHORTME_DATA=<Daten> npx tsx --tsconfig tsconfig.node.json scripts/v3-worker-smoke.ts <video> [von] [bis] [anfrage…]
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { FFMPEG_PATH } from '../src/main/pipeline/ffmpeg'
import { assetDir, modelsRoot } from '../src/main/engines/paths'
import { PyWorker } from '../src/main/shortme/clips/engines/v3/pyWorker'
import { pythonExe, workerScript } from '../src/main/shortme/clips/engines/v3/runtime'
import { cosineRows, readNpy } from '../src/main/shortme/clips/engines/v3/npy'

const [video, a = '0', b = '60', ...q] = process.argv.slice(2)
const queries = q.length ? q : ['a person laughing', 'two people talking at a table', 'a close-up of a woman', 'a man with a beard']
const work = join(tmpdir(), 'sm-v3-smoke')
mkdirSync(work, { recursive: true })
const t0 = Date.now()
void (async () => {
  const w = new PyWorker({ python: pythonExe(), script: workerScript(), allowedRoots: [work], modelRoots: [modelsRoot()] })
  const run = 'smoke'
  console.log('health:', JSON.stringify(await w.request('health', {}, { runId: run })))
  const lm = await w.request<Record<string, unknown>>('load_model', { modelId: 'qwen3-vl-embedding-2b', modelDir: assetDir('qwen3-vl-embedding-2b') }, { runId: run, timeoutMs: 300000 })
  console.log('load_model:', JSON.stringify(lm))
  // Fenster à 8 s mit 4 Bildern (Breite 448)
  const from = Number(a), to = Number(b), win = 8
  const wins: Array<{ id: string; frames: string[]; start: number }> = []
  for (let s = from; s + win <= to; s += win) {
    const frames: string[] = []
    for (let k = 0; k < 4; k++) { const f = join(work, `w${s}_${k}.jpg`); execFileSync(FFMPEG_PATH, ['-hide_banner', '-loglevel', 'error', '-y', '-ss', String(s + (k + 0.5) * (win / 4)), '-i', video, '-frames:v', '1', '-vf', 'scale=448:-2', '-q:v', '4', f]); frames.push(f) }
    wins.push({ id: `w${s}`, frames, start: s })
  }
  const vp = join(work, 'v.npy'), tp = join(work, 't.npy')
  const ev = await w.request<Record<string, unknown>>('embed_frames', { windows: wins.map((x) => ({ id: x.id, frames: x.frames })), outPath: vp, batchSize: 4 }, { runId: run, timeoutMs: 300000 })
  console.log('embed_frames:', JSON.stringify(ev))
  const et = await w.request<Record<string, unknown>>('embed_text', { texts: queries, outPath: tp }, { runId: run })
  console.log('embed_text:', JSON.stringify(et))
  const V = await readNpy(vp), T = await readNpy(tp)
  queries.forEach((qq, j) => { const sc = wins.map((x, i) => ({ s: x.start, c: cosineRows(T, j, V, i) })).sort((p, r) => r.c - p.c); console.log(`  "${qq}" → ${sc.slice(0, 3).map((x) => `${x.s}s (${x.c.toFixed(3)})`).join(', ')}  | Spanne ${sc[sc.length - 1].c.toFixed(3)}…${sc[0].c.toFixed(3)}`) })
  // Sicherheit: Pfad außerhalb wird abgewiesen
  try { await w.request('embed_frames', { windows: [{ id: 'x', frames: ['C:/Windows/win.ini'] }], outPath: join(work, 'x.npy') }, { runId: run }) } catch (e) { console.log('Pfad außerhalb abgewiesen:', (e as Error).message) }
  console.log('unload_model:', JSON.stringify(await w.request('unload_model', {}, { runId: run })))
  await w.stop()
  console.log(`fertig in ${((Date.now() - t0) / 1000).toFixed(1)} s; Bilder ${readdirSync(work).length}`)
  process.exit(0)
})().catch((e) => { console.error('FEHLER', e); process.exit(1) })
