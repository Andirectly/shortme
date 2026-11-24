// Remote-Jobs Ende-zu-Ende über echtes P2P (HyperDHT-Testnetz). Die Pipeline ist hier ein Stellvertreter, der echte Dateien schreibt;
// in der App ist sie mit importUrl/runTranscription/runAnalysis/renderClips verdrahtet (service.ts).
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, readFile, writeFile, rm, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import createTestnet from 'hyperdht/testnet'
import { RemoteHost, type PairRequest, type PeerStatus } from '../src/main/remote/host'
import { TrustStore, loadIdentity, type Sealer } from '../src/main/remote/trust'
import { RemoteClient, RemoteWorker, sha256File, type Net, type Pipeline } from '../src/main/remote/jobs'
import type { RemoteMessage } from '../src/shared/remote/protocol'

const sealer: Sealer = { available: () => true, seal: (s) => Buffer.from(s), open: (b) => Buffer.from(b).toString() }
let testnet: Awaited<ReturnType<typeof createTestnet>>
let dir: string
beforeAll(async () => { testnet = await createTestnet(3); dir = await mkdtemp(join(tmpdir(), 'shortme-rjobs-')) })
afterAll(async () => { await testnet.destroy(); await rm(dir, { recursive: true, force: true }) })

async function host(name: string, start = true): Promise<RemoteHost> {
  const keys = await loadIdentity(join(dir, name), sealer)
  const trust = await new TrustStore(join(dir, name, 'trust.json')).load()
  const h = new RemoteHost({ keys, name, platform: 'test', trust, bootstrap: testnet.bootstrap, bindHost: '127.0.0.1', heartbeatMs: 300, offlineAfterMs: 1500, nudgeMs: 10_000 })
  if (start) await h.start()
  return h
}
const waitFor = async (fn: () => boolean | Promise<boolean>, ms = 60_000, label = fn.toString().slice(0, 80)): Promise<void> => {
  const t0 = Date.now()
  while (!(await fn())) { if (Date.now() - t0 > ms) throw new Error(`Timeout: ${label}`); await new Promise((r) => setTimeout(r, 100)) }
}
const net = (h: RemoteHost): Net => ({ deviceId: h.deviceId, send: (id, body) => h.send(id, body as never), driveChannel: (id, t) => h.driveChannel(id, t), isOnline: (id) => h.isOnline(id) })

/** Stellvertreter-Pipeline: Projektordner mit JSON (enthält absolute Worker-Pfade), Quelle, zwei Clips (einer geprüft, einer zur Prüfung). */
function fakePipeline(root: string, opts: { slowRenderMs?: number } = {}): Pipeline & { downloads: number } {
  const p = {
    downloads: 0,
    preflight: async () => ({ ok: true as const }),
    download: async () => {
      p.downloads++
      const projectDir = join(root, 'projects', 'h123')
      const sourcePath = join(root, 'downloads', 'vid.mp4')
      await mkdir(join(projectDir, 'analysis', 'runs', 'r1'), { recursive: true })
      await mkdir(join(root, 'downloads'), { recursive: true })
      await writeFile(sourcePath, randomBytes(3 * 1024 * 1024))
      await writeFile(join(projectDir, 'project.json'), JSON.stringify({ hash: 'h123', title: 'Test', sourcePath }))
      await writeFile(join(projectDir, 'analysis', 'runs', 'r1', 'clips.json'), JSON.stringify({ clips: [{ id: 'c1' }, { id: 'c2' }], dir: projectDir }))
      return { hash: 'h123', projectDir, sourcePath, title: 'Test' }
    },
    analyze: async () => undefined,
    clips: async () => [
      { id: 'c1', title: 'Guter Clip', verdict: 'verified', start: 10, end: 40, revision: 'rev1' },
      { id: 'c2', title: 'Unsicher', verdict: 'needs-review', start: 50, end: 80, revision: 'rev2' }
    ],
    render: async (_h: string, ids: string[], outDir: string, onRendered: (id: string, path: string) => Promise<void>) => {
      await mkdir(outDir, { recursive: true })
      for (const id of ids) {
        if (opts.slowRenderMs) await new Promise((r) => setTimeout(r, opts.slowRenderMs))
        const f = join(outDir, `${id}.mp4`)
        await writeFile(f, randomBytes(600 * 1024))
        await onRendered(id, f)
      }
    },
    probeOk: async () => true
  }
  return p
}

