import type { ClipTagKind, ShortmeClip } from '@shared/shortme'
import type { AsrWord } from '../../engines/asr/protocol'
import type { Signals } from './signals'
import { splitSentences, type Sentence } from './sentences'
import { snapClip, type Range } from './snap'
import { topicClips } from './texttiling'
import { chatJson, int, isObj, loadPrompt, str } from './llm'

export interface SelectInput {
  words: AsrWord[]
  durationSec: number
  signals: Signals
  cuts: number[]
}

export interface SelectOptions {
  /** URL des laufenden llama-server; null = Fallback (TextTiling). */
  baseUrl: string | null
  query?: string
  wanted?: number
  minSec?: number
  maxSec?: number
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
}

export const MAX_CLIP_SEC = 90
const WINDOW_WORDS = 3000

export const defaultWanted = (durationSec: number): number => Math.max(3, Math.min(20, Math.round(durationSec / 240)))

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
  if (secOf(sig.burst, s.start, s.end) > 0.6) marks.push('Lachen?')
  if (secOf(sig.loudness, s.start, s.end) > 0.85) marks.push('laut')
  return `[S${s.index} | ${Math.round(s.start)} s] ${s.text}${marks.length ? ` (${marks.join(', ')})` : ''}`
}

const clipText = (sentences: Sentence[], a: number, b: number): string => sentences.slice(a, b + 1).map((s) => `[S${s.index}] ${s.text}`).join('\n')
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

const CRIT_SCHEMA = { type: 'integer', minimum: 0, maximum: 20 }
const RATE_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['hook', 'payoff', 'quotable', 'standalone', 'density', 'title', 'hook_text', 'reason', 'tags'],
  properties: {
    hook: CRIT_SCHEMA, payoff: CRIT_SCHEMA, quotable: CRIT_SCHEMA, standalone: CRIT_SCHEMA, density: CRIT_SCHEMA,
    title: { type: 'string' }, hook_text: { type: 'string' }, reason: { type: 'string' },
    tags: { type: 'array', maxItems: 8, items: { type: 'object', additionalProperties: false, required: ['sentence', 'word', 'kind'], properties: { sentence: { type: 'integer' }, word: { type: 'string' }, kind: { type: 'string', enum: ['emphasis', 'entity', 'hook'] } } } }
  }
}

function validateRate(x: unknown): Omit<Rated, 'first' | 'last' | 'extended' | 'rank' | 'sum'> {
  if (!isObj(x)) throw new Error('Objekt erwartet')
  const criteria = { hook: int(x.hook, 0, 20, 'hook'), payoff: int(x.payoff, 0, 20, 'payoff'), quotable: int(x.quotable, 0, 20, 'quotable'), standalone: int(x.standalone, 0, 20, 'standalone'), density: int(x.density, 0, 20, 'density') }
  const tags = Array.isArray(x.tags) ? x.tags.filter(isObj).map((t) => ({ sentence: int(t.sentence, 0, 1e9, 'sentence'), word: String(t.word ?? ''), kind: (['emphasis', 'entity', 'hook'].includes(String(t.kind)) ? t.kind : 'emphasis') as ClipTagKind })) : []
  return { criteria, title: str(x.title, 80, 'title'), hookText: str(x.hook_text, 80, 'hook_text'), reason: str(x.reason, 240, 'reason'), tags }
}

export const critSum = (c: ShortmeClip['criteria']): number => c.hook + c.payoff + c.quotable + c.standalone + c.density

/** Endwert: 60 % Raster, 40 % relative Rangfolge der Finalisten (+ bis 5 Punkte aus den Ton-Signalen). */
export function finalScore(sum: number, rank: number, finalists: number, signalMean: number): number {
  const rankScore = finalists <= 1 ? 100 : 100 - rank * (60 / (finalists - 1))
  return Math.max(0, Math.min(100, Math.round(0.6 * sum + 0.4 * rankScore + 5 * signalMean)))
}

const queryLine = (q?: string): string => (q?.trim() ? `Der Nutzer sucht besonders nach: „${q.trim()}“. Bevorzuge passende Stellen, erfinde aber nichts.\n` : '')

