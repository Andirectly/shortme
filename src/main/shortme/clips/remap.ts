// Einfügungen in die Wortliste des Transkripts (zweiter Durchgang mit Qwen3-ASR) ändern die Wortindizes: Clips, Tags, Korrekturen und
// Segmente werden auf die neuen Indizes umgerechnet. Reine Funktionen (getestet).
import type { ShortmeClip } from '../../../shared/shortme'
import type { Insert, TWord } from '../../../shared/wordDiff'

export interface InsertResult { map: number[]; starts: number[]; inserts: Insert[] }

/** Einfügungen sortiert (nach `before`) – `starts[i]` ist der neue Startindex der Gruppe i (siehe applyInserts). */
export function remapClip(c: ShortmeClip, r: InsertResult, newCount: number): ShortmeClip {
  const sorted = [...r.inserts].sort((a, b) => a.before - b.before)
  const group = (before: number): { start: number; words: TWord[] } | null => {
    const i = sorted.findIndex((g) => g.before === before)
    return i >= 0 ? { start: r.starts[i], words: sorted[i].words } : null
  }
  let first = r.map[c.firstWord]
  const gb = group(c.firstWord)
  if (gb && gb.words[0].start >= c.start - 0.05) first = gb.start // Wörter direkt vor dem ersten Wort, die noch im Clip beginnen
  let last = r.map[c.lastWord]
  const ga = group(c.lastWord + 1)
  if (ga && ga.words[ga.words.length - 1].end <= c.end + 0.05) last = ga.start + ga.words.length - 1
  last = Math.min(newCount - 1, last)
  const corrections: Record<number, string> = {}
  for (const [k, v] of Object.entries(c.corrections ?? {})) { const n = r.map[Number(k)]; if (n !== undefined) corrections[n] = v }
  return { ...c, firstWord: first, lastWord: last, tags: c.tags.map((t) => ({ ...t, word: r.map[t.word] ?? t.word })), corrections }
}

/** Segmente neu einteilen: jedes Segment reicht bis vor den Anfang des nächsten (Einfügungen vor einem Segment gehören zum vorigen). */
export function remapSegments<S extends { first: number; last: number }>(segs: S[], map: number[], newCount: number): S[] {
  return segs.map((s, i) => ({ ...s, first: map[s.first], last: i + 1 < segs.length ? map[segs[i + 1].first] - 1 : newCount - 1 }))
}
