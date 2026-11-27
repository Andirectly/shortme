// Transkript-Zeilen für die Lyrics-Ansicht (rein, getestet).
export interface LyricWord { w: string; t: number; e: number; g: number; hi?: boolean; edited: boolean }

/** Wörter → Zeilen: Satzende, Pause ≥ 0,7 s, Komma nach ≥ 4 Wörtern oder höchstens 7 Wörter. */
export function lyricLines(words: LyricWord[]): LyricWord[][] {
  const out: LyricWord[][] = []
  let cur: LyricWord[] = []
  words.forEach((w, i) => {
    const next = words[i + 1]
    cur.push(w)
    const end = /[.!?…]["»“]?$/.test(w.w) || (/,$/.test(w.w) && cur.length >= 4) || cur.length >= 7 || (next !== undefined && next.t - w.e >= 0.7)
    if (end || !next) { out.push(cur); cur = [] }
  })
  return out
}
