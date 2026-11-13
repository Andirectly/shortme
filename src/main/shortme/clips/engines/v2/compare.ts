// Globaler Paarvergleich der ausgearbeiteten Varianten (Bradley-Terry über einen zusammenhängenden Begegnungsgraphen), beide Reihenfolgen je Paar.
import { chatJson, isObj, loadPrompt, str } from '../../llm'
import { bradleyTerry, combineOrders, isConnected, rankOrder, scheduleMatches, type MatchResult, type Outcome } from '../../../../../shared/engineV2'

export interface CompareCand { id: string; kind: string; durationSec: number; text: string; evidence: string }
export interface Judgement { a: number; b: number; ab: string; ba: string; outcome: Outcome; reason: string }
export interface CompareResult { order: number[]; strength: number[] | null; judgements: Judgement[]; calls: number; failedCalls: number; connected: boolean }

type Side = 'A' | 'B' | 'tie' | 'bothWeak'
const SCHEMA = { type: 'object', additionalProperties: false, required: ['winner', 'grund'], properties: { winner: { type: 'string', enum: ['A', 'B', 'tie', 'both_weak'] }, grund: { type: 'string' } } }

async function askPair(baseUrl: string, x: CompareCand, y: CompareCand, signal?: AbortSignal): Promise<{ side: Side; reason: string }> {
  const prompt = await loadPrompt('v2/pair', { aDur: x.durationSec.toFixed(0), aKind: x.kind, a: x.text, aEvidence: x.evidence || 'keine', bDur: y.durationSec.toFixed(0), bKind: y.kind, b: y.text, bEvidence: y.evidence || 'keine' })
  return chatJson<{ side: Side; reason: string }>(baseUrl, prompt, {
    schema: SCHEMA, maxTokens: 160, temperature: 0.1, signal,
    validate: (v) => { if (!isObj(v) || !['A', 'B', 'tie', 'both_weak'].includes(v.winner as string)) throw new Error('winner ungültig'); return { side: v.winner === 'both_weak' ? 'bothWeak' : (v.winner as Side), reason: str(v.grund ?? '–', 200, 'grund').slice(0, 200) } }
  })
}

/**
 * Rundenweise: zuerst Ring + Sehnen (zusammenhängend, ~65 % des Budgets), danach Paare nahe der Auswahlgrenze `k` (Unsicherheit dort priorisiert).
 * Nicht verglichene oder nicht verbundene Kandidaten bekommen keinen erfundenen Rang (strength = null → Reihenfolge der Eingabe).
 */
export async function compareAll(baseUrl: string, cands: CompareCand[], opts: { matches: number; k: number; seed?: number; signal?: AbortSignal; onProgress?: (f: number) => void }): Promise<CompareResult> {
  const n = cands.length
  const judgements: Judgement[] = []
  const played = new Set<string>()
  let calls = 0, failed = 0
  const run = async (pairs: Array<[number, number]>, budget: number): Promise<void> => {
    for (const [a0, b0] of pairs) {
      if (judgements.length >= budget) return
      opts.signal?.throwIfAborted()
      const key = a0 < b0 ? `${a0}-${b0}` : `${b0}-${a0}`
      if (played.has(key)) continue
      played.add(key)
      // wechselnde Startposition je Paar; beide Reihenfolgen werden gefragt
      const [a, b] = played.size % 2 ? [a0, b0] : [b0, a0]
      const one = async (x: number, y: number): Promise<{ side: Side; reason: string } | null> => { calls++; try { return await askPair(baseUrl, cands[x], cands[y], opts.signal) } catch (e) { if (opts.signal?.aborted) throw e; failed++; return null } }
      const r1 = await one(a, b), r2 = await one(b, a)
      if (!r1 && !r2) continue
      // r1: A = Kandidat a; r2 (vertauscht): A = Kandidat b. Fehlt eine Reihenfolge, wird sie aus der anderen gespiegelt (A↔B).
      const swap = (x: Side): Side => (x === 'A' ? 'B' : x === 'B' ? 'A' : x)
      const ab: Side = r1?.side ?? swap(r2!.side)
      const ba: Side = r2?.side ?? swap(r1!.side)
      judgements.push({ a, b, ab, ba, outcome: combineOrders(ab, ba), reason: [r1?.reason, r2?.reason].filter(Boolean).join(' | ').slice(0, 300) })
      opts.onProgress?.(Math.min(1, judgements.length / Math.max(1, opts.matches)))
    }
  }
  if (n >= 2) {
    const first = Math.max(n, Math.ceil(opts.matches * 0.65))
    await run(scheduleMatches(n, first, opts.seed ?? 7), first)
    const results = (): MatchResult[] => judgements.map((j) => ({ a: j.a, b: j.b, outcome: j.outcome }))
    const bt = bradleyTerry(n, results())
    if (bt && judgements.length < opts.matches) {
      const order = rankOrder(bt)
      const near = order.slice(Math.max(0, opts.k - 4), Math.min(n, opts.k + 4))
      const pairs: Array<[number, number]> = []
      for (let i = 0; i < near.length; i++) for (let j = i + 1; j < near.length; j++) pairs.push([near[i], near[j]])
      await run(pairs, opts.matches)
    }
  }
  const results = judgements.map((j) => ({ a: j.a, b: j.b, outcome: j.outcome }))
  const strength = n >= 2 ? bradleyTerry(n, results) : null
  return { order: strength ? rankOrder(strength) : cands.map((_, i) => i), strength, judgements, calls, failedCalls: failed, connected: n < 2 || isConnected(n, results.filter((r) => r.outcome !== 'bothWeak')) }
}
