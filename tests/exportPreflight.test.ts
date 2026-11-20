import { describe, expect, it } from 'vitest'
import { blocks, needsConfirm, preflight } from '../src/shared/preflight'

const plan = (duration: number, shots: Array<{ start: number; end: number; auto?: 'empty' }> = []) => ({ start: 100, duration, shots: shots.map((s) => ({ ...s, layout: 'fixed' as const, cx: 0.5, zoom: 1 })) })

describe('Export-Vorabprüfung (nur messbare Befunde)', () => {
  it('sauberer Clip: nichts', () => {
    expect(preflight({ hasSource: true, plan: plan(30), words: 40, captions: true })).toEqual([])
  })
  it('fehlende Quelle blockiert; Person fehlt → Warnung mit Sprungstelle', () => {
    const r = preflight({ hasSource: false, plan: plan(30, [{ start: 0, end: 10 }, { start: 10, end: 20, auto: 'empty' }]), words: 40, captions: true })
    expect(blocks(r)).toBe(true)
    expect(r.find((x) => x.id === 'empty')?.at).toBe(110)
  })
  it('Länge, fehlende Untertitel, verworfen, KI-Befund', () => {
    const r = preflight({ hasSource: true, plan: plan(200), words: 0, captions: true, review: { status: 'verworfen' }, quality: { status: 'bitte_pruefen', findings: ['payoff: unknown'] } })
    expect(r.map((x) => `${x.id}:${x.level}`)).toEqual(['long:warnung', 'nocaps:warnung', 'discarded:warnung', 'ai:hinweis'])
    expect(needsConfirm(r)).toBe(true)
    expect(blocks(r)).toBe(false)
  })
  it('nur Hinweise → keine Rückfrage; ohne Untertitel keine Untertitel-Warnung', () => {
    const r = preflight({ hasSource: true, plan: plan(100), words: 0, captions: false })
    expect(r.map((x) => x.level)).toEqual(['hinweis'])
    expect(needsConfirm(r)).toBe(false)
  })
})
