import type { ClipTagKind, ShortmeClip } from '@shared/shortme'
import { MAX_CANDS, MAX_CLIPS, candidateBudget, defaultWanted } from '@shared/estimate'
import { marksBySentence, type AudioEvent } from './audioEvents'
import { chatBonus, heatBonus, heatScore, type HeatPoint } from './heat'
import type { AsrWord } from '../../engines/asr/protocol'
import type { Signals } from './signals'
import { splitSentences, type Sentence } from './sentences'
import { snapClip, type Range } from './snap'
import { topicClips } from './texttiling'
import { chatJson, int, isObj, loadPrompt, str } from './llm'
import { buildTopicMap, topicContext, topicOfRange, type TopicMap } from './topics'

export interface SelectInput {
  /** „Most replayed“-Kurve (YouTube), falls vorhanden – starkes Ranking-Signal. */
  heat?: HeatPoint[] | null
  /** Twitch-Chat-Aktivität (nur wenn der Chat-Schalter an war), um 15 s zurückgerechnet. */
  chat?: HeatPoint[] | null
  /** Gewichte aus dem Inhaltstyp-Profil (Standard 5 / 1 / 1). */
  weights?: { signal: number; heat: number; chat: number }
  /** Audio-Ereignisse (YAMNet/VAD) → Markierungen im Transkript für das LLM. */
  events?: AudioEvent[] | null
  words: AsrWord[]
  durationSec: number
  signals: Signals
  cuts: number[]
}

export interface CandTrace { start: number; end: number; criteria: ShortmeClip['criteria']; title: string; fate: 'rated' | 'finalist' | 'overlap' | 'selected' }

export interface SelectOptions {
  /** URL des laufenden llama-server; null = Fallback (TextTiling). */
  baseUrl: string | null
  /** Themenkarte zwischenspeichern (Projektordner) – spart den Themen-Durchgang bei erneuter Auswahl. */
  topicsCache?: { load: (sentences: number) => Promise<TopicMap | null>; save: (m: TopicMap) => Promise<void> }
  query?: string
  wanted?: number
  minSec?: number
  maxSec?: number
  /** Alle bewerteten Kandidaten (auch nicht gewählte) mit Schicksal – nur zum Sammeln von Lerndaten. */
  trace?: (rows: CandTrace[]) => void
  signal?: AbortSignal
  report?: (stage: string, fraction: number, message: string) => void
}

interface Cand { first: number; last: number } // Satzindizes (inklusive)
interface Rated extends Cand {
  criteria: ShortmeClip['criteria']
  sum: number
  title: string
  hookText: string
  reason: string
  tags: Array<{ sentence: number; word: string; kind: ClipTagKind }>
  extended: number
  rank: number
  /** Proben/Kontext für die adaptive zweite Bewertung (nur Top-Kandidaten). */
  samples?: RateRaw[]
  text?: string
  ctx?: string
}

export const MAX_CLIP_SEC = 90

const lev = (a: string, b: string): number => {
  const m = a.length
  const n = b.length
  let prev = Array.from({ length: n + 1 }, (_, j) => j)
  for (let i = 1; i <= m; i++) { const cur = [i]; for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = cur }
  return prev[n]
}

/** Korrektur annehmen? Nur Zeichensetzung/Schreibweise oder kleine Wortänderung – nie frei erfundene Wörter. */
export function acceptCorrection(orig: string, next: string): boolean {
  if (!next.trim() || /\s/.test(next.trim()) || next === orig) return false
  const a = squash(orig)
  const b = squash(next)
  if (a === b) return true
  const d = lev(a, b)
  return b.length > 2 && d <= Math.max(2, Math.floor(0.4 * Math.max(a.length, b.length)))
}

