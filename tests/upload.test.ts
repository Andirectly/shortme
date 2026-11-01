import { describe, expect, it } from 'vitest'
import { checkTikTokFile, contentRange, draftsIn24h, planChunks, type UploadJob } from '../src/shared/upload'

const MIB = 1024 * 1024
const covers = (p: ReturnType<typeof planChunks>): boolean => p.ranges[0][0] === 0 && p.ranges.at(-1)![1] === p.videoSize - 1 && p.ranges.every((r, i) => i === 0 || r[0] === p.ranges[i - 1][1] + 1)

describe('Teilstück-Planung', () => {
  it('unter 5 MiB: ein Stück, chunk_size = video_size', () => {
    const p = planChunks(3_000_000)
    expect([p.total, p.chunkSize, p.ranges]).toEqual([1, 3_000_000, [[0, 2_999_999]]])
    expect(contentRange(p.ranges[0], p.videoSize)).toBe('bytes 0-2999999/3000000')
  })
  it('zwischen 5 und 10 MiB: ebenfalls ein Stück mit chunk_size = video_size', () => {
    const p = planChunks(7 * MIB)
    expect([p.total, p.chunkSize]).toEqual([1, 7 * MIB])
  })
  it('Beispiel aus der Doku: 50.000.123 Byte, 10.000.000 → 5 Stücke, letztes 10.000.123', () => {
    const p = planChunks(50_000_123, 10_000_000)
    expect(p.total).toBe(5)
    expect(p.chunkSize).toBe(10_000_000)
    const last = p.ranges[4]
    expect(last[1] - last[0] + 1).toBe(10_000_123)
    expect(covers(p)).toBe(true)
  })
  it('Standard 10 MiB, Rest im letzten Stück', () => {
    const p = planChunks(35 * MIB + 5)
    expect([p.total, p.chunkSize]).toEqual([3, 10 * MIB])
    expect(covers(p)).toBe(true)
  })
  it('große Datei: Stückgröße wird angehoben, höchstens 1000 Stück, letztes ≤ 128 MB', () => {
    const p = planChunks(4 * 1024 * MIB)
    expect(p.total).toBeLessThanOrEqual(1000)
    expect(p.chunkSize).toBeLessThanOrEqual(64 * MIB)
    const last = p.ranges.at(-1)!
    expect(last[1] - last[0] + 1).toBeLessThanOrEqual(128 * MIB)
    expect(covers(p)).toBe(true)
  })
  it('leere Datei wird abgelehnt', () => { expect(() => planChunks(0)).toThrow() })
})

describe('Dateiprüfung', () => {
  const ok = { ext: '.mp4', size: 20 * MIB, durationSec: 55, width: 1080, height: 1920, fps: 30 }
  it('gültig', () => { expect(checkTikTokFile(ok)).toEqual([]) })
  it('Verstöße werden benannt', () => {
    expect(checkTikTokFile({ ...ok, ext: '.avi' })).toHaveLength(1)
    expect(checkTikTokFile({ ...ok, durationSec: 700 })[0]).toMatch(/10 Minuten/)
    expect(checkTikTokFile({ ...ok, width: 200, height: 300 })[0]).toMatch(/Auflösung/)
    expect(checkTikTokFile({ ...ok, fps: 15 })[0]).toMatch(/Bildrate/)
  })
})

describe('Tageslimit', () => {
  const job = (state: UploadJob['state'], ageH: number): UploadJob => ({ id: String(Math.random()), exportId: 'e', platform: 'tiktok', state, progress: 1, message: '', caption: '', createdAt: new Date(Date.now() - ageH * 3600_000).toISOString() })
  it('zählt nur Entwürfe der letzten 24 h', () => {
    expect(draftsIn24h([job('entwurf', 1), job('entwurf', 23), job('entwurf', 25), job('fehler', 1)], 'tiktok')).toBe(2)
  })
})

