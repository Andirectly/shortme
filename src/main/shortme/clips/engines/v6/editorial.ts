// Engine 6 – redaktionelles Ranking (Kap. 10): vollständiger tatsächlicher Wortlaut je Kandidat, Außenkontext getrennt, keine früheren Scores oder Titel.
// Gruppen von höchstens 6 Kandidaten (Eingabereihenfolge reproduzierbar gemischt), danach begrenzte Vergleiche der Spitzen. Jede Antwort muss jede erwartete
// ID genau einmal behandeln (Rang als Permutation, Satzgrenzen aus dem eigenen Kandidaten) – sonst ungültig, nie still ergänzt.
import type { Sentence } from '../../sentences'
import { chatJson, isObj, loadPrompt } from '../../llm'
import type { Lane, Span } from '../v4/core'

export const V6_RANK_PROMPT = 'v6/rank@3'
export type Decision = 'use' | 'investigate' | 'reject'
export const DECISIONS: Decision[] = ['use', 'investigate', 'reject']

export interface V6Candidate {
  id: string
  eventGroupId: string
  lanes: Lane[]
  span: Span
  /** Satzindizes (zusammenhängend) des vorgesehenen Wortlauts; leer = wortlos */
  sentences: number[]
  text: string
  contextBefore: string
  contextAfter: string
  wordless: boolean
  /** tatsächlich vorliegende Belege (Spuren), keine Auswahlbegründung */
  evidence: string[]
  durationSec: number
}

export interface RankDecision { id: string; decision: Decision; rank: number; first: number; last: number; reason: string; question: string; title: string }
export interface RankRound { round: string; order: string[]; decisions: RankDecision[]; ok: boolean; error?: string; promptChars: number; ms: number }

/** Deterministisch gemischte Reihenfolge (Mulberry32 + Fisher-Yates); Saat wird im Lauf gespeichert. */
export function shuffled<T>(xs: T[], seed: number): T[] {
  let a = seed >>> 0
  const rnd = (): number => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
  const out = [...xs]
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [out[i], out[j]] = [out[j], out[i]] }
  return out
}

/** Kandidat aus einer Ereignisgruppe: Sätze, die die Gruppe überlappen (vollständig, nicht gekürzt), plus je 2 Sätze Außenkontext getrennt. */
export function buildCandidate(id: string, group: { id: string; lanes: Lane[]; span: Span; evidence: string[] }, sentences: Sentence[], maxSec: number): V6Candidate {
  let idx = sentences.map((s, i) => ({ s, i })).filter(({ s }) => s.end > group.span.start + 0.3 && s.start < group.span.end - 0.3).map(({ i }) => i)
  // sehr lange Gruppen (z. B. verschmolzene Spuren): auf ein Fenster von höchstens 2×maxSec um die Mitte begrenzen – das Modell wählt darin first..last
  if (idx.length) {
    const mid = (group.span.start + group.span.end) / 2
    idx = idx.filter((i) => sentences[i].end > mid - maxSec && sentences[i].start < mid + maxSec)
  }
  const words = idx.reduce((n, i) => n + sentences[i].text.split(/\s+/).filter(Boolean).length, 0)
  const wordless = words < 4
  const a = idx[0], b = idx[idx.length - 1]
  const line = (i: number): string => `S${sentences[i].index}: ${sentences[i].text}${sentences[i].ev?.length ? ' ' + sentences[i].ev!.join(' ') : ''}`
  const span = wordless ? group.span : { start: sentences[a].start, end: sentences[b].end }
  return {
    id, eventGroupId: group.id, lanes: group.lanes, span,
    sentences: wordless ? [] : idx.map((i) => sentences[i].index),
    text: wordless ? '' : idx.map(line).join('\n'),
    contextBefore: wordless || a === undefined ? '' : sentences.slice(Math.max(0, a - 2), a).map((s) => s.text).join(' '),
    contextAfter: wordless || b === undefined ? '' : sentences.slice(b + 1, b + 3).map((s) => s.text).join(' '),
    wordless, evidence: group.evidence.slice(0, 4), durationSec: Math.round((span.end - span.start) * 10) / 10
  }
}

export function candidateBlock(c: V6Candidate): string {
  return [
    `### ${c.id} (${Math.round(c.durationSec)} s, gefunden über: ${c.lanes.join(', ')})`,
    c.wordless ? '(wortlos – kein Transkripttext)' : `Wortlaut:\n${c.text}`,
    c.contextBefore ? `Davor (nur Kontext, nicht im Clip): ${c.contextBefore}` : '',
    c.contextAfter ? `Danach (nur Kontext, nicht im Clip): ${c.contextAfter}` : '',
    c.evidence.length ? `Beobachtete Signale: ${c.evidence.join(' | ')}` : ''
  ].filter(Boolean).join('\n')
}

