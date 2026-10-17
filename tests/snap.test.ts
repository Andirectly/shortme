import { describe, expect, it } from 'vitest'
import type { AsrWord } from '../src/main/engines/asr/protocol'
import { isSentenceEnd, splitSentences } from '../src/main/shortme/clips/sentences'
import { snapClip, snapToCuts, snapToSentences, snapToSilence, snapToWords, type SnapContext } from '../src/main/shortme/clips/snap'
import { decodeBoundaries } from '../src/main/shortme/clips/scenes'
import { computeSignals, frameDb, normalize, silentIntervals } from '../src/main/shortme/clips/signals'

/** Baut Wörter: 0,4 s je Wort, 0,6 s Pause nach Satzende-Wörtern. */
function mk(text: string, t0 = 0): AsrWord[] {
  const out: AsrWord[] = []
  let t = t0
  for (const w of text.split(' ')) {
    out.push({ w, start: t, end: t + 0.35 })
    t += 0.4
    if (/[.!?]$/.test(w)) t += 0.6
  }
  return out
}

const TEXT = 'Heute ist ein guter Tag. Das sagt zumindest Dr. Meier. Er hat 3,5 Stunden geschlafen. Wirklich? Ja. Dann los!'

describe('Satzenden', () => {
  it('erkennt echte Satzenden', () => {
    expect(isSentenceEnd('Tag.', 'Das')).toBe(true)
    expect(isSentenceEnd('Wirklich?')).toBe(true)
    expect(isSentenceEnd('los!')).toBe(true)
  })
  it('ignoriert Abkürzungen, Initialen und Dezimalzahlen', () => {
    expect(isSentenceEnd('Dr.', 'Meier')).toBe(false)
    expect(isSentenceEnd('z.B.', 'wenn')).toBe(false)
    expect(isSentenceEnd('bzw.', 'später')).toBe(false)
    expect(isSentenceEnd('A.', 'Müller')).toBe(false)
    expect(isSentenceEnd('3.', 'Stock')).toBe(false)
    expect(isSentenceEnd('3,5')).toBe(false)
    expect(isSentenceEnd('u.a.', 'Katzen')).toBe(false)
  })
  it('zerlegt in Sätze und bricht bei langer Pause ohne Satzzeichen', () => {
    const s = splitSentences(mk(TEXT))
    expect(s.map((x) => x.text)).toEqual(['Heute ist ein guter Tag.', 'Das sagt zumindest Dr. Meier.', 'Er hat 3,5 Stunden geschlafen.', 'Wirklich?', 'Ja.', 'Dann los!'])
    const noPunct = splitSentences([{ w: 'a', start: 0, end: 0.3 }, { w: 'b', start: 0.4, end: 0.7 }, { w: 'c', start: 3, end: 3.3 }])
    expect(noPunct).toHaveLength(2)
  })
})

function ctx(over: Partial<SnapContext> = {}): SnapContext {
  const words = mk(TEXT)
  return { words, sentences: splitSentences(words), silences: [], cuts: [], durationSec: 60, ...over }
}

describe('Stufe 1: Wortgrenzen', () => {
  it('rastet Beginn auf Wortanfang und Ende auf Wortende', () => {
    const c = ctx()
    const r = snapToWords({ start: c.words[7].start + 0.12, end: c.words[10].end - 0.1 }, c.words)
    expect(r).toEqual({ first: 7, last: 10 })
  })
  it('nimmt das nächste Wort, wenn nichts im Fenster liegt', () => {
    const c = ctx()
    const r = snapToWords({ start: 0.5 + 0.2, end: 100 }, c.words)
    expect(r.first).toBeGreaterThanOrEqual(1)
    expect(r.last).toBe(c.words.length - 1)
  })
})