export async function selectClips(input: SelectInput, opts: SelectOptions): Promise<ShortmeClip[]> {
  const { words, durationSec, signals, cuts } = input
  const minSec = opts.minSec ?? 15
  const maxSec = Math.min(opts.maxSec ?? 75, MAX_CLIP_SEC)
  const wanted = opts.wanted ?? defaultWanted(durationSec)
  const sentences = splitSentences(words)
  const report = opts.report ?? (() => undefined)
  if (sentences.length < 4) return []
  if (!opts.baseUrl) return fallbackClips(input, sentences, wanted, minSec, maxSec, cuts, report)

  const url = opts.baseUrl
  const { signal } = opts

  // A: Kandidaten je Fenster (Satznummern)
  const windows = buildWindows(sentences)
  let cands: Cand[] = []
  const maxCands = Math.max(6, Math.ceil(wanted * 2.5))
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
  cands = cands.slice(0, maxCands)
  if (cands.length === 0) return fallbackClips(input, sentences, wanted, minSec, maxSec, cuts, report)

  // B: Bewertungsraster (je Kandidat) + C: Ende prüfen
  const rated: Rated[] = []
  for (let i = 0; i < cands.length; i++) {
    report('rate', i / cands.length, `Bewerten (${i + 1}/${cands.length}) …`)
    const first = cands[i].first
    let last = cands[i].last
    const rp = await loadPrompt('rate', { query: queryLine(opts.query), clip: clipText(sentences, first, last) })
    const r = await chatJson(url, rp, { signal, schema: RATE_SCHEMA, validate: validateRate, maxTokens: 700 })
    let extended = 0
    if (last < sentences.length - 1) {
      const ep = await loadPrompt('endcheck', { clip: clipText(sentences, first, last), after: clipText(sentences, last + 1, Math.min(sentences.length - 1, last + 3)) })
      const e = await chatJson(url, ep, {
        signal, maxTokens: 120, temperature: 0.1,
        schema: { type: 'object', additionalProperties: false, required: ['complete', 'extra'], properties: { complete: { type: 'boolean' }, extra: { type: 'integer', minimum: 0, maximum: 3 } } },
        validate: (x) => { if (!isObj(x)) throw new Error('Objekt erwartet'); return { complete: !!x.complete, extra: x.complete ? 0 : int(x.extra, 0, 3, 'extra') } }
      })
      while (extended < e.extra && last < sentences.length - 1 && dur(sentences, first, last + 1) <= MAX_CLIP_SEC) { last++; extended++ }
    }
    rated.push({ first, last, ...r, sum: critSum(r.criteria), extended, rank: 0 })
  }

  // D: Finalisten in EINEM Aufruf direkt vergleichen
  rated.sort((a, b) => b.sum - a.sum)
  const finalists = rated.slice(0, Math.min(rated.length, Math.max(wanted + 2, Math.ceil(wanted * 1.6)), 12))
  if (finalists.length > 1) {
    report('compare', 0.5, 'Finalisten vergleichen …')
    const cp = await loadPrompt('compare', {
      query: queryLine(opts.query),
      finalists: finalists.map((f, i) => `Clip ${i + 1} (${Math.round(dur(sentences, f.first, f.last))} s) – ${f.title}\n${clipText(sentences, f.first, f.last).slice(0, 900)}`).join('\n\n')
    })
    const order = await chatJson(url, cp, {
      signal, maxTokens: 200, temperature: 0.2,
      schema: { type: 'object', additionalProperties: false, required: ['ranking'], properties: { ranking: { type: 'array', items: { type: 'integer' } } } },
      validate: (x) => { if (!isObj(x) || !Array.isArray(x.ranking)) throw new Error('ranking fehlt'); return x.ranking.map((n) => Number(n) - 1).filter((n) => Number.isInteger(n) && n >= 0 && n < finalists.length) }
    })
    const seen = new Set<number>()
    const full = [...order.filter((n) => (seen.has(n) ? false : (seen.add(n), true))), ...finalists.map((_, i) => i).filter((i) => !seen.has(i))]
    full.forEach((idx, rank) => { finalists[idx].rank = rank })
  }

  // E: nach Score wählen, Grenzen einrasten (Nachbarn verbieten Überlappung)
  const scored = finalists.map((f) => ({ f, score: finalScore(f.sum, f.rank, finalists.length, (secOf(signals.loudness, sentences[f.first].start, sentences[f.last].end) + secOf(signals.burst, sentences[f.first].start, sentences[f.last].end)) / 2) }))
  scored.sort((a, b) => b.score - a.score)
  report('snap', 0.9, 'Grenzen einrasten …')
  const taken: Range[] = []
  const out: ShortmeClip[] = []
  const sctx = { words, sentences, silences: signals.silences, cuts, durationSec }
  for (const { f, score } of scored) {
    if (out.length >= wanted) break
    const snapped = snapClip({ start: sentences[f.first].start, end: sentences[f.last].end }, { ...sctx, neighbors: taken, maxLen: MAX_CLIP_SEC })
    if (snapped.end - snapped.start < minSec * 0.6 || taken.some((t) => snapped.start < t.end && snapped.end > t.start)) continue
    taken.push({ start: snapped.start, end: snapped.end })
    const fw = words.findIndex((w) => w.start >= sentences[f.first].start - 1e-6)
    const lw = sentences[f.last].last
    out.push({
      id: `clip-${Math.round(snapped.start * 10)}`, start: snapped.start, end: snapped.end, firstWord: fw, lastWord: lw, score, criteria: f.criteria,
      title: f.title, hookText: f.hookText, reason: f.reason, tags: resolveTags(f.tags, sentences, words, f.first, f.last), source: 'llm', snap: snapped.path, extended: f.extended
    })
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
