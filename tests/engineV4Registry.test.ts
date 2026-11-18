import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ENGINE4_MANIFEST, ENGINE_IDS, ENGINE_LABEL, emptyAnalysisState, hasProfiles, enginesFor, newRunId, sanitizeAnalysisState } from '../src/shared/engine'
import { parseProbe } from '../src/main/shortme/clips/engines/v4/media'
import { V4_PROFILES, v4Revisions } from '../src/main/shortme/clips/engines/v4/revisions'

const src = (p: string): string => readFileSync(p, 'utf8')

describe('V4 Registrierung und Dispatcher (V4-001/003/004/005)', () => {
  it('fünf Engines, Engine 4 mit eigenem Manifest; je System nur die lauffähigen', () => {
    expect(ENGINE_IDS).toEqual(['legacy', 'multimodal-v2', 'adaptive-v3', 'engine4', 'engine-mac'])
    expect(enginesFor('win32')).toEqual(['legacy', 'multimodal-v2', 'adaptive-v3', 'engine4'])
    expect(enginesFor('darwin')).toEqual(['legacy', 'multimodal-v2', 'engine-mac'])
    expect(hasProfiles('engine-mac')).toBe(true)
    expect(ENGINE_LABEL.engine4).toBe('Engine 4')
    expect(ENGINE4_MANIFEST).toMatchObject({ id: 'engine4', pipelineVersion: '4.0', protocolVersion: 1 })
    expect(hasProfiles('engine4')).toBe(true)
  })
  it('Dispatcher schickt engine4 in den eigenen Orchestrator, nicht zu Engine 2/3', () => {
    const d = src('src/main/shortme/clips/engines/index.ts')
    expect(d).toMatch(/req\.engine === 'engine4'[\s\S]*import\('\.\/v4'\)[\s\S]*selectV4\(req\)/)
    const v4 = src('src/main/shortme/clips/engines/v4/index.ts')
    expect(v4).not.toMatch(/import[^\n]*(runPipeline|selectV3|selectV2)|(runPipeline|selectV3|selectV2)\(/)
    expect(v4).toMatch(/export async function selectV4/)
  })
  it('bestehende Engines unverändert erreichbar (V4-002)', () => {
    const d = src('src/main/shortme/clips/engines/index.ts')
    expect(d).toMatch(/req\.engine === 'multimodal-v2'[\s\S]*selectV2\(req\)/)
    expect(d).toMatch(/req\.engine === 'adaptive-v3'[\s\S]*selectV3\(req\)/)
    expect(d).toMatch(/return selectLegacy\(req\)/)
  })
})

describe('V4 Läufe, Isolation, Manifest (V4-006/007)', () => {
  it('eigene Lauf-IDs v4-…', () => { expect(newRunId(() => 0.5, () => 1_700_000_000_000, 'v4')).toMatch(/^v4-/) })
  it('Zustand mit Engine-4-Läufen bleibt lesbar, alte Zustände ohne engine4 werden ergänzt (keine Migration nötig)', () => {
    const s = sanitizeAnalysisState({ version: 1, selected: 'engine4', shown: 'v4-abc-123', view: { legacy: 'legacy', 'multimodal-v2': null, 'adaptive-v3': null }, runs: [{ runId: 'v4-abc-123', engineId: 'engine4', engineVersion: '4.0', schema: 1, createdAt: 'x', status: 'done', fingerprint: 'f', options: { query: '', contentType: null, frame: null, wanted: null, minSec: 15, maxSec: 75, profile: 'balanced' }, models: {}, modalities: {} }] })
    expect(s.selected).toBe('engine4')
    expect(s.runs[0].engineId).toBe('engine4')
    expect(emptyAnalysisState().view.engine4).toBeNull()
  })
  it('Manifest-Snapshot enthält Quelle, Revisionen, Prompts, Anfragen, Profil und Code-Stand', () => {
    const v4 = src('src/main/shortme/clips/engines/v4/index.ts')
    for (const k of ['sha256', 'durationPts', 'timebaseNum', 'gitSha', 'configSha256', 'modelRevisions', 'weightHashes', 'promptVersions', 'queryRevision', 'seed', 'profile']) expect(v4).toContain(k)
    expect(v4Revisions('balanced')).toContain('pipeline:4.0')
  })
  it('Profile mit echten Budgetunterschieden (V4-044)', () => {
    expect(V4_PROFILES.fast.investigatorCalls).toBeLessThan(V4_PROFILES.deep.investigatorCalls)
    expect(V4_PROFILES.fast.finalists).toBeLessThan(V4_PROFILES.balanced.finalists)
    expect(V4_PROFILES.deep.repairs).toBeLessThanOrEqual(2)
  })
})

describe('V4 ffprobe (V4-009)', () => {
  const both = JSON.stringify({ format: { duration: '60.5', start_time: '0.000' }, streams: [
    { index: 0, codec_type: 'video', codec_name: 'h264', time_base: '1/15360', start_pts: 0, start_time: '0.000', duration_ts: 929280, width: 1920, height: 1080, r_frame_rate: '60/1', avg_frame_rate: '1578060000/26362561' },
    { index: 1, codec_type: 'audio', codec_name: 'aac', time_base: '1/48000', start_pts: 1024, start_time: '0.021333', sample_rate: '48000', channels: 2 }] })
  it('Timebase, PTS-Dauer, VFR und Audioversatz', () => {
    const p = parseProbe(both, 'x.mp4')
    expect(p.timebaseDen).toBe(15360)
    expect(p.durationPts).toBe(String(Math.round(60.5 * 15360)))
    expect(p.vfr).toBe(true)
    expect(p.audioOffsetSec).toBeCloseTo(0.021333, 5)
  })
  it('nur Video / nur Ton / kaputt', () => {
    const v = JSON.parse(both); v.streams = [v.streams[0]]
    expect(parseProbe(JSON.stringify(v), 'x').audio).toBeNull()
    const a = JSON.parse(both); a.streams = [a.streams[1]]
    expect(parseProbe(JSON.stringify(a), 'x').video).toBeNull()
    expect(() => parseProbe(JSON.stringify({ format: { duration: 'N/A' }, streams: [] }), 'x')).toThrow()
    expect(() => parseProbe(JSON.stringify({ format: { duration: '3' }, streams: [] }), 'x')).toThrow()
  })
})
