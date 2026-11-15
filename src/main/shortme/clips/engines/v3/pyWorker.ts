// Client für den lokalen Python-Worker (Engine 3): Zeilen-JSON über stdin/stdout, Protokoll v1 (resources/python/worker.py).
// Jeder Aufruf trägt requestId + runId; Antworten werden gegen beide geprüft (verspätete Antworten eines alten Laufs verändern nichts).
// Der Prozess wird über die vorhandene Sidecar-Verwaltung getrackt (Aufräumen beim App-Ende und nach Abstürzen).
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createInterface } from 'node:readline'
import { killTree, track } from '../../../../engines/sidecars'

export const PROTOCOL_VERSION = 1

export interface WorkerError { code: string; message: string; recoverable: boolean }
export class PyWorkerError extends Error {
  constructor(readonly code: string, message: string, readonly recoverable = true) { super(message) }
}

interface Pending { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout; runId: string; onAbort?: () => void; signal?: AbortSignal }

/** Eine Antwortzeile prüfen (Schema, Protokollversion). Gibt null zurück bei Ereignissen ohne requestId. */
export function parseResponse(line: string): { requestId: string; runId: string | null; ok: boolean; result?: unknown; error?: WorkerError } | { event: string } {
  const o = JSON.parse(line) as Record<string, unknown>
  if (typeof o !== 'object' || o === null || o.protocolVersion !== PROTOCOL_VERSION) throw new Error('Protokollversion/Format ungültig')
  if (typeof o.event === 'string') return { event: o.event }
  if (typeof o.requestId !== 'string' || typeof o.ok !== 'boolean') throw new Error('Antwort ohne requestId/ok')
  if (!o.ok) {
    const e = o.error as Partial<WorkerError> | undefined
    if (!e || typeof e.code !== 'string') throw new Error('Fehlerantwort ungültig')
    return { requestId: o.requestId, runId: typeof o.runId === 'string' ? o.runId : null, ok: false, error: { code: e.code, message: String(e.message ?? ''), recoverable: e.recoverable !== false } }
  }
  return { requestId: o.requestId, runId: typeof o.runId === 'string' ? o.runId : null, ok: true, result: o.result }
}

export interface PyWorkerOptions { python: string; script: string; allowedRoots: string[]; modelRoots: string[]; env?: NodeJS.ProcessEnv }

export class PyWorker {
  private child: ChildProcessWithoutNullStreams | null = null
  private pending = new Map<string, Pending>()
  private ready: Promise<void> | null = null
  private stderrTail: string[] = []
  exited = false

  constructor(private readonly opts: PyWorkerOptions) {}

  /** Prozess starten und auf „ready“ warten (höchstens 90 s: der erste Import von torch dauert). */
  start(): Promise<void> {
    if (this.ready) return this.ready
    this.ready = new Promise<void>((resolve, reject) => {
      const args = [this.opts.script, ...this.opts.allowedRoots.flatMap((r) => ['--allowed-root', r]), ...this.opts.modelRoots.flatMap((r) => ['--model-root', r])]
      const child = spawn(this.opts.python, args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, PYTHONUNBUFFERED: '1', PYTHONIOENCODING: 'utf-8', HF_HUB_OFFLINE: '1', ...this.opts.env } })
      this.child = child
      void track(child, 'python-worker', 'python.exe')
      const timer = setTimeout(() => { reject(new PyWorkerError('start-timeout', 'Python-Worker startet nicht (90 s)', false)); void this.stop() }, 90_000)
      child.stderr.on('data', (d: Buffer) => { for (const l of d.toString('utf8').split(/\r?\n/)) if (l.trim()) { this.stderrTail.push(l); if (this.stderrTail.length > 60) this.stderrTail.shift() } })
      createInterface({ input: child.stdout }).on('line', (line) => {
        let msg: ReturnType<typeof parseResponse>
        try { msg = parseResponse(line) } catch (e) { this.stderrTail.push(`ungültige Zeile: ${String(e).slice(0, 120)}`); return }
        if ('event' in msg) { if (msg.event === 'ready') { clearTimeout(timer); resolve() } return }
        const p = this.pending.get(msg.requestId)
        // Antwort eines anderen Laufs oder unbekannte requestId: verwerfen
        if (!p || (msg.runId !== null && msg.runId !== p.runId)) return
        this.pending.delete(msg.requestId); clearTimeout(p.timer)
        if (p.signal && p.onAbort) p.signal.removeEventListener('abort', p.onAbort)
        if (msg.ok) p.resolve(msg.result); else p.reject(new PyWorkerError(msg.error!.code, msg.error!.message, msg.error!.recoverable))
      })
      child.on('error', (e) => { clearTimeout(timer); reject(new PyWorkerError('spawn-failed', `Python konnte nicht gestartet werden: ${e.message}`, false)) })
      child.on('exit', (code) => {
        this.exited = true; clearTimeout(timer)
        const why = new PyWorkerError('worker-exited', `Python-Worker beendet (Code ${code}). ${this.stderrTail.slice(-4).join(' | ')}`.slice(0, 500), false)
        for (const [id, p] of this.pending) { clearTimeout(p.timer); p.reject(why); this.pending.delete(id) }
        reject(why)
      })
    })
    return this.ready
  }

  /** Eine Operation ausführen. Zeitlimit und Abbruch (AbortSignal → cancel an den Worker). */
  async request<T>(op: string, payload: Record<string, unknown>, o: { runId: string; timeoutMs?: number; signal?: AbortSignal }): Promise<T> {
    await this.start()
    if (this.exited || !this.child) throw new PyWorkerError('worker-exited', 'Python-Worker läuft nicht', false)
    o.signal?.throwIfAborted()
    const requestId = randomUUID()
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(requestId); this.send({ protocolVersion: PROTOCOL_VERSION, requestId: randomUUID(), runId: o.runId, op: 'cancel', payload: { targetRequestId: requestId } }); reject(new PyWorkerError('timeout', `${op}: Zeitlimit überschritten`, true)) }, o.timeoutMs ?? 120_000)
      const onAbort = (): void => { const p = this.pending.get(requestId); if (!p) return; this.pending.delete(requestId); clearTimeout(timer); this.send({ protocolVersion: PROTOCOL_VERSION, requestId: randomUUID(), runId: o.runId, op: 'cancel', payload: { targetRequestId: requestId } }); reject(new PyWorkerError('cancelled', 'abgebrochen', true)) }
      o.signal?.addEventListener('abort', onAbort, { once: true })
      this.pending.set(requestId, { resolve: resolve as (v: unknown) => void, reject, timer, runId: o.runId, onAbort, signal: o.signal })
      this.send({ protocolVersion: PROTOCOL_VERSION, requestId, runId: o.runId, op, payload })
    })
  }

  private send(obj: unknown): void { try { this.child?.stdin.write(JSON.stringify(obj) + '\n') } catch { /* Prozess weg: exit-Handler räumt auf */ } }

  /** Beenden: erst höflich (shutdown), danach der ganze Prozessbaum. */
  async stop(): Promise<void> {
    const c = this.child
    if (!c || !c.pid) return
    this.send({ protocolVersion: PROTOCOL_VERSION, requestId: randomUUID(), runId: 'shutdown', op: 'shutdown', payload: {} })
    await new Promise((r) => setTimeout(r, 300))
    await killTree(c.pid)
    this.child = null; this.ready = null
  }
}
