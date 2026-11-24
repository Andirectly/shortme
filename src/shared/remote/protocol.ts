/**
 * Remote Engine – versionierte Nachrichten (Plan V3, Kap. 13).
 * Alles, was über den Remote-Kanal ankommt, geht durch `parseMessage` (Vertrauensgrenze).
 * Keine OS-Pfade, keine freien Kommandos: nur IDs, Hashes und feste Operationen.
 */

export const PROTOCOL_VERSION = 1

export type ComputeState =
  | 'created' | 'queued' | 'accepted' | 'acquiring-source' | 'preparing' | 'transcribing' | 'analyzing'
  | 'selecting' | 'rendering' | 'auditing' | 'repairing' | 'publishing' | 'completed'
  | 'needs-input' | 'resource-paused' | 'failed' | 'cancelled'
export type ConnectivityState = 'connecting' | 'online-direct' | 'online-relay' | 'offline' | 'incompatible' | 'revoked'
export type DeliveryState = 'announced' | 'transferring' | 'verified' | 'imported' | 'acknowledged' | 'retryable-error' | 'permanently-unavailable'
export type ReleaseState = 'processing' | 'audit-review' | 'repair-required' | 'accepted-unpublished' | 'published' | 'superseded'
export type AuditStatus = 'accepted' | 'review' | 'repair'

export type ErrorCode =
  | 'SOURCE_UNAVAILABLE' | 'URL_BLOCKED' | 'MODEL_MISSING' | 'RELAY_UNAVAILABLE' | 'INSUFFICIENT_SPACE' | 'GPU_OOM'
  | 'VERSION_INCOMPATIBLE' | 'ASSET_CHECKSUM_FAIL' | 'RENDER_AUDIT_FAILED' | 'SOURCE_ORIGINAL_MISSING'
  | 'STALE_CLIP_REVISION' | 'DEVICE_REVOKED' | 'PERMISSION_DENIED'

export type ExecutionTarget = { kind: 'local' } | { kind: 'remote'; deviceId: string }
export type SourceDescriptor =
  | { kind: 'url'; url: string }
  | { kind: 'uploaded-file'; assetId: string; sha256: string; size: number }

export interface DevicePermissions {
  canSubmitJobs: boolean
  canReceiveResults: boolean
  canRequestProxies: boolean
  canCancelOwnJobs: boolean
  requireApprovalForNewProject?: boolean
}

export interface WorkerReadiness {
  deviceId: string
  protocolVersion: number
  projectSchemaVersion: number
  engineBuildId: string
  pipelineIds: string[]
  modelRevisions: Record<string, string>
  supportsAudit: boolean
  supportsProxyRanges: boolean
  maxConcurrentJobs: number
  freeWorkingBytes: number
  freeArchiveBytes: number
  status: 'ready' | 'busy' | 'missing-dependency' | 'low-disk' | 'incompatible'
  missing?: string[]
}

export interface RemoteJobRequest {
  jobId: string
  originDeviceId: string
  targetDeviceId: string
  projectId: string
  projectRevision: number
  source: SourceDescriptor
  requestedPipelineId: string
  /** Bestehende Engine-Einstellungen; der Worker validiert sie mit dem vorhandenen Schema. */
  settings: Record<string, unknown>
  createdAt: string
}

export interface SegmentRef { role: 'coldOpen' | 'main'; sourceStart: number; sourceEnd: number }

export interface AuditRef { decision: AuditStatus; renderAttemptId: string; clipRevision: string; renderedSha256: string; auditReportId: string }

export interface ClipResultPublished {
  eventId: string
  jobId: string
  projectId: string
  clipId: string
  projectRevision: number
  /** Wie `clipRevision` in shared/review.ts (Hash aus Grenzen + wirksamen Edit-Ops). */
  clipRevision: string
  renderAttemptId: string
  renderAssetId: string
  renderSha256: string
  audit: AuditRef
  segments: SegmentRef[]
  assetIds: string[]
}

export interface ClipImportedAck {
  eventId: string
  jobId: string
  clipId: string
  clipRevision: string
  renderAttemptId: string
  renderAssetId: string
  importedRenderSha256: string
  projectRevisionAtImport: number
}

export interface ProxyRangeRequest {
  requestId: string
  projectId: string
  sourceMediaId: string
  from: number
  to: number
  profile: 'scrub-low' | 'preview-standard'
}

export interface JobSnapshot {
  jobId: string
  compute: ComputeState
  stage?: string
  seq: number
  clips: Array<{ clipId: string; clipRevision: string; release: ReleaseState; delivery?: DeliveryState }>
  error?: { code: ErrorCode; message: string }
}

/** Kopf jeder Nachricht: Absender, Sequenz und eventId für Replay-/Duplikatschutz. */
interface Envelope { v: number; eventId: string; from: string; seq: number; sentAt: string }

