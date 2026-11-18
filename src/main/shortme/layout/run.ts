import type { ShortmeClip, ShortmeShot } from '@shared/shortme'
import { analyzeClipASD, ASD_FPS, type AsdAnalysis } from '../../pipeline/asd'
import type { ProjectMeta } from '../project'
import { loadTranscript } from '../transcription'
import { facePenalty, faceRatio, planShots, PLAN_DEFAULTS, type PlanInput, type PlanOptions, type PlanTrack } from './plan'

const STRIDE = ASD_FPS / 5 // Planungsraster 5 Ticks/s

export interface ClipLayout { shots: ShortmeShot[]; faceRatio: number; penalty: number; /** Tracks/Schnitte für manuelle Korrekturen im Editor (szenenweise konsistent). */ input: PlanInput
  /** Gesichts-Embeddings je Track (für die Personen-Zuordnung über das ganze Video). */
  identities: Array<{ track: number; emb: Float32Array; crop?: Buffer; sec: number }> }

// Engine 4 rechnet den Bildausschnitt schon beim Prüf-Render; die Layout-Stufe am Ende fragt dieselben Clips noch einmal an (gemessen 115 s je Lauf).
// shortcut: nur im Speicher und ohne Modell im Schlüssel – wer im Testlab das Gesichtsmodell wechselt, bekommt bis zu 24 alte Analysen; bei Bedarf Modell-ID in den Schlüssel.
const asdCache = new Map<string, Promise<AsdAnalysis | null>>()
export function cachedASD(video: string, start: number, end: number, signal?: AbortSignal): Promise<AsdAnalysis | null> {
  const key = `${video}|${start.toFixed(2)}|${end.toFixed(2)}`
  const hit = asdCache.get(key)
  if (hit) return hit
  const p = analyzeClipASD(video, start, end, signal).catch((e) => { asdCache.delete(key); if (signal?.aborted) throw e; return null })
  asdCache.set(key, p)
  if (asdCache.size > 24) asdCache.delete(asdCache.keys().next().value!)
  return p
}

/** LR-ASD-Analyse (Gesichter, Tracks, Sprecher-Werte) → Plan-Eingabe auf 5-Hz-Raster, relativ zum Clipbeginn. */
export async function layoutForClip(meta: ProjectMeta, clip: Pick<ShortmeClip, 'start' | 'end'>, shotCuts: number[], signal?: AbortSignal, pre?: AsdAnalysis | null, plan?: Partial<PlanOptions>): Promise<ClipLayout> {
  const dur = clip.end - clip.start
  const ticks = Math.max(1, Math.round(dur * 5))
  const dt = 1 / 5
  const analysis = pre !== undefined ? pre : await cachedASD(meta.sourcePath, clip.start, clip.end, signal)
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
  const shots = planShots(input, plan ? { ...PLAN_DEFAULTS, ...plan } : PLAN_DEFAULTS)
  const ratio = faceRatio(shots, input)
  const identities = (analysis?.tracks ?? []).flatMap((t, track) => (t.emb ? [{ track, emb: t.emb, crop: t.crop, sec: t.centres.length / ASD_FPS }] : []))
  return { shots, faceRatio: ratio, penalty: facePenalty(ratio), input, identities }
}