describe('Stufe 2: Sätze', () => {
  it('erweitert Beginn und Ende auf den umgebenden Satz', () => {
    const c = ctx()
    const r = snapToSentences(2, 6, c)
    expect(c.words[r.first].w).toBe('Heute')
    expect(c.words[r.last].w).toBe('Meier.')
    expect(r.path).toBe('sentence')
  })
  it('hält die Höchstlänge ein (Satz-Erweiterung verworfen)', () => {
    const c = ctx({ maxLen: 3.5 })
    const r = snapToSentences(2, 4, c)
    expect(c.words[r.last].end - c.words[r.first].start).toBeLessThanOrEqual(3.5 + 1e-9)
  })
  it('überlappt keine Nachbar-Clips', () => {
    const c = ctx()
    const prevEnd = c.words[4].end
    const r = snapToSentences(6, 9, { ...c, neighbors: [{ start: 0, end: prevEnd }] })
    expect(c.words[r.first].start).toBeGreaterThanOrEqual(prevEnd - 1e-6)
  })
  it('Abkürzung „Dr.“ beendet keinen Satz', () => {
    const c = ctx()
    const r = snapToSentences(6, 6, c) // Wort „zumindest“ → Satz „Das sagt zumindest Dr. Meier.“
    expect(c.words[r.last].w).toBe('Meier.')
  })
})

describe('Stufe 3: Stille', () => {
  it('rückt Beginn in die Stille davor und Ende in die Stille danach, nie in Sprache', () => {
    const fws = 10
    const lwe = 20
    const r = snapToSilence({ start: fws, end: lwe }, fws, lwe, ctx({ silences: [[9.6, 9.9], [20.1, 20.6]] }))
    expect(r.start).toBeCloseTo(9.86, 2)
    expect(r.start).toBeLessThanOrEqual(fws)
    expect(r.end).toBeGreaterThanOrEqual(lwe)
    expect(r.end).toBeLessThanOrEqual(lwe + 0.6)
  })
  it('lässt Grenzen ohne nahe Stille am Wort (nur kleiner Nachlauf)', () => {
    const r = snapToSilence({ start: 10, end: 20 }, 10, 20, ctx({ silences: [[5, 6], [30, 31]] }))
    expect(r.start).toBe(10)
    expect(r.end).toBeCloseTo(20.08, 5)
  })
  it('Endschutz: höchstens 0,6 s Nachlauf, auch bei langer Stille', () => {
    const r = snapToSilence({ start: 10, end: 20 }, 10, 20, ctx({ silences: [[20.05, 25]] }))
    expect(r.end).toBeLessThanOrEqual(20.6 + 1e-9)
  })
})

describe('Stufe 4: Kamerawechsel', () => {
  it('rastet auf einen Schnitt ≤ 0,5 s ein, wenn keine Sprache angeschnitten wird', () => {
    const r = snapToCuts({ start: 9.9, end: 20.3 }, 10, 20, [9.6, 20.45])
    expect(r.start).toBe(9.6)
    expect(r.end).toBe(20.45)
  })
  it('ignoriert weiter entfernte Schnitte und solche mitten in Sprache', () => {
    const r = snapToCuts({ start: 9.9, end: 20.3 }, 10, 20, [8.5, 10.2, 19.8, 22])
    expect(r.start).toBe(9.9)
    expect(r.end).toBe(20.3)
  })
})