/** LLM-Korrekturlauf (Zeichensetzung, Schreibweise, offensichtliche Erkennungsfehler); index-treu, Abweichungen werden verworfen. */
export async function proofreadWords(url: string, words: string[], signal?: AbortSignal): Promise<Record<number, string>> {
  if (words.length === 0) return {}
  const prompt = await loadPrompt('proofread', { words: words.map((w, i) => `${i}: ${w}`).join('\n') })
  try {
    const out = await chatJson(url, prompt, {
      signal, maxTokens: Math.min(4000, words.length * 8 + 200), temperature: 0.1,
      schema: { type: 'object', additionalProperties: false, required: ['words'], properties: { words: { type: 'array', items: { type: 'string' } } } },
      validate: (x) => { if (!isObj(x) || !Array.isArray(x.words)) throw new Error('words fehlt'); if (x.words.length !== words.length) throw new Error(`Wortzahl ${x.words.length} ≠ ${words.length}`); return x.words.map(String) }
    })
    const res: Record<number, string> = {}
    out.forEach((w, i) => { if (acceptCorrection(words[i], w.trim())) res[i] = w.trim() })
    return res
  } catch (e) {
    if (signal?.aborted) throw e
    console.error('Untertitel-Korrektur übersprungen:', e)
    return {}
  }
}
const WINDOW_WORDS = 3000
// Clip-Anzahl und Kandidatenbudget liegen in shared/estimate.ts (auch für die Dauer-Schätzung der Oberfläche)
export { MAX_CLIPS, MAX_CANDS, defaultWanted, candidateBudget }

/** Kandidaten (nach Zeit sortiert) gleichmäßig über das ganze Video ausdünnen – nie einfach den Rest abschneiden, sonst fehlt das Ende langer Videos. */
export function thinEvenly<T>(items: T[], max: number): T[] {
  if (items.length <= max) return items
  if (max <= 1) return items.slice(0, Math.max(0, max))
  return Array.from({ length: max }, (_, k) => items[Math.round((k * (items.length - 1)) / (max - 1))])
}

/** Transkript in LLM-Fenster teilen (Satzgrenzen, ≈ `maxWords` Wörter, 6 Sätze Überlappung). */
export function buildWindows(sentences: Sentence[], maxWords = WINDOW_WORDS, overlap = 6): Array<{ from: number; to: number }> {
  const out: Array<{ from: number; to: number }> = []
  let from = 0
  while (from < sentences.length) {
    let to = from
    let words = 0
    while (to < sentences.length && words + (sentences[to].last - sentences[to].first + 1) <= maxWords) { words += sentences[to].last - sentences[to].first + 1; to++ }
    to = Math.max(from, to - 1)
    out.push({ from, to })
    if (to >= sentences.length - 1) break
    from = Math.max(from + 1, to - overlap + 1)
  }
  return out
}

const secOf = (sig: number[], a: number, b: number): number => {
  let t = 0
  let n = 0
  for (let s = Math.floor(a); s <= Math.min(sig.length - 1, Math.floor(b)); s++) { t += sig[s]; n++ }
  return n ? t / n : 0
}

/** Zeile für das LLM: `[S12 | 212 s] Text (laut)`; Ton-Hinweise nur bei deutlichen Auffälligkeiten. */
export function formatSentence(s: Sentence, sig: Signals): string {
  const marks: string[] = []
  if (!s.ev && secOf(sig.burst, s.start, s.end) > 0.6) marks.push('Lachen?')
  if (secOf(sig.loudness, s.start, s.end) > 0.85) marks.push('laut')
  return `[S${s.index} | ${Math.round(s.start)} s] ${s.text}${s.ev?.length ? ` ${s.ev.join(' ')}` : ''}${marks.length ? ` (${marks.join(', ')})` : ''}`
}

const clipText = (sentences: Sentence[], a: number, b: number): string => sentences.slice(a, b + 1).map((s) => `[S${s.index}] ${s.text}${s.ev?.length ? ` ${s.ev.join(' ')}` : ''}`).join('\n')
const dur = (sentences: Sentence[], a: number, b: number): number => sentences[b].end - sentences[a].start
const norm = (w: string): string => w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')

/** LLM-Tags (Satz + Wort) → Wortindizes im Transkript; unbekannte Wörter werden verworfen. */
export function resolveTags(tags: Rated['tags'], sentences: Sentence[], words: AsrWord[], first: number, last: number): ShortmeClip['tags'] {
  const out: ShortmeClip['tags'] = []
  const seen = new Set<number>()
  for (const t of tags) {
    if (t.sentence < first || t.sentence > last) continue
    const s = sentences[t.sentence]
    for (let i = s.first; i <= s.last; i++) {
      if (norm(words[i].w) === norm(t.word) && !seen.has(i)) { seen.add(i); out.push({ word: i, kind: t.kind }); break }
    }
  }
  return out.sort((a, b) => a.word - b.word)
}

