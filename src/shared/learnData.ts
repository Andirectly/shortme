// Lern-Datensatz: Typen, Split Training/Test und Präferenz-Paare (rein, ohne Dateizugriff).
import { LEVEL_RANK, type Level } from './learn'
import type { ShortmeClip } from './shortme'

export type Source = 'shortme' | 'creator' | 'reference'
export type PairSource = 'rating' | 'correction' | 'creator' | 'heatmap' | 'blind'
/** Gewicht je Quelle: eigene Urteile > Creator > Heatmap > Referenz-Blindtest. */
export const PAIR_WEIGHT: Record<PairSource, number> = { rating: 1, correction: 1, creator: 0.6, heatmap: 0.35, blind: 0.2 }

export interface Corrected { startShift: number; endShift: number; cutText: string[]; hook?: { before: string; after: string }; framing: boolean }

export interface CandRecord {
  id: string
  /** Video-ID (Projekt-Hash); Rhapsody: `vid`. */
  vid: string
  source: Source
  contentType: string | null
  start: number
  end: number
  transcript: string
  marks: string[]
  /** Rubrik-Einzelwerte (hook, payoff, quotable, standalone, density) – nur Shortme-Kandidaten. */
  rubric: ShortmeClip['criteria'] | null
  heat: { mean: number; max: number } | null
  rating: { level: Level; reasons: string[] } | null
  corrections: Corrected | null
  exported: boolean
  playedSec: number
  /** Shortme: Schicksal in der Auswahl (rated/finalist/overlap/selected). */
  fate?: string
  /** Creator/Referenz: Kanal, Aufrufe, Leistung relativ zum Kanal-Median (null = zu jung/zu wenig Vergleich). */
  creator?: { channel: string; views: number; likes: number; comments: number; date: string; ratio: number | null }
  /** Nur Variante „meine Version“ eines korrigierten Vorschlags: Id des Vorschlags. */
  correctionOf?: string
  split: 'train' | 'test'
}

export interface Pair { a: string; b: string; source: PairSource; weight: number; vid: string; split: 'train' | 'test' }

/** Stabiler Zufallswert 0..1 aus einem Text (FNV-1a). */
export function unit(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) }
  return ((h >>> 0) % 100000) / 100000
}
/** ca. 80 % Training / 20 % Test, pro Video und für immer gleich (Eintrag in split.json hat Vorrang). */
export const splitOf = (vid: string): 'train' | 'test' => (unit(`shortme-split|${vid}`) < 0.8 ? 'train' : 'test')

export const overlap = (a: { start: number; end: number }, b: { start: number; end: number }): number => {
  const o = Math.min(a.end, b.end) - Math.max(a.start, b.start)
  return o <= 0 ? 0 : o / Math.min(a.end - a.start, b.end - b.start)
}

const mk = (a: CandRecord, b: CandRecord, source: PairSource): Pair => ({ a: a.id, b: b.id, source, weight: PAIR_WEIGHT[source], vid: a.vid, split: a.split })

/** Alle Paare eines Videos aus Bewertung, Korrektur, Creator und Heatmap (Blindtest-Paare kommen aus blind.jsonl). */
export function videoPairs(c: CandRecord[]): Pair[] {
  const out: Pair[] = []
  const mine = c.filter((x) => x.source === 'shortme')
  // Bewertungen: stark > mittel > schlecht (nur Originalvorschläge)
  const rated = mine.filter((x) => x.rating && !x.correctionOf)
  for (const a of rated) for (const b of rated) if (LEVEL_RANK[a.rating!.level] > LEVEL_RANK[b.rating!.level]) out.push(mk(a, b, 'rating'))
  // Korrekturen: meine Version > Vorschlag
  for (const v of mine) if (v.correctionOf) { const o = mine.find((x) => x.id === v.correctionOf); if (o) out.push(mk(v, o, 'correction')) }
  // Creator: gewählter Abschnitt > Shortme-Kandidaten, die ihn nicht berühren
  for (const cr of c.filter((x) => x.source === 'creator')) for (const o of mine.filter((x) => !x.correctionOf && overlap(cr, x) < 0.2)) out.push(mk(cr, o, 'creator'))
  // Heatmap: deutlich höheres Maximum bei ähnlicher Länge
  const hot = mine.filter((x) => x.heat && !x.correctionOf)
  for (const a of hot) for (const b of hot) {
    const la = a.end - a.start, lb = b.end - b.start
    if (a.heat!.max - b.heat!.max >= 0.25 && Math.max(la, lb) / Math.min(la, lb) <= 1.3) out.push(mk(a, b, 'heatmap'))
  }
  return out
}

/** Creator-Shorts desselben Kanals: deutlich stärker (Verhältnis ≥ 2× zueinander) > schwächer; nur innerhalb gleicher Split-Gruppe. */
export function channelPairs(all: CandRecord[]): Pair[] {
  const out: Pair[] = []
  const byCh = new Map<string, CandRecord[]>()
  for (const x of all) if (x.source === 'creator' && x.creator?.ratio != null) byCh.set(x.creator.channel, [...(byCh.get(x.creator.channel) ?? []), x])
  for (const list of byCh.values()) for (const a of list) for (const b of list) {
    if (a.split === b.split && a.id !== b.id && a.creator!.ratio! >= 2 * Math.max(b.creator!.ratio!, 0.01)) out.push(mk(a, b, 'creator'))
  }
  return out
}

/** Werkbank: Shorts (Creator oder Referenz) eines Langvideos, per Tonabgleich im Langvideo verortet (`creator.json` im Projekt). */
export interface CreatorShort {
  id: string
  source: 'creator' | 'reference'
  title: string
  url?: string
  views: number
  likes: number
  comments: number
  /** ISO-Datum der Veröffentlichung. */
  date: string
  /** Leistung / Median der Shorts desselben Kanals (±60 Tage); null = zu jung (< 14 Tage), zu wenig Vergleich oder Referenz. */
  ratio: number | null
  /** Abschnitte im Langvideo (mehrere, wenn der Short mehrere Stellen nutzt); `score` = Stärke des Tonabgleichs 0..1. */
  moments: Array<{ start: number; end: number; score: number }>
}
export interface CreatorFile { channel: string; shorts: CreatorShort[] }
