// Videostücke im Editor (wie in einem Schnittprogramm): Schnittpunkte teilen den Clip in Stücke, Stücke lassen sich löschen (= Schnitt)
// und in der Reihenfolge verschieben. Rein und getestet; Vorschau und Export nutzen dieselbe Funktion.

/** Stück [start, end) in Quellzeit vor das Stück legen, das bei Quellzeit `before` beginnt (null = ans Ende). */
export interface SegMove { start: number; end: number; before: number | null }
export interface SrcSpan { src0: number; src1: number }

const EPS = 1e-6

/** Abschnitte (aufsteigend) nach den Verschiebungen neu ordnen; direkt aneinanderliegende Abschnitte verschmelzen, Ausgabezeiten neu. */
export function applyMoves(keeps: SrcSpan[], moves: SegMove[]): Array<SrcSpan & { out0: number }> {
  let list: SrcSpan[] = keeps.map((k) => ({ src0: k.src0, src1: k.src1 }))
  for (const m of moves) {
    if (!(m.end > m.start)) continue
    for (const x of [m.start, m.end, ...(m.before !== null ? [m.before] : [])]) {
      list = list.flatMap((k) => (x > k.src0 + EPS && x < k.src1 - EPS ? [{ src0: k.src0, src1: x }, { src0: x, src1: k.src1 }] : [k]))
    }
    const moved = list.filter((k) => k.src0 >= m.start - EPS && k.src1 <= m.end + EPS)
    if (!moved.length) continue
    const rest = list.filter((k) => !moved.includes(k))
    let at = m.before === null ? rest.length : rest.findIndex((k) => Math.abs(k.src0 - m.before!) < 1e-3)
    if (at < 0) at = rest.findIndex((k) => k.src0 > m.before!)
    if (at < 0) at = rest.length
    list = [...rest.slice(0, at), ...moved, ...rest.slice(at)]
  }
  const out: Array<SrcSpan & { out0: number }> = []
  let o = 0
  for (const k of list) {
    const last = out[out.length - 1]
    if (last && Math.abs(last.src1 - k.src0) < EPS) last.src1 = k.src1
    else out.push({ ...k, out0: o })
    o += k.src1 - k.src0
  }
  return out
}

/** Stücke der Zeitleiste: Grenzen = Clipbeginn, Schnittpunkte im Clip, Clipende. */
export function segmentsOf(start: number, end: number, splits: number[]): Array<[number, number]> {
  const b = [start, ...splits.filter((s) => s > start + 0.02 && s < end - 0.02).sort((x, y) => x - y), end]
  return b.slice(1).map((e, i) => [b[i], e] as [number, number])
}