/** Kandidatenlänge in Grenzen bringen: zu lang → am letzten passenden Satzende kürzen; zu kurz → nach hinten verlängern. */
export function fitLength(c: Cand, sentences: Sentence[], minSec: number, maxSec: number, limit: number): Cand | null {
  let { first, last } = c
  first = Math.max(0, Math.min(first, limit)); last = Math.max(first, Math.min(last, limit))
  while (last > first && dur(sentences, first, last) > maxSec) last--
  while (last < limit && dur(sentences, first, last) < minSec) last++
  return dur(sentences, first, last) >= minSec * 0.8 && dur(sentences, first, last) <= maxSec ? { first, last } : null
}

const overlaps = (a: Cand, b: Cand): number => {
  const lo = Math.max(a.first, b.first)
  const hi = Math.min(a.last, b.last)
  if (hi < lo) return 0
  return (hi - lo + 1) / Math.min(a.last - a.first + 1, b.last - b.first + 1)
}

const NOTE = { type: 'integer', minimum: 0, maximum: 4 }
export const RATE_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['hook_quote', 'payoff_quote', 'missing_context', 'hook', 'payoff', 'quotable', 'standalone', 'emotion', 'title', 'hook_text', 'reason', 'tags'],
  properties: {
    hook_quote: { type: 'string' }, payoff_quote: { type: 'string' }, missing_context: { type: 'array', maxItems: 5, items: { type: 'string' } },
    hook: NOTE, payoff: NOTE, quotable: NOTE, standalone: NOTE, emotion: NOTE,
    title: { type: 'string' }, hook_text: { type: 'string' }, reason: { type: 'string' },
    tags: { type: 'array', maxItems: 8, items: { type: 'object', additionalProperties: false, required: ['sentence', 'word', 'kind'], properties: { sentence: { type: 'integer' }, word: { type: 'string' }, kind: { type: 'string', enum: ['emphasis', 'entity', 'hook'] } } } }
  }
}

interface RateRaw { notes: { hook: number; payoff: number; quotable: number; standalone: number; emotion: number }; hookQuote: string; payoffQuote: string; missing: string[]; title: string; hookText: string; reason: string; tags: Rated['tags'] }

export function validateRate(x: unknown): RateRaw {
  if (!isObj(x)) throw new Error('Objekt erwartet')
  const notes = { hook: int(x.hook, 0, 4, 'hook'), payoff: int(x.payoff, 0, 4, 'payoff'), quotable: int(x.quotable, 0, 4, 'quotable'), standalone: int(x.standalone, 0, 4, 'standalone'), emotion: int(x.emotion, 0, 4, 'emotion') }
  const tags = Array.isArray(x.tags) ? x.tags.filter(isObj).map((t) => ({ sentence: int(t.sentence, 0, 1e9, 'sentence'), word: String(t.word ?? ''), kind: (['emphasis', 'entity', 'hook'].includes(String(t.kind)) ? t.kind : 'emphasis') as ClipTagKind })) : []
  return { notes, hookQuote: String(x.hook_quote ?? ''), payoffQuote: String(x.payoff_quote ?? ''), missing: Array.isArray(x.missing_context) ? x.missing_context.map(String).filter(Boolean) : [], title: str(x.title, 80, 'title'), hookText: str(x.hook_text, 80, 'hook_text'), reason: str(x.reason, 240, 'reason'), tags }
}

const squash = (t: string): string => t.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')

/** Beleg-Prüfung: Zitat muss wörtlich im Clip stehen, sonst gilt die zugehörige Note als unzuverlässig (−1). */
export const quoteOk = (quote: string, clip: string): boolean => { const q = squash(quote); return q.length >= 4 && squash(clip).includes(q) }

