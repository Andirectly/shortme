/**
 * Remote-Jobs (Plan V4, Kap. 5/6): Worker verarbeitet einen Link mit der normalen lokalen Pipeline, Client importiert Ergebnisse.
 *
 * Worker:  SubmitJob → Preflight → dauerhaft speichern → JobAccepted → Download (eigener Downloader, SSRF-geprüft) →
 *          Transkription/Analyse/Render über `Pipeline` (dieselben Funktionen wie lokal) → Outbox:
 *          Projektdateien + Quelle (AssetOffer) und je akzeptiertem Clip ClipResultPublished + MP4.
 *          Outbox bleibt bis zur Quittung (AssetAck/ClipImportedAck) und wird bei jeder Wiederverbindung erneut angeboten.
 * Client:  fordert angebotene Dateien an, prüft Länge + SHA-256, importiert atomar, quittiert erst danach.
 *          Projekt = normales lokales Projekt (Editor, Export unverändert nutzbar).
 *
 * shortcut: Statt ±30-s-Proxys wird die ganze Quelle übertragen (voll editierbar, mehr Daten); Proxy-Bereiche (shared/remote/proxyRanges)
 *           erst einbauen, wenn die Datenmenge stört. Re-Render nach Edits läuft lokal auf dem Client (Quelle liegt dort).
 */
import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, readFile, readdir, rename, rm, stat, statfs, writeFile, copyFile } from 'node:fs/promises'
import { dirname, join, relative, sep } from 'node:path'
import { EventEmitter } from 'node:events'
import type { AssetOffer, ClipResultPublished, ComputeState, ErrorCode, RemoteMessage, RemoteJobRequest } from '@shared/remote/protocol'
import { isSafeRelPath } from '@shared/remote/protocol'
import { auditStatusFrom, importDecision, importKey, makeAck, releaseGate, ackMatches } from '@shared/remote/releaseGate'
import { writeFileAtomic } from '../shortme/atomic'
import { sendFile, receiveFile } from './drive/drive'
import { checkUrl, UrlBlocked } from './urlGuard'
import type { DriveChannel } from './drive/types'

export async function sha256File(path: string): Promise<string> {
  const h = createHash('sha256')
  for await (const chunk of createReadStream(path)) h.update(chunk as Buffer)
  return h.digest('hex')
}

/** Netzwerkseite (RemoteHost) – als Schnittstelle, damit die Logik ohne Electron testbar ist. */
export interface Net {
  deviceId: string
  send(deviceId: string, body: Record<string, unknown> & { type: RemoteMessage['type'] }): boolean
  driveChannel(deviceId: string, transferId: string): DriveChannel | null
  isOnline(deviceId: string): boolean
}

/** Optionen, die der Client mitschickt (validiert, nur bekannte Felder). */
export interface RemoteJobSettings { contentType?: string; wanted?: number; engine?: string; frame?: string; query?: string; title?: string }

export function sanitizeSettings(raw: Record<string, unknown>): RemoteJobSettings {
  const s: RemoteJobSettings = {}
  const str = (k: keyof RemoteJobSettings, max: number): void => { const v = raw[k]; if (typeof v === 'string' && v.length <= max) (s as Record<string, unknown>)[k] = v }
  str('contentType', 20); str('engine', 30); str('frame', 20); str('query', 500); str('title', 200)
  if (typeof raw.wanted === 'number' && Number.isInteger(raw.wanted) && raw.wanted >= 1 && raw.wanted <= 30) s.wanted = raw.wanted
  return s
}

/** Die lokale ShortMe-Pipeline, wie sie auch lokale Läufe nutzen (in service.ts mit den echten Funktionen verdrahtet). */
export interface Pipeline {
  preflight(s: RemoteJobSettings): Promise<{ ok: true } | { ok: false; code: ErrorCode; message: string }>
  /** Lädt die Quelle; liefert Projekt-Hash, Projektordner und Quellpfad. */
  download(url: string, onProgress: (p: number, msg: string) => void, signal: AbortSignal): Promise<{ hash: string; projectDir: string; sourcePath: string; title: string }>
  /** Transkription + Analyse im normalen Job-Queue (bricht bei signal ab). */
  analyze(hash: string, s: RemoteJobSettings, onProgress: (stage: string, p: number, msg: string) => void, signal: AbortSignal): Promise<void>
  /** Clips des Projekts mit Prüfurteil der Engine. */
  clips(hash: string): Promise<Array<{ id: string; title: string; verdict: string | undefined; start: number; end: number; revision: string }>>
  /** Clips rendern (gleicher Code wie Export); ruft onRendered je fertiger Datei. */
  render(hash: string, clipIds: string[], outDir: string, onRendered: (clipId: string, path: string) => Promise<void>, onProgress: (p: number, msg: string) => void, signal: AbortSignal): Promise<void>
  /** Datei technisch lesbar (ffprobe: Video-/Tonspur, Dauer > 0)? */
  probeOk(path: string): Promise<boolean>
}

