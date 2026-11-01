// Lernen: Zähler, Muster in Klartext, Eichung, Regel-Vorschläge (rein). Nichts hier verändert die Auswahl ohne bestätigte Regel.
import { LEVELS, LEVEL_LABEL, type Level } from './learn'
import type { CandRecord, Pair, PairSource } from './learnData'
import type { MomentEval } from './workbench'

export const MIN_PATTERNS = 50
export const MIN_MODEL = 1000

export interface LearnCounts {
  candidates: number
  withHeat: number
  creatorShorts: number
  ratings: Record<Level, number>
  corrections: number
  pairs: Record<PairSource, number>
  /** Einträge mit Heatmap oder Creator-Short (Grundlage fürs Modell-Training). */
  entries: number
}

export function counts(cands: CandRecord[], pairs: Pair[]): LearnCounts {
  const ratings: Record<Level, number> = { strong: 0, mid: 0, bad: 0 }
  for (const c of cands) if (c.rating) ratings[c.rating.level]++
  const p: Record<PairSource, number> = { rating: 0, correction: 0, creator: 0, heatmap: 0, blind: 0 }
  for (const x of pairs) p[x.source]++
  return {
    candidates: cands.length, withHeat: cands.filter((c) => c.heat).length,
    creatorShorts: new Set(cands.filter((c) => c.source === 'creator').map((c) => c.id.replace(/:\d+$/, ''))).size,
    ratings, corrections: cands.filter((c) => c.corrections && !c.correctionOf).length, pairs: p,
    entries: cands.filter((c) => c.heat || c.source === 'creator').length
  }
}

const de = (x: number): string => x.toFixed(1).replace('.', ',')
const avg = (a: number[]): number => a.reduce((s, x) => s + x, 0) / a.length
const corrected = (cands: CandRecord[]): CandRecord[] => cands.filter((c) => c.corrections && !c.correctionOf)

/** Mittlere Verschiebung der Grenzen durch eigene Korrekturen (nur Clips mit echter Änderung dieser Grenze). */
function userShift(cands: CandRecord[], key: 'startShift' | 'endShift'): { mean: number; n: number } | null {
  const v = corrected(cands).map((c) => c.corrections![key]).filter((x) => Math.abs(x) >= 0.1)
  return v.length >= 3 ? { mean: avg(v), n: v.length } : null
}
/** Mittlere Abweichung Shortme − Creator aus den Werkbank-Treffern. */
function creatorShift(evals: MomentEval[], key: 'startDelta' | 'endDelta'): { mean: number; n: number } | null {
  const v = evals.filter((m) => m.source === 'creator' && m.hit && m[key] !== null).map((m) => m[key] as number)
  return v.length >= 3 ? { mean: avg(v), n: v.length } : null
}

export function patterns(cands: CandRecord[], evals: MomentEval[]): string[] {
  const out: string[] = []
  const e = userShift(cands, 'endShift'), s = userShift(cands, 'startShift')
  if (e) out.push(`Enden ${e.mean > 0 ? 'verlängerst' : 'kürzt'} du im Schnitt um ${de(Math.abs(e.mean))} s (${e.n} Korrekturen).`)
  if (s) out.push(`Anfänge setzt du im Schnitt ${de(Math.abs(s.mean))} s ${s.mean < 0 ? 'früher' : 'später'} (${s.n} Korrekturen).`)
  const cut = corrected(cands).filter((c) => c.corrections!.cutText.length)
  if (cut.length >= 3) out.push(`In ${Math.round((cut.length / corrected(cands).length) * 100)} % deiner korrigierten Clips schneidest du Sätze heraus.`)
  for (const lv of ['bad', 'mid'] as Level[]) {
    const n = new Map<string, number>()
    for (const c of cands) if (c.rating?.level === lv) for (const r of c.rating.reasons) n.set(r, (n.get(r) ?? 0) + 1)
    const top = [...n].sort((a, b) => b[1] - a[1])[0]
    if (top && top[1] >= 2) out.push(`Häufigster Grund für „${LEVEL_LABEL[lv].toLowerCase()}“: ${top[0]} (${top[1]}×).`)
  }
  const cs = creatorShift(evals, 'startDelta'), ce = creatorShift(evals, 'endDelta')
  if (cs) out.push(`Creator beginnen im Schnitt ${de(Math.abs(cs.mean))} s ${cs.mean > 0 ? 'früher' : 'später'} als Shortme (${cs.n} Treffer).`)
  if (ce) out.push(`Creator enden im Schnitt ${de(Math.abs(ce.mean))} s ${ce.mean > 0 ? 'später' : 'früher'} als Shortme.`)
  const lost = new Map<string, number>()
  for (const m of evals) if (m.source === 'creator' && m.lost) lost.set(m.lost, (lost.get(m.lost) ?? 0) + 1)
  const l = [...lost].sort((a, b) => b[1] - a[1])[0]
  if (l && l[1] >= 3) out.push(`Verpasste Creator-Momente gehen am häufigsten bei „${l[0]}“ verloren (${l[1]}×).`)
  return out
}

export interface Calibration {
  /** Wie oft ordnet die Rubrik-Summe zwei Clips so wie deine Bewertung (Gleichstand = halb). */
  ratings: { rate: number; n: number; scope: 'Test' | 'Alle' } | null
  /** Anteil gewählter Shortme-Clips mit Spitze (≥ 0,75) der Wiedergabe-Kurve; `base` = Anteil bei allen Kandidaten. */
  peaks: { hit: number; base: number; n: number } | null
  creator: { rate: number; n: number } | null
}