/** Mehrere Proben zusammenführen: Median je Note (0–4), Belege prüfen, auf die 0–20-Skala des Rasters skalieren. */
export function mergeRatings(samples: RateRaw[], clip: string): { criteria: ShortmeClip['criteria']; missing: string[]; meta: RateRaw } {
  const med = (vals: number[]): number => { const v = [...vals].sort((x, y) => x - y); return v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2 }
  const pick = (k: keyof RateRaw['notes']): number => med(samples.map((r) => r.notes[k]))
  const hookBad = samples.every((r) => !quoteOk(r.hookQuote, clip))
  const payoffBad = samples.every((r) => !quoteOk(r.payoffQuote, clip))
  const at20 = (n: number): number => Math.round(Math.max(0, Math.min(4, n)) * 5)
  const criteria = {
    hook: at20(pick('hook') - (hookBad ? 1 : 0)), payoff: at20(pick('payoff') - (payoffBad ? 1 : 0)), quotable: at20(pick('quotable')),
    standalone: at20(pick('standalone')), density: at20(pick('emotion'))
  }
  return { criteria, missing: samples[0].missing, meta: samples[0] }
}

/** Satzanfänge, die fast immer Fortsetzung eines früheren Gedankens sind (Hinweis für die Anfangsprüfung). */
export const CONNECTIVE_START = /^(und|aber|also|dann|deswegen|deshalb|genau|ja|nee|nein|doch|weil|denn|sondern|oder|außerdem|trotzdem|jedenfalls|na ja)\b|^(er|sie|es|das|dies|dieser|diese|dieses|der|die|dem|den)\s+(ist|war|hat|hatte|sind|waren|wird|wurde|kann|muss|hab|habe)\b/i

/** Weiche Längenvorgabe (Shorts-Sweetspot 22–50 s); Abzug in Punkten. */
export function lengthPenalty(sec: number): number {
  if (sec < 15) return 6
  if (sec < 22) return 3
  if (sec <= 50) return 0
  if (sec <= 65) return 2
  if (sec <= 80) return 5
  return 8
}

export const critSum = (c: ShortmeClip['criteria']): number => c.hook + c.payoff + c.quotable + c.standalone + c.density

/** Endwert: 60 % Raster, 40 % relative Rangfolge der Finalisten (+ bis 5 Punkte aus den Ton-Signalen). */
export function finalScore(sum: number, rank: number, finalists: number, signalMean: number, heatBonusPts = 0, signalWeight = 5): number {
  const rankScore = finalists <= 1 ? 100 : 100 - rank * (60 / (finalists - 1))
  return Math.max(0, Math.min(100, Math.round(0.6 * sum + 0.4 * rankScore + signalWeight * signalMean + heatBonusPts)))
}

const queryLine = (q?: string): string => (q?.trim() ? `Der Nutzer sucht besonders nach: „${q.trim()}“. Bevorzuge passende Stellen, erfinde aber nichts.\n` : '')

