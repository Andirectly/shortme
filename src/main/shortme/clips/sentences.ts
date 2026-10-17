import type { AsrWord } from '../../engines/asr/protocol'

export interface Sentence { index: number; first: number; last: number; start: number; end: number; text: string }

/** Deutsche (und englische) Abkürzungen, nach denen ein Punkt KEIN Satzende ist. */
const ABBREVIATIONS = new Set([
  'z.b', 'z.b.', 'u.a', 'u.a.', 'd.h', 'd.h.', 'bzw', 'ca', 'etc', 'usw', 'vgl', 'ggf', 'evtl', 'inkl', 'zzgl', 'bspw', 'o.ä', 'u.ä', 'i.d.r', 'z.t', 'm.e', 's.o', 's.u',
  'dr', 'prof', 'nr', 'str', 'tel', 'fr', 'hr', 'mr', 'mrs', 'ms', 'st', 'vs', 'e.g', 'i.e', 'approx', 'jh', 'mio', 'mrd', 'max', 'min', 'std', 'sek', 'ggü', 'zb', 'ua'
])

/** Endet das Wort auf ein Satzzeichen (. ? ! … ), das wirklich ein Satzende ist? */
export function isSentenceEnd(word: string, _next?: string): boolean {
  const m = word.match(/^(.*?)([.!?…]+)["“”')\]]*$/u)
  if (!m) return false
  const body = m[1]
  const punct = m[2]
  if (/[!?]/.test(punct) || punct.includes('…')) return true
  // Punkt: Abkürzung?
  const bare = body.toLowerCase().replace(/^[("„“'\[]+/, '')
  if (ABBREVIATIONS.has(bare) || ABBREVIATIONS.has(`${bare}.`)) return false
  // Einzelner Buchstabe oder Initialen wie "A." / "z.B"
  if (/^\p{L}$/u.test(bare)) return false
  if (/^(\p{L}\.)+\p{L}$/u.test(bare)) return false
  // Ordnungszahl / Dezimalzahl: "3." gefolgt von Kleinbuchstaben, "3.5"
  // (wie clippyme: reine Zahl + Punkt ist kein Satzende; „3. Stock“ ist von „Ich bin 30.“ nicht unterscheidbar)
  if (/^\d+$/.test(bare)) return false
  if (/\d[.,]\d*$/.test(word) && /^\d+[.,]$/.test(word) === false && !/\d$/.test(body)) return false
  return true
}

/** Zerlegt die Wortliste in Sätze (Satzzeichen von Parakeet); ohne Satzzeichen bricht eine Pause ≥ `gap` Sekunden den Satz. */
export function splitSentences(words: AsrWord[], gap = 0.9): Sentence[] {
  const out: Sentence[] = []
  let first = 0
  for (let i = 0; i < words.length; i++) {
    const w = words[i]
    const next = words[i + 1]
    const punctEnd = isSentenceEnd(w.w, next?.w)
    const longPause = next !== undefined && next.start - w.end >= gap
    if (punctEnd || longPause || i === words.length - 1) {
      out.push({ index: out.length, first, last: i, start: words[first].start, end: w.end, text: words.slice(first, i + 1).map((x) => x.w).join(' ') })
      first = i + 1
    }
  }
  return out
}
