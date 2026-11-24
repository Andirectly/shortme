/**
 * P2P-Host der Remote Engine (Plan V4, Kap. 2.2/4): Hyperswarm/HyperDHT mit der Geräte-Identität als Noise-Schlüssel.
 * - Discovery: jedes Gerät `listen()`t unter seinem öffentlichen Schlüssel, gekoppelte Geräte werden per `joinPeer` gehalten
 *   (Hyperswarm verbindet selbst neu mit Backoff). Die Firewall lässt nur vertraute Schlüssel bzw. eine offene Kopplung zu.
 * - Pairing: Einmal-Einladung (32 Byte Zufall, TTL), gegenseitiger Beweis über den Noise-Handshake (Muster: AlterSend topic-auth),
 *   danach bestätigen beide Seiten den angezeigten Fingerabdruck.
 * - Control: eigener Protomux-Kanal `shortme/control/1` (RemoteMessage, validiert) + Herzschlag mit Nonce.
 * - Data: Protomux-Kanal `shortme/drive/1` über den übernommenen AlterSend-Drive-Engine (drive/).
 * Die Peer-Identität ist immer `socket.remotePublicKey` (durch Noise authentisiert), nie ein Feld aus der Nachricht.
 */
import { EventEmitter } from 'node:events'
import Hyperswarm, { type PeerSocket } from 'hyperswarm'
import HyperDHT from 'hyperdht'
import Protomux, { type ProtomuxChannel, type ProtomuxMessage } from 'protomux'
import c from 'compact-encoding'
import crypto from 'hypercore-crypto'
import { parseMessage, ReplayGuard, requiredPermission, ProtocolError, PROTOCOL_VERSION, type RemoteMessage, type ConnectivityState } from '@shared/remote/protocol'
import { DEFAULT_PERMISSIONS, type DeviceKeys, type TrustStore } from './trust'
import { DRIVE_PROTOCOL, chunkEncoding, type ChunkFrame } from './drive/transport'
import type { ChunkHeader, ControlMessage, DriveChannel } from './drive/types'

export const CONTROL_PROTOCOL = 'shortme/control/1'
const PAIR_PROTOCOL = 'shortme/pair/1'
const PAIR_CONTEXT = Buffer.from('shortme/pair/v1')
const MAX_MESSAGE_BYTES = 256 * 1024
export const HEARTBEAT_MS = 5_000
export const OFFLINE_AFTER_MS = 15_000
export const INVITE_TTL_MS = 5 * 60_000
export const NUDGE_MS = 60_000

type Kind = 'direct' | 'relay' | 'unknown'
export interface PeerStatus { deviceId: string; connectivity: ConnectivityState; route: Kind; lastSeenAt?: string }
export interface PairRequest { deviceId: string; name: string; platform: string; fingerprint: string }

export interface HostOptions {
  keys: DeviceKeys
  name: string
  platform: string
  trust: TrustStore
  bootstrap?: Array<{ host: string; port: number }>
  /** Bind-Adresse des DHT-Knotens (Tests: 127.0.0.1). Standard: alle Schnittstellen. */
  bindHost?: string
  /** Öffentlicher Schlüssel eines E2E-Blind-Relays (nur nutzergewählt). Ohne: „Direct only“. */
  relay?: Buffer | null
  heartbeatMs?: number
  offlineAfterMs?: number
  nudgeMs?: number
}

const hex = (b: Uint8Array): string => Buffer.from(b).toString('hex')
const enc = (o: unknown): string => JSON.stringify(o)
function dec(s: string): unknown {
  if (typeof s !== 'string' || s.length > MAX_MESSAGE_BYTES) throw new ProtocolError('MALFORMED', 'Nachricht zu groß')
  return JSON.parse(s)
}

/** Fingerabdruck, auf beiden Geräten gleich: aus beiden öffentlichen Schlüsseln, sortiert. */
export function fingerprint(a: string, b: string): string {
  const [x, y] = [a, b].sort()
  return crypto.hash([PAIR_CONTEXT, Buffer.from(x, 'hex'), Buffer.from(y, 'hex')]).subarray(0, 6).toString('hex').toUpperCase().replace(/(.{4})(?=.)/g, '$1-')
}