interface WorkerOffer extends AssetOffer { path: string; acked?: boolean }
interface WorkerJob {
  request: RemoteJobRequest
  requestHash: string
  origin: string
  compute: ComputeState
  stage?: string
  progress?: number
  error?: { code: ErrorCode; message: string }
  hash?: string
  offers: WorkerOffer[]
  published: Array<ClipResultPublished & { acked?: boolean }>
  updatedAt: string
}

const reqHash = (r: RemoteJobRequest): string => createHash('sha256').update(JSON.stringify([r.projectId, r.source, r.requestedPipelineId, r.settings])).digest('hex')
const errCode = (e: unknown): ErrorCode => (e instanceof UrlBlocked ? 'URL_BLOCKED' : ((e as { code?: ErrorCode }).code ?? 'SOURCE_UNAVAILABLE'))
const TERMINAL: ComputeState[] = ['completed', 'failed', 'cancelled']

/** Alle Dateien eines Ordners (rekursiv), relativ mit „/“; unfertige/temporäre Dateien ausgelassen. */
async function listFiles(dir: string): Promise<string[]> {
  const out: string[] = []
  for (const e of await readdir(dir, { withFileTypes: true, recursive: true })) {
    if (!e.isFile()) continue
    const rel = relative(dir, join(e.parentPath, e.name)).split(sep).join('/')
    if (/\.(part|tmp|bits)$/.test(rel) || !isSafeRelPath(rel)) continue
    out.push(rel)
  }
  return out.sort()
}

// ======================================================================= Worker

export class RemoteWorker extends EventEmitter {
  private jobs = new Map<string, WorkerJob>()
  private aborts = new Map<string, AbortController>()
  private serving = new Set<string>()

  constructor(private readonly root: string, private readonly net: Net, private readonly pipe: Pipeline) { super() }

  private file(jobId: string): string { return join(this.root, 'worker', `${jobId}.json`) }
  private async save(j: WorkerJob): Promise<void> { j.updatedAt = new Date().toISOString(); await writeFileAtomic(this.file(j.request.jobId), JSON.stringify(j, null, 1)) }

  /** Beim Start: gespeicherte Jobs laden; unterbrochene Läufe ab der sicheren Grenze neu starten. */
  async load(): Promise<void> {
    await mkdir(join(this.root, 'worker'), { recursive: true })
    for (const f of await readdir(join(this.root, 'worker'))) {
      if (!f.endsWith('.json')) continue
      try {
        const j = JSON.parse(await readFile(join(this.root, 'worker', f), 'utf8')) as WorkerJob
        this.jobs.set(j.request.jobId, j)
        if (!TERMINAL.includes(j.compute)) void this.run(j) // Stage-Wiederholung: Download/Analyse sind idempotent (Cache/Checkpoints)
      } catch (e) { console.warn('[remote] Job-Datei unlesbar:', f, (e as Error).message) }
    }
  }

  list(): WorkerJob[] { return [...this.jobs.values()] }

  async onMessage(from: string, m: RemoteMessage): Promise<void> {
    switch (m.type) {
      case 'SubmitJob': return this.submit(from, m.job)
      case 'CancelJob': { const j = this.jobs.get(m.jobId); if (j && j.origin === from) this.aborts.get(m.jobId)?.abort('cancel'); return }
      case 'AssetRequest': return this.serve(from, m.assetId)
      case 'AssetAck': return this.ack(from, (o) => o.assetId === m.assetId)
      case 'ClipImportedAck': {
        for (const j of this.jobs.values()) {
          if (j.origin !== from) continue
          const p = j.published.find((x) => ackMatches(x, m.ack))
          if (p && !p.acked) { p.acked = true; for (const o of j.offers) if (o.assetId === p.renderAssetId) o.acked = true; await this.save(j) }
        }
        return
      }
      default: return
    }
  }

