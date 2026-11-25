// Engine 6 – Profiler (Kap. 14): monotone Zeiten je Phase/Aufgabe, Modellwechsel, Cache-Treffer, Wiederholungen, Spitzen von RAM (Hauptprozess + Systemfrei)
// und VRAM (nvidia-smi, belegt gesamt). Parallele Phasen werden nicht addiert: `wallSec` ist die echte Laufzeit, `phases` kann sich überlappen.
// Nicht messbare Werte stehen als null (unbekannt), nie als 0.
import { execFile } from 'node:child_process'
import { freemem, totalmem } from 'node:os'
import { performance } from 'node:perf_hooks'

export interface PhaseRecord { name: string; startSec: number; endSec: number; sec: number; parallel: boolean }
export interface ProfileReport {
  wallSec: number
  phases: PhaseRecord[]
  /** Summe nur der nicht-parallelen Phasen (kritischer Pfad grob) */
  criticalPathSec: number
  counters: Record<string, number>
  peakRssMb: number
  minFreeRamMb: number
  totalRamMb: number
  peakVramUsedMb: number | null
  vramSamples: number
  firstVerifiedSec: number | null
  verifiedAtSec: number[]
}

function nvidiaUsedMb(): Promise<number | null> {
  if (process.platform !== 'win32' && process.platform !== 'linux') return Promise.resolve(null)
  return new Promise((resolve) => execFile('nvidia-smi', ['--query-gpu=memory.used', '--format=csv,noheader,nounits'], { windowsHide: true, timeout: 4000 }, (err, out) => {
    if (err) return resolve(null)
    const v = out.split('\n').map((l) => Number(l.trim())).filter((x) => Number.isFinite(x))
    resolve(v.length ? v.reduce((a, b) => a + b, 0) : null)
  }))
}

export class Profiler {
  private t0 = performance.now()
  private phases: PhaseRecord[] = []
  readonly counters: Record<string, number> = {}
  private peakRss = 0
  private minFree = Infinity
  private peakVram: number | null = null
  private vramN = 0
  private timer: NodeJS.Timeout | null = null
  private verified: number[] = []

  start(everyMs = 3000): void {
    const sample = async (): Promise<void> => {
      this.peakRss = Math.max(this.peakRss, process.memoryUsage().rss)
      this.minFree = Math.min(this.minFree, freemem())
      const v = await nvidiaUsedMb()
      if (v !== null) { this.peakVram = Math.max(this.peakVram ?? 0, v); this.vramN++ }
    }
    void sample()
    this.timer = setInterval(() => void sample(), everyMs)
    this.timer.unref?.()
  }
  stop(): void { if (this.timer) clearInterval(this.timer); this.timer = null }
  now(): number { return (performance.now() - this.t0) / 1000 }
  count(key: string, n = 1): void { this.counters[key] = (this.counters[key] ?? 0) + n }
  markVerified(): void { this.verified.push(Math.round(this.now() * 10) / 10) }

  async phase<T>(name: string, fn: () => Promise<T>, parallel = false): Promise<T> {
    const a = this.now()
    try { return await fn() } finally { const b = this.now(); this.phases.push({ name, startSec: Math.round(a * 10) / 10, endSec: Math.round(b * 10) / 10, sec: Math.round((b - a) * 10) / 10, parallel }) }
  }

  report(): ProfileReport {
    return {
      wallSec: Math.round(this.now() * 10) / 10,
      phases: this.phases,
      criticalPathSec: Math.round(this.phases.filter((p) => !p.parallel).reduce((n, p) => n + p.sec, 0) * 10) / 10,
      counters: this.counters,
      peakRssMb: Math.round(this.peakRss / 1048576),
      minFreeRamMb: Number.isFinite(this.minFree) ? Math.round(this.minFree / 1048576) : -1,
      totalRamMb: Math.round(totalmem() / 1048576),
      peakVramUsedMb: this.peakVram,
      vramSamples: this.vramN,
      firstVerifiedSec: this.verified[0] ?? null,
      verifiedAtSec: this.verified
    }
  }
}