const pairTopic = (secret: Buffer): Buffer => crypto.hash([PAIR_CONTEXT, Buffer.from('topic'), secret])
/** Beweis „ich kenne den Einladungscode“, gebunden an diese Verbindung (Handshake) und an den Beweisenden (kein Zurückspiegeln). */
const pairProof = (secret: Buffer, handshakeHash: Uint8Array, nonce: Buffer, prover: Uint8Array): string =>
  hex(crypto.hash([PAIR_CONTEXT, Buffer.from('proof'), secret, handshakeHash, nonce, prover]))

interface Link {
  socket: PeerSocket
  control: ProtomuxMessage<string>
  heartbeat: ProtomuxMessage<string>
  drive: { channel: ProtomuxChannel; control: ProtomuxMessage<ControlMessage>; chunk: ProtomuxMessage<ChunkFrame> }
  sessions: Map<string, { onMessage?: (m: ControlMessage) => void; onChunk?: (h: ChunkHeader, d: Uint8Array) => void }>
  pending: Map<string, (ok: boolean) => void>
  route: Kind
  inFlight: number
  waiters: Array<() => void>
}

interface Invite { secret: Buffer; topic: Buffer; expires: number; timer: NodeJS.Timeout }

export class RemoteHost extends EventEmitter {
  private swarm: Hyperswarm | null = null
  private dht: HyperDHT | null = null
  private links = new Map<string, Link>()
  private lastSeen = new Map<string, number>()
  private invite: Invite | null = null
  private pairing = new Map<string, { local?: boolean; remote?: boolean; info: PairRequest; send: (o: unknown) => void; socket: PeerSocket }>()
  private replay = new ReplayGuard()
  private seq = 0
  private timer: NodeJS.Timeout | null = null
  readonly deviceId: string

  constructor(private readonly o: HostOptions) {
    super()
    this.deviceId = o.keys.deviceId
  }

