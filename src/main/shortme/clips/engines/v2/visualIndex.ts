// Bild-Index der neuen Engine: (1) Bildänderungen über die ganze Zeitachse (Keyframes, kleine Graubilder), (2) Bild-Rundgang mit dem Bildmodell
// an gleichmäßig verteilten Zeitpunkten – ein unabhängiger Zugang für stille visuelle Ereignisse, nicht nur für den besten Textkandidaten.
import { spawn } from 'node:child_process'
import { FFMPEG_PATH } from '../../../../pipeline/ffmpeg'
import { loadPrompt } from '../../llm'
import { chatMm, imagePart, textPart } from './mm'
import { grabJpeg } from './media'
import { V2_LIMITS, type Evidence, type RawProposal } from '../../../../../shared/engineV2'

const W = 64, H = 36

/** Keyframe-Folge als kleine Graubilder samt Zeitstempel; sehr schnell (kein Voll-Decoding), deckt die ganze Datei ab. */
export function keyframeScan(video: string, signal?: AbortSignal): Promise<{ times: number[]; frames: Uint8Array[] }> {
  return new Promise((resolve, reject) => {
    const p = spawn(FFMPEG_PATH, ['-hide_banner', '-skip_frame', 'nokey', '-i', video, '-an', '-vf', `scale=${W}:${H}:flags=area,showinfo,format=gray`, '-vsync', '0', '-f', 'rawvideo', 'pipe:1'], { windowsHide: true, signal })
    const frames: Uint8Array[] = []
    const times: number[] = []
    let rest: Buffer = Buffer.alloc(0)
    let err = ''
    p.stdout.on('data', (d: Buffer) => {
      rest = rest.length ? Buffer.concat([rest, d]) : d
      while (rest.length >= W * H) { frames.push(Uint8Array.from(rest.subarray(0, W * H))); rest = rest.subarray(W * H) }
    })
    p.stderr.on('data', (d: Buffer) => { err += d.toString('latin1'); const re = /pts_time:([\d.]+)/g; let m: RegExpExecArray | null; let last = 0; while ((m = re.exec(err))) { times.push(Number(m[1])); last = re.lastIndex } err = err.slice(last) })
    p.on('error', reject)
    p.on('close', (code) => (code === 0 || frames.length > 1 ? resolve({ times: times.slice(0, frames.length), frames: frames.slice(0, times.length) }) : reject(new Error(`ffmpeg-Keyframe-Scan fehlgeschlagen (Code ${code})`))))
  })
}

/** Mittlere absolute Differenz aufeinanderfolgender Bilder (0..1). Index i = Änderung zwischen Bild i−1 und i. */
export function frameDiffs(frames: Uint8Array[]): number[] {
  const out = [0]
  for (let i = 1; i < frames.length; i++) { let s = 0; const a = frames[i - 1], b = frames[i]; for (let k = 0; k < a.length; k++) s += Math.abs(a[k] - b[k]); out.push(s / a.length / 255) }
  return out
}

/** Auffällige Bildänderungen: lokale Maxima im Verhältnis zum Umfeld (±120 s Median), mindestens 20 s Abstand, die stärksten `max`. */
export function changeProposals(times: number[], diffs: number[], durationSec: number, max = V2_LIMITS.visualTopChanges): { proposals: RawProposal[]; evidence: Evidence[] } {
  const cand: Array<{ t: number; ratio: number; d: number }> = []
  for (let i = 1; i < times.length; i++) {
    const near: number[] = []
    for (let j = i; j >= 0 && times[i] - times[j] <= 120; j--) near.push(diffs[j])
    for (let j = i + 1; j < times.length && times[j] - times[i] <= 120; j++) near.push(diffs[j])
    near.sort((a, b) => a - b)
    const med = near[near.length >> 1] ?? 0
    const ratio = diffs[i] / Math.max(0.01, med)
    if (diffs[i] >= 0.06 && ratio >= 3) cand.push({ t: times[i], ratio, d: diffs[i] })
  }
  const picked: typeof cand = []
  for (const c of cand.sort((a, b) => b.ratio - a.ratio)) { if (picked.length >= max) break; if (picked.every((p) => Math.abs(p.t - c.t) >= 20)) picked.push(c) }
  const top = picked[0]?.ratio ?? 1
  const proposals: RawProposal[] = []
  const evidence: Evidence[] = []
  picked.sort((a, b) => a.t - b.t).forEach((c, i) => {
    const id = `vc${i + 1}`
    evidence.push({ id, modality: 'visual', state: 'signal-only', source: 'bilddifferenz', start: Math.max(0, c.t - 1), end: Math.min(durationSec, c.t + 1), observation: `Bildänderung (Faktor ${c.ratio.toFixed(1)} über dem Umfeld)`, uncertainty: 'nur Pixeländerung, Inhalt nicht angesehen' })
    proposals.push({ start: Math.max(0, c.t - 12), end: Math.min(durationSec, c.t + 18), anchor: c.t, source: 'visual', kind: 'sonstiges', summary: 'auffällige Bildänderung', strength: Math.min(1, 0.3 + 0.4 * (c.ratio / top)), evidenceIds: [id] })
  })
  return { proposals, evidence }
}

