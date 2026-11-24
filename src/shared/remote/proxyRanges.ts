/**
 * Editierbare Proxys (Plan V3, Kap. 11): Quellbereiche je Clip mit Handles, überlappende/angrenzende
 * Bereiche zu wiederverwendbaren Chunks zusammenführen, fehlende Teile für Nachladen bestimmen.
 * Zeiten in Sekunden der Quelle (Quell-Timebase); PTS-Abbildung macht der Worker beim Erzeugen.
 */

export type Range = [number, number]

/** Handle-Bereich um ein Segment, an die Quellgrenzen gekappt (z. B. 05:20–06:05 ±30 s → 04:50–06:35). */
export function withHandles(start: number, end: number, handleSec: number, duration: number): Range {
  return [Math.max(0, start - handleSec), Math.min(duration, end + handleSec)]
}

/** Sortieren und Überlappende bzw. bis `gapSec` angrenzende Bereiche vereinen. */
export function mergeRanges(ranges: Range[], gapSec = 0): Range[] {
  const sorted = ranges.filter(([a, b]) => b > a).map(([a, b]): Range => [a, b]).sort((x, y) => x[0] - y[0])
  const out: Range[] = []
  for (const r of sorted) {
    const last = out[out.length - 1]
    if (last && r[0] <= last[1] + gapSec) last[1] = Math.max(last[1], r[1])
    else out.push(r)
  }
  return out
}

/** Teile von `want`, die keine vorhandenen Chunks abdecken → nur diese anfordern (keine Doppelübertragung). */
export function missingRanges(want: Range, have: Range[]): Range[] {
  let gaps: Range[] = [[want[0], want[1]]]
  for (const [a, b] of mergeRanges(have)) {
    gaps = gaps.flatMap(([x, y]): Range[] => {
      if (b <= x || a >= y) return [[x, y]]
      const parts: Range[] = []
      if (a > x) parts.push([x, a])
      if (b < y) parts.push([b, y])
      return parts
    })
  }
  return gaps.filter(([a, b]) => b - a > 1e-6)
}

/** Chunk-Schlüssel: gleiche Quelle + Hash + Profil + Bereich = gleicher Cache-Eintrag (Kap. 11). */
export const chunkKey = (sourceMediaId: string, sourceSha256: string, profile: string, r: Range): string =>
  `${sourceMediaId}:${sourceSha256.slice(0, 16)}:${profile}:${r[0].toFixed(3)}-${r[1].toFixed(3)}`

/**
 * Übertragungsreihenfolge: sichtbarer Clip und Abspielkopf-Nähe zuerst, dann der Rest (Kap. 10/11).
 * `focus` = Bereich des gerade sichtbaren Clips.
 */
export function prioritize(ranges: Range[], focus: Range | null): Range[] {
  if (!focus) return [...ranges]
  const dist = ([a, b]: Range): number => (b < focus[0] ? focus[0] - b : a > focus[1] ? a - focus[1] : 0)
  return [...ranges].sort((x, y) => dist(x) - dist(y) || x[0] - y[0])
}
