import { describe, expect, it } from 'vitest'
import { buildCandidate, groupsFor, rankSchema, shuffled, validateRanking, type V6Candidate } from '../src/main/shortme/clips/engines/v6/editorial'
import { planSpeech, planWordless, sentenceEdges } from '../src/main/shortme/clips/engines/v6/plan'
import { chooseRepresentatives } from '../src/main/shortme/clips/engines/v6/visualIndex'
import type { Sentence } from '../src/main/shortme/clips/sentences'
import { enginesFor, isUnsupportedEngine, isV4Pipeline } from '../src/shared/engine'

// 40 Sätze à 4 Wörter, je Satz 5 s (Wort 1 s), dazwischen kurze Pausen
const words = Array.from({ length: 160 }, (_, i) => ({ start: i * 1.25, end: i * 1.25 + 1, w: `w${i}` }))
const sentences: Sentence[] = Array.from({ length: 40 }, (_, k) => ({ index: k, first: k * 4, last: k * 4 + 3, start: words[k * 4].start, end: words[k * 4 + 3].end, text: `Satz ${k} mit Inhalt.` }))
const cand = (id: string, s: number[], wordless = false): V6Candidate => ({ id, eventGroupId: 'g' + id, lanes: ['speech'], span: { start: 0, end: 10 }, sentences: s, text: 'x', contextBefore: '', contextAfter: '', wordless, evidence: [], durationSec: 10 })

describe('Engine 6 – Ranking-Vertrag', () => {
  const cs = [cand('k1', [1, 2, 3]), cand('k2', [7, 8]), cand('k3', [], true)]
  const ok = { decisions: [
    { id: 'k2', decision: 'use', rank: 1, first: 7, last: 8, reason: 'klare Pointe', question: '', title: 'Der „beste“   Moment' },
    { id: 'k3', decision: 'investigate', rank: 2, first: -1, last: -1, reason: 'wortlos', question: 'Ist die Reaktion zu sehen?' },
    { id: 'k1', decision: 'reject', rank: 3, first: 1, last: 3, reason: 'Kontext fehlt', question: 'egal' }
  ] }
  it('gültige Antwort: nach Rang sortiert, Frage nur bei investigate', () => {
    const d = validateRanking(ok, cs)
    expect(d.map((x) => x.id)).toEqual(['k2', 'k3', 'k1'])
    expect(d[2].question).toBe('')
    expect(d[1].question).toMatch(/Reaktion/)
    expect(d[0].title).toBe('Der beste Moment')
  })
  it('fehlende, doppelte, unbekannte IDs und doppelte Ränge werden abgelehnt (nie still ergänzt)', () => {
    expect(() => validateRanking({ decisions: ok.decisions.slice(0, 2) }, cs)).toThrow(/fehlen k1/)
    expect(() => validateRanking({ decisions: [...ok.decisions.slice(0, 2), { ...ok.decisions[0], rank: 3 }] }, cs)).toThrow(/doppelt/)
    expect(() => validateRanking({ decisions: [...ok.decisions.slice(0, 2), { ...ok.decisions[2], id: 'k9' }] }, cs)).toThrow(/unbekannte/)
    expect(() => validateRanking({ decisions: ok.decisions.map((d, i) => ({ ...d, rank: i === 2 ? 1 : d.rank })) }, cs)).toThrow(/Rang/)
  })
  it('Satzgrenzen außerhalb des Kandidaten bei use → ungültig', () => {
    expect(() => validateRanking({ decisions: ok.decisions.map((d) => (d.id === 'k2' ? { ...d, last: 9 } : d)) }, cs)).toThrow(/Satzgrenzen/)
  })
  it('leere Begründung ungültig; Schema erzwingt genau n Einträge mit erlaubten IDs', () => {
    expect(() => validateRanking({ decisions: ok.decisions.map((d) => (d.id === 'k1' ? { ...d, reason: ' ' } : d)) }, cs)).toThrow(/Begründung/)
    const s = rankSchema(['k1', 'k2'], [1, 2]) as { properties: { decisions: { minItems: number; maxItems: number; items: { properties: { id: { enum: string[] } } } } } }
    expect([s.properties.decisions.minItems, s.properties.decisions.maxItems]).toEqual([2, 2])
    expect(s.properties.decisions.items.properties.id.enum).toEqual(['k1', 'k2'])
  })
  it('Mischen ist reproduzierbar; Gruppen kürzen nie Text, sondern werden kleiner', () => {
    expect(shuffled([1, 2, 3, 4, 5], 7)).toEqual(shuffled([1, 2, 3, 4, 5], 7))
    expect(shuffled([1, 2, 3, 4, 5], 7)).not.toEqual(shuffled([1, 2, 3, 4, 5], 8))
    const big = { ...cand('kb', [1]), text: 'x'.repeat(5000) }
    const g = groupsFor([big, cand('a', [1]), cand('b', [1]), big, cand('c', [1])], 6, 6000)
    expect(g.flat().find((c) => c.id === 'kb')!.text.length).toBe(5000)
    expect(g.every((x) => x.length <= 6)).toBe(true)
    expect(g.length).toBeGreaterThan(1)
  })
  it('Kandidat: vollständige Sätze, Außenkontext getrennt; ohne Sätze wortlos', () => {
    const c = buildCandidate('k1', { id: 'g1', lanes: ['speech'], span: { start: 26, end: 40 }, evidence: [] }, sentences, 75)
    expect(c.sentences).toEqual([5, 6, 7])
    expect(c.contextBefore).toMatch(/Satz 3.*Satz 4/)
    expect(c.text).not.toMatch(/Satz 4 /)
    const w = buildCandidate('k2', { id: 'g2', lanes: ['visual'], span: { start: 500, end: 520 }, evidence: ['Bildwechsel'] }, sentences, 75)
    expect(w.wordless).toBe(true)
  })
})

