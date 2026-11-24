/**
 * Geräteidentität und Vertrauensliste (Plan V4, Kap. 4.1).
 * Privater Schlüssel nur versiegelt (OS-Schlüsselbund/DPAPI über `Sealer`), öffentlicher Schlüssel = deviceId.
 */
import { readFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import crypto from 'hypercore-crypto'
import { writeFileAtomic } from '../shortme/atomic'
import type { DevicePermissions } from '@shared/remote/protocol'

export interface Sealer {
  available(): boolean
  seal(plain: string): Buffer
  open(sealed: Buffer): string
}

export interface DeviceKeys { publicKey: Buffer; secretKey: Buffer; deviceId: string }

export class SecretStoreUnavailable extends Error {
  readonly code = 'SECRET_STORE_UNAVAILABLE'
}

/** Lädt oder erzeugt das Geräteschlüsselpaar. Ohne sicheren Speicher: Fehler, nie Klartext. */
export async function loadIdentity(dir: string, sealer: Sealer): Promise<DeviceKeys> {
  if (!sealer.available()) throw new SecretStoreUnavailable('Kein sicherer Schlüsselspeicher (Schlüsselbund/DPAPI) verfügbar')
  await mkdir(dir, { recursive: true })
  const file = join(dir, 'identity.sealed')
  try {
    const secretKey = Buffer.from(sealer.open(await readFile(file)), 'hex')
    const publicKey = secretKey.subarray(32) // Ed25519 (libsodium): secretKey = seed ‖ publicKey
    return { publicKey, secretKey, deviceId: publicKey.toString('hex') }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err // nie still eine neue Identität erzeugen
  }
  const kp = crypto.keyPair()
  await writeFileAtomic(file, sealer.seal(kp.secretKey.toString('hex')))
  return { publicKey: kp.publicKey, secretKey: kp.secretKey, deviceId: kp.publicKey.toString('hex') }
}

export interface TrustedPeer {
  deviceId: string
  name: string
  platform: string
  permissions: DevicePermissions
  pairedAt: string
  lastSeenAt?: string
  /** Lokal entkoppelt: bleibt gespeichert, damit derselbe Schlüssel nicht still wieder angenommen wird. */
  revokedAt?: string
  /** Gegenstelle hat uns entkoppelt. */
  revokedByPeerAt?: string
}

export const DEFAULT_PERMISSIONS: DevicePermissions = { canSubmitJobs: true, canReceiveResults: true, canRequestProxies: true, canCancelOwnJobs: true }

export class TrustStore {
  private peers = new Map<string, TrustedPeer>()
  constructor(private readonly file: string) {}

  async load(): Promise<this> {
    try {
      const raw = JSON.parse(await readFile(this.file, 'utf8')) as { peers?: TrustedPeer[] }
      for (const p of raw.peers ?? []) if (/^[0-9a-f]{64}$/.test(p.deviceId)) this.peers.set(p.deviceId, p)
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
    }
    return this
  }

  private save(): Promise<void> {
    return writeFileAtomic(this.file, JSON.stringify({ version: 1, peers: [...this.peers.values()] }, null, 2))
  }

  list(): TrustedPeer[] { return [...this.peers.values()] }
  get(deviceId: string): TrustedPeer | undefined { return this.peers.get(deviceId) }
  /** Nur aktiv vertraute Geräte dürfen verbinden. */
  isTrusted(deviceId: string): boolean { const p = this.peers.get(deviceId); return !!p && !p.revokedAt && !p.revokedByPeerAt }

  async add(p: Omit<TrustedPeer, 'pairedAt'>): Promise<TrustedPeer> {
    const entry: TrustedPeer = { ...p, pairedAt: new Date().toISOString() }
    this.peers.set(p.deviceId, entry)
    await this.save()
    return entry
  }

  async update(deviceId: string, patch: Partial<TrustedPeer>): Promise<void> {
    const p = this.peers.get(deviceId)
    if (!p) return
    this.peers.set(deviceId, { ...p, ...patch, deviceId })
    await this.save()
  }

  async revoke(deviceId: string, byPeer = false): Promise<void> {
    await this.update(deviceId, byPeer ? { revokedByPeerAt: new Date().toISOString() } : { revokedAt: new Date().toISOString() })
  }
}
