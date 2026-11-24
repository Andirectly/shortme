// Echter P2P-Test: zwei RemoteHosts über ein lokales HyperDHT-Testnetz (UDP auf 127.0.0.1), keine Mocks des Transports.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { createHash, randomBytes } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import createTestnet from 'hyperdht/testnet'
import Hyperswarm from 'hyperswarm'
import HyperDHT from 'hyperdht'
import { RemoteHost, type PairRequest, type PeerStatus } from '../src/main/remote/host'
import { TrustStore, loadIdentity, SecretStoreUnavailable, type Sealer } from '../src/main/remote/trust'
import { sendFile, receiveFile } from '../src/main/remote/drive/drive'
import type { RemoteMessage } from '../src/shared/remote/protocol'

// Test-Versiegelung (in der App: Electron safeStorage). XOR reicht hier, getestet wird die Ablaufslogik.
const sealer: Sealer = { available: () => true, seal: (s) => Buffer.from(Buffer.from(s).map((b) => b ^ 0x5a)), open: (b) => Buffer.from(b).map((x) => x ^ 0x5a).toString() }

let testnet: Awaited<ReturnType<typeof createTestnet>>
let dir: string
beforeAll(async () => { testnet = await createTestnet(3); dir = await mkdtemp(join(tmpdir(), 'shortme-remote-')) })
afterAll(async () => { await testnet.destroy(); await rm(dir, { recursive: true, force: true }) })

async function makeHost(name: string): Promise<RemoteHost> {
  const keys = await loadIdentity(join(dir, name), sealer)
  const trust = await new TrustStore(join(dir, name, 'trust.json')).load()
  const h = new RemoteHost({ keys, name, platform: name === 'mac' ? 'darwin' : 'win32', trust, bootstrap: testnet.bootstrap, bindHost: '127.0.0.1', heartbeatMs: 300, offlineAfterMs: 1500 })
  await h.start()
  return h
}
const once = <T>(h: RemoteHost, ev: string, pred: (x: T) => boolean = () => true, ms = 20_000): Promise<T> =>
  new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`Timeout: ${ev}`)), ms)
    const fn = (x: T): void => { if (pred(x)) { clearTimeout(t); h.off(ev, fn); resolve(x) } }
    h.on(ev, fn)
  })
const online = (id: string) => (s: PeerStatus) => s.deviceId === id && s.connectivity === 'online-direct'

describe('Remote-Host (echtes P2P im Testnetz)', () => {
  it('Identität ohne sicheren Speicher wird verweigert', async () => {
    await expect(loadIdentity(join(dir, 'x'), { ...sealer, available: () => false })).rejects.toBeInstanceOf(SecretStoreUnavailable)
  })

  it('koppelt, tauscht Nachrichten, verbindet nach Neustart ohne neue Kopplung, überträgt Datei, entkoppelt', async () => {
    let mac = await makeHost('mac')
    let win = await makeHost('win')

    // Kopplung: Code auf dem Mac, Eingabe auf Windows, beide sehen denselben Fingerabdruck und bestätigen.
    const { code } = await mac.createInvite()
    const reqMac = once<PairRequest>(mac, 'pair-request')
    const reqWin = once<PairRequest>(win, 'pair-request')
    await win.acceptInvite(code)
    const [a, b] = await Promise.all([reqMac, reqWin])
    expect(a.fingerprint).toBe(b.fingerprint)
    expect(a.deviceId).toBe(win.deviceId)
    const paired = Promise.all([once(mac, 'paired'), once(win, 'paired'), once<PeerStatus>(mac, 'status', online(win.deviceId))])
    await mac.confirmPairing(a.deviceId, true)
    await win.confirmPairing(b.deviceId, true)
    await paired

    // Authentisierte Kontrollnachricht
    const got = new Promise<[string, RemoteMessage]>((r) => mac.once('message', (from: string, m: RemoteMessage) => r([from, m])))
    expect(win.send(mac.deviceId, { type: 'JobAccepted', jobId: 'job-1' })).toBe(true)
    const [from, m] = await got
    expect(m.type).toBe('JobAccepted')
    expect(from).toBe(win.deviceId)
    expect(await win.ping(mac.deviceId)).toBe(true)

    // Datei über den Drive-Kanal (AlterSend-Engine), Hash vergleichen
    const src = join(dir, 'src.bin')
    const dst = join(dir, 'dst.bin')
    const data = randomBytes(5 * 1024 * 1024 + 123)
    await writeFile(src, data)
    const rx = receiveFile(dst, mac.driveChannel(win.deviceId, 't1')!, { transferId: 't1', expectedSize: data.length })
    await sendFile(src, win.driveChannel(mac.deviceId, 't1')!, { transferId: 't1' })
    await rx
    const sha = (b: Buffer): string => createHash('sha256').update(b).digest('hex')
    expect(sha(await readFile(dst))).toBe(sha(data))

    // Neustart beider Hosts: gleiche Identität, Vertrauen bleibt, Verbindung kommt ohne Code zurück
    const ids = [mac.deviceId, win.deviceId]
    await Promise.all([mac.stop(), win.stop()])
    mac = await makeHost('mac')
    const back = once<PeerStatus>(mac, 'status', online(ids[1]), 30_000)
    win = await makeHost('win')
    expect([mac.deviceId, win.deviceId]).toEqual(ids)
    await back

    // Entkoppeln: lokal sofort gesperrt, Gegenstelle (erreichbar) sieht „revoked“
    const revoked = once<PeerStatus>(win, 'status', (s) => s.deviceId === mac.deviceId && s.connectivity === 'revoked')
    await mac.unpair(win.deviceId)
    expect(mac.status(win.deviceId).connectivity).toBe('revoked')
    await revoked
    expect(win.send(mac.deviceId, { type: 'JobAccepted', jobId: 'job-3' })).toBe(false)
    await Promise.all([mac.stop(), win.stop()])
  }, 90_000)

  it('fremdes Gerät ohne Kopplung kommt nicht durch die Firewall', async () => {
    const mac = await makeHost('mac2')
    const stranger = new Hyperswarm({ dht: new HyperDHT({ bootstrap: testnet.bootstrap, host: '127.0.0.1' }) })
    let connected = false
    stranger.on('connection', () => { connected = true })
    stranger.joinPeer(Buffer.from(mac.deviceId, 'hex'))
    await new Promise((r) => setTimeout(r, 3000))
    expect(connected).toBe(false)
    await stranger.destroy()
    await mac.stop()
  }, 30_000)

  it('falscher Kopplungscode führt zu keiner Kopplungsanfrage', async () => {
    const a = await makeHost('a3')
    const b = await makeHost('b3')
    await a.createInvite()
    let asked = false
    a.on('pair-request', () => { asked = true })
    await b.acceptInvite(randomBytes(32).toString('hex'))
    await new Promise((r) => setTimeout(r, 3000))
    expect(asked).toBe(false)
    await Promise.all([a.stop(), b.stop()])
  }, 30_000)
})