describe('Engine 6 – Schnittplan', () => {
  it('Grenzen nie im Nachbarwort', () => {
    const e = sentenceEdges(words, 4, 7)
    expect(e.start).toBeGreaterThan(words[3].end)
    expect(e.end).toBeLessThan(words[8].start)
  })
  it('zu kurz → um ganze Folgesätze erweitert; Hook/Payoff bleiben geschützt', () => {
    const r = planSpeech('k1', sentences, words, 2, 2, { minSec: 15, maxSec: 75 })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.plan.segments[0].end - r.plan.segments[0].start).toBeGreaterThanOrEqual(15)
    expect(r.plan.protectedSentenceIds).toEqual([2])
    expect(r.plan.extendedBy).toBeGreaterThan(0)
  })
  it('zu langer Gedankengang wird nicht mechanisch gekürzt', () => {
    const r = planSpeech('k1', sentences, words, 0, 30, { minSec: 15, maxSec: 75 })
    expect(r.ok).toBe(false)
  })
  it('Fingerabdruck ändert sich mit den Grenzen', () => {
    const a = planSpeech('k', sentences, words, 2, 5, { minSec: 15, maxSec: 75 }), b = planSpeech('k', sentences, words, 2, 6, { minSec: 15, maxSec: 75 })
    expect(a.ok && b.ok && a.plan.fingerprint !== b.plan.fingerprint).toBe(true)
  })
  it('wortlose Kante, die ein Wort anschneidet, ist ungültig', () => {
    expect(planWordless('k', { id: 'c', startEdgeId: 'a', endEdgeId: 'b', span: { start: 0.5, end: 20 }, prefilter: 0 }, words, { minSec: 15, maxSec: 75 }).ok).toBe(false)
  })
})