  private async submit(from: string, req: RemoteJobRequest): Promise<void> {
    const reject = (code: ErrorCode, message: string): void => { this.net.send(from, { type: 'JobRejected', jobId: req.jobId, code, message }) }
    if (req.originDeviceId !== from || req.targetDeviceId !== this.net.deviceId) return reject('PERMISSION_DENIED', 'Absender/Ziel passen nicht zur Verbindung')
    const existing = this.jobs.get(req.jobId)
    if (existing) {
      // idempotent: gleiche ID + gleicher Inhalt → erneut bestätigen und Stand schicken; anderer Inhalt → ablehnen
      if (existing.origin !== from || existing.requestHash !== reqHash(req)) return reject('PERMISSION_DENIED', 'Job-ID mit anderem Inhalt')
      this.net.send(from, { type: 'JobAccepted', jobId: req.jobId })
      this.snapshot(existing)
      return this.resend(from)
    }
    if (req.source.kind !== 'url') return reject('SOURCE_UNAVAILABLE', 'Nur Links werden remote unterstützt; lokale Dateien bitte auf diesem Rechner verarbeiten')
    try { await checkUrl(req.source.url) } catch (e) { return reject('URL_BLOCKED', (e as Error).message) }
    const settings = sanitizeSettings(req.settings)
    const pf = await this.pipe.preflight(settings)
    if (!pf.ok) return reject(pf.code, pf.message)
    const job: WorkerJob = { request: { ...req, settings: settings as Record<string, unknown> }, requestHash: reqHash(req), origin: from, compute: 'accepted', offers: [], published: [], updatedAt: '' }
    this.jobs.set(req.jobId, job)
    await this.save(job) // erst dauerhaft, dann quittieren
    this.net.send(from, { type: 'JobAccepted', jobId: req.jobId })
    void this.run(job)
  }

  private async set(j: WorkerJob, compute: ComputeState, stage?: string, progress?: number): Promise<void> {
    j.compute = compute
    j.stage = stage
    j.progress = progress
    await this.save(j)
    this.net.send(j.origin, { type: 'JobEvent', jobId: j.request.jobId, compute, stage, progress })
    this.emit('changed')
  }

  private snapshot(j: WorkerJob): void {
    this.net.send(j.origin, { type: 'JobSnapshot', snapshot: { jobId: j.request.jobId, compute: j.compute, stage: j.stage, seq: Date.now(), clips: j.published.map((p) => ({ clipId: p.clipId, clipRevision: p.clipRevision, release: 'published' as const })), error: j.error } })
  }

  private async run(j: WorkerJob): Promise<void> {
    if (this.aborts.has(j.request.jobId)) return
    const ac = new AbortController()
    this.aborts.set(j.request.jobId, ac)
    const s = j.request.settings as RemoteJobSettings
    let lastSend = 0
    const tick = (compute: ComputeState) => (stage: string, p: number): void => {
      if (Date.now() - lastSend < 1000) return // Fortschritt höchstens 1×/s senden
      lastSend = Date.now()
      j.compute = compute
      this.net.send(j.origin, { type: 'JobEvent', jobId: j.request.jobId, compute, stage, progress: Math.max(0, Math.min(1, p)) })
    }
    try {
      if (j.request.source.kind !== 'url') throw new Error('Quelle fehlt')
      await this.set(j, 'acquiring-source', 'Download')
      await checkUrl(j.request.source.url) // DNS kann sich seit der Annahme geändert haben
      const src = await this.pipe.download(j.request.source.url, (p, msg) => tick('acquiring-source')(msg, p), ac.signal)
      j.hash = src.hash
      await this.set(j, 'analyzing', 'Analyse')
      await this.pipe.analyze(src.hash, s, (stage, p) => tick(stage.startsWith('trans') ? 'transcribing' : 'analyzing')(stage, p), ac.signal)
      // Projekt (inkl. Quelle) sofort anbieten: der Client kann alle Clips im Editor öffnen, auch die zur Prüfung
      await this.offerProject(j, src)
      const clips = await this.pipe.clips(src.hash)
      await this.set(j, 'rendering', 'Render', 0)
      const outDir = join(this.root, 'outbox', j.request.jobId)
      const accepted = clips.filter((c) => auditStatusFrom(c.verdict) === 'accepted')
      await this.pipe.render(src.hash, accepted.map((c) => c.id), outDir, async (clipId, path) => {
        const c = clips.find((x) => x.id === clipId)!
        await this.publishClip(j, c, path)
      }, (p, msg) => tick('rendering')(msg, p), ac.signal)
      await this.set(j, 'completed', `${j.published.length} Clips freigegeben, ${clips.length - accepted.length} zur Prüfung im Projekt`)
    } catch (e) {
      const cancelled = ac.signal.aborted
      j.error = cancelled ? undefined : { code: errCode(e), message: (e as Error).message.slice(0, 500) }
      await this.set(j, cancelled ? 'cancelled' : 'failed', cancelled ? 'Abgebrochen' : j.error!.message)
    } finally {
      this.aborts.delete(j.request.jobId)
      this.snapshot(j)
    }
  }

