// Textsuche der neuen Engine: überlappende, zeitlich begrenzte Kontextfenster über das ganze Video; das Sprachmodell schlägt Momente über Satznummern vor.
import type { Sentence } from '../../sentences'
import { chatJson, int, isObj, loadPrompt, str } from '../../llm'
import { EVENT_KINDS, V2_LIMITS, isEventKind, type Evidence, type EventKind, type RawProposal } from '../../../../../shared/engineV2'

export interface Window { from: number; to: number }

/** Fenster nach Zeit (Standard 180 s, 30 s Überlappung) und Wortbudget; jedes Fenster ist mindestens ein Satz, der Fortschritt ist garantiert. */
export function textWindows(sentences: Sentence[], maxSec: number = V2_LIMITS.textWindowSec, overlapSec: number = V2_LIMITS.textOverlapSec, maxWords: number = V2_LIMITS.textWindowMaxWords): Window[] {
  const out: Window[] = []
  const len = (s: Sentence): number => s.last - s.first + 1
  let i = 0
  while (i < sentences.length) {
    let j = i, words = 0
    while (j < sentences.length && (j === i || (sentences[j].end - sentences[i].start <= maxSec && words + len(sentences[j]) <= maxWords))) { words += len(sentences[j]); j++ }
    out.push({ from: i, to: j - 1 })
    if (j >= sentences.length) break
    const limit = sentences[j - 1].end - overlapSec
    let nx = i + 1
    while (nx < j && sentences[nx].start < limit) nx++
    i = nx
  }
  return out
}

interface Moment { first: number; last: number; kind: EventKind; summary: string; missing: string[] }

const SCHEMA = (max: number): object => ({ type: 'object', additionalProperties: false, required: ['moments'], properties: { moments: { type: 'array', maxItems: max, items: { type: 'object', additionalProperties: false, required: ['first', 'last', 'kind', 'summary', 'missing_context'], properties: { first: { type: 'integer' }, last: { type: 'integer' }, kind: { type: 'string', enum: [...EVENT_KINDS] }, summary: { type: 'string' }, missing_context: { type: 'array', items: { type: 'string' } } } } } } })

export const sentenceLine = (s: Sentence): string => `S${s.index} ${Math.round(s.start)}s: ${s.text}${s.ev?.length ? ' ' + s.ev.map((e) => e.replace(/\[(.*)\]/, '($1)')).join(' ') : ''}`

export interface TextSearch { proposals: RawProposal[]; evidence: Evidence[]; windows: number; failedWindows: number; failedRanges: Array<[number, number]> }

/** Alle Fenster nacheinander; ein ausgefallenes Fenster wird protokolliert (Abdeckung), nicht still ausgelassen. */
export async function textSearch(baseUrl: string, sentences: Sentence[], opts: { query?: string; modelRev: string; signal?: AbortSignal; onProgress?: (f: number) => void }): Promise<TextSearch> {
  const windows = textWindows(sentences)
  const proposals: RawProposal[] = []
  const evidence: Evidence[] = []
  const failedRanges: Array<[number, number]> = []
  let n = 0
  for (let w = 0; w < windows.length; w++) {
    opts.signal?.throwIfAborted()
    const { from, to } = windows[w]
    const prompt = await loadPrompt('v2/events', { max: V2_LIMITS.rawPerWindow, query: opts.query ? `Der Nutzer sucht besonders: ${opts.query}` : '', transcript: sentences.slice(from, to + 1).map(sentenceLine).join('\n') })
    try {
      const moments = await chatJson<Moment[]>(baseUrl, prompt, {
        schema: SCHEMA(V2_LIMITS.rawPerWindow), maxTokens: 1100, temperature: 0.3, signal: opts.signal,
        validate: (x) => {
          if (!isObj(x) || !Array.isArray(x.moments)) throw new Error('moments fehlt')
          return x.moments.flatMap((m): Moment[] => {
            if (!isObj(m)) return []
            const first = int(m.first, -1e9, 1e9, 'first'), last = int(m.last, -1e9, 1e9, 'last')
            // außerhalb des Fensters = Modell hat keine Satznummer geliefert: verwerfen statt zurechtklemmen
            if (first < sentences[from].index || last > sentences[to].index || last < first || !isEventKind(m.kind)) return []
            return [{ first, last, kind: m.kind, summary: str(m.summary, 240, 'summary'), missing: Array.isArray(m.missing_context) ? m.missing_context.filter((k): k is string => typeof k === 'string').slice(0, 5) : [] }]
          })
        }
      })
      moments.forEach((m, rank) => {
        const a = sentences[m.first], b = sentences[m.last]
        if (!a || !b || b.end - a.start < 4 || b.end - a.start > 140) return
        const id = `tx${++n}`
        evidence.push({ id, modality: 'text', state: 'observed', source: 'text-llm', start: a.start, end: b.end, observation: m.summary, modelRev: opts.modelRev, wordRange: [a.first, b.last] })
        proposals.push({ start: a.start, end: b.end, source: 'text', kind: m.kind, summary: m.summary, strength: Math.max(0.2, 1 - 0.12 * rank), missingContext: m.missing, evidenceIds: [id] })
      })
    } catch (e) {
      if (opts.signal?.aborted) throw e
      failedRanges.push([sentences[from].start, sentences[to].end])
      console.warn(`[v2] Textfenster ${w + 1}/${windows.length} fehlgeschlagen: ${e instanceof Error ? e.message.slice(0, 120) : e}`)
    }
    opts.onProgress?.((w + 1) / windows.length)
  }
  return { proposals, evidence, windows: windows.length, failedWindows: failedRanges.length, failedRanges }
}
