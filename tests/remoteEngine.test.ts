import { describe, expect, it } from 'vitest'
import { PROTOCOL_VERSION, ProtocolError, ReplayGuard, parseMessage, type ClipResultPublished } from '../src/shared/remote/protocol'
import { canMoveCompute, canMoveDelivery, clipTile, summarize } from '../src/shared/remote/states'
import { ackMatches, auditStatusFrom, importDecision, importKey, makeAck, releaseGate } from '../src/shared/remote/releaseGate'
import { mergeRanges, missingRanges, prioritize, withHandles } from '../src/shared/remote/proxyRanges'
import { planCleanup, type StoredFile } from '../src/shared/remote/storage'
import { checkUrl, isPrivateAddress } from '../src/main/remote/urlGuard'

const H = 'a'.repeat(64)
const H2 = 'b'.repeat(64)
const env = (type: string, extra: object, seq = 1) => ({ v: PROTOCOL_VERSION, eventId: `e${seq}`, from: 'dev-mac', seq, sentAt: '2026-11-24T10:00:00Z', type, ...extra })
const clip = (over: Partial<ClipResultPublished> = {}): ClipResultPublished => ({
  eventId: 'p1', jobId: 'j1', projectId: 'pr1', clipId: 'c1', projectRevision: 3, clipRevision: 'r1', renderAttemptId: 'a1',
  renderAssetId: 'as1', renderSha256: H, audit: { decision: 'accepted', renderAttemptId: 'a1', clipRevision: 'r1', renderedSha256: H, auditReportId: 'au1' },
  segments: [{ role: 'coldOpen', sourceStart: 300, sourceEnd: 305 }, { role: 'main', sourceStart: 320, sourceEnd: 365 }], assetIds: ['as1'], ...over
})

describe('Protokoll', () => {
  it('nimmt gültige Nachrichten an und lehnt kaputte/fremde ab', () => {
    expect(parseMessage(env('ClipResultPublished', { clip: clip() })).type).toBe('ClipResultPublished')
    expect(() => parseMessage({ ...env('JobAccepted', { jobId: 'j1' }), v: 99 })).toThrow(ProtocolError)
    expect(() => parseMessage(env('RunShell', { cmd: 'rm -rf /' }))).toThrow(/unbekannter Typ/)
    expect(() => parseMessage(env('JobAccepted', { jobId: '../../etc/passwd' }))).toThrow(/ID/)
    expect(() => parseMessage(env('ClipResultPublished', { clip: clip({ renderSha256: 'x' }) }))).toThrow(/SHA/)
    expect(() => parseMessage(env('RequestProxyRange', { request: { requestId: 'q', projectId: 'p', sourceMediaId: 's', from: 10, to: 5, profile: 'scrub-low' } }))).toThrow()
  })
  it('Replay-Schutz: gleiche eventId oder alte Sequenz wird verworfen', () => {
    const g = new ReplayGuard()
    expect(g.accept({ from: 'a', seq: 1, eventId: 'x' })).toBe(true)
    expect(g.accept({ from: 'a', seq: 2, eventId: 'x' })).toBe(false)
    expect(g.accept({ from: 'a', seq: 1, eventId: 'y' })).toBe(false)
    expect(g.accept({ from: 'b', seq: 1, eventId: 'x' })).toBe(true)
  })
})

describe('Zustände', () => {
  it('Compute vorwärts, Stufen überspringbar, Reparaturschleife, Terminal endgültig', () => {
    expect(canMoveCompute('queued', 'rendering')).toBe(true)
    expect(canMoveCompute('rendering', 'transcribing')).toBe(false)
    expect(canMoveCompute('auditing', 'repairing')).toBe(true)
    expect(canMoveCompute('repairing', 'rendering')).toBe(true)
    expect(canMoveCompute('completed', 'failed')).toBe(false)
    expect(canMoveCompute('resource-paused', 'rendering')).toBe(true)
  })
  it('Delivery: kein Sprung von announced zu imported', () => {
    expect(canMoveDelivery('announced', 'imported')).toBe(false)
    expect(canMoveDelivery('verified', 'imported')).toBe(true)
  })
  it('Ready nur bei published + importiert; review zählt nicht als Ready', () => {
    expect(clipTile('published', 'transferring')).toBe('Preview ready')
    expect(clipTile('audit-review', 'imported')).toBe('Needs review')
    const tiles = [clipTile('published', 'imported'), clipTile('published', 'acknowledged'), clipTile('published', 'imported'), clipTile('processing', undefined), clipTile('processing', undefined), clipTile('audit-review', undefined)]
    expect(summarize(tiles)).toBe('3 Ready / 2 Processing / 1 Needs review')
  })
})

