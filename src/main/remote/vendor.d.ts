// from: denislupookov/altersend@8c23d5b7d50cedae6c9dae66f82b1e235070c16a/packages/core/src/types.d.ts (Apache-2.0, see src/main/remote/drive/NOTICE)
// Gekürzt auf die von ShortMe genutzten Module; ergänzt um listen/joinPeer/remotePublicKey/relayThrough und hyperdht-Bootstrap.

declare module 'hypercore-crypto' {
  export function randomBytes(n: number): Buffer
  export function discoveryKey(topic: Uint8Array): Buffer
  export function keyPair(seed?: Uint8Array): { publicKey: Buffer; secretKey: Buffer }
  export function hash(data: Uint8Array | Uint8Array[], out?: Uint8Array): Buffer
  export function sign(message: Uint8Array, secretKey: Uint8Array): Buffer
  export function verify(message: Uint8Array, signature: Uint8Array, publicKey: Uint8Array): boolean
  const _default: { randomBytes: typeof randomBytes; discoveryKey: typeof discoveryKey; keyPair: typeof keyPair; hash: typeof hash; sign: typeof sign; verify: typeof verify }
  export default _default
}

declare module 'hyperswarm' {
  import { EventEmitter } from 'events'
  export interface NoiseKeyPair { publicKey: Uint8Array; secretKey: Uint8Array }
  export interface PeerInfo { publicKey: Uint8Array }
  export interface PeerSocket {
    handshakeHash: Uint8Array | null
    remotePublicKey: Uint8Array
    rawStream?: { remoteHost?: string }
    on(event: 'close', cb: () => void): this
    on(event: 'drain', cb: () => void): this
    off(event: 'drain', cb: () => void): this
    on(event: 'error', cb: (err: Error) => void): this
    destroy(err?: Error): void
  }
  export interface SwarmDiscoverySession { flushed(): Promise<void>; destroy(): Promise<void> }
  export default class Hyperswarm extends EventEmitter {
    constructor(opts?: {
      keyPair?: NoiseKeyPair
      dht?: unknown
      bootstrap?: Array<{ host: string; port: number }> | string[]
      firewall?: (remotePublicKey: Uint8Array) => boolean
      relayThrough?: ((force: boolean) => Uint8Array | null) | Uint8Array | null
    })
    readonly keyPair: NoiseKeyPair
    listen(): Promise<void>
    join(topic: Uint8Array, opts?: { server?: boolean; client?: boolean }): SwarmDiscoverySession
    leave(topic: Uint8Array): Promise<void>
    joinPeer(publicKey: Uint8Array): void
    leavePeer(publicKey: Uint8Array): void
    flush(): Promise<void>
    destroy(): Promise<void>
    on(event: 'connection', cb: (socket: PeerSocket, info: PeerInfo) => void): this
    on(event: 'update', cb: () => void): this
  }
}

declare module 'hyperdht' {
  export default class HyperDHT {
    constructor(opts?: { bootstrap?: Array<{ host: string; port: number }>; host?: string; keyPair?: { publicKey: Uint8Array; secretKey: Uint8Array } })
    destroy(): Promise<void>
  }
}

declare module 'hyperdht/testnet' {
  export default function createTestnet(size?: number, opts?: unknown): Promise<{ bootstrap: Array<{ host: string; port: number }>; destroy(): Promise<void> }>
}

declare module 'protomux' {
  export interface ProtomuxMessage<T = unknown> { send(message: T): boolean }
  export interface ProtomuxChannel {
    addMessage<T = unknown>(opts: { encoding: unknown; onmessage?: (message: T) => void }): ProtomuxMessage<T>
    open(): void
    close(): void
    fullyOpened(): Promise<boolean>
    readonly drained: boolean
  }
  export default class Protomux {
    static from(socket: unknown): Protomux
    createChannel(opts: { protocol: string; onopen?: () => void; onclose?: (isRemote: boolean) => void }): ProtomuxChannel | null
  }
}

declare module 'compact-encoding' {
  export interface EncodingState { start: number; end: number; buffer: Uint8Array | null }
  export interface Encoding<T> {
    preencode(state: EncodingState, value: T): void
    encode(state: EncodingState, value: T): void
    decode(state: EncodingState): T
  }
  export const json: unknown
  export const string: Encoding<string>
  export const uint: Encoding<number>
  export const raw: Encoding<Uint8Array>
  const _default: { json: typeof json; string: typeof string; uint: typeof uint; raw: typeof raw }
  export default _default
}