export interface SweepResult { proposals: RawProposal[]; evidence: Evidence[]; sampled: number; failed: number; step: number; calls: number }

const SWEEP_SCHEMA = { type: 'object', additionalProperties: false, required: ['frames'], properties: { frames: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['id', 'aktivitaet', 'sichtbar'], properties: { id: { type: 'string' }, aktivitaet: { type: 'integer', minimum: 0, maximum: 3 }, sichtbar: { type: 'string' } } } } } }
interface SweepAnswer { frames: Array<{ id: string; aktivitaet: number; sichtbar: string }> }
const validateSweep = (x: unknown): SweepAnswer => {
  const f = (x as SweepAnswer | null)?.frames
  if (!Array.isArray(f)) throw new Error('frames fehlt')
  return { frames: f.filter((r) => typeof r?.id === 'string' && Number.isInteger(r.aktivitaet) && r.aktivitaet >= 0 && r.aktivitaet <= 3).map((r) => ({ id: r.id, aktivitaet: r.aktivitaet, sichtbar: String(r.sichtbar ?? '').slice(0, 140) })) }
}

/** Gleichmäßige Rundgang-Zeitpunkte über die ganze Dauer: höchstens `maxFrames`, mindestens `minStep` Sekunden Abstand. */
export function sweepTimes(durationSec: number, maxFrames: number, minStep = V2_LIMITS.visualSampleEverySec): { times: number[]; step: number } {
  const step = Math.max(minStep, durationSec / Math.max(1, maxFrames))
  const times: number[] = []
  for (let t = step / 2; t < durationSec - 1; t += step) times.push(t)
  return { times, step }
}

/**
 * Rundgang: Bilder in kleinen Gruppen an das Bildmodell. Ausgefallene Gruppen zählen als nicht geprüft (failed), nicht als „nichts passiert“.
 * Aufeinanderfolgende Bilder mit Aktivität ≥ 2 werden zu einem Vorschlag zusammengefasst.
 */
export async function sweep(video: string, baseUrl: string, durationSec: number, opts: { maxFrames: number; batch?: number; signal?: AbortSignal; onProgress?: (f: number) => void; modelRev: string }): Promise<SweepResult> {
  const { times, step } = sweepTimes(durationSec, opts.maxFrames)
  const batch = opts.batch ?? 6
  const act: Array<{ t: number; a: number; sichtbar: string } | null> = times.map(() => null)
  let failed = 0, calls = 0
  for (let i = 0; i < times.length; i += batch) {
    opts.signal?.throwIfAborted()
    const idx = times.slice(i, i + batch).map((_, k) => i + k)
    try {
      const jpegs = await Promise.all(idx.map((k) => grabJpeg(video, times[k], 512, opts.signal)))
      const prompt = await loadPrompt('v2/sweep', { n: idx.length })
      calls++
      const ans = await chatMm<SweepAnswer>(baseUrl, prompt.system, [textPart('Bilder:'), ...jpegs.flatMap((j, k) => [textPart(`F${k + 1}:`), imagePart(j)])], { schema: SWEEP_SCHEMA, validate: validateSweep, maxTokens: 700, signal: opts.signal })
      for (const r of ans.frames) { const k = Number(/^F(\d+)$/.exec(r.id)?.[1]) - 1; if (k >= 0 && k < idx.length) act[idx[k]] = { t: times[idx[k]], a: r.aktivitaet, sichtbar: r.sichtbar } }
    } catch (e) { if (opts.signal?.aborted) throw e; failed += idx.length; console.warn(`[v2] Bild-Rundgang: Gruppe ab ${times[i].toFixed(0)} s fehlgeschlagen (${e instanceof Error ? e.message.slice(0, 120) : e})`) }
    opts.onProgress?.(Math.min(1, (i + batch) / times.length))
  }
  const proposals: RawProposal[] = []
  const evidence: Evidence[] = []
  let n = 0
  for (let i = 0; i < act.length; i++) {
    if (!act[i] || act[i]!.a < 2) continue
    let j = i
    while (j + 1 < act.length && act[j + 1] && act[j + 1]!.a >= 2) j++
    const run = act.slice(i, j + 1) as Array<{ t: number; a: number; sichtbar: string }>
    const best = run.reduce((a, b) => (b.a > a.a ? b : a))
    const id = `vs${++n}`
    evidence.push({ id, modality: 'visual', state: 'observed', source: 'bild-rundgang', start: run[0].t, end: run[run.length - 1].t, observation: run.map((r) => r.sichtbar).filter(Boolean).slice(0, 3).join(' / '), modelRev: opts.modelRev, frames: run.map((r, k) => ({ id: `S${n}.${k + 1}`, t: r.t })), uncertainty: 'einzelne Rundgang-Bilder, kein Ablauf belegt' })
    proposals.push({ start: Math.max(0, run[0].t - Math.max(10, step / 2)), end: Math.min(durationSec, run[run.length - 1].t + Math.max(8, step / 2)), anchor: best.t, source: 'visual', kind: 'sonstiges', summary: best.sichtbar || 'auffälliges Bild', strength: Math.min(1, (best.a / 3) * 0.7 + Math.min(0.3, run.length * 0.1)), evidenceIds: [id] })
  }
  return { proposals, evidence, sampled: times.length, failed, step, calls }
}
