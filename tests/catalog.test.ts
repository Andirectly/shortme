import { describe, expect, it } from 'vitest'
import { entryKey, mergeEntries, parseCatalog, ratingCounts, remoteCandidates, sameEntries, syncEntries, videoKey, type CatalogEntries, type CatalogEntry, type Remote } from '../src/shared/catalog'

const e = (video: string, start: number, level: CatalogEntry['level'], at: string, machine = 'A'): CatalogEntry => ({ key: entryKey(video, start, start + 30), video, videoTitle: 'T', clipId: `clip-${start * 10}`, start, end: start + 30, title: 't', text: 'x', criteria: null, level, reasons: [], at, machine })
const map = (...l: CatalogEntry[]): Record<string, CatalogEntry> => Object.fromEntries(l.map((x) => [x.key, x]))

describe('Video-Schlüssel', () => {
  it('derselbe Link auf zwei Rechnern ergibt denselben Schlüssel', () => {
    expect(videoKey({ hash: 'a', twitch: { vodId: '2923337293' } })).toBe('twitch:2923337293')
    expect(videoKey({ hash: 'b', sourceUrl: 'https://www.youtube.com/watch?v=aygNPo4LxDs&t=6s' })).toBe('yt:aygNPo4LxDs')
    expect(videoKey({ hash: 'c', sourceUrl: 'https://youtu.be/aygNPo4LxDs' })).toBe('yt:aygNPo4LxDs')
    expect(videoKey({ hash: 'd' })).toBe('file:d')
  })
})

describe('Katalog zusammenführen', () => {
  it('die jüngere Bewertung gewinnt, Rücknahmen (null) auch', () => {
    const a = map(e('v', 10, 'bad', '2026-11-01T10:00:00Z'), e('v', 50, 'mid', '2026-11-01T10:00:00Z'))
    const b = map(e('v', 10, 'strong', '2026-11-02T10:00:00Z', 'B'), e('v', 50, null, '2026-11-03T10:00:00Z', 'B'), e('w', 5, 'bad', '2026-11-02T10:00:00Z', 'B'))
    const m = mergeEntries(a, b)
    expect(m[e('v', 10, null, '').key].level).toBe('strong')
    expect(m[e('v', 50, null, '').key].level).toBeNull()
    expect(Object.keys(m)).toHaveLength(3)
    expect(ratingCounts(m)).toEqual({ strong: 1, mid: 0, bad: 1 })
  })
  it('Reihenfolge egal, gleicher Stand erkannt', () => {
    const a = map(e('v', 10, 'bad', '2026-11-01T10:00:00Z'))
    const b = map(e('v', 10, 'strong', '2026-11-02T10:00:00Z'), e('w', 1, 'mid', '2026-11-02T10:00:00Z'))
    expect(sameEntries(mergeEntries(a, b), mergeEntries(b, a))).toBe(true)
    expect(sameEntries(a, b)).toBe(false)
  })
})

/** Simuliertes GitHub-Repo mit SHA-Prüfung; `racer` schreibt zwischen Holen und Schreiben dazwischen (anderer Rechner). */
function fakeRepo(initial: CatalogEntries = {}, racer?: () => CatalogEntries): { remote: Remote; state: { entries: CatalogEntries; sha: string; pushes: number } } {
  const state = { entries: initial, sha: 'sha0', pushes: 0 }
  let raced = false
  const remote: Remote = {
    pull: async () => ({ entries: { ...state.entries }, sha: Object.keys(state.entries).length ? state.sha : null }),
    push: async (entries, sha) => {
      if (racer && !raced) { raced = true; state.entries = racer(); state.sha = 'sha-race' }
      if ((sha ?? null) !== (Object.keys(state.entries).length ? state.sha : null)) return 'conflict'
      state.entries = entries; state.sha = `sha${++state.pushes}`
      return 'ok'
    }
  }
  return { remote, state }
}

