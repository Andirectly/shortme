// Korrektur-Protokoll: was ändert die Person an einem Shortme-Vorschlag? Reine Funktionen (Diff zweier Editor-Zustände).
import type { EditState } from './edits'

export type CorrEvent =
  | { kind: 'trim'; before: [number, number]; after: [number, number]; /** Sekunden; negativ = früher */ startShift: number; endShift: number }
  | { kind: 'cut'; text: string; seconds: number; restored: boolean }
  | { kind: 'hook'; before: string; after: string }
  | { kind: 'framing'; before: number; after: number }
  | { kind: 'export'; durationSec: number }
  /** Wiedergabedauer im Editor (Sekunden); zeigt auch bei verworfenen Clips, ob sie angesehen wurden. */
  | { kind: 'played'; sec: number }
  /** Clip aus der Liste gelöscht; `playedSec` = so lange wurde er vorher im Editor abgespielt (0 = nie). */
  | { kind: 'delete'; playedSec: number }

export type CorrRecord = CorrEvent & { at: string; clipId: string }

const r1 = (x: number): number => Math.round(x * 100) / 100

/** Ereignisse für den Übergang `a` → `b`; `words` für Text und Dauer der herausgeschnittenen Wörter. */
export function diffStates(a: EditState, b: EditState, words: Array<{ w: string; start: number; end: number }>): CorrEvent[] {
  const out: CorrEvent[] = []
  if (a.start !== b.start || a.end !== b.end) out.push({ kind: 'trim', before: [r1(a.start), r1(a.end)], after: [r1(b.start), r1(b.end)], startShift: r1(b.start - a.start), endShift: r1(b.end - a.end) })
  const A = new Set(a.cutWords), B = new Set(b.cutWords)
  for (const [ids, restored] of [[b.cutWords.filter((i) => !A.has(i)), false], [a.cutWords.filter((i) => !B.has(i)), true]] as const) {
    if (!ids.length) continue
    const ws = ids.map((i) => words[i]).filter(Boolean)
    out.push({ kind: 'cut', text: ws.map((w) => w.w).join(' '), seconds: r1(ws.reduce((s, w) => s + (w.end - w.start), 0)), restored })
  }
  if (a.hook.text !== b.hook.text) out.push({ kind: 'hook', before: a.hook.text, after: b.hook.text })
  const fa = JSON.stringify([a.layoutOps, a.streamOps]), fb = JSON.stringify([b.layoutOps, b.streamOps])
  if (fa !== fb) out.push({ kind: 'framing', before: a.layoutOps.length + a.streamOps.length, after: b.layoutOps.length + b.streamOps.length })
  return out
}