describe('Engine 6 – Redundanzreduktion', () => {
  const sig = (v: number): number[] => new Array(32 * 18).fill(v)
  const win = (start: number, v: number[]): { start: number; end: number; frameSigs: number[][] } => ({ start, end: start + 8, frameSigs: v.map(sig) })
  it('gleiches Bild → Vektor übernommen; Schnitt, Änderung und Kontrollabstand erzwingen Einbettung', () => {
    const wins = [win(0, [100, 100]), win(8, [101, 100]), win(16, [100, 100]), win(24, [200, 200]), win(32, [200, 201]), win(40, [200, 200]), win(48, [200, 200]), win(56, [200, 200]), win(64, [200, 200]), win(72, [200, 200])]
    const r = chooseRepresentatives(wins, [35], { dedupe: true, sameThreshold: 0.035, maxGapSec: 40 })
    expect(r.map((x) => x.reason)).toEqual(['embedded', 'same-as-representative', 'same-as-representative', 'changed', 'scene-cut', 'same-as-representative', 'same-as-representative', 'same-as-representative', 'same-as-representative', 'control'])
    expect(r[2].representedBy).toBe(0)
    const ctl = chooseRepresentatives(wins.map((w) => ({ ...w, frameSigs: [sig(100)] })), [], { dedupe: true, sameThreshold: 0.035, maxGapSec: 40 })
    expect(ctl[5].reason).toBe('control')
  })
  it('Bildwechsel innerhalb eines Fensters zählt als Änderung; ohne dedupe wird alles eingebettet', () => {
    const r = chooseRepresentatives([win(0, [100]), win(8, [100, 180])], [], { dedupe: true, sameThreshold: 0.035, maxGapSec: 40 })
    expect(r[1].reason).toBe('changed')
    expect(chooseRepresentatives([win(0, [100]), win(8, [100])], [], { dedupe: false, sameThreshold: 0.035, maxGapSec: 40 }).every((x) => x.reason === 'embedded')).toBe(true)
  })
})

describe('Engine 6 – Registry und Remote', () => {
  it('wählbar auf Windows und Mac, nicht als v4 deklariert', () => {
    expect(enginesFor('win32')).toContain('engine6')
    expect(enginesFor('darwin')).toContain('engine6')
    expect(isV4Pipeline('engine6')).toBe(false)
  })
  it('Worker lehnt unbekannte Engine ab statt still die Standard-Engine zu nehmen', () => {
    expect(isUnsupportedEngine('engine6', 'win32')).toBe(false)
    expect(isUnsupportedEngine('engine4', 'darwin')).toBe(true)
    expect(isUnsupportedEngine('engine9', 'win32')).toBe(true)
    expect(isUnsupportedEngine(undefined, 'win32')).toBe(false)
    expect(isUnsupportedEngine('default', 'darwin')).toBe(false)
  })
})

import { keepSeconds } from '../src/main/shortme/clips/engines/v6/frames'
describe('Engine 6 – Redundanz in AV-Paketen', () => {
  it('statisch → nur Kontrollbilder; Wechsel wird gezeigt; erste/letzte Sekunde immer', () => {
    const s = (v: number): number[] => new Array(576).fill(v)
    const sigs = [...Array(14).fill(0).map(() => s(100)), s(200), ...Array(5).fill(0).map(() => s(200))]
    expect(keepSeconds(sigs, { threshold: 0.035, maxGapSec: 6 })).toEqual([0, 6, 12, 14, 19])
  })
})

import { isDetailQuestion, validateBox } from '../src/main/shortme/clips/engines/v6/roi'
describe('Engine 6 – ROI', () => {
  it('nur gültige Boxen (innerhalb, 0,5–60 % Fläche), mit Rand erweitert', () => {
    expect(validateBox({ x: 0.1, y: 0.6, w: 0.3, h: 0.2 })).toMatchObject({ x: expect.closeTo(0.055, 3), w: expect.closeTo(0.39, 3) })
    expect(validateBox({ x: 0.9, y: 0, w: 0.3, h: 0.2 })).toBeNull()
    expect(validateBox({ x: 0, y: 0, w: 1, h: 1 })).toBeNull()
    expect(validateBox({ x: 0.1, y: 0.1, w: 0.01, h: 0.01 })).toBeNull()
    expect(validateBox(null)).toBeNull()
  })
  it('Detailfrage erkannt', () => {
    expect(isDetailQuestion('Ist der Punktestand im HUD zu sehen?')).toBe(true)
    expect(isDetailQuestion('Lacht das Publikum?')).toBe(false)
  })
})