describe('Abgleich zwischen zwei Rechnern', () => {
  it('A schreibt, B holt und ergänzt, A sieht beides', async () => {
    const repo = fakeRepo()
    const a1 = await syncEntries(map(e('v', 10, 'strong', '2026-11-01T10:00:00Z', 'A')), repo.remote)
    expect(a1.pushed).toBe(true)
    const b = await syncEntries(map(e('w', 5, 'bad', '2026-11-02T10:00:00Z', 'B')), repo.remote)
    expect(Object.keys(b.merged)).toHaveLength(2)
    const a2 = await syncEntries(a1.merged, repo.remote)
    expect(Object.keys(a2.merged)).toHaveLength(2)
    expect(ratingCounts(a2.merged)).toEqual({ strong: 1, mid: 0, bad: 1 })
  })
  it('nichts zu tun: kein Schreiben, auch bei leerem Repo', async () => {
    const repo = fakeRepo()
    expect((await syncEntries({}, repo.remote)).pushed).toBe(false)
    expect(repo.state.pushes).toBe(0)
    const same = fakeRepo(map(e('v', 10, 'mid', '2026-11-01T10:00:00Z')))
    expect((await syncEntries(map(e('v', 10, 'mid', '2026-11-01T10:00:00Z')), same.remote)).pushed).toBe(false)
  })
  it('Konflikt: anderer Rechner war schneller → neu holen, zusammenführen, nichts geht verloren', async () => {
    const repo = fakeRepo(map(e('v', 10, 'mid', '2026-11-01T10:00:00Z', 'B')), () => map(e('v', 10, 'mid', '2026-11-01T10:00:00Z', 'B'), e('x', 1, 'bad', '2026-11-03T10:00:00Z', 'B')))
    const r = await syncEntries(map(e('w', 5, 'strong', '2026-11-02T10:00:00Z', 'A')), repo.remote)
    expect(r.pushed).toBe(true)
    expect(Object.keys(repo.state.entries).sort()).toEqual([e('v', 10, null, '').key, e('w', 5, null, '').key, e('x', 1, null, '').key].sort())
  })
  it('zweimal Konflikt → klare Meldung statt Datenverlust', async () => {
    const remote: Remote = { pull: async () => ({ entries: {}, sha: 's' }), push: async () => 'conflict' }
    await expect(syncEntries(map(e('v', 10, 'bad', '2026-11-01T10:00:00Z')), remote)).rejects.toThrow(/kollidierte/)
  })
  it('Rücknahme einer Bewertung erreicht den anderen Rechner', async () => {
    const repo = fakeRepo()
    await syncEntries(map(e('v', 10, 'bad', '2026-11-01T10:00:00Z', 'A')), repo.remote)
    const b0 = await syncEntries({}, repo.remote)
    expect(ratingCounts(b0.merged).bad).toBe(1)
    await syncEntries(map(e('v', 10, null, '2026-11-02T10:00:00Z', 'A')), repo.remote)
    const b1 = await syncEntries(b0.merged, repo.remote)
    expect(ratingCounts(b1.merged).bad).toBe(0)
  })
})

describe('Fremde Datei', () => {
  it('ungültige Einträge werden verworfen', () => {
    const ok = e('v', 10, 'mid', '2026-11-01T10:00:00Z')
    const p = parseCatalog({ version: 1, entries: { [ok.key]: ok, kaputt: { video: 1 }, auch: { video: 'v', at: 'x', start: 1, end: 2, level: 'super' }, '<b>': 'text' } })
    expect(Object.keys(p)).toEqual([ok.key])
    expect(parseCatalog(null)).toEqual({})
    expect(parseCatalog({ entries: 5 })).toEqual({})
  })
})

describe('Bewertungen anderer Rechner im Datensatz', () => {
  it('nur Videos ohne lokales Projekt, zurückgenommene fehlen', () => {
    const m = map(e('v', 10, 'strong', '2026-11-01T10:00:00Z'), e('w', 10, 'bad', '2026-11-01T10:00:00Z'), e('w', 60, null, '2026-11-01T10:00:00Z'))
    const c = remoteCandidates(m, new Set(['v']))
    expect(c).toHaveLength(1)
    expect(c[0].vid).toBe('cat:w')
    expect(c[0].rating?.level).toBe('bad')
    expect(['train', 'test']).toContain(c[0].split)
  })
})