export function rankSchema(ids: string[], sentenceIds: number[]): object {
  return {
    type: 'object', additionalProperties: false, required: ['decisions'],
    properties: {
      decisions: {
        type: 'array', minItems: ids.length, maxItems: ids.length,
        items: {
          type: 'object', additionalProperties: false, required: ['id', 'decision', 'rank', 'first', 'last', 'reason', 'question', 'title'],
          properties: {
            id: { type: 'string', enum: ids }, decision: { type: 'string', enum: DECISIONS },
            rank: { type: 'integer', minimum: 1, maximum: ids.length },
            first: { type: 'integer', enum: [-1, ...sentenceIds] }, last: { type: 'integer', enum: [-1, ...sentenceIds] },
            reason: { type: 'string', maxLength: 160 }, question: { type: 'string', maxLength: 160 }, title: { type: 'string', maxLength: 70 }
          }
        }
      }
    }
  }
}

/** Hostprüfung (zusätzlich zum Schema): jede ID genau einmal, Rang = Permutation 1..n, Satzgrenzen im eigenen Kandidaten und geordnet. */
export function validateRanking(x: unknown, cands: V6Candidate[]): RankDecision[] {
  if (!isObj(x) || !Array.isArray(x.decisions)) throw new Error('decisions fehlt')
  const want = new Set(cands.map((c) => c.id))
  const seen = new Set<string>(), ranks = new Set<number>()
  const out: RankDecision[] = []
  for (const d of x.decisions) {
    if (!isObj(d)) throw new Error('Eintrag ist kein Objekt')
    const id = String(d.id)
    if (!want.has(id)) throw new Error(`unbekannte ID ${id}`)
    if (seen.has(id)) throw new Error(`ID ${id} doppelt`)
    seen.add(id)
    const decision = d.decision as Decision
    if (!DECISIONS.includes(decision)) throw new Error(`${id}: Entscheidung ungültig`)
    const rank = Number(d.rank)
    if (!Number.isInteger(rank) || rank < 1 || rank > cands.length || ranks.has(rank)) throw new Error(`${id}: Rang ${d.rank} ungültig oder doppelt`)
    ranks.add(rank)
    const c = cands.find((k) => k.id === id)!
    let first = Number(d.first), last = Number(d.last)
    if (c.wordless) { first = -1; last = -1 } else if (decision !== 'reject') {
      if (!c.sentences.includes(first) || !c.sentences.includes(last) || last < first) throw new Error(`${id}: Satzgrenzen S${d.first}–S${d.last} nicht im Kandidaten`)
    } else if (!c.sentences.includes(first) || !c.sentences.includes(last) || last < first) { first = c.sentences[0]; last = c.sentences[c.sentences.length - 1] }
    const reason = typeof d.reason === 'string' ? d.reason.trim().slice(0, 160) : ''
    if (!reason) throw new Error(`${id}: Begründung fehlt`)
    const question = decision === 'investigate' && typeof d.question === 'string' ? d.question.trim().slice(0, 160) : ''
    const title = typeof d.title === 'string' ? d.title.replace(/["'„“‚‘,]/g, '').replace(/\s+/g, ' ').trim().slice(0, 60) : ''
    out.push({ id, decision, rank, first, last, reason, question, title })
  }
  if (seen.size !== want.size) throw new Error(`es fehlen ${[...want].filter((i) => !seen.has(i)).join(', ')}`)
  return out.sort((a, b) => a.rank - b.rank)
}

/** Gruppen bilden: höchstens `size` Kandidaten und höchstens `maxChars` Prompttext je Gruppe (Text wird nie gekürzt – die Gruppe wird kleiner). */
export function groupsFor(cands: V6Candidate[], size: number, maxChars: number): V6Candidate[][] {
  const out: V6Candidate[][] = []
  let cur: V6Candidate[] = [], chars = 0
  for (const c of cands) {
    const n = candidateBlock(c).length
    if (cur.length && (cur.length >= size || chars + n > maxChars)) { out.push(cur); cur = []; chars = 0 }
    cur.push(c); chars += n
  }
  if (cur.length) out.push(cur)
  return out
}

export interface RankingResult { order: string[]; decisions: Map<string, RankDecision>; rounds: RankRound[]; seed: number; incomplete: string[] }

/**
 * Gesamtrangfolge: (1) jede Gruppe bewertet, (2) Spitzen (Rang ≤ 2, nicht reject) im Vergleich geordnet – bei mehr als 6 in Runden zu 6, die besten 3 je Runde
 * weiter, bis höchstens 6 übrig sind (kein O(n²)-Turnier). Restliche Kandidaten folgen nach Gruppenrang. Fehlgeschlagene Gruppen bleiben „unvollständig“
 * und werden nicht als bewertet gezählt.
 */
export async function rankCandidates(url: string, cands: V6Candidate[], o: { query?: string; /** Sprache der Titel (Deutsch/Englisch), aus dem Transkript erkannt */ lang?: string; seed: number; maxChars: number; signal?: AbortSignal; model?: string; onRound?: (r: RankRound) => void }): Promise<RankingResult> {
  const rounds: RankRound[] = []
  const decisions = new Map<string, RankDecision>()
  const incomplete: string[] = []
  const call = async (label: string, list: V6Candidate[], seed: number): Promise<RankDecision[] | null> => {
    const order = shuffled(list, seed)
    const prompt = await loadPrompt('v6/rank', { lang: o.lang ?? 'des Kandidatentextes', n: order.length, query: o.query ? `Der Nutzer sucht besonders: ${o.query}` : '', candidates: order.map(candidateBlock).join('\n\n') })
    const t0 = Date.now()
    const sids = [...new Set(order.flatMap((c) => c.sentences))].sort((a, b) => a - b)
    try {
      const d = await chatJson(url, prompt, { schema: rankSchema(order.map((c) => c.id), sids), validate: (x) => validateRanking(x, order), maxTokens: 140 + 110 * order.length, temperature: 0, signal: o.signal, model: o.model, timeoutMs: 240_000 })
      const r: RankRound = { round: label, order: order.map((c) => c.id), decisions: d, ok: true, promptChars: prompt.system.length + prompt.user.length, ms: Date.now() - t0 }
      rounds.push(r); o.onRound?.(r)
      return d
    } catch (e) {
      if (o.signal?.aborted) throw e
      const r: RankRound = { round: label, order: order.map((c) => c.id), decisions: [], ok: false, error: e instanceof Error ? e.message.slice(0, 200) : String(e), promptChars: prompt.system.length + prompt.user.length, ms: Date.now() - t0 }
      rounds.push(r); o.onRound?.(r)
      return null
    }
  }
  const groups = groupsFor(shuffled(cands, o.seed), 6, o.maxChars)
  const groupRank = new Map<string, number>()
  for (let g = 0; g < groups.length; g++) {
    const d = await call(`g${g + 1}`, groups[g], o.seed + g + 1)
    if (!d) { incomplete.push(...groups[g].map((c) => c.id)); continue }
    for (const x of d) { decisions.set(x.id, x); groupRank.set(x.id, x.rank) }
  }
  // Spitzen vergleichen (Entscheidung und Grenzen der Gruppenrunde bleiben; der Vergleich ordnet nur)
  const byGroupRank = (xs: V6Candidate[]): string[] => [...xs].sort((p, q) => groupRank.get(p.id)! - groupRank.get(q.id)! || p.id.localeCompare(q.id)).map((c) => c.id)
  let pool = cands.filter((c) => decisions.get(c.id) && decisions.get(c.id)!.decision !== 'reject' && groupRank.get(c.id)! <= 2)
  const eliminated: string[][] = []
  let round = 0
  while (pool.length > 6 && round < 4) {
    round++
    const adv: V6Candidate[] = [], out: string[] = []
    for (const [k, chunk] of groupsFor(pool, 6, o.maxChars).entries()) {
      const d = await call(`leaders${round}.${k + 1}`, chunk, o.seed + 1000 * round + k)
      const ids = d ? d.map((x) => x.id) : byGroupRank(chunk) // ausgefallener Vergleich: Gruppenreihenfolge (protokolliert in rounds)
      adv.push(...ids.slice(0, 3).map((id) => chunk.find((c) => c.id === id)!)); out.push(...ids.slice(3))
    }
    eliminated.unshift(out) // wer später ausscheidet, steht weiter vorn
    pool = adv
  }
  const final = pool.length > 1 && groups.length > 1 ? ((await call('leaders', pool, o.seed + 9999))?.map((x) => x.id) ?? byGroupRank(pool)) : byGroupRank(pool)
  const ranked = [...final, ...eliminated.flat()]
  const others = cands.filter((c) => !ranked.includes(c.id) && decisions.has(c.id)).sort((a, b) => {
    const da = decisions.get(a.id)!, db = decisions.get(b.id)!
    const w = (d: RankDecision): number => (d.decision === 'reject' ? 1 : 0)
    return w(da) - w(db) || da.rank - db.rank || a.id.localeCompare(b.id) // deterministischer Tie-Break
  }).map((c) => c.id)
  return { order: [...ranked, ...others], decisions, rounds, seed: o.seed, incomplete }
}
