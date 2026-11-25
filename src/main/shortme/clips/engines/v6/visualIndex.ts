// Engine 6 – visueller Feature-Index („Visual Memory“, Kap. 7/19/20): ein gebündelter Decode der Originalquelle liefert in EINEM FFmpeg-Durchgang
//   (a) Analysebilder in der Zielauflösung (Pixelbudget des Embedding-Prozessors) und (b) 32×18-Graustufen-Signaturen für die Redundanzreduktion.
// Redundante Fenster (gleiches Bild wie der Repräsentant, kein Schnitt dazwischen, Kontrollabstand nicht überschritten) übernehmen dessen Vektor –
// reversibel: jedes Fenster behält seine Quellzeit, `represented` zeigt, von welchem Fenster der Vektor stammt; Coverage trennt „eingebettet“ und „übernommen“.
// Der Index ist anfrageunabhängig (Anfragen werden separat eingebettet) und je Quelle, Auflösung, Abtastung, Signatur-Revision und Modell versioniert.
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readFile, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { FFMPEG_PATH } from '../../../../pipeline/ffmpeg'
import { projectDir } from '../../../project'
import { writeFileAtomic } from '../../../atomic'
import { fingerprintOf } from '../../../../../shared/engine'
import { readNpy, type Npy2D } from '../v3/npy'
import { embedWindows, type EmbedWindow } from '../v3/search'
import { V3_EMBED_MODEL } from '../v3/revisions'
import type { EmbedSession } from '../v3/embedWorker'
import type { IndexMeta, IndexResult } from '../v3/embedIndex'

export const V6_SIGNATURE_REVISION = 'sig32x18-v1'
export const V6_EXTRACTOR_REVISION = 'single-decode-v1'
const SW = 32, SH = 18

export interface V6IndexConfig {
  windowSec: number
  hopSec: number
  frames: number
  /** Breite der Analysebilder (Höhe folgt dem Seitenverhältnis). */
  frameWidth: number
  /** Redundanzreduktion aktiv (P0-Mechanismus, Standard nur bei nachgewiesener Eignung). */
  dedupe: boolean
  /** mittlere Pixeldifferenz (0..1) unter der ein Fenster als Wiederholung des Repräsentanten gilt */
  sameThreshold: number
  /** höchstens so viele Sekunden darf ein Fenster von seinem Repräsentanten entfernt sein (Kontrollframes) */
  maxGapSec: number
}

export interface WindowSample { index: number; start: number; end: number; frameTimes: number[]; signature: number[]; representedBy: number; reason: 'embedded' | 'control' | 'scene-cut' | 'changed' | 'same-as-representative' }

export interface V6IndexResult extends IndexResult { samples: WindowSample[]; decodeSec: number; embedSec: number; embedded: number }

export const v6IndexFingerprint = (hash: string, durationSec: number, c: V6IndexConfig): string =>
  fingerprintOf([hash, durationSec.toFixed(2), V3_EMBED_MODEL.id, V3_EMBED_MODEL.revision, V6_EXTRACTOR_REVISION, V6_SIGNATURE_REVISION, c.windowSec, c.hopSec, c.frames, c.frameWidth, c.dedupe ? `d${c.sameThreshold}/${c.maxGapSec}` : 'nodedupe'])

const indexDir = (hash: string, fp: string): string => join(projectDir(hash), 'analysis', 'shared', 'embeddings-v6', V3_EMBED_MODEL.id, V3_EMBED_MODEL.revision.slice(0, 8), fp)

export const meanAbsDiff = (a: ArrayLike<number>, b: ArrayLike<number>): number => { let s = 0; for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]); return a.length ? s / a.length / 255 : 1 }

/**
 * Repräsentanten wählen (reine Funktion, getestet): ein Fenster wird eingebettet, wenn es das erste ist, ein Schnitt in ihm oder seit dem Repräsentanten liegt,
 * sein Bild sich vom Repräsentanten unterscheidet, ein Bild IN ihm stark wechselt oder der Kontrollabstand erreicht ist. Sonst übernimmt es den Vektor.
 */