export type RemoteMessage = Envelope & (
  | { type: 'PairRequest'; name: string; platform: 'win32' | 'darwin' | 'linux'; publicKey: string }
  | { type: 'PairDecision'; accepted: boolean; permissions?: DevicePermissions }
  | { type: 'UnpairNotice' }
  | { type: 'DeviceCapabilities'; readiness: WorkerReadiness }
  | { type: 'SubmitJob'; job: RemoteJobRequest }
  | { type: 'JobAccepted'; jobId: string }
  | { type: 'JobRejected'; jobId: string; code: ErrorCode; message: string }
  | { type: 'JobSnapshot'; snapshot: JobSnapshot }
  | { type: 'JobEvent'; jobId: string; compute: ComputeState; stage?: string; progress?: number }
  | { type: 'CancelJob'; jobId: string }
  | { type: 'ClipResultPublished'; clip: ClipResultPublished }
  | { type: 'ClipImportedAck'; ack: ClipImportedAck }
  | { type: 'RequestProxyRange'; request: ProxyRangeRequest }
  | { type: 'AssetUnavailable'; assetId: string; code: ErrorCode }
)

export type MessageType = RemoteMessage['type']

// ---------- Validierung (Vertrauensgrenze) ----------

export class ProtocolError extends Error {
  constructor(public readonly code: ErrorCode | 'MALFORMED', message: string) { super(message) }
}

type Obj = Record<string, unknown>
const isObj = (x: unknown): x is Obj => typeof x === 'object' && x !== null && !Array.isArray(x)
const ID = /^[A-Za-z0-9._:-]{1,128}$/
const SHA = /^[0-9a-f]{64}$/

function need(cond: boolean, what: string): void { if (!cond) throw new ProtocolError('MALFORMED', what) }
const id = (o: Obj, k: string): string => { const v = o[k]; need(typeof v === 'string' && ID.test(v), `${k}: ungültige ID`); return v as string }
const sha = (o: Obj, k: string): void => need(typeof o[k] === 'string' && SHA.test(o[k] as string), `${k}: kein SHA-256`)
const str = (o: Obj, k: string, max = 2000): void => need(typeof o[k] === 'string' && (o[k] as string).length <= max, `${k}: kein Text`)
const num = (o: Obj, k: string): void => need(typeof o[k] === 'number' && Number.isFinite(o[k] as number) && (o[k] as number) >= 0, `${k}: keine Zahl`)
const oneOf = (o: Obj, k: string, vals: readonly string[]): void => need(vals.includes(o[k] as string), `${k}: unbekannter Wert`)
const sub = (o: Obj, k: string): Obj => { need(isObj(o[k]), `${k}: kein Objekt`); return o[k] as Obj }

const COMPUTE: readonly ComputeState[] = ['created', 'queued', 'accepted', 'acquiring-source', 'preparing', 'transcribing', 'analyzing', 'selecting', 'rendering', 'auditing', 'repairing', 'publishing', 'completed', 'needs-input', 'resource-paused', 'failed', 'cancelled']
const RELEASE: readonly ReleaseState[] = ['processing', 'audit-review', 'repair-required', 'accepted-unpublished', 'published', 'superseded']
const DELIVERY: readonly DeliveryState[] = ['announced', 'transferring', 'verified', 'imported', 'acknowledged', 'retryable-error', 'permanently-unavailable']
const CODES: readonly ErrorCode[] = ['SOURCE_UNAVAILABLE', 'URL_BLOCKED', 'MODEL_MISSING', 'RELAY_UNAVAILABLE', 'INSUFFICIENT_SPACE', 'GPU_OOM', 'VERSION_INCOMPATIBLE', 'ASSET_CHECKSUM_FAIL', 'RENDER_AUDIT_FAILED', 'SOURCE_ORIGINAL_MISSING', 'STALE_CLIP_REVISION', 'DEVICE_REVOKED', 'PERMISSION_DENIED']

function checkClip(c: Obj): void {
  for (const k of ['eventId', 'jobId', 'projectId', 'clipId', 'clipRevision', 'renderAttemptId', 'renderAssetId']) id(c, k)
  num(c, 'projectRevision'); sha(c, 'renderSha256')
  const a = sub(c, 'audit')
  oneOf(a, 'decision', ['accepted', 'review', 'repair']); id(a, 'renderAttemptId'); id(a, 'clipRevision'); id(a, 'auditReportId'); sha(a, 'renderedSha256')
  need(Array.isArray(c.segments) && c.segments.length > 0 && c.segments.length <= 16, 'segments')
  for (const s of c.segments as unknown[]) {
    need(isObj(s), 'segment'); const o = s as Obj
    oneOf(o, 'role', ['coldOpen', 'main']); num(o, 'sourceStart'); num(o, 'sourceEnd')
    need((o.sourceEnd as number) > (o.sourceStart as number), 'segment: Ende vor Anfang')
  }
  need(Array.isArray(c.assetIds) && (c.assetIds as unknown[]).every((x) => typeof x === 'string' && ID.test(x)), 'assetIds')
}

