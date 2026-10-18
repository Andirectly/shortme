import { readFile } from 'node:fs/promises'
import { writeFileAtomic } from '../atomic'
import { projectFile } from '../project'
import { chatJson, int, isObj, loadPrompt, str } from './llm'
import type { Sentence } from './sentences'

/** Themenkarte des Videos: Hauptthema + zusammenhängende Abschnitte (Quellzeit). */
export interface TopicMap {
  version: 1
  main: string
  sentences: number
  topics: Array<{ id: number; title: string; summary: string; start: number; end: number }>
}

const CHUNK_WORDS = 2200
export const topicsFile = (hash: string): string => projectFile(hash, 'topics.json')

export async function loadTopics(hash: string, sentenceCount: number): Promise<TopicMap | null> {
  try {
    const t = JSON.parse(await readFile(topicsFile(hash), 'utf8')) as TopicMap
    return t.version === 1 && t.sentences === sentenceCount && t.topics.length ? t : null
  } catch { return null }
}

/** Thema (Index) mit der größten zeitlichen Überlappung; −1 ohne Karte. */
export function topicOfRange(map: TopicMap | null, start: number, end: number): number {
  if (!map) return -1
  let best = -1, bestOv = 0
  for (const t of map.topics) { const ov = Math.min(end, t.end) - Math.max(start, t.start); if (ov > bestOv) { bestOv = ov; best = t.id } }
  return best
}

/** Text-Block für Bewertungs-Prompts: Hauptthema, Themenkarte, Thema dieses Clips. */
export function topicContext(map: TopicMap | null, start: number, end: number): string {
  if (!map) return ''
  const cur = map.topics.find((t) => t.id === topicOfRange(map, start, end))
  const list = map.topics.map((t) => `${t.id + 1}. ${t.title}`).join('; ')
  return `Hauptthema des Videos: ${map.main}\nThemenkarte: ${list}\n${cur ? `Thema dieses Clips: ${cur.title} – ${cur.summary}\n` : ''}\n`
}

/**
 * Themen-Durchgang vor der Clip-Auswahl (Map-Reduce): je Abschnitt (~2 200 Wörter) 1–4 Themen, danach ein Aufruf, der
 * Abschnitte zu Themen verschmilzt und das Hauptthema nennt.
 */
export async function buildTopicMap(url: string, sentences: Sentence[], opts: { signal?: AbortSignal; report?: (f: number, m: string) => void } = {}): Promise<TopicMap> {
  const chunks: Array<{ from: number; to: number }> = []
  let from = 0, words = 0
  for (let i = 0; i < sentences.length; i++) {
    words += sentences[i].last - sentences[i].first + 1
    if (words >= CHUNK_WORDS || i === sentences.length - 1) { chunks.push({ from, to: i }); from = i + 1; words = 0 }
  }
  const parts: Array<{ title: string; summary: string; start: number; end: number }> = []
  for (let c = 0; c < chunks.length; c++) {
    opts.report?.(c / (chunks.length + 1), `Themen erfassen (${c + 1}/${chunks.length}) …`)
    const { from: a, to: b } = chunks[c]
    const prompt = await loadPrompt('topics', { transcript: sentences.slice(a, b + 1).map((s) => `[S${s.index}] ${s.text}`).join('\n') })
    const got = await chatJson(url, prompt, {
      signal: opts.signal, maxTokens: 700, temperature: 0.2,
      schema: { type: 'object', additionalProperties: false, required: ['topics'], properties: { topics: { type: 'array', minItems: 1, maxItems: 4, items: { type: 'object', additionalProperties: false, required: ['title', 'summary', 'start', 'end'], properties: { title: { type: 'string' }, summary: { type: 'string' }, start: { type: 'integer' }, end: { type: 'integer' } } } } } },
      validate: (x) => { if (!isObj(x) || !Array.isArray(x.topics)) throw new Error('topics fehlt'); return x.topics.filter(isObj).map((t) => ({ title: str(t.title, 80, 'title'), summary: str(t.summary, 240, 'summary'), start: int(t.start, 0, 1e9, 'start'), end: int(t.end, 0, 1e9, 'end') })) }
    }).catch((e) => { if (opts.signal?.aborted) throw e; return [] as Array<{ title: string; summary: string; start: number; end: number }> })
    if (got.length === 0) { parts.push({ title: 'Abschnitt', summary: '', start: sentences[a].start, end: sentences[b].end }); continue }
    // lückenlos an die Abschnittsgrenzen anlegen
    got.sort((x, y) => x.start - y.start)
    got.forEach((t, k) => {
      const s0 = k === 0 ? a : Math.max(a, Math.min(b, t.start))
      const s1 = k === got.length - 1 ? b : Math.max(s0, Math.min(b, t.end))
      parts.push({ title: t.title, summary: t.summary, start: sentences[s0].start, end: sentences[s1].end })
    })
  }
  opts.report?.(chunks.length / (chunks.length + 1), 'Themenkarte zusammenfassen …')
  let main = parts[0]?.title ?? ''
  let merged: Array<{ title: string; summary: string; members: number[] }> = parts.map((p, i) => ({ title: p.title, summary: p.summary, members: [i] }))
  if (parts.length > 1) {
    const prompt = await loadPrompt('topicsMain', { items: parts.map((p, i) => `${i + 1}. ${p.title} – ${p.summary}`).join('\n') })
    const r = await chatJson(url, prompt, {
      signal: opts.signal, maxTokens: 900, temperature: 0.2,
      schema: { type: 'object', additionalProperties: false, required: ['main', 'topics'], properties: { main: { type: 'string' }, topics: { type: 'array', minItems: 1, maxItems: 24, items: { type: 'object', additionalProperties: false, required: ['title', 'summary', 'members'], properties: { title: { type: 'string' }, summary: { type: 'string' }, members: { type: 'array', items: { type: 'integer' } } } } } } },
      validate: (x) => { if (!isObj(x) || !Array.isArray(x.topics)) throw new Error('topics fehlt'); return { main: str(x.main, 240, 'main'), topics: x.topics.filter(isObj).map((t) => ({ title: str(t.title, 80, 'title'), summary: str(t.summary, 240, 'summary'), members: (Array.isArray(t.members) ? t.members : []).map((m) => int(m, 1, 1e6, 'member') - 1).filter((m) => m < parts.length) })) } }
    }).catch((e) => { if (opts.signal?.aborted) throw e; return null })
    if (r) {
      main = r.main
      const seen = new Set<number>()
      const m = r.topics.map((t) => ({ ...t, members: t.members.filter((i) => !seen.has(i) && (seen.add(i), true)) })).filter((t) => t.members.length)
      const orphans = parts.map((_, i) => i).filter((i) => !seen.has(i))
      // nicht zugeordnete Abschnitte bleiben eigene Themen (nichts geht verloren)
      if (m.length) merged = [...m, ...orphans.map((i) => ({ title: parts[i].title, summary: parts[i].summary, members: [i] }))]
    }
  }
  const topics = merged.map((t) => {
    const ps = t.members.map((i) => parts[i])
    return { title: t.title, summary: t.summary, start: Math.min(...ps.map((p) => p.start)), end: Math.max(...ps.map((p) => p.end)) }
  }).sort((x, y) => x.start - y.start).map((t, id) => ({ id, ...t }))
  return { version: 1, main, sentences: sentences.length, topics }
}

export const saveTopics = (hash: string, map: TopicMap): Promise<void> => writeFileAtomic(topicsFile(hash), JSON.stringify(map, null, 1))