  async start(): Promise<void> {
    const keyPair = { publicKey: this.o.keys.publicKey, secretKey: this.o.keys.secretKey }
    this.dht = new HyperDHT({ bootstrap: this.o.bootstrap, host: this.o.bindHost, keyPair })
    this.swarm = new Hyperswarm({
      keyPair,
      dht: this.dht,
      // true = ablehnen. Unbekannte Schlüssel nur, solange eine Kopplung offen ist.
      firewall: (rk) => !this.o.trust.isTrusted(hex(rk)) && !this.invite,
      relayThrough: this.o.relay ? (force) => (force ? this.o.relay ?? null : null) : null
    })
    this.swarm.on('connection', (socket) => this.onConnection(socket))
    await this.swarm.listen()
    for (const p of this.o.trust.list()) if (this.o.trust.isTrusted(p.deviceId)) this.swarm.joinPeer(Buffer.from(p.deviceId, 'hex'))
    this.timer = setInterval(() => this.tick(), this.o.heartbeatMs ?? HEARTBEAT_MS)
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer)
    this.cancelInvite()
    for (const l of this.links.values()) l.socket.destroy()
    await this.swarm?.destroy()
    await this.dht?.destroy().catch(() => undefined)
    this.swarm = null
    this.dht = null
  }

  // ---------- Pairing ----------

  /** Einladung erzeugen: 64-stelliger Code, 5 Minuten gültig, einmalig. */
  async createInvite(): Promise<{ code: string; expiresAt: string }> {
    const secret = crypto.randomBytes(32)
    await this.openInvite(secret)
    return { code: secret.toString('hex'), expiresAt: new Date(this.invite!.expires).toISOString() }
  }

  async acceptInvite(code: string): Promise<void> {
    if (!/^[0-9a-f]{64}$/i.test(code.trim())) throw new Error('Ungültiger Kopplungscode')
    await this.openInvite(Buffer.from(code.trim(), 'hex'))
  }

  private async openInvite(secret: Buffer): Promise<void> {
    this.cancelInvite()
    const topic = pairTopic(secret)
    const ttl = INVITE_TTL_MS
    this.invite = { secret, topic, expires: Date.now() + ttl, timer: setTimeout(() => this.cancelInvite(), ttl) }
    await this.swarm!.join(topic, { server: true, client: true }).flushed()
  }

  cancelInvite(closePending = true): void {
    if (!this.invite) return
    clearTimeout(this.invite.timer)
    void this.swarm?.leave(this.invite.topic).catch(() => undefined)
    this.invite = null
    if (closePending) for (const p of this.pairing.values()) p.socket.destroy()
    this.pairing.clear()
  }

  /** Nutzerentscheidung zur angezeigten Kopplungsanfrage (Fingerabdruck geprüft). */
  async confirmPairing(deviceId: string, accept: boolean): Promise<void> {
    const p = this.pairing.get(deviceId)
    if (!p) throw new Error('Keine offene Kopplung')
    p.local = accept
    p.send({ t: 'decision', accept })
    await this.settlePairing(deviceId)
  }

  private async settlePairing(deviceId: string): Promise<void> {
    const p = this.pairing.get(deviceId)
    if (!p || p.local === undefined || p.remote === undefined) return
    this.pairing.delete(deviceId)
    if (p.local && p.remote) {
      await this.o.trust.add({ deviceId, name: p.info.name, platform: p.info.platform, permissions: DEFAULT_PERMISSIONS })
      this.cancelInvite(false) // Einmalverbrauch
      this.swarm!.joinPeer(Buffer.from(deviceId, 'hex'))
      this.attach(p.socket) // gleiche authentisierte Verbindung weiterverwenden
      this.emit('paired', deviceId)
    } else {
      p.socket.destroy()
      this.emit('pair-declined', deviceId)
    }
  }

  private runPairing(socket: PeerSocket, mux: Protomux): void {
    const inv = this.invite
    const remote = hex(socket.remotePublicKey)
    if (!inv || !socket.handshakeHash) return socket.destroy()
    const nonce = crypto.randomBytes(32)
    let proven = false
    const ch = mux.createChannel({ protocol: PAIR_PROTOCOL, onclose: () => this.pairing.delete(remote) })
    if (!ch) return socket.destroy()
    const msg = ch.addMessage<string>({
      encoding: c.string,
      onmessage: (raw) => {
        try {
          const m = dec(raw) as { t?: string; nonce?: string; proof?: string; name?: string; platform?: string; accept?: boolean }
          if (m.t === 'challenge' && typeof m.nonce === 'string' && /^[0-9a-f]{64}$/.test(m.nonce))
            send({ t: 'proof', proof: pairProof(inv.secret, socket.handshakeHash!, Buffer.from(m.nonce, 'hex'), this.o.keys.publicKey), name: this.o.name.slice(0, 80), platform: this.o.platform })
          else if (m.t === 'proof' && !proven) {
            if (m.proof !== pairProof(inv.secret, socket.handshakeHash!, nonce, socket.remotePublicKey)) return socket.destroy()
            proven = true
            const info: PairRequest = { deviceId: remote, name: String(m.name ?? 'Unbekannt').slice(0, 80), platform: String(m.platform ?? '?').slice(0, 16), fingerprint: fingerprint(this.deviceId, remote) }
            this.pairing.set(remote, { info, send, socket })
            this.emit('pair-request', info)
          } else if (m.t === 'decision' && proven && typeof m.accept === 'boolean') {
            const p = this.pairing.get(remote)
            if (p) { p.remote = m.accept; void this.settlePairing(remote) }
          }
        } catch { socket.destroy() }
      }
    })
    const send = (o: unknown): void => { msg.send(enc(o)) }
    ch.open()
    send({ t: 'challenge', nonce: nonce.toString('hex') })
  }

  // ---------- Verbindungen ----------

  private onConnection(socket: PeerSocket): void {
    socket.on('error', () => undefined)
    if (!this.o.trust.isTrusted(hex(socket.remotePublicKey))) return this.runPairing(socket, Protomux.from(socket))
    this.attach(socket)
  }

  /** Kontroll- und Datenkanal auf einer authentisierten Verbindung eines vertrauten Geräts öffnen. */
  private attach(socket: PeerSocket): void {
    const remote = hex(socket.remotePublicKey)
    const mux = Protomux.from(socket)
    const old = this.links.get(remote)
    if (old?.socket === socket) return
    // Hyperswarm entfernt doppelte Verbindungen selbst und meldet die verbleibende – die neueste gilt
    old?.socket.destroy()
    const sessions: Link['sessions'] = new Map()
    const ctl = mux.createChannel({ protocol: CONTROL_PROTOCOL })
    const dch = mux.createChannel({ protocol: DRIVE_PROTOCOL })
    if (!ctl || !dch) return socket.destroy()
    const link: Link = {
      socket,
      route: this.o.relay ? 'unknown' : 'direct', // shortcut: ohne Relay ist jede Verbindung direkt; mit Relay fehlt noch die Klassifizierung (AlterSend: remoteHost gegen Relay-Hosts)
      sessions,
      pending: new Map(),
      inFlight: 0,
      waiters: [],
      control: ctl.addMessage<string>({ encoding: c.string, onmessage: (raw) => this.onControl(remote, raw) }),
      heartbeat: ctl.addMessage<string>({ encoding: c.string, onmessage: (raw) => this.onHeartbeat(remote, raw) }),
      drive: {
        channel: dch,
        control: dch.addMessage<ControlMessage>({ encoding: c.json, onmessage: (m) => { if (m && typeof m.transferId === 'string') sessions.get(m.transferId)?.onMessage?.(m) } }),
        chunk: dch.addMessage<ChunkFrame>({ encoding: chunkEncoding, onmessage: ({ transferId, index, data }) => sessions.get(transferId)?.onChunk?.({ transferId, index }, data) })
      }
    }
    ctl.open()
    dch.open()
    this.links.set(remote, link)
    const release = (): void => { link.inFlight = 0; for (const w of link.waiters.splice(0)) w() }
    socket.on('drain', release)
    socket.on('close', () => {
      if (this.links.get(remote) !== link) return
      this.links.delete(remote)
      for (const [id, s] of sessions) s.onMessage?.({ type: 'cancel', transferId: id, reason: 'Peer disconnected' })
      for (const r of link.pending.values()) r(false)
      release()
      this.emitStatus(remote)
    })
    this.markSeen(remote)
    this.ping(remote)
  }

  private markSeen(remote: string): void {
    const was = this.isOnline(remote)
    this.lastSeen.set(remote, Date.now())
    if (!was) this.emitStatus(remote)
  }

  private onHeartbeat(remote: string, raw: string): void {
    try {
      const m = dec(raw) as { t?: string; nonce?: string }
      const link = this.links.get(remote)
      if (!link || typeof m.nonce !== 'string') return
      if (m.t === 'ping') link.heartbeat.send(enc({ t: 'pong', nonce: m.nonce }))
      else if (m.t === 'pong') {
        const r = link.pending.get(m.nonce)
        link.pending.delete(m.nonce)
        if (r) { this.markSeen(remote); r(true) } // nur beantwortete eigene Nonce zählt als frisch
      }
    } catch { /* kaputter Herzschlag: ignorieren, Timeout greift */ }
  }

  private onControl(remote: string, raw: string): void {
    let m: RemoteMessage
    try {
      m = parseMessage(dec(raw))
    } catch (err) {
      this.emit('protocol-error', remote, err)
      return
    }
    if (m.from !== remote || !this.replay.accept(m)) return // Absender muss der authentisierte Schlüssel sein
    const peer = this.o.trust.get(remote)
    const need = requiredPermission(m.type)
    if (!peer || (need && !peer.permissions[need])) { this.emit('permission-denied', remote, m.type); return }
    this.markSeen(remote)
    if (m.type === 'UnpairNotice') {
      void this.o.trust.revoke(remote, true).then(() => { this.swarm?.leavePeer(Buffer.from(remote, 'hex')); this.links.get(remote)?.socket.destroy(); this.emitStatus(remote) })
      return
    }
    this.emit('message', remote, m)
  }

  /** Authentisierter Ping mit frischer Nonce; true bei Antwort innerhalb des Offline-Fensters. */
  ping(deviceId: string): Promise<boolean> {
    const link = this.links.get(deviceId)
    if (!link) return Promise.resolve(false)
    const nonce = crypto.randomBytes(16).toString('hex')
    return new Promise((resolve) => {
      const t = setTimeout(() => { link.pending.delete(nonce); resolve(false) }, this.o.offlineAfterMs ?? OFFLINE_AFTER_MS)
      link.pending.set(nonce, (ok) => { clearTimeout(t); resolve(ok) })
      link.heartbeat.send(enc({ t: 'ping', nonce }))
    })
  }

  private nudged = new Map<string, number>()

  private tick(): void {
    const offlineAfter = this.o.offlineAfterMs ?? OFFLINE_AFTER_MS
    for (const [id, link] of this.links) {
      // Halbtote Verbindung (offen, aber keine Antworten): schließen, damit Hyperswarm neu verbindet
      if (Date.now() - (this.lastSeen.get(id) ?? 0) > offlineAfter * 2) { link.socket.destroy(); continue }
      void this.ping(id)
    }
    for (const id of this.lastSeen.keys()) if (this.statusSent.get(id) !== this.status(id).connectivity) this.emitStatus(id)
    // Hyperswarm verlängert die Pause zwischen Verbindungsversuchen bis in den Minutenbereich; nach Schlaf/Netzwechsel
    // soll ein gekoppeltes Gerät aber schnell zurückkommen → alle NUDGE_MS die Versuche neu anstoßen (leavePeer/joinPeer setzt den Backoff zurück).
    const now = Date.now()
    for (const p of this.o.trust.list()) {
      if (!this.o.trust.isTrusted(p.deviceId) || this.links.has(p.deviceId)) continue
      if (now - (this.nudged.get(p.deviceId) ?? 0) < (this.o.nudgeMs ?? NUDGE_MS)) continue
      if ((this.swarm?.connecting ?? 0) > 0) continue // laufenden Verbindungsaufbau nicht abbrechen
      this.nudged.set(p.deviceId, now)
      const key = Buffer.from(p.deviceId, 'hex')
      this.swarm?.leavePeer(key)
      this.swarm?.joinPeer(key)
    }
  }

  private statusSent = new Map<string, ConnectivityState>()
  isOnline(id: string): boolean { return this.links.has(id) && Date.now() - (this.lastSeen.get(id) ?? 0) < (this.o.offlineAfterMs ?? OFFLINE_AFTER_MS) }

  status(deviceId: string): PeerStatus {
    const p = this.o.trust.get(deviceId)
    const seen = this.lastSeen.get(deviceId)
    const lastSeenAt = seen ? new Date(seen).toISOString() : p?.lastSeenAt
    if (p?.revokedAt || p?.revokedByPeerAt) return { deviceId, connectivity: 'revoked', route: 'unknown', lastSeenAt }
    const link = this.links.get(deviceId)
    if (!link || !this.isOnline(deviceId)) return { deviceId, connectivity: link ? 'connecting' : 'offline', route: 'unknown', lastSeenAt }
    return { deviceId, connectivity: link.route === 'relay' ? 'online-relay' : 'online-direct', route: link.route, lastSeenAt }
  }

  private emitStatus(id: string): void {
    const s = this.status(id)
    this.statusSent.set(id, s.connectivity)
    if (s.lastSeenAt) void this.o.trust.update(id, { lastSeenAt: s.lastSeenAt }).catch(() => undefined)
    this.emit('status', s)
  }

  // ---------- Senden ----------

  /** Nachricht an ein vertrautes, verbundenes Gerät. Transportzustellung ≠ fachliche Quittung. */
  send(deviceId: string, body: DistributiveOmit<RemoteMessage, 'v' | 'eventId' | 'from' | 'seq' | 'sentAt'>): boolean {
    const link = this.links.get(deviceId)
    if (!link || !this.o.trust.isTrusted(deviceId)) return false
    const m = { ...body, v: PROTOCOL_VERSION, eventId: crypto.randomBytes(12).toString('hex'), from: this.deviceId, seq: Date.now() * 1000 + (this.seq++ % 1000), sentAt: new Date().toISOString() }
    return link.control.send(enc(m))
  }

  /** Datenkanal je Übertragung (AlterSend-Drive-Protokoll) über die bestehende authentisierte Verbindung. */
  driveChannel(deviceId: string, transferId: string): DriveChannel | null {
    const link = this.links.get(deviceId)
    if (!link) return null
    const s: { onMessage?: (m: ControlMessage) => void; onChunk?: (h: ChunkHeader, d: Uint8Array) => void } = {}
    link.sessions.set(transferId, s)
    return {
      send: (m) => { link.drive.control.send(m) },
      sendChunk: (h, data) => { link.inFlight += data.length; link.drive.chunk.send({ ...h, data }) },
      onMessage: (fn) => { s.onMessage = fn },
      onChunk: (fn) => { s.onChunk = fn },
      // Gegendruck wie AlterSend PeerDrive: gesendete Bytes bis zum 'drain' des Sockets zählen.
      bufferedAmount: () => (link.drive.channel.drained ? (link.inFlight = 0) : link.inFlight),
      whenWritable: () => (link.drive.channel.drained || !this.links.has(deviceId) ? Promise.resolve() : new Promise<void>((r) => link.waiters.push(r))),
      close: () => { link.sessions.delete(transferId) }
    }
  }

  /** Lokal sofort entkoppeln; Gegenstelle erfährt es nur, wenn sie gerade erreichbar ist. */
  async unpair(deviceId: string): Promise<void> {
    this.send(deviceId, { type: 'UnpairNotice' })
    await this.o.trust.revoke(deviceId)
    this.swarm?.leavePeer(Buffer.from(deviceId, 'hex'))
    this.links.get(deviceId)?.socket.destroy()
    this.emitStatus(deviceId)
  }
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never
