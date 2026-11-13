import { createServer, type Server } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import type { AsrWord } from '../src/main/engines/asr/protocol'
import type { ShortmeClip } from '../src/shared/shortme'
import type { Transcript } from '../src/main/shortme/transcription'
import { planExport } from '../src/main/shortme/render/exporter'
import { baseState, effectiveClip, emptyLog, push, stateOf, undo } from '../src/shared/edits'
import { audioPeaks, audioProposals, groupFrames, GROUP_NAMES, type Group } from '../src/main/shortme/clips/engines/v2/audioIndex'
import { textWindows } from '../src/main/shortme/clips/engines/v2/search'
import { changeProposals, sweepTimes } from '../src/main/shortme/clips/engines/v2/visualIndex'
import { checkVariant, evidenceInKeep, sameKeep, sentencePiece } from '../src/main/shortme/clips/engines/v2/plan'
import { frameTimes } from '../src/main/shortme/clips/engines/v2/observe'
import { rateType, requiredModalities, uncheckedOf } from '../src/main/shortme/clips/engines/v2/judge'
import { audioPart, chatMm, imagePart, textPart } from '../src/main/shortme/clips/engines/v2/mm'
import { compareAll } from '../src/main/shortme/clips/engines/v2/compare'
import type { Evidence, HighlightEvent } from '../src/shared/engineV2'
import type { Sentence } from '../src/main/shortme/clips/sentences'

// ---------- kleiner Fake-Server für den OpenAI-kompatiblen Endpunkt (nur Protokolltest, ersetzt keine echte Inferenz) ----------
let server: Server | null = null
const seen: Array<Record<string, unknown>> = []
async function fakeServer(answer: (body: Record<string, unknown>) => unknown): Promise<string> {
  server = createServer((req, res) => {
    let b = ''
    req.on('data', (d: Buffer) => { b += d.toString() })
    req.on('end', () => { const body = JSON.parse(b) as Record<string, unknown>; seen.push(body); res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(answer(body)) }, finish_reason: 'stop' }] })) })
  })
  await new Promise<void>((r) => server!.listen(0, '127.0.0.1', r))
  return `http://127.0.0.1:${(server.address() as { port: number }).port}`
}
afterEach(async () => { seen.length = 0; if (server) await new Promise((r) => server!.close(r)); server = null })

describe('Ton-Index', () => {
  const frames = 400
  const mk = (): Record<Group, Uint8Array> => Object.fromEntries(GROUP_NAMES.map((g) => [g, new Uint8Array(frames)])) as Record<Group, Uint8Array>
  it('Gesang/Rap wird ein Performance-Vorschlag (nur Signal, nicht als geprüft ausgegeben)', () => {
    const s = mk()
    s.vocal.fill(200, 100, 160)
    const { proposals, evidence } = audioProposals(s, 192)
    const p = proposals.find((x) => x.kind === 'performance')!
    expect(p).toBeTruthy()
    expect(p.source).toBe('audio')
    expect(p.anchor).toBeGreaterThan(45); expect(p.anchor).toBeLessThan(80)
    expect(evidence.every((e) => e.state === 'signal-only')).toBe(true)
  })
  it('Dauermusik ohne Kontrast ist kein Vorschlag, Lachen schon', () => {
    const s = mk()
    s.music.fill(190, 0, 400)
    s.laugh.fill(220, 330, 336)
    const peaks = audioPeaks(s)
    expect(peaks.some((p) => p.group === 'laugh')).toBe(true)
    const { proposals } = audioProposals(s, 192)
    expect(proposals.some((p) => (p.summary ?? '').includes('Musik'))).toBe(false)
    expect(proposals.some((p) => (p.summary ?? '').includes('Lachen'))).toBe(true)
  })
  it('Klassen-Gruppierung nimmt das Maximum der Klassen (Index aus der geprüften Klassenliste)', () => {
    const sc = new Float32Array(2 * 521)
    sc[0 * 521 + 31] = 0.8 // Rapping
    sc[1 * 521 + 13] = 0.6 // Laughter
    const g = groupFrames(sc, 2)
    expect(g.vocal[0]).toBeGreaterThan(190); expect(g.vocal[1]).toBe(0)
    expect(g.laugh[1]).toBeGreaterThan(140)
  })
})

