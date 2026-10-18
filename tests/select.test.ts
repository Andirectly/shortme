import { describe, expect, it } from 'vitest'
import type { AsrWord } from '../src/main/engines/asr/protocol'
import { splitSentences } from '../src/main/shortme/clips/sentences'
import { CONNECTIVE_START, buildWindows, defaultWanted, finalScore, fitLength, formatSentence, lengthPenalty, mergeRatings, quoteOk, resolveTags } from '../src/main/shortme/clips/select'
import { topicBoundaries, topicClips, tokens } from '../src/main/shortme/clips/texttiling'
import type { Signals } from '../src/main/shortme/clips/signals'

function words(text: string, step = 0.4): AsrWord[] {
  const out: AsrWord[] = []
  let t = 0
  for (const w of text.split(' ')) { out.push({ w, start: t, end: t + 0.35 }); t += step; if (/[.!?]$/.test(w)) t += 0.5 }
  return out
}
const sig = (n: number, v = 0): Signals => ({ loudness: Array(n).fill(v), rate: Array(n).fill(v), burst: Array(n).fill(v), silence: Array(n).fill(0), silences: [], noiseFloorDb: -60 })

describe('Fenster', () => {
  it('teilt an Satzgrenzen mit Überlappung und deckt alles ab', () => {
    const text = Array.from({ length: 60 }, (_, i) => `satz${i} mit fünf wörtern hier.`).join(' ')
    const s = splitSentences(words(text))
    const w = buildWindows(s, 100, 3)
    expect(w[0].from).toBe(0)
    expect(w[w.length - 1].to).toBe(s.length - 1)
    for (let i = 1; i < w.length; i++) { expect(w[i].from).toBeLessThanOrEqual(w[i - 1].to); expect(w[i].from).toBeGreaterThan(w[i - 1].from) }
    for (const x of w) expect(s.slice(x.from, x.to + 1).reduce((n, q) => n + q.last - q.first + 1, 0)).toBeLessThanOrEqual(100 + 5)
  })
  it('liefert bei kurzem Transkript ein Fenster', () => {
    expect(buildWindows(splitSentences(words('alpha beta gamma. delta epsilon zeta.')))).toEqual([{ from: 0, to: 1 }])
  })
})

describe('Länge', () => {
  const s = splitSentences(words(Array.from({ length: 40 }, (_, i) => `eins zwei drei vier fünf sechs sieben acht${i}.`).join(' ')))
  it('kürzt zu lange Kandidaten an Satzenden', () => {
    const f = fitLength({ first: 0, last: 39 }, s, 15, 30, 39)!
    const d = s[f.last].end - s[f.first].start
    expect(d).toBeLessThanOrEqual(30)
    expect(d).toBeGreaterThan(20)
  })
  it('verlängert zu kurze und verwirft hoffnungslos kurze', () => {
    const f = fitLength({ first: 0, last: 0 }, s, 15, 60, 39)!
    expect(s[f.last].end - s[f.first].start).toBeGreaterThanOrEqual(15)
    expect(fitLength({ first: 38, last: 38 }, s, 15, 60, 38)).toBeNull()
  })
  it('Zielanzahl wächst mit der Dauer (≈ 1 je 2,5 Min), begrenzt auf 4–30', () => {
    expect(defaultWanted(100)).toBe(4)
    expect(defaultWanted(729)).toBe(5)
    expect(defaultWanted(3600)).toBe(24)
    expect(defaultWanted(100000)).toBe(30)
  })
})

describe('Tags', () => {
  it('löst Satz+Wort zu Wortindizes auf, ignoriert Unbekanntes und Sätze außerhalb', () => {
    const w = words('Das ist ein Test. Hier kommt Berlin vor! Noch ein Satz.')
    const s = splitSentences(w)
    const tags = resolveTags([{ sentence: 1, word: 'berlin', kind: 'entity' }, { sentence: 1, word: 'gibtsnicht', kind: 'emphasis' }, { sentence: 2, word: 'Satz', kind: 'hook' }], s, w, 0, 1)
    expect(tags).toEqual([{ word: 6, kind: 'entity' }])
  })
})

describe('Score', () => {
  it('kombiniert Raster, Rang und Signal und bleibt in 0–100', () => {
    expect(finalScore(100, 0, 5, 1)).toBe(100)
    expect(finalScore(80, 0, 5, 0)).toBe(88)
    expect(finalScore(80, 4, 5, 0)).toBe(64)
    expect(finalScore(0, 4, 5, 0)).toBe(16)
    expect(finalScore(80, 0, 1, 0)).toBe(88)
  })
})

