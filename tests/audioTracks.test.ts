import { describe, expect, it } from 'vitest'
import { outTimeOf, placeAudio, type AudioClip } from '../src/shared/audioMix'
import { baseState, reduce } from '../src/shared/edits'
import { buildFilterGraph } from '../src/main/shortme/render/graph'

const keeps = [{ src0: 100, src1: 110, out0: 0 }, { src0: 112, src1: 120, out0: 10 }] // Lücke 110–112 entfernt, Ausgabe 18 s
const clip = (o: Partial<AudioClip>): AudioClip => ({ id: 'a', file: 'a.wav', name: 'A', at: 105, dur: 2, gainDb: 0, kind: 'sfx', ...o })

describe('Tonspuren', () => {
  it('Quellzeit → Ausgabezeit, Lücken springen zum nächsten Abschnitt', () => {
    expect(outTimeOf(105, keeps)).toBe(5)
    expect(outTimeOf(111, keeps)).toBe(10)
    expect(outTimeOf(115, keeps)).toBe(13)
    expect(outTimeOf(130, keeps)).toBe(18)
  })
  it('platziert, kürzt am Clipende und am Clipbeginn, verwirft Stummes', () => {
    expect(placeAudio([clip({})], keeps, 18)).toEqual([{ file: 'a.wav', delay: 5, offset: 0, len: 2, gainDb: 0 }])
    expect(placeAudio([clip({ at: 117, dur: 5 })], keeps, 18)[0]).toMatchObject({ delay: 15, len: 3 })
    expect(placeAudio([clip({ at: 98, dur: 5 })], keeps, 18)[0]).toMatchObject({ delay: 0, offset: 2, len: 3 })
    expect(placeAudio([clip({ gainDb: -40 }), clip({ at: 125 })], keeps, 18)).toEqual([])
  })
  it('Operationen: hinzufügen, verschieben, pegeln (begrenzt), entfernen, Originalton', () => {
    const b = baseState({ start: 100, end: 120, hookText: '' })
    let s = reduce(b, [{ t: 'audio', id: 'a', clip: clip({}) }, { t: 'audio', id: 'a', patch: { at: 107, gainDb: 40 } }, { t: 'voice', gainDb: -6 }])
    expect(s.audio[0]).toMatchObject({ at: 107, gainDb: 12 })
    expect(s.voiceDb).toBe(-6)
    s = reduce(s, [{ t: 'audio', id: 'a', remove: true }])
    expect(s.audio).toEqual([])
    expect(b.audio).toEqual([])
  })
  it('Graph: ohne Spuren unverändert, mit Spuren Mischung + Limiter, Eingänge nach dem Titel', () => {
    const piece = { src0: 10, src1: 20, out0: 0, zoom: 1, keep: 0, shot: { start: 0, end: 10, layout: 'fixed', cx: 0.5, zoom: 1 } } as never
    const o = { src: { width: 1920, height: 1080 }, base: 10, duration: 10, fadeOutSec: 0.25 }
    expect(buildFilterGraph([piece], { ...o, mix: { first: 1, tracks: [], voiceDb: 0 } })).toBe(buildFilterGraph([piece], o))
    const g = buildFilterGraph([piece], { ...o, mix: { first: 2, tracks: [{ file: 'a.wav', delay: 1.5, offset: 0, len: 2, gainDb: -6 }], voiceDb: -3 } })
    expect(g).toContain('[2:a]atrim=start=0.000:duration=2.000')
    expect(g).toContain('volume=-6.0dB')
    expect(g).toContain('adelay=1500:all=1[x0]')
    expect(g).toContain('volume=-3.0dB[av]')
    expect(g).toMatch(/\[av\]\[x0\]amix=inputs=2:duration=first:dropout_transition=0:normalize=0,alimiter=limit=0\.95:level=0,afade=t=out:st=9\.750:d=0\.25\[a\]/)
  })
})
