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

/** Layout-Wechsel exakt auf den Videoschnitt legen: Die Planung rechnet in 0,2-s-Schritten, der echte Schnitt liegt bis zu 0,1 s daneben (sichtbar als ein Bild mit falschem Ausschnitt). */
export function snapShotsToCuts<T extends Pick<ShortmeShot, 'start' | 'end'>>(shots: T[], clipStart: number, cuts: number[], tol = 0.35): T[] {
  const out = shots.map((s) => ({ ...s }))
  for (let i = 1; i < out.length; i++) {
    const abs = clipStart + out[i].start
    let best: number | null = null
    for (const c of cuts) if (Math.abs(c - abs) <= tol && (best === null || Math.abs(c - abs) < Math.abs(best - abs))) best = c
    if (best === null) continue
    const t = best - clipStart
    // nie eine Einstellung auf null stauchen
    if (t <= out[i - 1].start + 0.1 || t >= out[i].end - 0.1) continue
    out[i - 1].end = t; out[i].start = t
  }
  return out
}
