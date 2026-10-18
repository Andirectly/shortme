import { describe, expect, it } from 'vitest'
import { applyPersons, clusterEmbeddings, personConfidence } from '../src/main/shortme/clips/persons'
import { activeSpeakers, type PlanInput } from '../src/shared/layoutPlan'

const vec = (...v: number[]): Float32Array => { const n = Math.hypot(...v); return Float32Array.from(v.map((x) => x / n)) }
const A = vec(1, 0.1, 0), A2 = vec(1, 0.2, 0.05), B = vec(0, 1, 0.1), B2 = vec(0.1, 1, 0)

describe('Personen', () => {
  it('gruppiert ähnliche Embeddings', () => {
    const g = clusterEmbeddings([A, B, A2, B2].map((emb) => ({ emb, sec: 5 })))
    expect(g.map((x) => [...x].sort())).toEqual(expect.arrayContaining([[0, 2], [1, 3]]))
  })
  it('Cannot-link trennt gleichzeitig sichtbare Tracks', () => {
    const items = [A, A2].map((emb) => ({ emb, sec: 5 }))
    expect(clusterEmbeddings(items, { cannotLink: () => true })).toHaveLength(2)
  })
  it('Sicherheit sinkt, wenn mehr Personen gleichzeitig sichtbar sind als Cluster', () => {
    const items = [A, A2, B, B2].map((emb) => ({ emb, sec: 5 }))
    const c = clusterEmbeddings(items)
    expect(personConfidence(items, c, 2)).toBeGreaterThan(0.6)
    expect(personConfidence(items, c, 3)).toBeLessThan(0.6)
  })
})

describe('Rollen im Planer', () => {
  const ticks = 40
  const mk = (id: number, cx: number, s: number, person: string) => ({ id, start: 0, centres: Array(ticks).fill(cx), areas: Array(ticks).fill(0.05), scores: Array(ticks).fill(s), person })
  const base = (): PlanInput => ({ tracks: [mk(0, 0.3, 2, 'p1'), mk(1, 0.7, -0.2, 'p2')], ticks, dt: 0.2, cuts: [], sourceAspect: 16 / 9 })
  it('ignorierte Person wird nie Ziel', () => {
    const a = activeSpeakers({ ...base(), personRoles: { p1: 'ignore' } })
    expect(a.every((x) => x === 1)).toBe(true)
  })
  it('applyPersons trägt Personen ein', () => {
    const inp = applyPersons({ ...base(), tracks: base().tracks.map((t) => ({ ...t, person: undefined })) }, 'c', { version: 1, confirmed: true, confidence: 1, needsReview: false, persons: [{ id: 'p1', label: 'A', role: 'main', seconds: 9 }], assignment: { 'c:0': 'p1' } })
    expect(inp.tracks[0].person).toBe('p1')
    expect(inp.personRoles).toEqual({ p1: 'main' })
  })
})
