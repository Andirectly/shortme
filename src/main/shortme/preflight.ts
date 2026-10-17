export interface PreflightInput { durationSec: number; sizeBytes: number; hasAudio: boolean }
export interface PreflightResult { ok: boolean; errors: string[]; warnings: string[]; peakGb: number }

const GB = 1024 ** 3
export const RESERVE_GB = 1

/** Geschätzter Speicher-Spitzenbedarf: 16-kHz-Mono-WAV + Zwischen-/Clip-Renderings (≈ Quellgröße) + Cache. */
export function estimatePeakGb(i: PreflightInput): number {
  const wav = i.durationSec * 32000
  return (wav + i.sizeBytes * 1.0 + 0.2 * GB) / GB
}

/** Vorabprüfung beim Import (docs/PIPELINE.md §1): Dauer, Größe, freier Speicher (Reserve ≥ 1 GB nach Peak), Audiospur. */
export function preflight(i: PreflightInput, freeGb: number): PreflightResult {
  const errors: string[] = []
  const warnings: string[] = []
  const peakGb = estimatePeakGb(i)
  if (!i.hasAudio) errors.push('Das Video hat keine Audiospur – ohne Ton kann nichts transkribiert werden.')
  if (!(i.durationSec > 0)) errors.push('Die Videodauer konnte nicht bestimmt werden.')
  if (freeGb - peakGb < RESERVE_GB) errors.push(`Zu wenig freier Speicher: ${freeGb.toFixed(1)} GB frei, geschätzt ${peakGb.toFixed(1)} GB nötig plus ${RESERVE_GB} GB Reserve.`)
  if (i.durationSec > 4 * 3600) warnings.push('Sehr langes Video (> 4 h): Analyse dauert entsprechend lange.')
  if (i.durationSec > 0 && i.durationSec < 60) warnings.push('Kurzes Video (< 1 min): es wird kaum etwas für Clips zu finden sein.')
  return { ok: errors.length === 0, errors, warnings, peakGb }
}
