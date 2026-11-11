import { EventEmitter } from 'node:events'
import { randomUUID } from 'node:crypto'
import { friendlyError } from './errors'

export type JobState = 'queued' | 'running' | 'paused' | 'stopped' | 'done' | 'error'

export interface JobInfo {
  id: string
  hash: string
  title: string
  state: JobState
  stage: string
  progress: number
  message: string
  error?: string
}

export interface JobContext { signal: AbortSignal; report: (stage: string, progress: number, message: string) => void }
/** Rückgabe (optional) = Abschlussmeldung des Jobs, z. B. „Exportiert nach …“. */
type Runner = (ctx: JobContext) => Promise<void | string>

interface Entry { info: JobInfo; run: Runner; ac: AbortController | null; onDiscard?: () => Promise<void> }

/**
 * Job-Warteschlange (eine Stufe gleichzeitig): Pausieren (Checkpoint bleibt, Fortsetzen möglich),
 * „Stoppen & behalten“ (Ergebnisse bleiben), Verwerfen (Projektdaten löschen).
 */
export class JobQueue extends EventEmitter {
  private jobs = new Map<string, Entry>()
  private order: string[] = []
  private running = false

  enqueue(hash: string, title: string, run: Runner, onDiscard?: () => Promise<void>): JobInfo {
    const info: JobInfo = { id: randomUUID(), hash, title, state: 'queued', stage: '', progress: 0, message: 'Wartet …' }
    this.jobs.set(info.id, { info, run, ac: null, onDiscard })
    this.order.push(info.id)
    this.emit('job', { ...info })
    void this.pump()
    return { ...info }
  }

  list(): JobInfo[] { return this.order.map((id) => ({ ...this.jobs.get(id)!.info })) }
  get(id: string): JobInfo | undefined { const e = this.jobs.get(id); return e && { ...e.info } }

  private set(e: Entry, patch: Partial<JobInfo>): void {
    e.info = { ...e.info, ...patch }
    this.emit('job', { ...e.info })
  }

  private async pump(): Promise<void> {
    if (this.running) return
    this.running = true
    try {
      for (;;) {
        const next = this.order.map((id) => this.jobs.get(id)!).find((e) => e.info.state === 'queued')
        if (!next) break
        await this.execute(next)
      }
    } finally { this.running = false }
  }

  private async execute(e: Entry): Promise<void> {
    const ac = new AbortController()
    e.ac = ac
    this.set(e, { state: 'running', error: undefined })
    try {
      const done = await e.run({ signal: ac.signal, report: (stage, progress, message) => this.set(e, { stage, progress, message }) })
      this.set(e, { state: 'done', progress: 1, message: typeof done === 'string' ? done : 'Fertig' })
    } catch (err) {
      const reason = ac.signal.aborted ? String(ac.signal.reason) : ''
      if (reason === 'pause') this.set(e, { state: 'paused', message: 'Pausiert' })
      else if (reason === 'stop') this.set(e, { state: 'stopped', message: 'Gestoppt (Ergebnisse behalten)' })
      else if (reason === 'discard') this.set(e, { state: 'stopped', message: 'Verworfen' })
      else {
        console.error('Job fehlgeschlagen:', e.info.title, err)
        this.set(e, { state: 'error', error: friendlyError(err), message: 'Fehler' })
      }
    } finally { e.ac = null }
  }

  pause(id: string): void { this.jobs.get(id)?.ac?.abort('pause') }
  stop(id: string): void {
    const e = this.jobs.get(id)
    if (!e) return
    if (e.ac) e.ac.abort('stop')
    else if (e.info.state === 'queued' || e.info.state === 'paused') this.set(e, { state: 'stopped', message: 'Gestoppt' })
  }

  /** Pausierten/gestoppten/fehlgeschlagenen Job erneut einreihen (setzt per Checkpoint fort). */
  resume(id: string): void {
    const e = this.jobs.get(id)
    if (!e || !['paused', 'stopped', 'error'].includes(e.info.state)) return
    this.set(e, { state: 'queued', message: 'Wartet …', error: undefined })
    void this.pump()
  }

  async discard(id: string): Promise<void> {
    const e = this.jobs.get(id)
    if (!e) return
    if (e.ac) {
      const done = new Promise<void>((r) => { const h = (i: JobInfo): void => { if (i.id === id && i.state !== 'running') { this.off('job', h); r() } }; this.on('job', h) })
      e.ac.abort('discard')
      await done
    }
    await e.onDiscard?.()
    this.jobs.delete(id)
    this.order = this.order.filter((x) => x !== id)
    this.emit('removed', id)
  }
}
