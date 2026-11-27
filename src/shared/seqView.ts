// Sequenzansicht der Editor-Zeitleiste (wie in Premiere/Shotcut): die x-Achse ist die Export-Zeit. Gelöschtes verschwindet, die Stücke
// schließen lückenlos aneinander an, verschobene Stücke stehen an ihrer neuen Stelle. Links/rechts ein kurzer Rand aus der Quelle,
// damit sich der Clip über die Griffe verlängern lässt. Rein und getestet; die Zeitleiste rechnet alles über fwd/inv.

export interface SeqSpan { s0: number; s1: number; o0: number; pad?: boolean }
export interface SeqView { a0: number; a1: number; len: number; spans: SeqSpan[]; fwd: (s: number) => number; inv: (o: number) => number }

/**
 * `pieces` = Stücke [Quelle von, bis] in Export-Reihenfolge (relativ zur Zeitleiste), `window` = Länge der Zeitleiste in Quellzeit.
 * Ohne Stücke (Plan fehlt) ist die Ansicht die Quellzeit selbst.
 */
export function seqView(pieces: Array<[number, number]>, window: number): SeqView {
  const keeps: SeqSpan[] = []
  let o = 0
  for (const [s0, s1] of pieces) {
    if (!(s1 > s0)) continue
    const last = keeps[keeps.length - 1]
    if (last && Math.abs(last.s1 - s0) < 1e-6) last.s1 = s1
    else keeps.push({ s0, s1, o0: o })
    o += s1 - s0
  }
  if (!keeps.length) {
    const id: SeqSpan = { s0: 0, s1: window, o0: 0 }
    return { a0: 0, a1: window, len: window, spans: [id], fwd: (s) => Math.min(window, Math.max(0, s)), inv: (x) => Math.min(window, Math.max(0, x)) }
  }
  const len = o
  const margin = Math.min(15, Math.max(3, len * 0.2))
  const first = Math.min(...keeps.map((k) => k.s0)), lastEnd = Math.max(...keeps.map((k) => k.s1))
  const m0 = Math.min(margin, first), m1 = Math.min(margin, Math.max(0, window - lastEnd))
  const spans: SeqSpan[] = [...(m0 > 0 ? [{ s0: first - m0, s1: first, o0: -m0, pad: true }] : []), ...keeps, ...(m1 > 0 ? [{ s0: lastEnd, s1: lastEnd + m1, o0: len, pad: true }] : [])]
  const a0 = -m0, a1 = len + m1
  const fwd = (s: number): number => {
    const hit = spans.find((k) => s >= k.s0 && s < k.s1) ?? spans.find((k) => Math.abs(s - k.s1) < 1e-9 && !spans.some((x) => Math.abs(x.s0 - s) < 1e-9))
    if (hit) return hit.o0 + (s - hit.s0)
    if (s < first - m0) return a0
    if (s >= lastEnd + m1) return a1
    // gelöschter Bereich: zusammengeschoben auf den Anfang des nächsten Stücks (in Quellreihenfolge)
    const next = keeps.filter((k) => k.s0 > s).sort((x, y) => x.s0 - y.s0)[0]
    return next ? next.o0 : len
  }
  const inv = (x: number): number => {
    if (x <= a0) return spans[0].s0
    const hit = spans.find((k) => x >= k.o0 && x < k.o0 + (k.s1 - k.s0))
    if (hit) return hit.s0 + (x - hit.o0)
    const tail = spans[spans.length - 1]
    return tail.s1
  }
  return { a0, a1, len, spans, fwd, inv }
}