function checkJob(j: Obj): void {
  for (const k of ['jobId', 'originDeviceId', 'targetDeviceId', 'projectId', 'requestedPipelineId']) id(j, k)
  num(j, 'projectRevision'); str(j, 'createdAt', 40); need(isObj(j.settings), 'settings')
  const s = sub(j, 'source')
  if (s.kind === 'url') str(s, 'url', 2048)
  else { need(s.kind === 'uploaded-file', 'source.kind'); id(s, 'assetId'); sha(s, 'sha256'); num(s, 'size') }
}

/** Prüft eine eingehende Nachricht vollständig; wirft `ProtocolError`. Unbekannte Felder werden ignoriert, nie ausgeführt. */
export function parseMessage(raw: unknown): RemoteMessage {
  const m = typeof raw === 'string' ? (JSON.parse(raw) as unknown) : raw
  need(isObj(m), 'Nachricht ist kein Objekt')
  const o = m as Obj
  if (o.v !== PROTOCOL_VERSION) throw new ProtocolError('VERSION_INCOMPATIBLE', `Protokoll ${String(o.v)} ≠ ${PROTOCOL_VERSION}`)
  id(o, 'eventId'); id(o, 'from'); num(o, 'seq'); str(o, 'sentAt', 40)
  switch (o.type) {
    case 'PairRequest': str(o, 'name', 80); oneOf(o, 'platform', ['win32', 'darwin', 'linux']); str(o, 'publicKey', 200); break
    case 'PairDecision': need(typeof o.accepted === 'boolean', 'accepted'); break
    case 'UnpairNotice': break
    case 'DeviceCapabilities': { const r = sub(o, 'readiness'); id(r, 'deviceId'); num(r, 'protocolVersion'); oneOf(r, 'status', ['ready', 'busy', 'missing-dependency', 'low-disk', 'incompatible']); break }
    case 'SubmitJob': checkJob(sub(o, 'job')); break
    case 'JobAccepted': case 'CancelJob': id(o, 'jobId'); break
    case 'JobRejected': id(o, 'jobId'); oneOf(o, 'code', CODES); str(o, 'message'); break
    case 'JobSnapshot': {
      const s = sub(o, 'snapshot'); id(s, 'jobId'); oneOf(s, 'compute', COMPUTE); num(s, 'seq')
      need(Array.isArray(s.clips), 'clips')
      for (const c of s.clips as unknown[]) {
        need(isObj(c), 'clip'); const x = c as Obj
        id(x, 'clipId'); id(x, 'clipRevision'); oneOf(x, 'release', RELEASE)
        if (x.delivery !== undefined) oneOf(x, 'delivery', DELIVERY)
      }
      break
    }
    case 'JobEvent': id(o, 'jobId'); oneOf(o, 'compute', COMPUTE); break
    case 'ClipResultPublished': checkClip(sub(o, 'clip')); break
    case 'ClipImportedAck': {
      const a = sub(o, 'ack')
      for (const k of ['eventId', 'jobId', 'clipId', 'clipRevision', 'renderAttemptId', 'renderAssetId']) id(a, k)
      sha(a, 'importedRenderSha256'); num(a, 'projectRevisionAtImport'); break
    }
    case 'RequestProxyRange': {
      const r = sub(o, 'request'); id(r, 'requestId'); id(r, 'projectId'); id(r, 'sourceMediaId'); num(r, 'from'); num(r, 'to')
      need((r.to as number) > (r.from as number), 'Bereich leer'); oneOf(r, 'profile', ['scrub-low', 'preview-standard']); break
    }
    case 'AssetUnavailable': id(o, 'assetId'); oneOf(o, 'code', CODES); break
    default: throw new ProtocolError('MALFORMED', `unbekannter Typ ${String(o.type)}`)
  }
  return m as RemoteMessage
}

/** Erlaubte Nachrichten je Recht. Pairing/Unpair/Status brauchen kein Recht (gehen nur zwischen gekoppelten Geräten). */
export function requiredPermission(type: MessageType): keyof DevicePermissions | null {
  switch (type) {
    case 'SubmitJob': return 'canSubmitJobs'
    case 'CancelJob': return 'canCancelOwnJobs'
    case 'RequestProxyRange': return 'canRequestProxies'
    case 'ClipImportedAck': return 'canReceiveResults'
    default: return null
  }
}

/** Replay-Schutz je Peer: jede eventId nur einmal, Sequenz streng steigend. */
export class ReplayGuard {
  private last = new Map<string, number>()
  private seen = new Set<string>()
  constructor(private readonly maxSeen = 10_000) {}
  accept(m: Pick<RemoteMessage, 'from' | 'seq' | 'eventId'>): boolean {
    const key = `${m.from}/${m.eventId}`
    if (this.seen.has(key) || m.seq <= (this.last.get(m.from) ?? -1)) return false
    this.last.set(m.from, m.seq)
    this.seen.add(key)
    if (this.seen.size > this.maxSeen) this.seen.delete(this.seen.values().next().value as string)
    return true
  }
}