  /** Renderdatei gegen die Freigabe-Schranke prüfen; nur `accepted` zum exakten Hash wird veröffentlicht. */
  private async publishClip(j: WorkerJob, c: { id: string; title: string; verdict: string | undefined; start: number; end: number; revision: string }, path: string): Promise<void> {
    const sha = await sha256File(path)
    const attempt = `r${randomUUID().slice(0, 8)}`
    const checked = await this.pipe.probeOk(path)
    const audit = { status: auditStatusFrom(c.verdict), renderAttemptId: attempt, clipRevision: c.revision, renderedSha256: sha }
    const gate = releaseGate({ clipId: c.id, clipRevision: c.revision, renderAttemptId: attempt, renderSha256: sha, fileChecked: checked }, audit, c.revision)
    if (!gate.ok) { console.warn('[remote] Clip nicht freigegeben:', c.id, gate.reason); return }
    const size = (await stat(path)).size
    const assetId = `a${createHash('sha256').update(`${j.request.jobId}/${c.id}/${attempt}`).digest('hex').slice(0, 24)}`
    const offer: WorkerOffer = { assetId, jobId: j.request.jobId, kind: 'render', relPath: `${safeName(c.title)}.mp4`, size, sha256: sha, clipId: c.id, path, projectHash: j.hash }
    const pub: ClipResultPublished = {
      eventId: `p${randomUUID().slice(0, 12)}`, jobId: j.request.jobId, projectId: j.request.projectId, clipId: c.id, projectRevision: j.request.projectRevision,
      clipRevision: c.revision, renderAttemptId: attempt, renderAssetId: assetId, renderSha256: sha,
      audit: { decision: 'accepted', renderAttemptId: attempt, clipRevision: c.revision, renderedSha256: sha, auditReportId: `au-${c.id}` },
      segments: [{ role: 'main', sourceStart: c.start, sourceEnd: c.end }], assetIds: [assetId]
    }
    j.offers.push(offer)
    j.published.push(pub)
    await this.save(j) // Event + Outbox gemeinsam dauerhaft, dann senden
    this.net.send(j.origin, { type: 'ClipResultPublished', clip: pub })
    this.net.send(j.origin, { type: 'AssetOffer', offer: strip(offer) })
  }

  private async offerProject(j: WorkerJob, src: { hash: string; projectDir: string; sourcePath: string }): Promise<void> {
    if (j.offers.some((o) => o.kind !== 'render')) return // schon angeboten (Neustart)
    const files = await listFiles(src.projectDir)
    const total = files.length + 1
    const base = { jobId: j.request.jobId, bundleTotal: total, projectHash: src.hash, workerProjectDir: src.projectDir, workerSourcePath: src.sourcePath }
    for (const rel of files) {
      const path = join(src.projectDir, ...rel.split('/'))
      j.offers.push({ ...base, assetId: `f${createHash('sha256').update(`${j.request.jobId}/${rel}`).digest('hex').slice(0, 24)}`, kind: 'project-file', relPath: rel, size: (await stat(path)).size, sha256: await sha256File(path), path })
    }
    j.offers.push({ ...base, assetId: `s${createHash('sha256').update(`${j.request.jobId}/source`).digest('hex').slice(0, 24)}`, kind: 'source', relPath: 'source.mp4', size: (await stat(src.sourcePath)).size, sha256: await sha256File(src.sourcePath), path: src.sourcePath })
    await this.save(j)
    for (const o of j.offers) if (o.kind !== 'render') this.net.send(j.origin, { type: 'AssetOffer', offer: strip(o) })
  }