describe('Satzformat für das LLM', () => {
  it('markiert laute und lachende Stellen', () => {
    const w = words('Das war richtig laut hier. Und dann leise.')
    const s = splitSentences(w)
    expect(formatSentence(s[0], sig(10, 0.95))).toMatch(/^\[S0 \| 0 s\] Das war richtig laut hier\. \(Lachen\?, laut\)$/)
    expect(formatSentence(s[1], sig(10, 0))).not.toMatch(/\(/)
  })
})

describe('TextTiling', () => {
  const topicA = 'Katze Maus Käse Fell Pfote Katze Maus Fell'
  const topicB = 'Motor Reifen Benzin Auto Motor Reifen Lenkrad Auto'
  const blocks = [topicA, topicA, topicA, topicA, topicA, topicB, topicB, topicB, topicB, topicB].map(tokens)
  it('findet die Themengrenze zwischen A und B', () => {
    const b = topicBoundaries(blocks)
    expect(b).toContain(4)
  })
  it('bildet Clip-Spannen in den Längengrenzen', () => {
    const text = Array.from({ length: 20 }, (_, i) => `${i < 10 ? 'Katze Maus Käse Fell Pfote' : 'Motor Reifen Benzin Auto Lenkrad'} und noch etwas ${i}.`).join(' ')
    const s = splitSentences(words(text, 1.6))
    const spans = topicClips(s, 8, 40)
    expect(spans.length).toBeGreaterThanOrEqual(1)
    for (const p of spans) { expect(p.end - p.start).toBeLessThanOrEqual(41); expect(p.end - p.start).toBeGreaterThanOrEqual(8) }
    for (let i = 1; i < spans.length; i++) expect(spans[i].first).toBeGreaterThan(spans[i - 1].last)
  })
  it('liefert bei zu wenigen Blöcken nichts', () => {
    expect(topicBoundaries([['a'], ['b']])).toEqual([])
    expect(topicClips(splitSentences(words('alpha beta. gamma delta.')))).toEqual([])
  })
})

describe('Auswahl-Qualität (Beleg-Prüfung, Proben, Anfang, Länge)', () => {
  const clip = 'Warum ist das so? Weil niemand zuhört. Das ändert alles.'
  const sample = (hook: number, payoff: number, hq: string, pq: string) => ({ notes: { hook, payoff, quotable: 2, standalone: 3, emotion: 1 }, hookQuote: hq, payoffQuote: pq, missing: [], title: 't', hookText: 'h', reason: 'r', tags: [] })
  it('Zitate müssen wörtlich im Clip stehen (Satzzeichen/Schreibweise egal)', () => {
    expect(quoteOk('warum ist das so', clip)).toBe(true)
    expect(quoteOk('Das ändert alles', clip)).toBe(true)
    expect(quoteOk('Das verändert nichts', clip)).toBe(false)
    expect(quoteOk('ja', clip)).toBe(false)
  })
  it('Median über Proben, Skala 0–4 → 0–20, erfundene Zitate kosten einen Punkt', () => {
    const ok = mergeRatings([sample(4, 2, 'Warum ist das so?', 'Das ändert alles.'), sample(2, 2, 'Warum ist das so?', 'Das ändert alles.')], clip)
    expect(ok.criteria.hook).toBe(15) // Median 3 → 15
    expect(ok.criteria.payoff).toBe(10)
    expect(ok.criteria.density).toBe(5)
    const fake = mergeRatings([sample(4, 4, 'erfunden hier', 'auch erfunden'), sample(4, 4, 'noch erfunden', 'ebenso erfunden')], clip)
    expect(fake.criteria.hook).toBe(15)
    expect(fake.criteria.payoff).toBe(15)
  })
  it('Konnektiv-Anfänge werden erkannt', () => {
    expect(CONNECTIVE_START.test('Und deswegen machen wir das.')).toBe(true)
    expect(CONNECTIVE_START.test('Aber das stimmt nicht.')).toBe(true)
    expect(CONNECTIVE_START.test('Er ist gestern gegangen.')).toBe(true)
    expect(CONNECTIVE_START.test('Warum hören Leute nicht zu?')).toBe(false)
    expect(CONNECTIVE_START.test('Ich habe heute etwas Verrücktes erlebt.')).toBe(false)
  })
  it('weiche Längenvorgabe: Sweetspot 22–50 s ohne Abzug', () => {
    expect([10, 18, 30, 50, 60, 75, 90].map(lengthPenalty)).toEqual([6, 3, 0, 0, 2, 5, 8])
  })
})

describe('Untertitel-Korrektur: nur sichere Änderungen', () => {
  it('nimmt Zeichensetzung, Schreibweise und kleine Wortfehler an', async () => {
    const { acceptCorrection } = await import('../src/main/shortme/clips/select')
    expect(acceptCorrection('season', 'Season,')).toBe(true)
    expect(acceptCorrection('tattoo', 'Tattoo.')).toBe(true)
    expect(acceptCorrection('Tatoo', 'Tattoo')).toBe(true)
  })
  it('lehnt erfundene Wörter, Mehrwort-Einträge und Leeres ab', async () => {
    const { acceptCorrection } = await import('../src/main/shortme/clips/select')
    expect(acceptCorrection('Haus', 'Schmetterling')).toBe(false)
    expect(acceptCorrection('Haus', 'das Haus')).toBe(false)
    expect(acceptCorrection('Haus', '')).toBe(false)
    expect(acceptCorrection('Haus', 'Haus')).toBe(false)
  })
})
