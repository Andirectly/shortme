import { describe, expect, it } from 'vitest'
import { stageClock } from '../src/main/shortme/jobs'

describe('Laufzeit je Stufe', () => {
  it('summiert Stufen (auch wiederkehrende) und die Gesamtzeit', () => {
    let t = 0
    const c = stageClock(() => t)
    t = 2; c.mark('asr')
    t = 12; c.mark('asr') // gleiche Stufe: kein Wechsel
    t = 20; c.mark('candidates')
    t = 50; c.mark('asr')
    t = 55
    const r = c.timing()
    expect(r.totalSec).toBe(0.1) // Millisekunden-Uhr: 55 ms
    expect(r.stages).toEqual([{ stage: 'asr', sec: 0 }, { stage: 'candidates', sec: 0 }])
  })
  it('in Sekunden', () => {
    let t = 0
    const c = stageClock(() => t)
    t = 1000; c.mark('asr')
    t = 61_000; c.mark('compare')
    t = 91_000; c.mark('asr')
    t = 95_000
    expect(c.timing()).toEqual({ totalSec: 95, stages: [{ stage: 'asr', sec: 64 }, { stage: 'compare', sec: 30 }] })
  })
})