describe('Textfenster', () => {
  const sentences: Sentence[] = Array.from({ length: 120 }, (_, i) => ({ index: i, first: i * 10, last: i * 10 + 9, start: i * 5, end: i * 5 + 4.5, text: `Satz ${i}` }))
  it('decken alle Sätze ab, überlappen und sind begrenzt', () => {
    const w = textWindows(sentences)
    expect(w[0].from).toBe(0); expect(w[w.length - 1].to).toBe(119)
    const seenIdx = new Set<number>()
    for (const x of w) { for (let i = x.from; i <= x.to; i++) seenIdx.add(i); expect(sentences[x.to].end - sentences[x.from].start).toBeLessThanOrEqual(180) }
    expect(seenIdx.size).toBe(120)
    for (let i = 1; i < w.length; i++) { expect(w[i].from).toBeGreaterThan(w[i - 1].from); expect(w[i].from).toBeLessThanOrEqual(w[i - 1].to + 1) }
    expect(w.length).toBeGreaterThan(3)
  })
  it('Wortbudget teilt dichte Passagen, ohne hängen zu bleiben', () => {
    const dense: Sentence[] = Array.from({ length: 10 }, (_, i) => ({ index: i, first: i * 400, last: i * 400 + 399, start: i, end: i + 0.9, text: 'x' }))
    const w = textWindows(dense)
    expect(w.length).toBeGreaterThan(1)
    expect(w[w.length - 1].to).toBe(9)
  })
})

describe('Bild-Index', () => {
  it('Rundgang deckt die ganze Dauer gleichmäßig ab (nicht nur den Anfang)', () => {
    const { times, step } = sweepTimes(3 * 3600, 240)
    expect(times.length).toBeLessThanOrEqual(241)
    expect(times[0]).toBeLessThan(step); expect(times[times.length - 1]).toBeGreaterThan(3 * 3600 - 2 * step)
  })
  it('Bildänderung nur bei klarem Kontrast zum Umfeld', () => {
    const times = Array.from({ length: 200 }, (_, i) => i * 2)
    const diffs = times.map((_, i) => (i === 120 ? 0.5 : 0.02))
    const { proposals, evidence } = changeProposals(times, diffs, 400)
    expect(proposals).toHaveLength(1)
    expect(proposals[0].anchor).toBe(240)
    expect(evidence[0].state).toBe('signal-only')
  })
  it('Frame-Zeiten liegen im Ereignis, sind geordnet und haben Abstand', () => {
    const t = frameTimes({ start: 100, end: 130, anchor: 115 })
    expect(t.length).toBeGreaterThanOrEqual(3)
    for (let i = 1; i < t.length; i++) expect(t[i] - t[i - 1]).toBeGreaterThanOrEqual(1.5)
    expect(Math.min(...t)).toBeGreaterThanOrEqual(100); expect(Math.max(...t)).toBeLessThanOrEqual(130)
  })
})