const rubricSum = (c: CandRecord | undefined): number | null => (c?.rubric ? c.rubric.hook + c.rubric.payoff + c.rubric.quotable + c.rubric.standalone + c.rubric.density : null)

export function calibration(cands: CandRecord[], pairs: Pair[], evals: MomentEval[]): Calibration {
  const byId = new Map(cands.map((c) => [c.id, c]))
  const agree = (list: Pair[]): { rate: number; n: number } | null => {
    let ok = 0, n = 0
    for (const p of list) { const a = rubricSum(byId.get(p.a)), b = rubricSum(byId.get(p.b)); if (a === null || b === null) continue; n++; ok += a > b ? 1 : a === b ? 0.5 : 0 }
    return n ? { rate: ok / n, n } : null
  }
  const rp = pairs.filter((p) => p.source === 'rating')
  const test = agree(rp.filter((p) => p.split === 'test'))
  const all = agree(rp)
  const sel = cands.filter((c) => c.source === 'shortme' && c.fate === 'selected' && c.heat)
  const withHeat = cands.filter((c) => c.source === 'shortme' && c.heat && !c.correctionOf)
  const cr = evals.filter((m) => m.source === 'creator')
  return {
    ratings: test ? { ...test, scope: 'Test' } : all ? { ...all, scope: 'Alle' } : null,
    peaks: sel.length ? { hit: sel.filter((c) => c.heat!.max >= 0.75).length / sel.length, base: withHeat.filter((c) => c.heat!.max >= 0.75).length / withHeat.length, n: sel.length } : null,
    creator: cr.length ? { rate: cr.filter((m) => m.hit).length / cr.length, n: cr.length } : null
  }
}

export interface Rule { id: string; kind: 'start' | 'end'; /** Verschiebung in Sekunden (negativ = früher). */ seconds: number; text: string }

/** Vorschläge nur, wenn genug Belege vorliegen und die Verschiebung merklich ist (≥ 0,8 s). */
export function suggestRules(cands: CandRecord[], evals: MomentEval[]): Rule[] {
  const out: Rule[] = []
  const add = (id: string, kind: Rule['kind'], mean: number, n: number, minN: number, from: string): void => {
    if (n < minN || Math.abs(mean) < 0.8) return
    const seconds = Math.max(-5, Math.min(5, Math.round(mean * 10) / 10))
    out.push({ id, kind, seconds, text: `${kind === 'end' ? 'Enden' : 'Anfänge'} um ${de(Math.abs(seconds))} s ${(kind === 'end') === (seconds > 0) ? (kind === 'end' ? 'verlängern' : 'später setzen') : (kind === 'end' ? 'kürzen' : 'früher setzen')} (${from}, ${n} Fälle)` })
  }
  const e = userShift(cands, 'endShift'), s = userShift(cands, 'startShift')
  if (e) add('end-user', 'end', e.mean, e.n, 5, 'aus deinen Korrekturen')
  if (s) add('start-user', 'start', s.mean, s.n, 5, 'aus deinen Korrekturen')
  const cs = creatorShift(evals, 'startDelta'), ce = creatorShift(evals, 'endDelta')
  if (cs) add('start-creator', 'start', -cs.mean, cs.n, 10, 'nach Creator-Shorts')
  if (ce) add('end-creator', 'end', -ce.mean, ce.n, 10, 'nach Creator-Shorts')
  return out
}

/** Angenommene Regeln auf frisch gewählte Clips anwenden: Grenzen verschieben, auf Wortgrenzen einrasten. Unplausible Ergebnisse bleiben unverändert. */
export function applyRules<C extends { start: number; end: number; firstWord: number; lastWord: number }>(clip: C, words: Array<{ start: number; end: number }>, rules: Rule[], durationSec: number, maxLen = 90): C {
  const ds = rules.filter((r) => r.kind === 'start').reduce((a, r) => a + r.seconds, 0)
  const de_ = rules.filter((r) => r.kind === 'end').reduce((a, r) => a + r.seconds, 0)
  if (!ds && !de_) return clip
  const start = Math.max(0, clip.start + ds), end = Math.min(durationSec, clip.end + de_)
  if (end - start < 10 || end - start > maxLen) return clip
  const first = words.findIndex((w) => w.start >= start - 0.06)
  let last = -1
  for (let k = Math.max(0, first); k < words.length && words[k].end <= end + 0.06; k++) last = k
  if (first < 0 || last < first) return clip
  return { ...clip, start: words[first].start, end: words[last].end, firstWord: first, lastWord: last }
}

export type StageId = 'collect' | 'patterns' | 'rules' | 'model' | 'compare' | 'adopted'
export const STAGES: Array<{ id: StageId; label: string }> = [{ id: 'collect', label: 'Sammeln' }, { id: 'patterns', label: 'Muster' }, { id: 'rules', label: 'Regeln' }, { id: 'model', label: 'Modell' }, { id: 'compare', label: 'Vergleich' }, { id: 'adopted', label: 'Übernommen' }]

/** Stufen-Anzeige: erreicht = true. Modell/Vergleich gibt es in diesem Paket noch nicht (nur „bereit“ ab 1.000 Einträgen). */
export function stages(c: LearnCounts, collecting: boolean, suggested: number, accepted: number): Record<StageId, boolean> {
  return { collect: collecting && c.candidates > 0, patterns: c.corrections >= MIN_PATTERNS, rules: suggested + accepted > 0, model: false, compare: false, adopted: accepted > 0 }
}
export { LEVELS }

export interface LearnStats {
  settings: { collect: boolean; deleteVideos: boolean; trend: boolean }
  counts: LearnCounts
  patterns: string[]
  calibration: Calibration
  open: Rule[]
  accepted: Rule[]
  stages: Record<StageId, boolean>
}