export async function selectClips(input: SelectInput, opts: SelectOptions): Promise<ShortmeClip[]> {
  const { words, durationSec, signals, cuts } = input
  const minSec = opts.minSec ?? 15
  const maxSec = Math.min(opts.maxSec ?? 75, MAX_CLIP_SEC)
  const wanted = opts.wanted ?? defaultWanted(durationSec)
  const sentences = splitSentences(words)
  if (input.events?.length) for (const [i, ev] of marksBySentence(sentences, input.events)) sentences[i].ev = ev
  const report = opts.report ?? (() => undefined)
  if (sentences.length < 4) return []
  if (!opts.baseUrl) return fallbackClips(input, sentences, wanted, minSec, maxSec, cuts, report)

  const url = opts.baseUrl
  const { signal } = opts

  // 0: Themen-Durchgang (Hauptthema + Themenkarte) → Bewertung („ohne Vorwissen verständlich?“) und Themenvielfalt
  let tmap: TopicMap | null = (await opts.topicsCache?.load(sentences.length)) ?? null
  if (!tmap) {
    report('topics', 0, 'Themenkarte erstellen …')
    tmap = await buildTopicMap(url, sentences, { signal, report: (f, m) => report('topics', f, m) }).catch((e) => { if (signal?.aborted) throw e; console.error('[select] Themenkarte fehlgeschlagen:', e); return null })
    if (tmap) await opts.topicsCache?.save(tmap).catch(() => undefined)
  }
  console.info(`[select] Themen: ${tmap ? tmap.topics.length : 0}${tmap ? ` · ${tmap.main}` : ''}`)
  const topicCtx = (a: number, b: number): string => topicContext(tmap, sentences[a].start, sentences[b].end)

  // A: Kandidaten je Fenster (Satznummern)
  const windows = buildWindows(sentences)
  let cands: Cand[] = []
  const maxCands = candidateBudget(wanted)
  for (let w = 0; w < windows.length; w++) {
    report('candidates', w / windows.length, `Kandidaten suchen (${w + 1}/${windows.length}) …`)
    const win = windows[w]
    const prompt = await loadPrompt('candidates', { minSec, maxSec, max: Math.ceil(maxCands / windows.length) + 1, query: queryLine(opts.query), transcript: sentences.slice(win.from, win.to + 1).map((s) => formatSentence(s, signals)).join('\n') })
    const got = await chatJson(url, prompt, {
      signal, maxTokens: 800,
      schema: { type: 'object', additionalProperties: false, required: ['candidates'], properties: { candidates: { type: 'array', maxItems: 12, items: { type: 'object', additionalProperties: false, required: ['start', 'end'], properties: { start: { type: 'integer' }, end: { type: 'integer' } } } } } },
      validate: (x) => { if (!isObj(x) || !Array.isArray(x.candidates)) throw new Error('candidates fehlt'); return x.candidates.filter(isObj).map((c) => ({ first: int(c.start, 0, 1e9, 'start'), last: int(c.end, 0, 1e9, 'end') })) }
    })
    for (const c of got) {
      const f = fitLength({ first: Math.max(win.from, Math.min(c.first, c.last)), last: Math.min(win.to, Math.max(c.first, c.last)) }, sentences, minSec, maxSec, win.to)
      if (f && !cands.some((o) => overlaps(o, f) > 0.5)) cands.push(f)
    }
  }
  cands = thinEvenly(cands.sort((a, b) => a.first - b.first), maxCands)
  console.info(`[select] Kandidaten: ${cands.length} (Ziel ${wanted}, max ${maxCands}), Fenster: ${windows.length}`)
  if (cands.length === 0) return fallbackClips(input, sentences, wanted, minSec, maxSec, cuts, report)

  // B: Anfang prüfen (Kontext davor) → C: Bewertung (2 Proben, Belege) → D: Ende prüfen
  const rated: Rated[] = []
  const BEFORE = 2
  for (let i = 0; i < cands.length; i++) {
    report('rate', i / cands.length, `Bewerten (${i + 1}/${cands.length}) …`)
    let first = cands[i].first
    let last = cands[i].last
    // B: beginnt der Clip mitten im Gedanken? (Anapher/Konnektiv oder LLM-Urteil) → Anfang bis zu 2 Sätze nach vorn, höchstens 2 Runden
    let startExt = 0
    for (let round = 0; round < 2 && first > 0; round++) {
      const flagged = CONNECTIVE_START.test(sentences[first].text.trim())
      const prev = clipText(sentences, Math.max(0, first - BEFORE), first - 1)
      const sp = await loadPrompt('standalone', { topic: topicCtx(first, Math.min(last, first + 2)), before: prev, clip: clipText(sentences, first, Math.min(last, first + 2)) })
      const v = await chatJson(url, sp, {
        signal, maxTokens: 100, temperature: 0.1,
        schema: { type: 'object', additionalProperties: false, required: ['ok', 'extend_start'], properties: { ok: { type: 'boolean' }, extend_start: { type: 'integer', minimum: 0, maximum: 2 } } },
        validate: (x) => { if (!isObj(x)) throw new Error('Objekt erwartet'); return { ok: !!x.ok, ext: x.ok ? 0 : int(x.extend_start, 0, 2, 'extend_start') } }
      })
      const ext = v.ok && !flagged ? 0 : Math.max(v.ext, flagged && !v.ok ? 1 : 0)
      if (ext === 0 || dur(sentences, Math.max(0, first - ext), last) > MAX_CLIP_SEC) break
      first = Math.max(0, first - ext)
      startExt += ext
    }
    const textNow = (): string => clipText(sentences, first, last)
    const ctx = (): string => `[Kontext] ${first > 0 ? sentences[first - 1].text : '–'}\n${textNow()}\n[Kontext] ${last < sentences.length - 1 ? sentences[last + 1].text : '–'}`
    // C: erste Probe (die Besten bekommen später eine zweite → Median)
    const samples: RateRaw[] = []
    {
      const rp = await loadPrompt('rate', { topic: topicCtx(first, last), query: queryLine(opts.query), clip: ctx() })
      samples.push(await chatJson(url, rp, { signal, schema: RATE_SCHEMA, validate: validateRate, maxTokens: 800, temperature: 0.2 }))
    }
    let merged = mergeRatings(samples, textNow())
    // D: Ende prüfen; bei Verlängerung nicht neu bewerten, Beleg-Prüfung bleibt
    let extended = 0
    if (last < sentences.length - 1) {
      const ep = await loadPrompt('endcheck', { clip: textNow(), after: clipText(sentences, last + 1, Math.min(sentences.length - 1, last + 3)) })
      const e = await chatJson(url, ep, {
        signal, maxTokens: 120, temperature: 0.1,
        schema: { type: 'object', additionalProperties: false, required: ['complete', 'extra'], properties: { complete: { type: 'boolean' }, extra: { type: 'integer', minimum: 0, maximum: 3 } } },
        validate: (x) => { if (!isObj(x)) throw new Error('Objekt erwartet'); return { complete: !!x.complete, extra: x.complete ? 0 : int(x.extra, 0, 3, 'extra') } }
      })
      while (extended < e.extra && last < sentences.length - 1 && dur(sentences, first, last + 1) <= MAX_CLIP_SEC) { last++; extended++ }
      if (extended > 0) merged = { ...merged, criteria: { ...merged.criteria, payoff: Math.max(merged.criteria.payoff, 10) } }
    }
    const m = merged.meta
    rated.push({ first, last, criteria: merged.criteria, title: m.title, hookText: m.hookText, reason: m.reason, tags: m.tags, sum: critSum(merged.criteria), extended: extended + startExt, rank: 0, samples, text: textNow(), ctx: ctx() })
  }

  // C2: zweite Probe für die obere Hälfte (bessere Trennschärfe dort, wo es um die Plätze geht)
  rated.sort((x, y) => y.sum - x.sum)
  const second = rated.slice(0, Math.max(wanted + 2, Math.ceil(rated.length * 0.6)))
  for (let i = 0; i < second.length; i++) {
    report('rate', 0.8 + 0.2 * (i / second.length), `Zweite Bewertung (${i + 1}/${second.length}) …`)
    const r = second[i]
    const rp = await loadPrompt('rate', { topic: topicCtx(r.first, r.last), query: queryLine(opts.query), clip: r.ctx ?? '' })
    r.samples = [...(r.samples ?? []), await chatJson(url, rp, { signal, schema: RATE_SCHEMA, validate: validateRate, maxTokens: 800, temperature: 0.5 })]
    const mg = mergeRatings(r.samples, r.text ?? '')
    r.criteria = mg.criteria
    r.sum = critSum(mg.criteria)
  }

  // E1: Finalisten paarweise vergleichen (beide Reihenfolgen; Uneinigkeit = Unentschieden) – weniger Positions-Bias als eine Gesamt-Rangliste
  rated.sort((a, b) => b.sum - a.sum)
  const finalists = rated.slice(0, Math.min(rated.length, Math.max(wanted + 2, Math.ceil(wanted * 1.6)), 12))
  if (finalists.length > 1) {
    const K = Math.min(finalists.length, 6)
    const wins = new Array<number>(finalists.length).fill(0)
    const total = (K * (K - 1)) / 2
    let done = 0
    const textOf = (f: Rated): string => clipText(sentences, f.first, f.last).slice(0, 1100)
    const ask = async (x: Rated, y: Rated): Promise<'A' | 'B'> => {
      const pp = await loadPrompt('pair', { query: queryLine(opts.query), a: textOf(x), b: textOf(y) })
      return chatJson(url, pp, {
        signal, maxTokens: 40, temperature: 0,
        schema: { type: 'object', additionalProperties: false, required: ['winner'], properties: { winner: { type: 'string', enum: ['A', 'B'] } } },
        validate: (v) => { if (!isObj(v) || (v.winner !== 'A' && v.winner !== 'B')) throw new Error('winner fehlt'); return v.winner }
      })
    }
    for (let i = 0; i < K; i++) for (let j = i + 1; j < K; j++) {
      report('compare', 0.3 + 0.6 * (done++ / total), `Finalisten vergleichen (${done}/${total}) …`)
      const w1 = await ask(finalists[i], finalists[j])
      const w2 = await ask(finalists[j], finalists[i])
      const iWins = (w1 === 'A' ? 1 : 0) + (w2 === 'B' ? 1 : 0) // i gewinnt in Reihenfolge 1 als A, in Reihenfolge 2 als B
      wins[i] += iWins / 2
      wins[j] += (2 - iWins) / 2
    }
    const order = finalists.map((_, i) => i).sort((p, q) => (q < K && p < K ? wins[q] - wins[p] || finalists[q].sum - finalists[p].sum : q < K ? 1 : p < K ? -1 : finalists[q].sum - finalists[p].sum))
    order.forEach((idx, rank) => { finalists[idx].rank = rank })
  }

  // E: nach Score wählen, Grenzen einrasten (Nachbarn verbieten Überlappung)
  console.info(`[select] bewertet: ${rated.length}, Finalisten: ${finalists.length}`)
  const pool = [...finalists, ...rated.filter((r) => !finalists.includes(r)).map((r) => { r.rank = finalists.length; return r })]
  const scored = pool.map((f) => ({ f, score: Math.max(0, finalScore(f.sum, f.rank, pool.length, (secOf(signals.loudness, sentences[f.first].start, sentences[f.last].end) + secOf(signals.burst, sentences[f.first].start, sentences[f.last].end)) / 2, ((input.heat ? heatBonus(heatScore(input.heat, sentences[f.first].start, sentences[f.last].end)) : 0) * (input.weights?.heat ?? 1)) + ((input.chat ? chatBonus(heatScore(input.chat, sentences[f.first].start, sentences[f.last].end)) : 0) * (input.weights?.chat ?? 1)), input.weights?.signal ?? 5) - lengthPenalty(dur(sentences, f.first, f.last))) }))
  // Qualitätsschwelle: Clips mit schwachem Hook UND/ODER nicht eigenständigem Anfang erst nehmen, wenn zu wenige gute da sind
  const solid = (f: Rated): boolean => f.criteria.standalone >= 8 && f.criteria.hook >= 8
  scored.sort((a, b) => Number(solid(b.f)) - Number(solid(a.f)) || b.score - a.score)
  report('snap', 0.9, 'Grenzen einrasten …')
  const taken: Range[] = []
  const out: ShortmeClip[] = []
  const lost = new Set<Rated>()
  const chosen = new Set<Rated>()
  const sctx = { words, sentences, silences: signals.silences, cuts, durationSec }
  // Themenvielfalt: jeder weitere Clip aus einem schon gewählten Thema kostet Punkte
  const topicOf = (f: Rated): number => topicOfRange(tmap, sentences[f.first].start, sentences[f.last].end)
  const perTopic = new Map<number, number>()
  const adj = (x: { f: Rated; score: number }): number => x.score - (tmap && tmap.topics.length > 1 ? 7 * (perTopic.get(topicOf(x.f)) ?? 0) : 0)
  while (scored.length && out.length < wanted) {
    scored.sort((a, b) => Number(solid(b.f)) - Number(solid(a.f)) || adj(b) - adj(a))
    const { f, score } = scored.shift()!
    const snapped = snapClip({ start: sentences[f.first].start, end: sentences[f.last].end }, { ...sctx, neighbors: taken, maxLen: MAX_CLIP_SEC })
    if (snapped.end - snapped.start < minSec * 0.6 || taken.some((t) => snapped.start < t.end && snapped.end > t.start)) { lost.add(f); console.info(`[select] verworfen (Überlappung/zu kurz): ${snapped.start.toFixed(1)}–${snapped.end.toFixed(1)}`); continue }
    taken.push({ start: snapped.start, end: snapped.end })
    chosen.add(f)
    perTopic.set(topicOf(f), (perTopic.get(topicOf(f)) ?? 0) + 1)
    // Wortgrenzen aus dem EINGERASTETEN Bereich (Nachbarn/Länge können den Kandidaten kürzen)
    const fw = Math.max(0, words.findIndex((w) => w.start >= snapped.start - 0.06))
    let lw = fw
    for (let k = fw; k < words.length && words[k].end <= snapped.end + 0.06; k++) lw = k
    out.push({
      id: `clip-${Math.round(snapped.start * 10)}`, start: snapped.start, end: snapped.end, firstWord: fw, lastWord: lw, score, criteria: f.criteria,
      title: f.title, hookText: f.hookText, reason: f.reason, tags: resolveTags(f.tags, sentences, words, f.first, f.last), ...(input.heat ? { heat: Math.round(heatScore(input.heat, snapped.start, snapped.end) * 100) / 100 } : {}), ...(input.chat ? { chat: Math.round(heatScore(input.chat, snapped.start, snapped.end) * 100) / 100 } : {}), source: 'llm', snap: snapped.path, extended: f.extended
    })
  }
  // Spur für das Lernen: alle bewerteten Kandidaten und wie weit sie kamen (Stufe, an der ein Moment verloren geht)
  opts.trace?.(pool.map((f) => ({ start: sentences[f.first].start, end: sentences[f.last].end, criteria: f.criteria, title: f.title, fate: chosen.has(f) ? 'selected' : lost.has(f) ? 'overlap' : finalists.includes(f) ? 'finalist' : 'rated' })))
  // F: Untertitel-Korrektur je Clip (Zeichensetzung, Schreibweise, Erkennungsfehler) – als Vorbelegung, im Editor änderbar
  for (let i = 0; i < out.length; i++) {
    report('proofread', i / out.length, `Untertitel prüfen (${i + 1}/${out.length}) …`)
    const c = out[i]
    const local = await proofreadWords(url, words.slice(c.firstWord, c.lastWord + 1).map((w) => w.w), signal)
    const abs: Record<number, string> = {}
    for (const [k, v] of Object.entries(local)) abs[c.firstWord + Number(k)] = v
    if (Object.keys(abs).length) out[i] = { ...c, corrections: abs }
  }
  report('done', 1, `${out.length} Clips`)
  return out.sort((a, b) => b.score - a.score)
}

