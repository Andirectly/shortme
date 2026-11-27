import { describe, expect, it } from 'vitest'
import { applyMoves, segmentsOf } from '../src/shared/segments'
import { baseState, liveAudio, reduce } from '../src/shared/edits'
import { outTimeOf, placeAudio, type AudioClip } from '../src/shared/audioMix'
import { TimeMap } from '../src/main/shortme/render/timeline'

describe('Videostücke', () => {
  it('Stücke aus Schnittpunkten (nur innerhalb des Clips)', () => {
    expect(segmentsOf(0, 30, [20, 10, 40])).toEqual([[0, 10], [10, 20], [20, 30]])
  })
  it('Verschieben: Stück nach vorn und ans Ende, Nachbarn verschmelzen, Ausgabezeit lückenlos', () => {
    const keeps = [{ src0: 0, src1: 30 }]
    expect(applyMoves(keeps, [{ start: 20, end: 30, before: 0 }])).toEqual([{ src0: 20, src1: 30, out0: 0 }, { src0: 0, src1: 20, out0: 10 }])
    expect(applyMoves(keeps, [{ start: 0, end: 10, before: null }])).toEqual([{ src0: 10, src1: 30, out0: 0 }, { src0: 0, src1: 10, out0: 20 }])
    // zurückschieben = wieder eine durchgehende Folge
    expect(applyMoves(keeps, [{ start: 20, end: 30, before: 0 }, { start: 20, end: 30, before: null }])).toEqual([{ src0: 0, src1: 30, out0: 0 }])
    // Schnitt (Lücke 12–14) bleibt erhalten
    expect(applyMoves([{ src0: 0, src1: 12 }, { src0: 14, src1: 30 }], [{ start: 20, end: 30, before: 0 }])).toEqual([{ src0: 20, src1: 30, out0: 0 }, { src0: 0, src1: 12, out0: 10 }, { src0: 14, src1: 20, out0: 22 }])
  })
  it('Wörter folgen verschobenen Stücken und bleiben nach Ausgabezeit sortiert', () => {
    const map = new TimeMap(applyMoves([{ src0: 0, src1: 30 }], [{ start: 20, end: 30, before: 0 }]))
    const w = map.words([{ start: 5, end: 5.4 }, { start: 25, end: 25.3 }, { start: 19.8, end: 20.3 }])
    expect(w.map((x) => [+x.start.toFixed(3), +x.end.toFixed(3)])).toEqual([[5, 5.3], [15, 15.4], [29.8, 30]])
    expect(outTimeOf(25, map.keeps)).toBe(5)
  })
  it('Ops: Schnittpunkt setzen/entfernen, Stück verschieben, Tonspur teilen', () => {
    const b = baseState({ start: 0, end: 30, hookText: '' })
    const clip: AudioClip = { id: 'a', file: 'a.wav', name: 'A', at: 2, dur: 6, gainDb: 0, kind: 'sfx' }
    const s = reduce(b, [{ t: 'split', at: 10 }, { t: 'split', at: 20 }, { t: 'split', at: 10, remove: true }, { t: 'moveSeg', move: { start: 20, end: 30, before: 0 } }, { t: 'audio', id: 'a', clip }, { t: 'audioSplit', id: 'a', at: 5, newId: 'b' }])
    expect(s.splits).toEqual([20])
    expect(s.moves).toHaveLength(1)
    expect(s.audio).toEqual([{ ...clip, dur: 3 }, { ...clip, id: 'b', at: 5, in: 3, dur: 3, fileDur: 6 }])
    // hinterer Teil spielt ab Sekunde 3 der Datei
    expect(placeAudio(s.audio.slice(1), [{ src0: 0, src1: 30, out0: 0 }], 30)).toEqual([{ file: 'a.wav', delay: 5, offset: 3, len: 3, gainDb: 0 }])
  })
})

describe('Schnitt durch alle Ebenen', () => {
  const b = baseState({ start: 0, end: 30, hookText: '' })
  const sfx: AudioClip = { id: 'a', file: 'a.wav', name: 'A', at: 2, dur: 20, gainDb: 0, kind: 'music' }
  const sfx2: AudioClip = { id: 'b', file: 'b.wav', name: 'B', at: 25, dur: 2, gainDb: 0, kind: 'sfx' }
  it('teilt Video und jede Tonspur unter dem Kopf in einem Schritt', () => {
    const s = reduce(b, [{ t: 'audio', id: 'a', clip: sfx }, { t: 'audio', id: 'b', clip: sfx2 }, { t: 'split', at: 10 }])
    expect(s.splits).toEqual([10])
    expect(s.audio.map((x) => [x.id, x.at, x.dur, x.in ?? 0])).toEqual([['a', 2, 8, 0], ['a.10000', 10, 12, 8], ['b', 25, 2, 0]])
  })
  it('außerhalb des Clips nur die Tonspur', () => {
    const s = reduce(b, [{ t: 'audio', id: 'a', clip: { ...sfx, at: 25, dur: 20 } }, { t: 'split', at: 40 }])
    expect(s.splits).toEqual([])
    expect(s.audio).toHaveLength(2)
  })
  it('gelöschtes Stück macht seine Tonstücke stumm, Wiederherstellen bringt sie zurück', () => {
    const cut = { start: 10, end: 20 }
    const s = reduce(b, [{ t: 'audio', id: 'a', clip: sfx }, { t: 'split', at: 10 }, { t: 'split', at: 20 }, { t: 'autoCuts', ranges: [cut], cut: true }])
    expect(liveAudio(s).map((x) => x.at)).toEqual([2, 20])
    expect(liveAudio(reduce(s, [{ t: 'autoCuts', ranges: [cut], cut: false }])).map((x) => x.at)).toEqual([2, 10, 20])
  })
})