describe('Freigabe-Schranke', () => {
  const r = { clipId: 'c1', clipRevision: 'r1', renderAttemptId: 'a1', renderSha256: H, fileChecked: true }
  const a = { status: 'accepted' as const, renderAttemptId: 'a1', clipRevision: 'r1', renderedSha256: H }
  it('nur accepted zum exakten Render', () => {
    expect(releaseGate(r, a, 'r1')).toEqual({ ok: true })
    expect(releaseGate(r, { ...a, renderedSha256: H2 }, 'r1')).toMatchObject({ ok: false, release: 'processing' })
    expect(releaseGate(r, { ...a, status: 'review' }, 'r1')).toMatchObject({ ok: false, release: 'audit-review' })
    expect(releaseGate(r, { ...a, status: 'repair' }, 'r1')).toMatchObject({ ok: false, release: 'repair-required' })
    expect(releaseGate(r, a, 'r2')).toMatchObject({ ok: false, release: 'superseded' })
    expect(releaseGate({ ...r, fileChecked: false }, a, 'r1').ok).toBe(false)
  })
  it('Import idempotent, alte Revision überschreibt nicht, ACK nur bei passendem Hash', () => {
    const p = clip()
    expect(importDecision(p, new Set(), undefined)).toBe('import')
    expect(importDecision(p, new Set([importKey(p)]), 'r1')).toBe('already-imported')
    expect(importDecision(p, new Set(), 'r2')).toBe('stale')
    expect(importDecision(clip({ audit: { ...p.audit, decision: 'review' } }), new Set(), undefined)).toBe('invalid')
    expect(() => makeAck(p, 'k1', H2, 3)).toThrow('ASSET_CHECKSUM_FAIL')
    expect(ackMatches(p, makeAck(p, 'k1', H, 3))).toBe(true)
    expect(ackMatches(p, { ...makeAck(p, 'k1', H, 3), renderAttemptId: 'a0' })).toBe(false)
  })
  it('Engine-Urteile: Unklares ist review', () => {
    expect(auditStatusFrom('verified')).toBe('accepted')
    expect(auditStatusFrom('needs-review')).toBe('review')
    expect(auditStatusFrom(undefined)).toBe('review')
    expect(auditStatusFrom('failed')).toBe('repair')
  })
})

describe('Proxy-Bereiche', () => {
  it('Handles an Quellgrenzen gekappt (Beispiel aus dem Plan)', () => {
    expect(withHandles(320, 365, 30, 3600)).toEqual([290, 395])
    expect(withHandles(10, 20, 30, 25)).toEqual([0, 25])
  })
  it('überlappende Bereiche einmal übertragen, nur Lücken nachladen', () => {
    expect(mergeRanges([[290, 395], [380, 450], [600, 650], [650, 700]])).toEqual([[290, 450], [600, 700]])
    expect(missingRanges([280, 460], [[290, 450]])).toEqual([[280, 290], [450, 460]])
    expect(missingRanges([300, 400], [[290, 450]])).toEqual([])
    expect(prioritize([[0, 10], [500, 510], [95, 105]], [100, 120])[0]).toEqual([95, 105])
  })
})

describe('Speicher', () => {
  const f = (path: string, kind: StoredFile['kind'], bytes: number, extra: Partial<StoredFile> = {}): StoredFile => ({ path, kind, bytes, lastAccess: 0, ...extra })
  it('reservierte Originale und nicht quittierte Renders werden nie gelöscht', () => {
    const files = [f('orig', 'original', 900, { sourceMediaId: 's1' }), f('out', 'render-outbox', 300, { acknowledged: false }), f('c', 'cache', 100), f('t', 'temp', 50)]
    const leases = [{ leaseId: 'l', sourceMediaId: 's1', ownerProjectId: 'p', pinnedForEdit: true, retentionMode: 'time-limited' as const, retainUntil: '2000-01-01T00:00:00Z' }]
    expect(planCleanup(files, leases, 0, 120)).toEqual({ ok: true, delete: [files[3], files[2]] })
    expect(planCleanup(files, leases, 0, 1000)).toEqual({ ok: false, code: 'INSUFFICIENT_SPACE', freeable: 150 })
  })
})

describe('SSRF-Schutz', () => {
  it('private Adressen erkannt', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '192.168.0.5', '172.20.0.1', '169.254.169.254', '100.64.0.1', '::1', 'fd00::1', 'fe80::1', '::ffff:192.168.1.1'])
      expect(isPrivateAddress(ip), ip).toBe(true)
    for (const ip of ['8.8.8.8', '172.32.0.1', '2606:4700::1111']) expect(isPrivateAddress(ip), ip).toBe(false)
  })
  it('blockt Schema, Zugangsdaten, localhost und DNS auf Heimnetz', async () => {
    const dns = (ip: string) => async () => [{ address: ip }]
    await expect(checkUrl('file:///etc/passwd')).rejects.toThrow(/Schema/)
    await expect(checkUrl('https://u:p@example.com/')).rejects.toThrow(/Zugangsdaten/)
    await expect(checkUrl('http://localhost:8080/')).rejects.toThrow(/Lokaler/)
    await expect(checkUrl('https://evil.example/', dns('192.168.1.1'))).rejects.toThrow(/privaten/)
    await expect(checkUrl('http://[::1]/')).rejects.toThrow(/privaten/)
    expect((await checkUrl('https://www.youtube.com/watch?v=x', dns('142.250.0.1'))).addresses).toEqual(['142.250.0.1'])
  })
})
