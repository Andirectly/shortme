import { describe, expect, it } from 'vitest'
import { CHAT_LAG_SEC, chatSpikes, parseChatJson, type ChatMsg } from '../src/main/twitch/chat'
import { chatLane } from '../src/main/shortme/clips/engines/v4/lanes'
import { fuseSeeds, laneWeights, type Seed } from '../src/main/shortme/clips/engines/v4/core'
import { lanesOfClip } from '../src/main/shortme/clips/engines/v4/laneWeights'

// Grundrauschen: 2 Schreiber je 10 s über 20 min
const base = (dur: number, per10 = 2): ChatMsg[] => Array.from({ length: Math.floor(dur / 10) * per10 }, (_, i) => ({ t: Math.floor(i / per10) * 10 + (i % per10), text: 'hi', user: `u${i % per10}` }))
const burst = (t: number, users: number, text = 'LUL'): ChatMsg[] => Array.from({ length: users }, (_, i) => ({ t: t + (i % 9), text, user: `b${i}` }))

describe('Chat-Spitzen (gleitende Basis, verschiedene Schreiber)', () => {
  it('viele Schreiber → Spitze, zeitlich um die Chat-Verzögerung zurückgerechnet, Lachen erkannt', () => {
    const s = chatSpikes([...base(1200), ...burst(600, 20)], 1200)
    expect(s.length).toBe(1)
    expect(s[0].start).toBe(600 - CHAT_LAG_SEC)
    expect(s[0].laugh).toBe(true)
    expect(s[0].chatters).toBeGreaterThanOrEqual(20)
  })
  it('Spam eines einzelnen Nutzers ergibt keine Spitze', () => {
    const spam = Array.from({ length: 80 }, (_, i) => ({ t: 600 + (i % 9), text: 'KEKW', user: 'spammer' }))
    expect(chatSpikes([...base(1200), ...spam], 1200)).toEqual([])
  })
  it('ohne Nutzernamen zählt derselbe Text höchstens 3×', () => {
    const spam = Array.from({ length: 80 }, (_, i) => ({ t: 600 + (i % 9), text: 'KEKW' }))
    expect(chatSpikes(spam, 1200)).toEqual([])
  })
  it('Basis ist lokal: in einem vollen Abschnitt zählt nur, was darüber hinausgeht', () => {
    const busy = base(1200, 12) // 12 Schreiber je 10 s
    expect(chatSpikes([...busy, ...burst(600, 8, 'wow')], 1200)).toEqual([]) // 12+8 < 1,8 × 12
    expect(chatSpikes([...busy, ...burst(600, 20, 'wow')], 1200).length).toBe(1)
  })
  it('Nutzer aus TwitchDownloader-JSON', () => {
    expect(parseChatJson({ comments: [{ content_offset_seconds: 3, commenter: { name: 'anna' }, message: { body: 'x' } }] })).toEqual([{ t: 3, text: 'x', user: 'anna' }])
  })
  it('Chat-Spur: ohne Chat keine Spur, sonst Seeds mit Kontext vor der Reaktion', () => {
    expect(chatLane(null, { duration: 100, max: 5 })).toBeNull()
    const l = chatLane([{ start: 50, end: 60, score: 0.8, chatters: 20, base: 2, laugh: false }], { duration: 100, max: 5 })!
    expect(l.seeds[0]).toMatchObject({ lane: 'chat', span: { start: 25, end: 70 } })
    expect(l.evidence[0].modality).toBe('chat')
  })
})

describe('Gelernte Spur-Gewichte', () => {
  const samples = (lane: 'speech' | 'chat', ok: number, bad: number) => [...Array(ok).fill({ lanes: [lane], ok: true }), ...Array(bad).fill({ lanes: [lane], ok: false })]
  it('unter 30 Entscheidungen: keine Gewichte', () => {
    expect(laneWeights(samples('speech', 10, 10))).toEqual({})
  })
  it('gute Spur > 1, schlechte < 1, begrenzt auf 0,7–1,3', () => {
    const w = laneWeights([...samples('speech', 5, 25), ...samples('chat', 25, 5)])
    expect(w.chat!).toBeGreaterThan(1)
    expect(w.speech!).toBeLessThan(1)
    expect(w.chat!).toBeLessThanOrEqual(1.3)
    expect(w.speech!).toBeGreaterThanOrEqual(0.7)
    expect(w.audio).toBeUndefined()
  })
  it('Gewicht verschiebt die Fusion', () => {
    const seed = (id: string, lane: Seed['lane'], anchor: number): Seed => ({ id, lane, laneRank: 0, anchor, span: { start: anchor - 5, end: anchor + 5 }, evidenceIds: [], hint: '', summary: '', laneScore: 1 })
    const seeds = [seed('a', 'speech', 10), seed('b', 'chat', 500)]
    expect(fuseSeeds(seeds)[0].lanes).toEqual(['speech']) // gleich stark → früherer Anker
    expect(fuseSeeds(seeds, 60, { speech: 0.8 })[0].lanes).toEqual(['chat'])
  })
  it('Spuren aus der Clip-Notiz (Engine 4 und Engine Mac)', () => {
    expect(lanesOfClip({ v2: { eventNote: 'Engine 4 · Lanes audio+speech · 2 Untersuchungen' } } as never)).toEqual(['audio', 'speech'])
    expect(lanesOfClip({ v2: { eventNote: 'Engine Mac · Suchwege chat+cross-modal · LFM3' } } as never)).toEqual(['chat', 'cross-modal'])
    expect(lanesOfClip({} as never)).toEqual([])
  })
})