describe('Schnittplanung', () => {
  const sentences: Sentence[] = Array.from({ length: 30 }, (_, i) => ({ index: i, first: i * 3, last: i * 3 + 2, start: i * 4, end: i * 4 + 3, text: `s${i}` }))
  it('Stück mit Polster bleibt zwischen den Nachbarsätzen', () => {
    const p = sentencePiece(sentences, 5, 7, 0.5)
    expect(p.start).toBeCloseTo(19.5, 6) // Satz 5 beginnt bei 20; Lücke zu Satz 4 (Ende 19) → Mitte 19,5 begrenzt
    expect(p.end).toBeCloseTo(31.5, 6) // Satz 7 endet bei 31, nächster beginnt bei 32
    const wide = sentencePiece(sentences, 5, 7, 5)
    expect(wide.start).toBeCloseTo(19.5, 6); expect(wide.end).toBeCloseTo(31.5, 6) // Polster nie über die Mitte der Lücke hinaus
  })
  it('prüft die tatsächliche Ausgabelänge, nicht den umschließenden Bereich', () => {
    const lim = { minSec: 15, maxSec: 75 }
    expect(checkVariant([{ start: 0, end: 10 }, { start: 100, end: 110 }], 1000, lim)).toBeNull() // 20 s Ausgabe, Spanne 110
    expect(checkVariant([{ start: 0, end: 5 }, { start: 100, end: 104 }], 1000, lim)).toMatch(/kurz/)
    expect(checkVariant([{ start: 0, end: 10 }, { start: 200, end: 230 }], 1000, lim)).toMatch(/Spanne/)
    expect(checkVariant([{ start: 0, end: 20 }, { start: 10, end: 40 }], 1000, lim)).toMatch(/überlappt/)
    expect(checkVariant([{ start: 0, end: 10 }, { start: 12, end: 20 }, { start: 22, end: 30 }, { start: 32, end: 40 }], 1000, lim)).toMatch(/mehr als/)
    expect(checkVariant([{ start: 0, end: 20 }], 15, lim)).not.toBeNull() // außerhalb des Videos
  })
  it('Beleg aus entferntem Abschnitt legitimiert die Kürzung nicht', () => {
    const e: Evidence = { id: 'x', modality: 'audio', state: 'observed', source: 't', start: 30, end: 40, observation: '' }
    expect(evidenceInKeep(e, [{ start: 0, end: 20 }, { start: 50, end: 70 }])).toBe(false)
    expect(evidenceInKeep(e, [{ start: 0, end: 20 }, { start: 35, end: 70 }])).toBe(true)
    expect(sameKeep([{ start: 0, end: 10 }], [{ start: 0.1, end: 10.1 }])).toBe(true)
  })
})

describe('Bewertungsart und Pflichtwege', () => {
  const ev = (over: Partial<HighlightEvent>): HighlightEvent => ({ id: 'e1', start: 0, end: 30, anchor: 15, kind: 'aussage', summary: '', foundBy: ['text'], evidenceIds: [], requiredModalities: [], missingContext: [], ...over })
  it('Art und Inhaltstyp bestimmen die Kriterien', () => {
    expect(rateType('aussage', ['text'], 'podcast')).toBe('aussage')
    expect(rateType('aussage', ['text'], 'stream')).toBe('unterhaltung')
    expect(rateType('performance', ['audio'], 'stream')).toBe('performance')
    expect(rateType('gameplay', ['visual'], 'stream')).toBe('gaming')
  })
  it('Gesang braucht den Ton, Gameplay das Bild; fehlende Beobachtung = nicht geprüft', () => {
    const req = requiredModalities('performance', ['audio'])
    expect(req).toContain('audio'); expect(req).not.toContain('text')
    const signal: Evidence = { id: 'a1', modality: 'audio', state: 'signal-only', source: 'yamnet', start: 0, end: 5, observation: 's' }
    const heard: Evidence = { ...signal, id: 'a2', state: 'observed' }
    const e = ev({ kind: 'performance', foundBy: ['audio'], evidenceIds: ['a1'], requiredModalities: req })
    expect(uncheckedOf(e, new Map([['a1', signal]]))).toEqual(['audio']) // Signal allein reicht nicht
    expect(uncheckedOf({ ...e, evidenceIds: ['a1', 'a2'] }, new Map([['a1', signal], ['a2', heard]]))).toEqual([])
    expect(uncheckedOf(e, new Map([['a1', { ...signal, state: 'failed' as const }]]))).toEqual(['audio'])
  })
})