  /** Datei nur an den Auftraggeber des Jobs und nur aus der Outbox (keine beliebigen Pfade). */
  private async serve(from: string, assetId: string): Promise<void> {
    const j = [...this.jobs.values()].find((x) => x.origin === from && x.offers.some((o) => o.assetId === assetId))
    const o = j?.offers.find((x) => x.assetId === assetId)
    if (!o) { this.net.send(from, { type: 'AssetUnavailable', assetId, code: 'PERMISSION_DENIED' }); return }
    if (this.serving.has(assetId)) return
    const ch = this.net.driveChannel(from, assetId)
    if (!ch) return
    this.serving.add(assetId)
    try {
      if ((await sha256File(o.path)) !== o.sha256) { this.net.send(from, { type: 'AssetUnavailable', assetId, code: o.kind === 'source' ? 'SOURCE_ORIGINAL_MISSING' : 'ASSET_CHECKSUM_FAIL' }); return }
      await sendFile(o.path, ch, { transferId: assetId, name: o.relPath.split('/').pop() })
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') this.net.send(from, { type: 'AssetUnavailable', assetId, code: o.kind === 'source' ? 'SOURCE_ORIGINAL_MISSING' : 'SOURCE_UNAVAILABLE' })
    } finally { ch.close(); this.serving.delete(assetId) }
  }

  private async ack(from: string, match: (o: WorkerOffer) => boolean): Promise<void> {
    for (const j of this.jobs.values()) {
      if (j.origin !== from) continue
      const o = j.offers.find(match)
      if (o && !o.acked) { o.acked = true; await this.save(j) }
    }
  }

  /** Nach Wiederverbindung: Stand + alle unquittierten Angebote/Publikationen erneut senden (Client dedupliziert). */
  resend(deviceId: string): void {
    for (const j of this.jobs.values()) {
      if (j.origin !== deviceId) continue
      this.snapshot(j)
      for (const p of j.published) if (!p.acked) this.net.send(deviceId, { type: 'ClipResultPublished', clip: stripAck(p) })
      for (const o of j.offers) if (!o.acked) this.net.send(deviceId, { type: 'AssetOffer', offer: strip(o) })
    }
  }
}

const strip = (o: WorkerOffer): AssetOffer => { const { path: _p, acked: _a, ...rest } = o; return rest }
const stripAck = (p: ClipResultPublished & { acked?: boolean }): ClipResultPublished => { const { acked: _a, ...rest } = p; return rest }
const safeName = (s: string): string => (s.replace(/[^A-Za-z0-9 _-]/g, '').trim().slice(0, 60) || 'clip').replace(/^[^A-Za-z0-9_]+/, '')

// ======================================================================= Client (Origin)

export interface ClientJob {
  jobId: string
  deviceId: string
  url: string
  title: string
  settings: RemoteJobSettings
  createdAt: string
  /** Worker hat dauerhaft angenommen. */
  accepted?: boolean
  rejected?: { code: string; message: string }
  compute?: ComputeState
  stage?: string
  progress?: number
  /** Zeitpunkt der letzten Nachricht vom Worker zu diesem Job (für „zuletzt bekannt“). */
  lastUpdateAt?: string
  projectHash?: string
  projectImported?: boolean
  bundle: Record<string, { relPath: string; kind: string; done: boolean }>
  bundleTotal?: number
  workerProjectDir?: string
  workerSourcePath?: string
  clips: Record<string, { title: string; ready: boolean; path?: string }>
}

/** Wo importierte Daten landen (in service.ts: Projektordner + Exportordner der App). */
export interface ClientStore {
  projectDir(hash: string): string
  /** Projekt fertig importiert (z. B. Mediapfade freigeben, Liste aktualisieren). */
  onProjectImported(hash: string): Promise<void>
  /** Freigegebenes MP4 im Projekt/Exportverzeichnis ablegen; gibt den endgültigen Pfad zurück. */
  importRender(hash: string | undefined, clipId: string, title: string, tmpPath: string): Promise<string>
}

export class RemoteClient extends EventEmitter {
  private jobs = new Map<string, ClientJob>()
  private offers = new Map<string, AssetOffer>()
  private pubs = new Map<string, ClipResultPublished>()
  private receiving = new Set<string>()
  private imported = new Set<string>()
  private stopped = false
  /** Ohne Fortschritt so lange warten, bevor eine Übertragung neu angefordert wird. */
  stallMs = 20_000

  constructor(private readonly root: string, private readonly net: Net, private readonly store: ClientStore) { super() }