async function pair(a: RemoteHost, b: RemoteHost): Promise<void> {
  const { code } = await a.createInvite()
  const ra = new Promise<PairRequest>((r) => a.once('pair-request', r))
  const rb = new Promise<PairRequest>((r) => b.once('pair-request', r))
  await b.acceptInvite(code)
  const [x, y] = await Promise.all([ra, rb])
  const on = new Promise<void>((r) => { const f = (s: PeerStatus): void => { if (s.deviceId === b.deviceId && s.connectivity === 'online-direct') { a.off('status', f); r() } }; a.on('status', f) })
  await a.confirmPairing(x.deviceId, true)
  await b.confirmPairing(y.deviceId, true)
  await on
}

describe('Remote-Jobs über P2P', () => {
  it('Link-Job: Projekt wird importiert (Pfade umgeschrieben), nur geprüfter Clip als fertig, Quittungen leeren die Outbox; doppeltes Senden = ein Job; Client offline → später nachgeliefert', async () => {
    const macRoot = join(dir, 'mac-data')
    const winRoot = join(dir, 'win-data')
    let mac = await host('mac')
    const win = await host('win')
    await pair(mac, win)

    const pipe = fakePipeline(winRoot, { slowRenderMs: 2500 })
    const worker = new RemoteWorker(join(winRoot, 'remote'), net(win), pipe)
    await worker.load()
    win.on('message', (from: string, m: RemoteMessage) => void worker.onMessage(from, m))
    win.on('status', (s: PeerStatus) => { if (s.connectivity.startsWith('online')) worker.resend(s.deviceId) })

    const imported: string[] = []
    const renders: string[] = []
    const store = {
      projectDir: (h: string) => join(macRoot, 'projects', h),
      onProjectImported: async (h: string) => { imported.push(h) },
      importRender: async (_h: string | undefined, clipId: string, _t: string, tmp: string) => { const f = join(macRoot, 'exports', `${clipId}.mp4`); await mkdir(join(macRoot, 'exports'), { recursive: true }); await writeFile(f, await readFile(tmp)); renders.push(clipId); return f }
    }
    let client = new RemoteClient(join(macRoot, 'remote'), net(mac), store)
    client.stallMs = 5000
    await client.load()
    const wire = (h: RemoteHost, c: RemoteClient): void => {
      h.on('message', (from: string, m: RemoteMessage) => void c.onMessage(from, m))
      h.on('status', (s: PeerStatus) => { if (s.connectivity.startsWith('online')) c.reconnected(s.deviceId) })
    }
    wire(mac, client)

    const job = await client.submit(win.deviceId, 'https://93.184.215.14/watch?v=x', { contentType: 'vlog', wanted: 3, title: 'Mein Video' })
    // dieselbe Anfrage erneut senden (Wiederholung nach Verbindungsabbruch) → kein zweiter Job
    client.reconnected(win.deviceId)
    await waitFor(() => imported.includes('h123'))

    // Projekt importiert, Worker-Pfade umgeschrieben, Quelle verifiziert
    const meta = JSON.parse(await readFile(join(macRoot, 'projects', 'h123', 'project.json'), 'utf8')) as { sourcePath: string }
    expect(meta.sourcePath).toBe(join(macRoot, 'projects', 'h123', 'source.mp4'))
    expect(await sha256File(meta.sourcePath)).toBe(await sha256File(join(winRoot, 'downloads', 'vid.mp4')))
    const clipsJson = await readFile(join(macRoot, 'projects', 'h123', 'analysis', 'runs', 'r1', 'clips.json'), 'utf8')
    expect(clipsJson).not.toContain(winRoot)

    // Client geht offline, während der Worker noch rendert
    await mac.stop()
    await waitFor(() => worker.list()[0]?.compute === 'completed')
    expect(renders).toEqual([])

    // Client kommt wieder: Outbox wird nachgeliefert, nur der geprüfte Clip
    // wie in der App (service.ts): erst alles anschließen, dann den Host starten
    mac = await host('mac', false)
    client = new RemoteClient(join(macRoot, 'remote'), net(mac), store)
    client.stallMs = 5000
    await client.load()
    wire(mac, client)
    await mac.start()
    await waitFor(() => renders.includes('c1'))
    await waitFor(() => worker.list()[0].offers.every((o) => o.acked) && worker.list()[0].published.every((p) => p.acked))
    expect(renders).toEqual(['c1'])
    expect(pipe.downloads).toBe(1)
    expect(worker.list()).toHaveLength(1)
    const cj = client.list().find((j) => j.jobId === job.jobId)!
    expect(cj.compute).toBe('completed')
    expect(cj.clips.c1.ready).toBe(true)
    expect(cj.clips.c2).toBeUndefined() // zur Prüfung: nicht als fertig veröffentlicht (liegt aber im importierten Projekt)
    expect((await stat(join(macRoot, 'exports', 'c1.mp4'))).size).toBe(600 * 1024)

    // Neustart des Workers: abgeschlossener Job wird nicht neu gestartet, Outbox bleibt quittiert
    const worker2 = new RemoteWorker(join(winRoot, 'remote'), net(win), pipe)
    await worker2.load()
    expect(worker2.list()[0].compute).toBe('completed')
    expect(pipe.downloads).toBe(1)
    expect(existsSync(join(macRoot, 'projects', 'h123.remote-import'))).toBe(false)
    await Promise.all([mac.stop(), win.stop()])
  }, 240_000)

  it('Worker lehnt Link ins Heimnetz und fremde Absender ab', async () => {
    const a = await host('a2')
    const b = await host('b2')
    await pair(a, b)
    const worker = new RemoteWorker(join(dir, 'b2data'), net(b), fakePipeline(join(dir, 'b2data')))
    await worker.load()
    b.on('message', (from: string, m: RemoteMessage) => void worker.onMessage(from, m))
    const rejected = new Promise<RemoteMessage>((r) => a.on('message', (_f: string, m: RemoteMessage) => { if (m.type === 'JobRejected') r(m) }))
    const resend = (p: Promise<unknown>, fn: () => void): void => { let done = false; void p.then(() => { done = true }); void (async () => { while (!done) { fn(); await new Promise((r) => setTimeout(r, 1000)) } })() }
    resend(rejected, () => a.send(b.deviceId, { type: 'SubmitJob', job: { jobId: 'jx1', originDeviceId: a.deviceId, targetDeviceId: b.deviceId, projectId: 'p', projectRevision: 1, source: { kind: 'url', url: 'http://192.168.1.10/video.mp4' }, requestedPipelineId: 'default', settings: {}, createdAt: new Date().toISOString() } }))
    const m = await rejected
    expect(m.type === 'JobRejected' && m.code).toBe('URL_BLOCKED')
    // gefälschter Absender im Auftrag
    const rejected2 = new Promise<RemoteMessage>((r) => a.on('message', (_f: string, x: RemoteMessage) => { if (x.type === 'JobRejected' && x.jobId === 'jx2') r(x) }))
    resend(rejected2, () => a.send(b.deviceId, { type: 'SubmitJob', job: { jobId: 'jx2', originDeviceId: 'f'.repeat(64), targetDeviceId: b.deviceId, projectId: 'p', projectRevision: 1, source: { kind: 'url', url: 'https://93.184.215.14/v' }, requestedPipelineId: 'default', settings: {}, createdAt: new Date().toISOString() } }))
    const m2 = await rejected2
    expect(m2.type === 'JobRejected' && m2.code).toBe('PERMISSION_DENIED')
    expect(worker.list()).toHaveLength(0)
    await Promise.all([a.stop(), b.stop()])
  }, 60_000)
})
