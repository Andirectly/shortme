import { readFile } from 'node:fs/promises'
import { writeFileAtomic } from '../atomic'
import { projectFile } from '../project'

/** YouTube „Most replayed“: Abschnitte (Quellzeit) mit Wiedergabe-Intensität 0..1 (Maximum = 1). */
export interface HeatPoint { start: number; end: number; value: number }

export const heatFile = (hash: string): string => projectFile(hash, 'heatmap.json')
export const saveHeat = (hash: string, points: HeatPoint[]): Promise<void> => writeFileAtomic(heatFile(hash), JSON.stringify(points))
export async function loadHeat(hash: string): Promise<HeatPoint[] | null> {
  try { const p = JSON.parse(await readFile(heatFile(hash), 'utf8')) as HeatPoint[]; return Array.isArray(p) && p.length ? p : null } catch { return null }
}

/** Mittel und Spitze der Kurve über [start, end] (zeitgewichtet). */
export function heatStats(points: HeatPoint[], start: number, end: number): { mean: number; peak: number } {
  let sum = 0, w = 0, peak = 0
  for (const p of points) {
    const a = Math.max(start, p.start), b = Math.min(end, p.end)
    if (b <= a) continue
    sum += p.value * (b - a); w += b - a; peak = Math.max(peak, p.value)
  }
  return { mean: w ? sum / w : 0, peak }
}

/** Stärke 0..1: Spitze zählt mehr als der Durchschnitt (ein Peak im Clip ist der Grund, warum Zuschauer zurückspulen). */
export const heatScore = (points: HeatPoint[], start: number, end: number): number => { const s = heatStats(points, start, end); return 0.6 * s.peak + 0.4 * s.mean }

/** Bonus/Malus in Punkten für den Endscore (Mitte ≈ durchschnittlicher Clip → 0). */
export const heatBonus = (score: number): number => Math.max(-8, Math.min(16, 24 * (score - 0.35)))

/** Lokale Maxima ≥ `min` (Spitzen), absteigend nach Wert. */
export function heatPeaks(points: HeatPoint[], min = 0.75): HeatPoint[] {
  return points.filter((p, i) => p.value >= min && p.value >= (points[i - 1]?.value ?? 0) && p.value >= (points[i + 1]?.value ?? 0)).sort((a, b) => b.value - a.value)
}
