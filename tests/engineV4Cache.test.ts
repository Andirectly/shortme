import { copyFileSync, mkdtempSync, existsSync, utimesSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// eigener Datenordner, bevor die App-Module ihre Pfade bestimmen
const data = mkdtempSync(join(tmpdir(), 'shortme-v4-cache-'))
process.env.SHORTME_DATA = data

describe('V4 Stufen-Caches werden bei Änderungen ungültig (V4-043)', () => {
  it('Quell-Probe: gleiche Datei → Cache, geänderte Datei (mtime) → neu gemessen', async () => {
    const { probeSource } = await import('../src/main/shortme/clips/engines/v4/media')
    const src = join(data, 'src.mp4')
    copyFileSync('test-videos/solo.mp4', src)
    const a = await probeSource('cachetest', src)
    expect(a.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(existsSync(join(data, 'projects', 'cachetest', 'analysis', 'shared', 'source-v4.json'))).toBe(true)
    const b = await probeSource('cachetest', src)
    expect(b.probedAt).toBe(a.probedAt)
    const t = new Date(Date.now() + 5000)
    utimesSync(src, t, t)
    const c = await probeSource('cachetest', src)
    expect(c.probedAt).not.toBe(a.probedAt)
    expect(c.sha256).toBe(a.sha256)
  }, 60_000)
  it('Embedding-Index: Fingerabdruck hängt an Modellrevision und Abtastung, nicht an Anfragen', async () => {
    const { indexFingerprint } = await import('../src/main/shortme/clips/engines/v3/embedIndex')
    const { V3_PROFILE_CONFIG } = await import('../src/main/shortme/clips/engines/v3/revisions')
    const f1 = indexFingerprint('h', 60, V3_PROFILE_CONFIG.balanced)
    expect(indexFingerprint('h', 60, V3_PROFILE_CONFIG.balanced)).toBe(f1)
    expect(indexFingerprint('h', 60, V3_PROFILE_CONFIG.deep)).not.toBe(f1)
    expect(indexFingerprint('h2', 60, V3_PROFILE_CONFIG.balanced)).not.toBe(f1)
    expect(readFileSync('src/main/shortme/clips/engines/v3/embedIndex.ts', 'utf8')).toMatch(/V3_EMBED_MODEL\.revision/)
  })
  it('Stufen-Checkpoints: gleicher Schlüssel → Übernahme, andere Revision → neuer Schlüssel (Fortsetzen ohne falsche Treffer)', async () => {
    const { checkpointKey, loadCheckpoint, saveCheckpoint } = await import('../src/main/shortme/clips/engines/v4/checkpoint')
    const k1 = checkpointKey(['sha', 'g1', 'balanced', 'v4-inv-2', 'rev'])
    expect(checkpointKey(['sha', 'g1', 'balanced', 'v4-inv-2', 'rev'])).toBe(k1)
    expect(checkpointKey(['sha', 'g1', 'balanced', 'v4-inv-3', 'rev'])).not.toBe(k1)
    expect(await loadCheckpoint('cachetest', 'inv', k1)).toBeNull()
    await saveCheckpoint('cachetest', 'inv', k1, { calls: 2 })
    expect(await loadCheckpoint('cachetest', 'inv', k1)).toEqual({ calls: 2 })
  })
  it('Engine-4-Fingerabdruck des Laufs enthält Prompt-, Anfragen- und Kantenrevision', async () => {
    const { v4Revisions } = await import('../src/main/shortme/clips/engines/v4/revisions')
    const r = v4Revisions('balanced').join(' ')
    for (const k of ['v4-inv-3', 'v4-cut-2', 'v4-final-3', 'v4-queries-1', 'v4-edges-1', 'profile:balanced']) expect(r).toContain(k)
  })
})
