import type { ShortmeClip, ShortmeShot } from '@shared/shortme'
import { analyzeClipASD, ASD_FPS, type AsdAnalysis } from '../../pipeline/asd'
import type { ProjectMeta } from '../project'
import { loadTranscript } from '../transcription'
import { facePenalty, faceRatio, planShots, type PlanInput, type PlanTrack } from './plan'

const STRIDE = ASD_FPS / 5 // Planungsraster 5 Ticks/s

export interface ClipLayout { shots: ShortmeShot[]; faceRatio: number; penalty: number; /** Tracks/Schnitte für manuelle Korrekturen im Editor (szenenweise konsistent). */ input: PlanInput
  /** Gesichts-Embeddings je Track (für die Personen-Zuordnung über das ganze Video). */
  identities: Array<{ track: number; emb: Float32Array; crop?: Buffer; sec: number }> }

/** LR-ASD-Analyse (Gesichter, Tracks, Sprecher-Werte) → Plan-Eingabe auf 5-Hz-Raster, relativ zum Clipbeginn. */
export async function layoutForClip(meta: ProjectMeta, clip: Pick<ShortmeClip, 'start' | 'end'>, shotCuts: number[], signal?: AbortSignal, pre?: AsdAnalysis | null): Promise<ClipLayout> {
  const dur = clip.end - clip.start
  const ticks = Math.max(1, Math.round(dur * 5))
  const dt = 1 / 5
  const analysis = pre !== undefined ? pre : await analyzeClipASD(meta.sourcePath, clip.start, clip.end, signal).catch((e) => { if (signal?.aborted) throw e; return null })
  const tracks: PlanTrack[] = []
  const cuts = new Set<number>()
  for (const c of shotCuts) if (c > clip.start + 0.3 && c < clip.end - 0.3) cuts.add(Math.round((c - clip.start) * 5))
  if (analysis) {
    for (const f of analysis.sceneCuts) cuts.add(Math.round(f / STRIDE))
    analysis.tracks.forEach((t, id) => {
      const first = Math.ceil(t.start / STRIDE)
      const last = Math.floor((t.start + t.centres.length - 1) / STRIDE)
      if (last < first) return
      const pick = <T,>(arr: T[]): T[] => { const out: T[] = []; for (let k = first; k <= last; k++) out.push(arr[Math.min(arr.length - 1, k * STRIDE - t.start)]); return out }
      tracks.push({ id, start: first, centres: pick(t.centres), areas: pick(t.areas), scores: pick(t.scores) })
    })
  }
  // Sprache (VAD) je Tick: ASD zählt nur, wenn gesprochen wird
  const tr = await loadTranscript(meta.hash).catch(() => null)
  const speech = tr?.speech.length ? Array.from({ length: ticks }, (_, i) => { const t = clip.start + (i + 0.5) * dt; return tr.speech.some(([a, b]) => t >= a && t <= b) }) : undefined
  const input: PlanInput = { tracks, ticks, dt, cuts: [...cuts].filter((c) => c > 0 && c < ticks).sort((a, b) => a - b), sourceAspect: meta.width / meta.height, speech }
  const shots = planShots(input)
  const ratio = faceRatio(shots, input)
  const identities = (analysis?.tracks ?? []).flatMap((t, track) => (t.emb ? [{ track, emb: t.emb, crop: t.crop, sec: t.centres.length / ASD_FPS }] : []))
  return { shots, faceRatio: ratio, penalty: facePenalty(ratio), input, identities }
}
