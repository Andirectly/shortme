import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// Synthetisches Projekt: 2 Clips (einer bewertet + korrigiert, einer gelöscht), 1 Creator-Short, Kandidaten-Spur
describe('Datensatz-Aufbau', () => {
  it('baut Kandidaten, Paare und Split aus Projektdateien', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ds-'))
    process.env.SHORTME_DATA = root
    const dir = join(root, 'projects', 'vid1')
    mkdirSync(join(dir, 'edits'), { recursive: true })
    const w = (n: string, v: unknown): void => writeFileSync(join(dir, n), JSON.stringify(v))
    const words = Array.from({ length: 400 }, (_, i) => ({ w: `w${i}`, start: i, end: i + 0.8 }))
    w('project.json', { hash: 'vid1', title: 'T', sourcePath: 'x.mp4', durationSec: 400, width: 1, height: 1, fps: 25, sizeBytes: 1, hasAudio: true, created: '', stages: {} })
    w('transcript.json', { version: 1, hash: 'vid1', model: 'm', durationSec: 400, words, segments: [{ start: 0, end: 399, text: 'x', first: 0, last: 399 }], speech: [], diarized: false, speakers: 1 })
    const crit = (n: number) => ({ hook: n, payoff: n, quotable: n, standalone: n, density: n })
    const clip = (id: string, a: number, b: number, n: number) => ({ id, start: a, end: b, firstWord: a, lastWord: b - 1, score: n, criteria: crit(n), title: id, hookText: 'h', reason: '', tags: [], source: 'llm', snap: [], extended: 0 })
    w('clips.json', { version: 1, hash: 'vid1', query: '', createdAt: '', mode: 'llm', clips: [clip('c1', 10, 50, 15), clip('c2', 100, 140, 6)] })
    w('ratings.json', { c1: { level: 'strong', reasons: [], at: '' }, c2: { level: 'bad', reasons: ['Langweilig'], at: '' } })
    w('edits/c1.json', { version: 1, clipId: 'c1', ops: [{ t: 'trim', start: 10, end: 54 }], cursor: 1 })
    w('candidates.json', [{ start: 300, end: 330, criteria: crit(9), title: 'x', fate: 'finalist' }])
    w('creator.json', { channel: 'K', shorts: [{ id: 's1', source: 'creator', title: '', views: 10, likes: 1, comments: 0, date: '2026-01-01', ratio: 1.4, moments: [{ start: 200, end: 230, score: 0.9 }] }] })
    const { rebuildDataset } = await import('../src/main/learn/dataset')
    const info = await rebuildDataset()
    expect(info.videos).toBe(1)
    const rows = (n: string): Array<Record<string, any>> => readFileSync(join(root, 'dataset', n), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
    const c = rows('candidates.jsonl')
    expect(c.map((x) => x.id).sort()).toEqual(['vid1:c1', 'vid1:c1#mine', 'vid1:c2', 'vid1:creator:s1:0', 'vid1:t3000'].sort())
    expect(c.find((x) => x.id === 'vid1:c1')!.corrections).toMatchObject({ endShift: 4 })
    const pairs = rows('pairs.jsonl').map((p) => `${p.source}:${p.a}>${p.b}`)
    expect(pairs).toContain('rating:vid1:c1>vid1:c2')
    expect(pairs).toContain('correction:vid1:c1#mine>vid1:c1')
    expect(pairs).toContain('creator:vid1:creator:s1:0>vid1:c2')
    expect(rows('videos.jsonl')[0]).toMatchObject({ vid: 'vid1', gt: null })
    expect(JSON.parse(readFileSync(join(root, 'dataset', 'split.json'), 'utf8')).vid1).toMatch(/train|test/)
  }, 60000)
})