describe('Medien gehen wirklich an das Modell (Protokoll)', () => {
  it('Bild- und Tonteile erreichen den Endpunkt als image_url/input_audio, Schema wird erzwungen', async () => {
    const url = await fakeServer(() => ({ ok: true }))
    const out = await chatMm<{ ok: boolean }>(url, 'System', [textPart('F1:'), imagePart(Buffer.from([0xff, 0xd8, 1, 2])), audioPart(Buffer.from('RIFFxxxx'))], { schema: { type: 'object' }, validate: (x) => x as { ok: boolean } })
    expect(out.ok).toBe(true)
    const body = seen[0] as { messages: Array<{ role: string; content: unknown }>; response_format: { type: string } }
    const user = body.messages.find((m) => m.role === 'user')!.content as Array<{ type: string; image_url?: { url: string }; input_audio?: { data: string; format: string } }>
    expect(user.some((p) => p.type === 'image_url' && p.image_url!.url.startsWith('data:image/jpeg;base64,'))).toBe(true)
    expect(user.some((p) => p.type === 'input_audio' && p.input_audio!.format === 'wav' && p.input_audio!.data.length > 0)).toBe(true)
    expect(body.response_format.type).toBe('json_schema')
  })
  it('Voxtral-Modus: kein Systemprompt, Anweisung im Nutzerteil', async () => {
    const url = await fakeServer(() => ({ ok: true }))
    await chatMm(url, 'ANWEISUNG', [audioPart(Buffer.from('x'))], { noSystem: true, schema: { type: 'object' }, validate: (x) => x })
    const body = seen[0] as { messages: Array<{ role: string; content: Array<{ text?: string }> }> }
    expect(body.messages.every((m) => m.role !== 'system')).toBe(true)
    expect(body.messages[0].content[0].text).toBe('ANWEISUNG')
  })
  it('ungültige Antwort wird einmal wiederholt, danach verständlicher Fehler', async () => {
    const url = await fakeServer(() => ({ falsch: 1 }))
    await expect(chatMm(url, 's', [textPart('x')], { schema: { type: 'object' }, validate: () => { throw new Error('nope') } })).rejects.toThrow(/Modellantwort ungültig/)
    expect(seen.length).toBe(2)
  })
})

describe('Globaler Paarvergleich', () => {
  const cands = Array.from({ length: 6 }, (_, i) => ({ id: `c${i}`, kind: 'witz', durationSec: 30, text: `Text ${i}`, evidence: '' }))
  const strengthOf = (text: string): number => Number(/Text (\d)/.exec(text)![1])
  const pairBody = (body: Record<string, unknown>): { a: number; b: number } => {
    const u = (body.messages as Array<{ role: string; content: string }>).find((m) => m.role === 'user')!.content
    return { a: strengthOf(/Vorschlag A[^]*?Text (\d)/.exec(u)![0]), b: strengthOf(/Vorschlag B[^]*?Text (\d)/.exec(u)![0]) }
  }
  it('stellt beide Reihenfolgen, ordnet zusammenhängend nach Stärke', async () => {
    const url = await fakeServer((body) => { const { a, b } = pairBody(body); return { winner: a === b ? 'tie' : a > b ? 'A' : 'B', grund: 'x' } })
    const r = await compareAll(url, cands, { matches: 10, k: 3 })
    expect(r.connected).toBe(true)
    expect(r.strength).not.toBeNull()
    expect(r.order[0]).toBe(5); expect(r.order[5]).toBe(0)
    expect(r.calls).toBe(r.judgements.length * 2) // beide Reihenfolgen je Begegnung
  })
  it('reiner Positions-Bias („immer A“) ergibt Unentschieden statt eines erfundenen Rangs', async () => {
    const url = await fakeServer(() => ({ winner: 'A', grund: 'x' }))
    const r = await compareAll(url, cands, { matches: 8, k: 3 })
    expect(r.judgements.every((j) => j.outcome === 'tie')).toBe(true)
  })
  it('ein Kandidat: kein Vergleich, keine erfundene Rangzahl', async () => {
    const url = await fakeServer(() => ({ winner: 'A', grund: 'x' }))
    const r = await compareAll(url, cands.slice(0, 1), { matches: 5, k: 1 })
    expect(r.calls).toBe(0); expect(r.strength).toBeNull(); expect(r.order).toEqual([0])
  })
})

