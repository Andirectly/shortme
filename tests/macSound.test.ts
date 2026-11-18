import { describe, expect, it, vi } from 'vitest'
vi.mock('electron', () => ({ app: { isPackaged: false } }))
import { musicWindows, soundEvents, soundProposals, type SoundWindow } from '../src/main/shortme/clips/engines/mac/sound'

const w = (t: number, c: Record<string, number>): SoundWindow => ({ t, d: 1.5, c })

describe('Apple-SoundAnalysis-Ereignisse', () => {
  it('Hysterese: Start ≥ 0.5, läuft bis < 0.3, verbindet Lücken ≤ 1 s, Gruppen getrennt', () => {
    const wins = [w(0, { speech: 0.9 }), w(10, { laughter: 0.6 }), w(10.75, { belly_laugh: 0.35 }), w(11.5, { laughter: 0.1 }), w(13, { laughter: 0.55 }), w(40, { applause: 0.7 })]
    const ev = soundEvents(wins)
    const laugh = ev.filter((e) => e.group === 'laugh')
    // 10–12.25 und 13–14.5 liegen 0.75 s auseinander → ein Ereignis
    expect(laugh).toEqual([{ group: 'laugh', start: 10, end: 14.5, peak: 0.6, labels: ['laughter', 'belly_laugh'] }])
    expect(ev.find((e) => e.group === 'cheer')).toMatchObject({ start: 40, end: 41.5, peak: 0.7 })
  })
  it('schwache Werte (< 0.5) starten kein Ereignis, kaputte Fenster werden ignoriert', () => {
    expect(soundEvents([w(5, { laughter: 0.45 }), { t: Number.NaN, d: 1.5, c: { laughter: 1 } }, { t: 3, d: 0, c: { laughter: 1 } }])).toEqual([])
  })
  it('Vorschläge ohne Musik, mit Beleg und Vorlauf; Musik nur als „Sprache unsicher“', () => {
    const ev = soundEvents([w(100, { laughter: 0.8 }), w(200, { music: 0.9 })])
    const { proposals, evidence } = soundProposals(ev, 300, 10)
    expect(proposals).toHaveLength(1)
    expect(proposals[0]).toMatchObject({ start: 86, anchor: 100, source: 'audio', kind: 'witz', evidenceIds: ['as1'] })
    expect(evidence[0]).toMatchObject({ id: 'as1', state: 'signal-only', source: 'apple-soundanalysis' })
    const mus = Array.from({ length: 40 }, (_, i) => w(60 + i * 1.5, { music: 0.8, speech: 0.2 }))
    expect(musicWindows(mus, 180)).toEqual([{ start: 60, end: 120, share: 1 }])
  })
})
