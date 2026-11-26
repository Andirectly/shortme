/**
 * Engine 6 – Bildindex-Benchmark (Kap. 7/8/19/20): Referenz A = v3-Index (ein FFmpeg-Sprung je Bild) gegen B = ein gebündelter Decode,
 * jeweils mit/ohne Redundanzreduktion und bei mehreren Breiten. Gemessen: Decode-/Embedding-/Gesamtzeit, eingebettete Fenster, Übereinstimmung
 * der Suchtreffer (Top-5 je Anfrage, ±1 Fenster) und mittlere Kosinus-Ähnlichkeit der Fenstervektoren mit A. Kalter Lauf (Cache je Variante gelöscht).
 *   SHORTME_DATA=<Datenordner> npx tsx --tsconfig tsconfig.node.json scripts/v6-index-bench.ts <video> <label> [<out.json>]
 */
import { execFileSync } from 'node:child_process'
import { rm, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { FFPROBE_PATH } from '../src/main/pipeline/ffmpeg'
import { killAllSidecars } from '../src/main/engines/sidecars'
import { vram } from '../src/main/engines'
import { projectDir } from '../src/main/shortme/project'
import { withEmbedder } from '../src/main/shortme/clips/engines/v3/embedWorker'
import { buildIndex } from '../src/main/shortme/clips/engines/v3/embedIndex'
import { V3_PROFILE_CONFIG } from '../src/main/shortme/clips/engines/v3/revisions'
import { readNpy, type Npy2D } from '../src/main/shortme/clips/engines/v3/npy'
import { scoreQueries } from '../src/main/shortme/clips/engines/v3/search'
import { QUERY_BANK } from '../src/main/shortme/clips/engines/v4/lanes'
import { buildV6Index, type V6IndexConfig } from '../src/main/shortme/clips/engines/v6/visualIndex'

const [video, label, outFile] = process.argv.slice(2)
if (!video || !label) throw new Error('Aufruf: v6-index-bench.ts <video> <label> [out.json]')
const dur = Number(execFileSync(FFPROBE_PATH, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', video]).toString().trim())
const hash = 'bench-' + createHash('sha1').update(video).digest('hex').slice(0, 12)
const base = V3_PROFILE_CONFIG.balanced
const top = (v: Npy2D, Q: Npy2D, k = 5): number[][] => scoreQueries(v, Q, QUERY_BANK.map((q) => q.id)).map((s) => [...s.cos].map((c, i) => ({ c, i })).sort((a, b) => b.c - a.c).slice(0, k).map((x) => x.i))
const agree = (a: number[][], b: number[][]): number => { let hit = 0, n = 0; a.forEach((ta, q) => ta.forEach((i) => { n++; if (b[q].some((j) => Math.abs(i - j) <= 1)) hit++ })); return n ? hit / n : 0 }
const meanCos = (a: Npy2D, b: Npy2D): number => { let s = 0; for (let r = 0; r < a.rows; r++) { let d = 0, na = 0, nb = 0; for (let k = 0; k < a.cols; k++) { const x = a.data[r * a.cols + k], y = b.data[r * b.cols + k]; d += x * y; na += x * x; nb += y * y } s += d / Math.sqrt(na * nb || 1) } return s / a.rows }

;(async () => {
  const out: Record<string, unknown> = { video: label, durationSec: Math.round(dur), windows: 0, results: [] as unknown[] }
  await rm(join(projectDir(hash)), { recursive: true, force: true })
  await mkdir(projectDir(hash), { recursive: true })
  try {
    await withEmbedder('bench', async (s) => {
      const qPath = join(projectDir(hash), 'q.npy')
      await s.worker.request('embed_text', { texts: QUERY_BANK.map((q) => q.text), outPath: qPath }, { runId: s.runId, timeoutMs: 120_000 })
      const Q = await readNpy(qPath)
      const t0 = Date.now()
      const A = await buildIndex(s, { hash, video, durationSec: dur, cfg: base })
      const aSec = (Date.now() - t0) / 1000
      const ta = top(A.vectors, Q)
      out.windows = A.wins.length
      ;(out.results as unknown[]).push({ variant: 'A v3 (Sprung je Bild)', width: base.frameWidth, sec: Math.round(aSec * 10) / 10, embedded: A.wins.length, agreeTop5: 1, meanCos: 1 })
      console.log(label, 'A', aSec.toFixed(1), 's')
      const variants: Array<[string, Partial<V6IndexConfig>]> = [['B Einzeldecode', { frameWidth: 448, dedupe: false }], ['B+Redundanz', { frameWidth: 448, dedupe: true }], ['B 320', { frameWidth: 320, dedupe: false }], ['B+Redundanz 320', { frameWidth: 320, dedupe: true }]]
      for (const [name, v] of variants) {
        const cfg: V6IndexConfig = { windowSec: base.windowSec, hopSec: base.hopSec, frames: base.frames, frameWidth: 448, dedupe: false, sameThreshold: 0.035, maxGapSec: 40, ...v }
        const t1 = Date.now()
        const B = await buildV6Index(s, { hash, video, durationSec: dur, cfg, cuts: [] })
        const sec = (Date.now() - t1) / 1000
        const r = { variant: name, width: cfg.frameWidth, sec: Math.round(sec * 10) / 10, decodeSec: Math.round(B.decodeSec * 10) / 10, embedSec: Math.round(B.embedSec * 10) / 10, embedded: B.embedded, agreeTop5: Math.round(agree(ta, top(B.vectors, Q)) * 1000) / 1000, meanCos: Math.round(meanCos(A.vectors, B.vectors) * 1000) / 1000, reasons: B.samples.reduce<Record<string, number>>((m, x) => ({ ...m, [x.reason]: (m[x.reason] ?? 0) + 1 }), {}) }
        ;(out.results as unknown[]).push(r)
        console.log(label, JSON.stringify(r))
      }
    })
  } finally {
    await vram.releaseAll().catch(() => undefined)
    killAllSidecars()
    await rm(projectDir(hash), { recursive: true, force: true }).catch(() => undefined)
  }
  if (outFile) await writeFile(outFile, JSON.stringify(out, null, 1))
  console.log('PASS')
  process.exit(0)
})().catch((e) => { console.error('FAIL', e instanceof Error ? e.message : e); killAllSidecars(); process.exit(1) })
