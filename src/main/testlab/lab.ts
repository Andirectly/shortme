import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, stat } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { dataRoot } from '../engines/paths'
import { analyzeClipASD, ASD_FPS } from '../pipeline/asd'
import { importFile } from '../shortme/importer'
import { loadMeta, projectsRoot } from '../shortme/project'
import { writeFileAtomic } from '../shortme/atomic'
import { ensureShots } from '../shortme/clips/analysis'
import { loadTranscript } from '../shortme/transcription'
import { layoutForClip } from '../shortme/layout/run'
import { activeSpeakers } from '../shortme/layout/plan'
import type { LabResult, LabRunRequest, LabSource, LabTrack } from '../../shared/models'
import { loadCatalog, recordMeasured } from './registry'

const HZ = 12.5
const STEP = ASD_FPS / HZ // 2 Frames je Probe
const VERSION = 1

/** Verfahren je Platz: Modell-ID → Parameter für die Analyse. Nur Plätze mit Verfahren sind vergleichbar. */
const FACE_DETECTORS: Record<string, 'yunet' | 'scrfd'> = { yunet: 'yunet', scrfd_10g: 'scrfd' }
export const LAB_SLOTS = ['face']

const vramMb = (): number => { try { return Number(execFileSync('nvidia-smi', ['--query-gpu=memory.used', '--format=csv,noheader,nounits'], { encoding: 'utf8', windowsHide: true }).split('\n')[0]) } catch { return -1 } }

/** Testvideos (test-videos/) und alle Projekte; Quelle für den Testclip. */
export async function labSources(): Promise<LabSource[]> {
  const out: LabSource[] = []
  const dir = resolve(process.cwd(), 'test-videos')
  if (existsSync(dir)) {
    for (const f of (await readdir(dir)).filter((n) => /\.(mp4|mov|mkv)$/i.test(n)).sort()) out.push({ id: `test:${f}`, label: `Testvideo · ${f}`, path: join(dir, f), durationSec: 0, width: 0, height: 0, kind: 'test' })
  }
  try {
    for (const h of await readdir(projectsRoot())) {
      const m = await loadMeta(h)
      if (m && existsSync(m.sourcePath)) out.push({ id: `project:${h}`, label: `Projekt · ${m.title}`, path: m.sourcePath, durationSec: m.durationSec, width: m.width, height: m.height, kind: 'project' })
    }
  } catch { /* noch keine Projekte */ }
  return out
}

const cacheDir = (): string => join(dataRoot(), 'testlab')
async function cacheKey(path: string, model: string, start: number, dur: number): Promise<string> {
  const st = await stat(path)
  return createHash('sha1').update(`${path}|${st.size}|${st.mtimeMs}|${model}|${start}|${dur}|v${VERSION}`).digest('hex').slice(0, 20)
}

export interface LabProgress { side: 'A' | 'B'; message: string }

async function runOne(slot: string, model: string, path: string, start: number, dur: number, onProgress: (m: string) => void): Promise<LabResult> {
  if (slot !== 'face' || !FACE_DETECTORS[model]) throw new Error('Für diesen Platz gibt es noch kein Testverfahren')
  await mkdir(cacheDir(), { recursive: true })
  const file = join(cacheDir(), `${await cacheKey(path, model, start, dur)}.json`)
  if (existsSync(file)) { onProgress('aus dem Zwischenspeicher'); return JSON.parse(await readFile(file, 'utf8')) as LabResult }
  const imp = await importFile(path)
  const meta = imp.meta
  const end = Math.min(meta.durationSec, start + dur)
  onProgress('Schnitte …')
  const cuts = await ensureShots(meta)
  const tr = await loadTranscript(meta.hash)
  const base = vramMb()
  let peak = base
  const poll = setInterval(() => { peak = Math.max(peak, vramMb()) }, 400)
  const t0 = Date.now()
  onProgress('Gesichter, Spuren und Sprecher berechnen …')
  let analysis
  try { analysis = await analyzeClipASD(meta.sourcePath, start, end, undefined, { detector: FACE_DETECTORS[model] }) } finally { clearInterval(poll) }
  peak = Math.max(peak, vramMb())
  const layout = await layoutForClip(meta, { start, end }, cuts, undefined, analysis)
  const runtimeSec = (Date.now() - t0) / 1000
  const tracks: LabTrack[] = (analysis?.tracks ?? []).map((t, id) => {
    const boxes: LabTrack['boxes'] = []
    const scores: number[] = []
    for (let k = 0; k < t.centres.length; k += STEP) { const b = t.boxes?.[k]; if (!b) continue; boxes.push([+b.x1.toFixed(4), +b.y1.toFixed(4), +b.x2.toFixed(4), +b.y2.toFixed(4)]); scores.push(+(t.scores[k] ?? 0).toFixed(2)) }
    return { id, t0: t.start / ASD_FPS, dt: 1 / HZ, boxes, scores }
  })
  const act = activeSpeakers(layout.input)
  const n = Math.ceil((end - start) * HZ)
  const active = Array.from({ length: n }, (_, i) => act[Math.min(act.length - 1, Math.floor((i / HZ) * 5))] ?? null)
  // Anteil der Sprechzeit (VAD) mit erkanntem Gesicht
  const speech = (tr?.speech ?? []).map(([a, b]) => [Math.max(a, start) - start, Math.min(b, end) - start] as const).filter(([a, b]) => b > a)
  let speechSec = 0, withFace = 0
  for (const [a, b] of speech) for (let t = a; t < b; t += 0.2) { speechSec += 0.2; if (tracks.some((tk) => { const k = Math.round((t - tk.t0) * HZ); return k >= 0 && k < tk.boxes.length })) withFace += 0.2 }
  const res: LabResult = {
    version: 1, model, slot, source: basename(path), start, dur: end - start, runtimeSec: +runtimeSec.toFixed(1), vramPeakMb: base >= 0 ? Math.max(0, peak - base) : -1,
    speechFaceShare: speechSec > 0 ? +(withFace / speechSec).toFixed(3) : null, speechSec: +speechSec.toFixed(1), hz: HZ, tracks, active,
    shots: layout.shots.map((s) => ({ start: s.start, end: s.end, layout: s.layout, cx: s.cx, cx2: s.cx2, zoom: s.zoom }))
  }
  await writeFileAtomic(file, JSON.stringify(res))
  await recordMeasured(model, { runtimeSec: res.runtimeSec, vramPeakMb: res.vramPeakMb, speechFaceShare: res.speechFaceShare, clip: `${res.source} ${Math.round(start)}–${Math.round(end)} s`, at: new Date().toISOString() })
  return res
}

/** Beide Modelle nacheinander (GPU/CPU-Last und VRAM-Messung bleiben vergleichbar). */
export async function runLab(req: LabRunRequest, onProgress: (p: LabProgress) => void): Promise<{ a: LabResult; b: LabResult }> {
  const cat = await loadCatalog()
  for (const id of [req.modelA, req.modelB]) {
    const m = cat.models.find((x) => x.id === id && x.slot === req.slot)
    if (!m?.integrated) throw new Error(`„${id}“ ist noch nicht integriert`)
  }
  const src = (await labSources()).find((s) => s.id === req.source)
  if (!src) throw new Error('Testclip nicht gefunden')
  const a = await runOne(req.slot, req.modelA, src.path, req.start, req.dur, (message) => onProgress({ side: 'A', message }))
  const b = await runOne(req.slot, req.modelB, src.path, req.start, req.dur, (message) => onProgress({ side: 'B', message }))
  return { a, b }
}