export function chooseRepresentatives(wins: Array<{ start: number; end: number; frameSigs: number[][] }>, cuts: number[], c: Pick<V6IndexConfig, 'dedupe' | 'sameThreshold' | 'maxGapSec'>): Array<{ representedBy: number; reason: WindowSample['reason'] }> {
  const out: Array<{ representedBy: number; reason: WindowSample['reason'] }> = []
  let rep = -1
  for (let i = 0; i < wins.length; i++) {
    const w = wins[i]
    if (!c.dedupe || rep < 0 || !w.frameSigs.length) { rep = i; out.push({ representedBy: i, reason: 'embedded' }); continue }
    const r = wins[rep]
    const cut = cuts.some((t) => t > r.start && t < w.end)
    const inner = w.frameSigs.some((s, k) => k > 0 && meanAbsDiff(s, w.frameSigs[k - 1]) >= c.sameThreshold)
    const diff = r.frameSigs.length ? Math.max(...w.frameSigs.map((s) => Math.min(...r.frameSigs.map((q) => meanAbsDiff(s, q))))) : 1
    if (cut) { rep = i; out.push({ representedBy: i, reason: 'scene-cut' }) }
    else if (w.start - r.start >= c.maxGapSec) { rep = i; out.push({ representedBy: i, reason: 'control' }) }
    else if (inner || diff >= c.sameThreshold) { rep = i; out.push({ representedBy: i, reason: 'changed' }) }
    else out.push({ representedBy: rep, reason: 'same-as-representative' })
  }
  return out
}

/** Ein Decode-Durchgang: Analysebilder (JPEG, Zielbreite, Seitenverhältnis inkl. SAR erhalten) + Signaturen; Zeiten aus den echten PTS (showinfo). */
export function decodeSamples(video: string, rate: number, width: number, outDir: string, signal?: AbortSignal, hwaccel = false): Promise<{ times: number[]; sigs: Uint8Array[]; files: string[] }> {
  return new Promise((resolve, reject) => {
    const graph = `[0:v]fps=${rate.toFixed(6)},scale=iw*sar:ih,setsar=1,split=2[a][b];[a]scale=${width}:-2:flags=bicubic,showinfo[o1];[b]scale=${SW}:${SH}:flags=area,format=gray[o2]`
    const args = ['-hide_banner', '-loglevel', 'info', ...(hwaccel ? ['-hwaccel', 'auto'] : []), '-i', video, '-an', '-sn', '-filter_complex', graph, '-map', '[o1]', '-q:v', '4', '-f', 'image2', join(outDir, 'f%06d.jpg'), '-map', '[o2]', '-f', 'rawvideo', 'pipe:1']
    const p = spawn(FFMPEG_PATH, args, { windowsHide: true, signal })
    const sigs: Uint8Array[] = [], times: number[] = []
    let rest: Buffer = Buffer.alloc(0), err = '', tail = ''
    p.stdout.on('data', (d: Buffer) => { rest = rest.length ? Buffer.concat([rest, d]) : d; while (rest.length >= SW * SH) { sigs.push(Uint8Array.from(rest.subarray(0, SW * SH))); rest = rest.subarray(SW * SH) } })
    p.stderr.on('data', (d: Buffer) => { err += d.toString('latin1'); const re = /pts_time:\s*([-\d.]+)/g; let m: RegExpExecArray | null; let last = 0; while ((m = re.exec(err))) { times.push(Number(m[1])); last = re.lastIndex } tail = (tail + err).slice(-2000); err = err.slice(last) })
    p.on('error', reject)
    p.on('close', async (code) => {
      if (code !== 0) return reject(new Error(`Engine-6-Decode fehlgeschlagen (Code ${code}): ${tail.split('\n').filter((l) => /error|invalid/i.test(l)).slice(-2).join(' | ').slice(0, 300)}`))
      const files = (await readdir(outDir)).filter((f) => /^f\d{6}\.jpg$/.test(f)).sort().map((f) => join(outDir, f))
      const n = Math.min(files.length, sigs.length, times.length)
      resolve({ times: times.slice(0, n), sigs: sigs.slice(0, n), files: files.slice(0, n) })
    })
  })
}