describe('Gesamt: snapClip', () => {
  it('liefert Grenzen, die nie ein Wort anschneiden und am Satzrand liegen', () => {
    const c = ctx({ silences: [[2.9, 3.4]], cuts: [] })
    const raw = { start: c.words[1].start + 0.1, end: c.words[5].end - 0.05 }
    const r = snapClip(raw, c)
    expect(r.start).toBeLessThanOrEqual(c.words[0].start)
    expect(r.end).toBeGreaterThanOrEqual(c.words[9].end - 1e-9) // „Meier.“
    expect(r.end - c.words[9].end).toBeLessThanOrEqual(0.6 + 1e-9)
    expect(r.path).toContain('sentence')
  })
  it('Fuzz: 200 zufällige Rohbereiche → nie Wort angeschnitten, immer innerhalb [0, Dauer]', () => {
    let seed = 7
    const rnd = (): number => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296 }
    const words = mk(Array.from({ length: 120 }, (_, i) => (i % 9 === 8 ? `wort${i}.` : `wort${i}`)).join(' '))
    const sentences = splitSentences(words)
    const dur = words[words.length - 1].end + 2
    const silences: Array<[number, number]> = []
    for (let i = 0; i < words.length - 1; i++) if (words[i + 1].start - words[i].end > 0.4) silences.push([words[i].end + 0.05, words[i + 1].start - 0.05])
    const cuts = Array.from({ length: 20 }, () => rnd() * dur)
    for (let n = 0; n < 200; n++) {
      const a = rnd() * (dur - 10)
      const raw = { start: a, end: a + 5 + rnd() * 40 }
      const r = snapClip(raw, { words, sentences, silences, cuts, durationSec: dur })
      expect(r.start).toBeGreaterThanOrEqual(0)
      expect(r.end).toBeLessThanOrEqual(dur)
      const inside = words.filter((w) => w.start >= r.start - 1e-6 && w.end <= r.end + 1e-6)
      const cutWords = words.filter((w) => (w.start < r.start - 1e-6 && w.end > r.start + 1e-6) || (w.start < r.end - 1e-6 && w.end > r.end + 1e-6))
      expect(cutWords).toHaveLength(0)
      expect(inside.length).toBeGreaterThan(0)
      // Beginn = Satzanfang, Ende = Satzende (außer Rückfall wegen Höchstlänge)
      const first = words.indexOf(inside[0])
      const last = words.indexOf(inside[inside.length - 1])
      if (r.end - r.start <= 90) {
        expect(sentences.some((s) => s.first === first)).toBe(true)
        expect(sentences.some((s) => s.last === last)).toBe(true)
      }
    }
  })
})

describe('TransNetV2-Dekodierung', () => {
  it('nimmt je Lauf ≥ 0,5 den Peak, Zeit = (Peak+1)/25', () => {
    const p = new Float32Array(100)
    p[10] = 0.6; p[11] = 0.98; p[12] = 0.7
    p[50] = 0.5
    expect(decodeBoundaries(p)).toEqual([12 / 25, 51 / 25])
  })
})

describe('Signale', () => {
  function wav(seconds: number, fn: (t: number) => number): Buffer {
    const n = seconds * 16000
    const b = Buffer.alloc(44 + n * 2)
    b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22)
    b.writeUInt32LE(16000, 24); b.writeUInt32LE(32000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40)
    for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(fn(i / 16000) * 32767), 44 + i * 2)
    return b
  }
  it('findet Stille und normalisiert unabhängig vom Pegel', () => {
    const tone = (amp: number) => (t: number) => (t >= 2 && t < 3 ? 0 : amp * Math.sin(2 * Math.PI * 220 * t))
    const quiet = frameDb(wav(5, tone(0.02)))
    const loud = frameDb(wav(5, tone(0.5)))
    const sq = silentIntervals(quiet, -80)
    const sl = silentIntervals(loud, -80)
    expect(sq).toHaveLength(1)
    expect(sq[0][0]).toBeCloseTo(2, 1)
    expect(sq[0][1]).toBeCloseTo(3, 1)
    expect(sl).toHaveLength(1)
    const nq = normalize(Array.from(quiet.slice(0, 200)))
    const nl = normalize(Array.from(loud.slice(0, 200)))
    expect(Math.max(...nq)).toBeCloseTo(Math.max(...nl), 1)
  })
  it('liefert Sekundenraster gleicher Länge', () => {
    const db = frameDb(wav(10, (t) => 0.1 * Math.sin(2 * Math.PI * 200 * t)))
    const s = computeSignals(db, [{ w: 'a', start: 1, end: 1.3 }], 10)
    expect(s.loudness).toHaveLength(10)
    expect(s.rate).toHaveLength(10)
    expect(s.burst).toHaveLength(10)
    expect(s.silence).toHaveLength(10)
  })
})
