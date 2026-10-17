import type { Sentence } from './sentences'

// Lexikalisches TextTiling (Hearst) nach clippyme/analysis/texttiling_ops.py: Fenster k, Glättung 3, Tiefenwert, Schwelle mean+std.
// Fallback ohne LLM; Satzblöcke statt Whisper-Segmente.

const STOP = new Set(('der die das den dem des ein eine einen einem einer eines und oder aber doch denn weil dass ob wie was wer wo wann warum ich du er sie es wir ihr mich dich ihn uns euch mir dir ihm ihnen ' +
  'mein dein sein ihr unser euer ist sind war waren bin bist wird werden wurde wurden hat haben hatte hatten kann können konnte muss müssen will wollen soll sollen nicht kein keine auch noch schon nur mal ja nein ne ' +
  'so da dann also halt eben denn mit von zu zum zur bei nach aus auf in im an am um über unter für gegen ohne bis durch vor hier dort jetzt immer wieder sehr mehr ganz okay genau').split(' '))

export function tokens(text: string): string[] {
  return (text.toLowerCase().match(/\p{L}+/gu) ?? []).filter((t) => t.length > 2 && !STOP.has(t))
}

function cosine(a: Map<string, number>, b: Map<string, number>): number {
  let dot = 0
  let na = 0
  let nb = 0
  for (const [k, v] of a) { na += v * v; const w = b.get(k); if (w) dot += v * w }
  for (const v of b.values()) nb += v * v
  return na && nb ? dot / Math.sqrt(na * nb) : 0
}

function pool(blocks: string[][], from: number, to: number): Map<string, number> {
  const m = new Map<string, number>()
  for (let i = Math.max(0, from); i <= Math.min(blocks.length - 1, to); i++) for (const t of blocks[i]) m.set(t, (m.get(t) ?? 0) + 1)
  return m
}

/** Index i = Themengrenze NACH Block i. */
export function topicBoundaries(blocks: string[][], k = 4): number[] {
  const n = blocks.length
  if (n < 4) return []
  const kk = Math.max(1, Math.min(k, Math.floor(n / 5) || 1))
  const gap: number[] = []
  for (let i = 0; i < n - 1; i++) gap.push(cosine(pool(blocks, i - kk + 1, i), pool(blocks, i + 1, i + kk)))
  const sm = gap.map((_, i) => { let t = 0; let c = 0; for (let j = i - 1; j <= i + 1; j++) if (j >= 0 && j < gap.length) { t += gap[j]; c++ } return t / c })
  const depth = sm.map((v, i) => {
    let l = i
    while (l > 0 && sm[l - 1] >= sm[l]) l--
    let r = i
    while (r < sm.length - 1 && sm[r + 1] >= sm[r]) r++
    return sm[l] - v + (sm[r] - v)
  })
  const mean = depth.reduce((a, b) => a + b, 0) / depth.length
  const sd = Math.sqrt(depth.reduce((a, b) => a + (b - mean) ** 2, 0) / depth.length)
  const cut = mean + sd
  const out: number[] = []
  for (let i = 0; i < depth.length; i++) {
    if (depth[i] > cut && depth[i] >= (depth[i - 1] ?? -Infinity) && depth[i] >= (depth[i + 1] ?? -Infinity) && !(depth[i] === depth[i - 1] && depth[i] === depth[i + 1])) out.push(i)
  }
  return out
}

export interface TopicSpan { first: number; last: number; start: number; end: number }

/** Sätze → Themen-Abschnitte → Clip-Spannen: < min werden mit dem nächsten verbunden, > max an Satzgrenzen geteilt. */
export function topicClips(sentences: Sentence[], minSec = 15, maxSec = 75): TopicSpan[] {
  if (sentences.length < 4) return []
  const bounds = topicBoundaries(sentences.map((s) => tokens(s.text)))
  const spans: Array<[number, number]> = []
  let from = 0
  for (const b of [...bounds, sentences.length - 1]) { spans.push([from, b]); from = b + 1 }
  const out: TopicSpan[] = []
  let carry: number | null = null
  const push = (a: number, b: number): void => { out.push({ first: a, last: b, start: sentences[a].start, end: sentences[b].end }) }
  for (const [a0, b] of spans) {
    const a: number = carry ?? a0
    const dur = sentences[b].end - sentences[a].start
    if (dur < minSec) { carry = a; continue }
    carry = null
    if (dur <= maxSec) { push(a, b); continue }
    let s = a
    for (let i = a; i <= b; i++) {
      if (sentences[i].end - sentences[s].start >= maxSec) {
        const cut = sentences[i].end - sentences[s].start > maxSec && i > s ? i - 1 : i
        push(s, cut)
        s = cut + 1
        i = cut
      }
    }
    if (s <= b && sentences[b].end - sentences[s].start >= minSec) push(s, b)
  }
  if (carry !== null) { const b = sentences.length - 1; if (sentences[b].end - sentences[carry].start >= minSec) push(carry, b) }
  return out
}