/** Index laden oder bauen (ein Decode, dann nur Repräsentanten einbetten). Liefert dieselbe Form wie der v3-Index, damit Suche und Spuren unverändert bleiben. */
export async function buildV6Index(s: EmbedSession, o: { hash: string; video: string; durationSec: number; cfg: V6IndexConfig; cuts: number[]; signal?: AbortSignal; onProgress?: (f: number, msg: string) => void; hwaccel?: boolean }): Promise<V6IndexResult> {
  const fp = v6IndexFingerprint(o.hash, o.durationSec, o.cfg)
  const dir = indexDir(o.hash, fp)
  const wins: EmbedWindow[] = embedWindows(o.durationSec, o.cfg)
  const metaPath = join(dir, 'meta.json'), vecPath = join(dir, 'vectors.npy'), samplesPath = join(dir, 'samples.json')
  if (existsSync(metaPath) && existsSync(vecPath) && existsSync(samplesPath)) {
    try {
      const meta = JSON.parse(await readFile(metaPath, 'utf8')) as IndexMeta & { decodeSec: number; embedSec: number; embedded: number }
      const vectors = await readNpy(vecPath)
      const samples = JSON.parse(await readFile(samplesPath, 'utf8')) as WindowSample[]
      if (meta.fingerprint === fp && vectors.rows === wins.length && samples.length === wins.length) return { meta, vectors, wins, cached: true, dir, samples, decodeSec: 0, embedSec: 0, embedded: meta.embedded }
    } catch { /* beschädigt → neu bauen */ }
  }
  await rm(dir, { recursive: true, force: true }).catch(() => undefined)
  const tmp = join(dir, 'frames')
  await mkdir(tmp, { recursive: true })
  const t0 = Date.now()
  try {
    o.onProgress?.(0, 'Analysebilder in einem Durchgang dekodieren …')
    const rate = o.cfg.frames / o.cfg.windowSec
    const dec = await decodeSamples(o.video, rate, o.cfg.frameWidth, tmp, o.signal, o.hwaccel)
    const decodeSec = (Date.now() - t0) / 1000
    if (!dec.times.length) throw new Error('Keine Analysebilder dekodiert')
    // Bilder je Fenster: echte PTS im Fenster, gleichmäßig auf `frames` verteilt (nie aus Bildnummer × FPS abgeleitet)
    const perWin = wins.map((w) => {
      const idx = dec.times.map((t, i) => ({ t, i })).filter(({ t }) => t >= w.start && t < w.end)
      const pick = idx.length <= o.cfg.frames ? idx : Array.from({ length: o.cfg.frames }, (_, k) => idx[Math.floor(((k + 0.5) / o.cfg.frames) * idx.length)])
      // leeres Fenster (Ende der Datei, große PTS-Lücke): nächstes Bild davor als einzige Stichprobe, Zeit bleibt sichtbar
      const fallback = pick.length ? pick : (() => { let j = 0; for (let i = 0; i < dec.times.length; i++) if (dec.times[i] <= w.end) j = i; return [{ t: dec.times[j], i: j }] })()
      return { ...w, pick: fallback, frameSigs: fallback.map((x) => Array.from(dec.sigs[x.i])) }
    })
    const reps = chooseRepresentatives(perWin, o.cuts, o.cfg)
    const toEmbed = perWin.filter((_, i) => reps[i].representedBy === i)
    o.onProgress?.(0.3, `Bild-Embeddings: ${toEmbed.length} von ${wins.length} Fenstern (Rest wiederholt sich) …`)
    const t1 = Date.now()
    const BATCH = 64
    let dim = 0
    const repVec = new Map<number, Float32Array>()
    for (let k = 0; k < toEmbed.length; k += BATCH) {
      o.signal?.throwIfAborted()
      const slice = toEmbed.slice(k, k + BATCH)
      const part = join(dir, `part-${k / BATCH}.npy`)
      const res = await s.worker.request<{ dimension: number }>('embed_frames', { windows: slice.map((w) => ({ id: `w${w.index}`, frames: w.pick.map((x) => dec.files[x.i]) })), outPath: part, batchSize: 4 }, { runId: s.runId, timeoutMs: 600_000, signal: o.signal })
      dim = res.dimension
      const v = await readNpy(part)
      slice.forEach((w, r) => repVec.set(w.index, v.data.slice(r * v.cols, (r + 1) * v.cols)))
      await rm(part, { force: true })
      o.onProgress?.(0.3 + 0.7 * Math.min(1, (k + BATCH) / toEmbed.length), `Bild-Embeddings ${Math.min(toEmbed.length, k + BATCH)}/${toEmbed.length} …`)
    }
    const embedSec = (Date.now() - t1) / 1000
    if (!dim) throw new Error('Kein Fenster konnte eingebettet werden')
    const data = new Float32Array(wins.length * dim)
    wins.forEach((_, i) => data.set(repVec.get(reps[i].representedBy)!, i * dim))
    const vectors: Npy2D = { rows: wins.length, cols: dim, data }
    const samples: WindowSample[] = perWin.map((w, i) => ({ index: w.index, start: w.start, end: w.end, frameTimes: w.pick.map((x) => Math.round(dec.times[x.i] * 1000) / 1000), signature: w.frameSigs[0] ?? [], representedBy: reps[i].representedBy, reason: reps[i].reason }))
    const meta = { version: 1 as const, fingerprint: fp, model: V3_EMBED_MODEL.id, revision: V3_EMBED_MODEL.revision, extractor: V6_EXTRACTOR_REVISION, durationSec: o.durationSec, cfg: { windowSec: o.cfg.windowSec, hopSec: o.cfg.hopSec, frames: o.cfg.frames, frameWidth: o.cfg.frameWidth }, dimension: dim, windows: wins.map((w) => [w.start, w.end] as [number, number]), failed: [], createdAt: new Date().toISOString(), seconds: Math.round((Date.now() - t0) / 100) / 10, decodeSec: Math.round(decodeSec * 10) / 10, embedSec: Math.round(embedSec * 10) / 10, embedded: toEmbed.length }
    await writeNpyF32(vecPath, vectors)
    await writeFileAtomic(samplesPath, JSON.stringify(samples.map((x) => ({ ...x, signature: [] }))))
    await writeFileAtomic(metaPath, JSON.stringify(meta))
    return { meta, vectors, wins, cached: false, dir, samples, decodeSec, embedSec, embedded: toEmbed.length }
  } finally { await rm(tmp, { recursive: true, force: true }).catch(() => undefined) }
}

/** Minimaler .npy-Schreiber (float32, C-Ordnung). */
async function writeNpyF32(path: string, m: Npy2D): Promise<void> {
  const header = `{'descr': '<f4', 'fortran_order': False, 'shape': (${m.rows}, ${m.cols}), }`
  const pad = 64 - ((10 + header.length + 1) % 64)
  const h = header + ' '.repeat(pad) + '\n'
  const pre = Buffer.alloc(10)
  pre.write('\x93NUMPY', 0, 'latin1'); pre[6] = 1; pre[7] = 0; pre.writeUInt16LE(h.length, 8)
  await writeFileAtomic(path, Buffer.concat([pre, Buffer.from(h, 'latin1'), Buffer.from(m.data.buffer, m.data.byteOffset, m.data.byteLength)]) as never)
}