import { runUpload, type PutResult, type Resume, type UploadDeps } from '../src/main/upload/tiktokUpload'
describe('Upload-Ablauf', () => {
  const plan = planChunks(35 * MIB) // 3 Stücke
  const mk = (puts: PutResult[], t = { v: 1_000_000 }): { deps: UploadDeps; calls: { init: number; put: number[] } } => {
    const calls = { init: 0, put: [] as number[] }
    const deps: UploadDeps = {
      init: async () => ({ publishId: `p${++calls.init}`, uploadUrl: `u${calls.init}` }),
      put: async (_u, _p, i) => { calls.put.push(i); return puts.shift() ?? { status: 206 } },
      now: () => t.v, sleep: async () => undefined
    }
    return { deps, calls }
  }
  it('normaler Lauf: 3 Stücke, eine Initialisierung', async () => {
    const { deps, calls } = mk([{ status: 206 }, { status: 206 }, { status: 201 }])
    const r = await runUpload(plan, undefined, deps, () => undefined)
    expect([r.chunksDone, calls.init, calls.put]).toEqual([3, 1, [0, 1, 2]])
  })
  it('Fortsetzen beim letzten bestätigten Stück ohne neue Initialisierung', async () => {
    const { deps, calls } = mk([{ status: 201 }])
    const resume: Resume = { publishId: 'x', uploadUrl: 'ux', initAt: 999_000, chunksDone: 2 }
    await runUpload(plan, resume, deps, () => undefined)
    expect([calls.init, calls.put]).toEqual([0, [2]])
  })
  it('Adresse älter als 1 h: neue Initialisierung, Start bei 0', async () => {
    const { deps, calls } = mk([], { v: 5_000_000 })
    await runUpload(plan, { publishId: 'x', uploadUrl: 'ux', initAt: 0, chunksDone: 2 }, deps, () => undefined)
    expect([calls.init, calls.put]).toEqual([1, [0, 1, 2]])
  })
  it('403 → neu initialisieren und von vorn; zweites 403 → Abbruch nach zwei Initialisierungen', async () => {
    const a = mk([{ status: 403 }])
    await runUpload(plan, undefined, a.deps, () => undefined)
    expect(a.calls.init).toBe(2)
    const b = mk([{ status: 403 }, { status: 404 }])
    await expect(runUpload(plan, undefined, b.deps, () => undefined)).rejects.toThrow(/zweimal/)
  })
  it('416 mit Content-Range setzt beim bestätigten Stück fort', async () => {
    const { deps, calls } = mk([{ status: 206 }, { status: 416, received: plan.ranges[1][1] }])
    const r = await runUpload(plan, undefined, deps, () => undefined)
    expect([r.chunksDone, calls.init]).toEqual([3, 1])
  })
  it('5xx wird je Stück höchstens dreimal wiederholt', async () => {
    const { deps } = mk([{ status: 500 }, { status: 500 }, { status: 500 }, { status: 500 }])
    await expect(runUpload(plan, undefined, deps, () => undefined)).rejects.toThrow(/Fehler 500/)
  })
})

import { matchStats } from '../src/main/upload/stats'
describe('Aufrufzahlen zuordnen (vorbereitet)', () => {
  it('Bildunterschrift (ohne Hashtags) + Zeitpunkt', () => {
    const job: UploadJob = { id: 'j', exportId: 'e', platform: 'tiktok', state: 'entwurf', progress: 1, message: '', caption: 'Das glaubst du nie\n\n#lustig #clip', createdAt: new Date(1_000_000).toISOString() }
    const stat = { id: 'v', description: 'Das glaubst du nie #fyp', createdAt: 2_000_000, views: 5, likes: 1, comments: 0, shares: 0 }
    expect(matchStats([job], [stat])).toHaveLength(1)
    expect(matchStats([job], [{ ...stat, createdAt: 500_000 }])).toHaveLength(0)
    expect(matchStats([job], [{ ...stat, description: 'anderer Text' }])).toHaveLength(0)
  })
})
