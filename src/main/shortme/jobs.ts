import { EventEmitter } from 'node:events'
import { randomUUID } from 'node:crypto'
import { friendlyError } from './errors'
import { logError, logInfo } from '../log'
import type { RunTiming } from '../../shared/shortme'

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
  /** Beginn der aktuellen Ausführung (ms seit 1970) – für „vergangen“ in der Oberfläche. */
  startedAt?: number
}

export interface JobContext { signal: AbortSignal; report: (stage: string, progress: number, message: string) => void; /** Bisher gemessene Dauer des Jobs, je gemeldeter Stufe. */ timing: () => RunTiming }

/** Misst, wie lange jede gemeldete Stufe lief (Stufenwechsel = Zeitpunkt der ersten Meldung der neuen Stufe). */
export function stageClock(now: () => number = Date.now): { mark: (stage: string) => void; timing: () => RunTiming } {
  const t0 = now(), sec = new Map<string, number>()
  let cur = '', at = t0
  return {
    mark: (stage) => { if (stage === cur) return; const t = now(); if (cur) sec.set(cur, (sec.get(cur) ?? 0) + (t - at) / 1000); cur = stage; at = t },
    timing: () => {
      const t = now(), out = new Map(sec)
      if (cur) out.set(cur, (out.get(cur) ?? 0) + (t - at) / 1000)
      return { totalSec: Math.round((t - t0) / 100) / 10, stages: [...out].map(([stage, s]) => ({ stage, sec: Math.round(s * 10) / 10 })) }
    }
  }
}
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
    const before = e.info
    e.info = { ...e.info, ...patch }
    // Verlauf ins Log: Zustands- und Stufenwechsel (nicht jede Prozentmeldung)
    if (before.state !== e.info.state || before.stage !== e.info.stage) (e.info.state === 'error' ? logError : logInfo)(`[Job] ${e.info.title} · ${e.info.state}${e.info.stage ? ` · ${e.info.stage}` : ''} · ${e.info.message}${e.info.error ? ` · Fehler: ${e.info.error}` : ''}`)
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
    this.set(e, { state: 'running', error: undefined, startedAt: Date.now() })
    try {
      const clock = stageClock()
      const done = await e.run({ signal: ac.signal, report: (stage, progress, message) => { clock.mark(stage); this.set(e, { stage, progress, message }) }, timing: clock.timing })
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