  /** Keine neuen Versuche mehr (App beendet / Remote ausgeschaltet). */
  stop(): void { this.stopped = true }

  private isDone(o: AssetOffer): boolean {
    const j = this.jobs.get(o.jobId)
    if (!j) return true
    if (o.kind === 'render') { const p = this.pubs.get(o.assetId); return !p || this.imported.has(importKey(p)) }
    return !!j.projectImported || !!j.bundle[o.assetId]?.done
  }

  private file(jobId: string): string { return join(this.root, 'client', `${jobId}.json`) }
  private async save(j: ClientJob): Promise<void> { await writeFileAtomic(this.file(j.jobId), JSON.stringify(j, null, 1)); this.emit('changed') }
  private incoming(jobId: string): string { return join(this.root, 'incoming', jobId) }

  async load(): Promise<void> {
    await mkdir(join(this.root, 'client'), { recursive: true })
    for (const f of await readdir(join(this.root, 'client'))) {
      if (!f.endsWith('.json')) continue
      try { const j = JSON.parse(await readFile(join(this.root, 'client', f), 'utf8')) as ClientJob; this.jobs.set(j.jobId, j) } catch { /* beschädigt: ignorieren */ }
    }
    try { for (const k of JSON.parse(await readFile(join(this.root, 'imported.json'), 'utf8')) as string[]) this.imported.add(k) } catch { /* noch keine */ }
  }

