// Szenen eines Clips in „Facecam + Gameplay“ (Facecam im Bild) und Smart-Ausschnitt (keine Facecam, z. B. Vollbild-Kamera bei „Just Chatting“) aufteilen.
import type { ShortmeShot } from '../../../shared/shortme'
import type { StreamLayout } from '../../../shared/streamLayout'

export interface Scene { start: number; end: number }

/** Kamerawechsel (absolute Zeit) → Szenen innerhalb [start, end]; Szenen unter `minSec` werden der vorigen zugeschlagen (kein Flackern). */
export function scenesOf(start: number, end: number, cuts: number[], minSec = 1.5): Scene[] {
  const edges = [start, ...cuts.filter((c) => c > start + 0.3 && c < end - 0.3).sort((a, b) => a - b), end]
  const out: Scene[] = []
  for (let i = 0; i < edges.length - 1; i++) {
    const s = { start: edges[i], end: edges[i + 1] }
    const prev = out[out.length - 1]
    if (prev && s.end - s.start < minSec) prev.end = s.end
    else out.push(s)
  }
  if (out.length > 1 && out[0].end - out[0].start < minSec) { out[1].start = out[0].start; out.shift() }
  return out
}

/**
 * Shots des Clips (Zeiten relativ zum Clipbeginn) mit Stream-Szenen versehen: Szenen mit Facecam → ein Shot `stream`; die übrigen
 * behalten den Smart-Plan (`planned`), hart geschnitten an den Szenengrenzen.
 */
export function mergeStreamScenes(clipStart: number, clipEnd: number, planned: ShortmeShot[], scenes: Array<Scene & { cam: boolean }>, base: StreamLayout): ShortmeShot[] {
  const out: ShortmeShot[] = []
  for (const sc of scenes) {
    const a = sc.start - clipStart, b = sc.end - clipStart
    if (sc.cam) { out.push({ start: a, end: b, layout: 'stream', cx: 0.5, zoom: 1, stream: base }); continue }
    for (const p of planned) {
      const s = Math.max(a, p.start), e = Math.min(b, p.end)
      if (e - s > 1e-3) out.push({ ...p, start: s, end: e })
    }
    if (!out.length || out[out.length - 1].end < b - 1e-3) out.push({ start: out.length ? out[out.length - 1].end : a, end: b, layout: 'fixed', cx: 0.5, zoom: 1 })
  }
  const merged: ShortmeShot[] = []
  for (const s of out) {
    const p = merged[merged.length - 1]
    if (p && p.layout === 'stream' && s.layout === 'stream') p.end = s.end
    else merged.push({ ...s })
  }
  if (merged.length) { merged[0].start = 0; merged[merged.length - 1].end = clipEnd - clipStart }
  return merged
}
