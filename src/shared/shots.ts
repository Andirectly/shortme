import type { ShortmeShot } from './shortme'

/** Kürzer als das zeigt eine Einstellung nur als verwirrendes Zwischenbild; sie wird in die vorige aufgenommen (die erste in die folgende). */
export const MIN_SHOT_SEC = 0.75

/** Zu kurze Einstellungen entfernen: ihre Zeit gehört der Nachbareinstellung, damit zwischen zwei Szenen nie ein Blitzbild liegt. Zeiten bleiben lückenlos. */
export function mergeShortShots<T extends Pick<ShortmeShot, 'start' | 'end'>>(shots: T[], minSec: number = MIN_SHOT_SEC): T[] {
  const out = shots.map((s) => ({ ...s }))
  for (let i = 0; i < out.length && out.length > 1;) {
    if (out[i].end - out[i].start >= minSec) { i++; continue }
    if (i > 0) { out[i - 1].end = out[i].end; out.splice(i, 1) } else { out[1].start = out[0].start; out.splice(0, 1) }
  }
  return out
}