describe('Automatische Kürzung im Editor (Vorschau = Export, Undo/Redo)', () => {
  const W = (w: string, start: number, end: number): AsrWord => ({ w, start, end })
  const words = [W('a', 10, 12), W('b', 12.2, 14), W('mitte', 30, 31), W('c', 45, 47), W('d', 55, 58)]
  const t = { words, speech: [] } as unknown as Transcript
  const clip: ShortmeClip = { id: 'v2-x-c1', start: 10, end: 60, firstWord: 0, lastWord: 4, score: 80, criteria: { hook: 0, payoff: 0, quotable: 0, standalone: 0, density: 0 }, title: 't', hookText: 'h', reason: '', tags: [], source: 'v2', snap: [], extended: 0, autoCuts: [{ start: 24, end: 40 }] }
  const plan = (st: ReturnType<typeof stateOf>): ReturnType<typeof planExport> => { const eff = effectiveClip(clip, words, st); return planExport(eff, t, { silences: [] }, false, eff.removed) }
  it('entfernte Abschnitte fehlen in Zeitachse und Untertiteln, Länge = tatsächliche Ausgabe', () => {
    const p = plan(stateOf(baseState(clip), emptyLog(clip.id)))
    expect(p.duration).toBeCloseTo(50 - 16, 6)
    expect(p.words.map((w) => w.w)).toEqual(['a', 'b', 'c', 'd']) // „mitte“ liegt im entfernten Abschnitt
  })
  it('Wiederherstellen und erneut Anwenden sind Operationen mit Undo', () => {
    const base = baseState(clip)
    let log = push(emptyLog(clip.id), { t: 'autoCuts', ranges: clip.autoCuts!, cut: false })
    expect(stateOf(base, log).autoCuts).toHaveLength(0)
    expect(plan(stateOf(base, log)).duration).toBeCloseTo(50, 6)
    expect(plan(stateOf(base, log)).words.map((w) => w.w)).toContain('mitte')
    log = undo(log)
    expect(stateOf(base, log).autoCuts).toHaveLength(1)
    log = push(push(log, { t: 'autoCuts', ranges: clip.autoCuts!, cut: false }), { t: 'autoCuts', ranges: clip.autoCuts!, cut: true })
    expect(stateOf(base, log).autoCuts).toEqual([{ start: 24, end: 40 }]) // nichts doppelt
  })
  it('manuelle Wortlöschung und automatische Kürzung überlagern sich ohne Doppelanwendung', () => {
    const base = baseState(clip)
    const log = push(emptyLog(clip.id), { t: 'cutWords', words: [1], cut: true }) // „b“ 12,2–14
    const p = plan(stateOf(base, log))
    expect(p.duration).toBeCloseTo(50 - 16 - 1.8, 5)
  })
  it('Clip ohne Wörter (nichtsprachlich) plant ohne erfundene Untertitel', () => {
    const wordless: ShortmeClip = { ...clip, id: 'v2-x-c2', start: 100, end: 130, firstWord: 5, lastWord: 4, wordless: true, autoCuts: undefined }
    const eff = effectiveClip(wordless, words, baseState(wordless))
    const p = planExport(eff, t, { silences: [] }, true, eff.removed)
    expect(p.words).toEqual([])
    expect(p.duration).toBeCloseTo(30, 6)
    expect(p.pieces.length).toBeGreaterThan(0)
  })
})