/** Ohne LLM: TextTiling-Themen, Score aus Ton-Signalen (Lautheit, Tempo, Spitzen, wenig Stille). */
function fallbackClips(input: SelectInput, sentences: Sentence[], wanted: number, minSec: number, maxSec: number, cuts: number[], report: NonNullable<SelectOptions['report']>): ShortmeClip[] {
  report('texttiling', 0.5, 'Themen erkennen (ohne KI) …')
  const { words, signals, durationSec } = input
  const spans = topicClips(sentences, minSec, maxSec)
  const rated = spans.map((s) => {
    const q = 0.35 * secOf(signals.loudness, s.start, s.end) + 0.2 * secOf(signals.rate, s.start, s.end) + 0.25 * Math.max(...signals.burst.slice(Math.floor(s.start), Math.ceil(s.end)), 0) + 0.2 * (1 - secOf(signals.silence, s.start, s.end))
    return { s, score: Math.round(Math.max(0, Math.min(1, q)) * 100) }
  }).sort((a, b) => b.score - a.score)
  const taken: Range[] = []
  const out: ShortmeClip[] = []
  for (const { s, score } of rated) {
    if (out.length >= wanted) break
    const snapped = snapClip({ start: s.start, end: s.end }, { words, sentences, silences: signals.silences, cuts, durationSec, neighbors: taken, maxLen: MAX_CLIP_SEC })
    if (taken.some((t) => snapped.start < t.end && snapped.end > t.start)) continue
    taken.push({ start: snapped.start, end: snapped.end })
    const first = sentences[s.first]
    const hook = first.text.split(' ').slice(0, 8).join(' ')
    const c = Math.round(score / 5)
    out.push({ id: `clip-${Math.round(snapped.start * 10)}`, start: snapped.start, end: snapped.end, firstWord: first.first, lastWord: sentences[s.last].last, score, criteria: { hook: c, payoff: c, quotable: c, standalone: c, density: c }, title: hook, hookText: hook, reason: 'Heuristik aus Ton-Signalen (ohne KI-Bewertung).', tags: [], source: 'texttiling', snap: snapped.path, extended: 0 })
  }
  report('done', 1, `${out.length} Clips (Fallback)`)
  return out
}