  list(): ClientJob[] { return [...this.jobs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)) }

  /** Neuen Link-Job anlegen: Job-ID vor dem Senden dauerhaft speichern; erneutes Senden ist idempotent. */
  async submit(deviceId: string, url: string, settings: RemoteJobSettings): Promise<ClientJob> {
    await checkUrl(url).catch((e: Error) => { throw new Error(`Link abgelehnt: ${e.message}`) })
    const jobId = `j${randomUUID().replace(/-/g, '').slice(0, 20)}`
    const j: ClientJob = { jobId, deviceId, url, title: settings.title ?? url, settings: sanitizeSettings(settings as Record<string, unknown>), createdAt: new Date().toISOString(), bundle: {}, clips: {} }
    await this.save(j)
    this.jobs.set(jobId, j)
    this.sendSubmit(j)
    return j
  }

  private sendSubmit(j: ClientJob): void {
    const req: RemoteJobRequest = { jobId: j.jobId, originDeviceId: this.net.deviceId, targetDeviceId: j.deviceId, projectId: j.jobId, projectRevision: 1, source: { kind: 'url', url: j.url }, requestedPipelineId: j.settings.engine ?? 'default', settings: j.settings as Record<string, unknown>, createdAt: j.createdAt }
    this.net.send(j.deviceId, { type: 'SubmitJob', job: req })
  }

  cancel(jobId: string): boolean {
    const j = this.jobs.get(jobId)
    return !!j && this.net.send(j.deviceId, { type: 'CancelJob', jobId })
  }

  async forget(jobId: string): Promise<void> {
    this.jobs.delete(jobId)
    await rm(this.file(jobId), { force: true })
    await rm(this.incoming(jobId), { recursive: true, force: true })
    this.emit('changed')
  }

  /** Nach Wiederverbindung: nicht angenommene Jobs erneut senden (Worker dedupliziert). */
  reconnected(deviceId: string): void {
    for (const j of this.jobs.values()) if (j.deviceId === deviceId && !j.accepted && !j.rejected) this.sendSubmit(j)
  }

  async onMessage(from: string, m: RemoteMessage): Promise<void> {
    const job = (id: string): ClientJob | undefined => { const j = this.jobs.get(id); return j && j.deviceId === from ? j : undefined }
    const at = new Date().toISOString()
    switch (m.type) {
      case 'JobAccepted': { const j = job(m.jobId); if (j && !j.accepted) { j.accepted = true; j.lastUpdateAt = at; await this.save(j) } return }
      case 'JobRejected': { const j = job(m.jobId); if (j) { j.rejected = { code: m.code, message: m.message }; j.lastUpdateAt = at; await this.save(j) } return }
      case 'JobEvent': { const j = job(m.jobId); if (j) { j.accepted = true; j.compute = m.compute; j.stage = m.stage; j.progress = m.progress; j.lastUpdateAt = at; this.emit('changed') ; if (TERMINAL.includes(m.compute)) await this.save(j) } return }
      case 'JobSnapshot': { const j = job(m.snapshot.jobId); if (j) { j.accepted = true; j.compute = m.snapshot.compute; j.stage = m.snapshot.stage ?? j.stage; j.lastUpdateAt = at; await this.save(j) } return }
      case 'ClipResultPublished': {
        const j = job(m.clip.jobId)
        if (!j) return
        const d = importDecision(m.clip, this.imported, undefined)
        if (d === 'invalid') return
        if (d === 'already-imported') { this.ackClip(from, m.clip, j); return } // ACK verloren → erneut quittieren, kein Duplikat
        this.pubs.set(m.clip.renderAssetId, m.clip)
        j.clips[m.clip.clipId] ??= { title: m.clip.clipId, ready: false }
        await this.save(j)
        const o = this.offers.get(m.clip.renderAssetId)
        if (o) this.request(from, o)
        return
      }
      case 'AssetOffer': {
        const j = job(m.offer.jobId)
        if (!j) return
        this.offers.set(m.offer.assetId, m.offer)
        if (m.offer.kind !== 'render') {
          if (j.projectImported || j.bundle[m.offer.assetId]?.done) { this.net.send(from, { type: 'AssetAck', assetId: m.offer.assetId }); return }
          j.bundle[m.offer.assetId] ??= { relPath: m.offer.relPath, kind: m.offer.kind, done: false }
          j.bundleTotal = m.offer.bundleTotal
          j.projectHash = m.offer.projectHash
          j.workerProjectDir = m.offer.workerProjectDir
          j.workerSourcePath = m.offer.workerSourcePath
          await this.save(j)
          this.request(from, m.offer)
        } else {
          if (m.offer.clipId) j.clips[m.offer.clipId] = { ...(j.clips[m.offer.clipId] ?? { ready: false }), title: m.offer.relPath.replace(/\.mp4$/, '') }
          if (this.pubs.has(m.offer.assetId)) this.request(from, m.offer)
        }
        return
      }
      case 'AssetUnavailable': this.emit('asset-unavailable', m.assetId, m.code); return
      default: return
    }
  }

  /** Datei anfordern und empfangen (Resume über gespeicherte Chunk-Bitmap), danach Länge + SHA-256 prüfen. */
  private request(from: string, o: AssetOffer): void {
    if (this.receiving.has(o.assetId)) return
    const ch = this.net.driveChannel(from, o.assetId)
    if (!ch) return
    this.receiving.add(o.assetId)
    const target = join(this.incoming(o.jobId), o.assetId)
    // Wächter: Anforderung oder Verbindung kann bei einem Verbindungswechsel verloren gehen → nach STALL_MS ohne Fortschritt neu anfordern
    const ac = new AbortController()
    let lastActivity = Date.now()
    let ok = false
    const watchdog = setInterval(() => { if (Date.now() - lastActivity > this.stallMs) ac.abort() }, 1000)
    void (async () => {
      await mkdir(dirname(target), { recursive: true })
      const bitsFile = `${target}.bits`
      const resumeBits = await readFile(bitsFile).then((b) => new Uint8Array(b)).catch(() => undefined)
      let lastBits = 0
      const done = receiveFile(target, ch, {
        transferId: o.assetId, expectedSize: o.size, overwrite: true, resumeBits, signal: ac.signal,
        onChunkWritten: (bm) => { lastActivity = Date.now(); if (Date.now() - lastBits > 1000) { lastBits = Date.now(); void writeFile(bitsFile, bm.serialize()).catch(() => undefined) } },
        onProgress: (got, total) => { lastActivity = Date.now(); this.emit('transfer', o.assetId, got, total) }
      })
      this.net.send(from, { type: 'AssetRequest', assetId: o.assetId })
      const path = await done
      await rm(bitsFile, { force: true })
      if ((await stat(path)).size !== o.size || (await sha256File(path)) !== o.sha256) { await rm(path, { force: true }); throw Object.assign(new Error('Prüfsumme falsch'), { code: 'ASSET_CHECKSUM_FAIL' }) }
      await this.received(from, o, path)
      ok = true
    })().catch((e: Error) => { if (!/disconnected|cancel/i.test(e.message)) console.warn('[remote] Empfang', o.assetId, e.message) })
      .finally(() => {
        clearInterval(watchdog)
        ch.close()
        this.receiving.delete(o.assetId)
        // abgebrochen (Wächter/Verbindungswechsel): erneut versuchen, solange das Gerät erreichbar ist; sonst beim nächsten Wiederverbinden
        if (!ok && !this.stopped) setTimeout(() => { if (this.net.isOnline(from) && this.offers.get(o.assetId) && !this.isDone(o)) this.request(from, o) }, 2000)
      })
  }

  private async received(from: string, o: AssetOffer, path: string): Promise<void> {
    const j = this.jobs.get(o.jobId)
    if (!j) return
    if (o.kind === 'render') {
      const pub = this.pubs.get(o.assetId)
      if (!pub || pub.renderSha256 !== o.sha256) return
      if (this.imported.has(importKey(pub))) { this.ackClip(from, pub, j); return }
      const final = await this.store.importRender(j.projectHash, pub.clipId, j.clips[pub.clipId]?.title ?? pub.clipId, path)
      this.imported.add(importKey(pub))
      await writeFileAtomic(join(this.root, 'imported.json'), JSON.stringify([...this.imported]))
      j.clips[pub.clipId] = { title: j.clips[pub.clipId]?.title ?? pub.clipId, ready: true, path: final }
      await this.save(j)
      this.ackClip(from, pub, j) // erst nach dauerhaftem Import
      return
    }
    j.bundle[o.assetId] = { relPath: o.relPath, kind: o.kind, done: true }
    await this.save(j)
    if (j.bundleTotal && Object.values(j.bundle).filter((b) => b.done).length >= j.bundleTotal && !j.projectImported) await this.importProject(from, j)
  }

  private ackClip(from: string, pub: ClipResultPublished, j: ClientJob): void {
    this.net.send(from, { type: 'ClipImportedAck', ack: makeAck(pub, `k${randomUUID().slice(0, 12)}`, pub.renderSha256, 1) })
    void j
  }

  /** Alle Projektdateien verifiziert → in den Projektordner verschieben, Worker-Pfade auf eigene umschreiben, quittieren. */
  private async importProject(from: string, j: ClientJob): Promise<void> {
    const hash = j.projectHash
    if (!hash || !/^[A-Za-z0-9_-]{4,128}$/.test(hash)) return
    const dest = this.store.projectDir(hash)
    const staging = `${dest}.remote-import`
    await rm(staging, { recursive: true, force: true })
    await mkdir(staging, { recursive: true })
    for (const [assetId, b] of Object.entries(j.bundle)) {
      if (!isSafeRelPath(b.relPath)) throw new Error('unzulässiger Pfad')
      const to = join(staging, ...b.relPath.split('/'))
      await mkdir(dirname(to), { recursive: true })
      await copyFile(join(this.incoming(j.jobId), assetId), to)
    }
    const localSource = join(dest, 'source.mp4')
    // Gespeicherte absolute Pfade des Workers (Projektordner, Quelle) auf die eigenen abbilden – auch JSON-escaped (Windows-Backslashes)
    const pairs: Array<[string, string]> = []
    if (j.workerSourcePath) pairs.push([j.workerSourcePath, localSource])
    if (j.workerProjectDir) pairs.push([j.workerProjectDir, dest])
    for (const rel of await listFiles(staging)) {
      if (!/\.(json|jsonl)$/.test(rel)) continue
      const f = join(staging, ...rel.split('/'))
      let text = await readFile(f, 'utf8')
      for (const [from_, to] of pairs) {
        text = text.split(JSON.stringify(from_).slice(1, -1)).join(JSON.stringify(to).slice(1, -1))
        text = text.split(from_).join(to)
      }
      await writeFile(f, text)
    }
    // Gleiches Video schon lokal vorhanden: nie überschreiben, sondern beiseitelegen (lokale Bearbeitungen bleiben erhalten)
    if (await stat(dest).then(() => true, () => false)) await rename(dest, `${dest}.local-${Date.now()}`)
    await rename(staging, dest)
    j.projectImported = true
    await this.save(j)
    await this.store.onProjectImported(hash)
    for (const assetId of Object.keys(j.bundle)) this.net.send(from, { type: 'AssetAck', assetId })
    for (const assetId of Object.keys(j.bundle)) await rm(join(this.incoming(j.jobId), assetId), { force: true }) // Renders können noch eintreffen
  }

  /** Freier Speicher für eingehende Daten (Kap. 8): vor dem Senden prüfen. */
  static async freeBytes(dir: string): Promise<number> {
    await mkdir(dir, { recursive: true })
    const s = await statfs(dir)
    return s.bavail * s.bsize
  }
}
