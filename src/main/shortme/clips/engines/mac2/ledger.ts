// Engine Mac 2 – Aufgabenbuch: jede echte Aufgabe (Medienpaket, Planungsaufruf, Render, Prüfpaket, Modellladen) mit Art, Kandidat, Grund und Dauer.
// Daraus: Zähler im Fortschritt („Clip 3 von 6 rendern“), Tempo je Aufgabenart aus erledigter Arbeit und Restzeit aus der echten Warteschlange
// (estimateRemainingSeconds: fehlende Messwerte = unbekannt, nie 0). Zusatzarbeit (Kontext, JSON-Korrektur, Gemma, Reparatur) läuft über dieselben Zähler.
import { estimateRemainingSeconds, type RemainingWork } from './runtimePolicy'

export type TaskKind = 'proxy' | 'model-load' | 'speech-window' | 'embed-window' | 'speech-window' | 'embed' | 'observe-packet' | 'plan' | 'rank' | 'render' | 'audit-packet' | 'audit-judge' | 'gemma' | 'repair-render'
export type TaskReason = 'initial' | 'context' | 'schema-retry' | 'repair' | 'fallback'

export interface TaskRecord { kind: TaskKind; label: string; candidate?: string; reason: TaskReason; model?: string; ms: number; ok: boolean; error?: string; units: number; at: string }

export class Ledger {
  readonly tasks: TaskRecord[] = []
  /** Geplante, noch offene Arbeit je Art (Einheiten: Pakete, Aufrufe, Clip-Sekunden beim Rendern). */
  private queued = new Map<TaskKind, number>()
  readonly t0 = Date.now()
  /** Gemessenes Tempo früherer Läufe auf diesem Rechner (Sekunden je Einheit), bis die eigene Messung vorliegt. */
  constructor(private readonly priors: Partial<Record<TaskKind, number>> = {}) {}

  plan(kind: TaskKind, units: number): void { this.queued.set(kind, Math.max(0, (this.queued.get(kind) ?? 0) + units)) }
  /** Offene Arbeit einer Art auf den jetzt bekannten Wert setzen (ersetzt die Vorab-Schätzung). */
  set(kind: TaskKind, units: number): void { this.queued.set(kind, Math.max(0, units)) }
  planned(kind: TaskKind): number { return this.queued.get(kind) ?? 0 }

  /** Aufgabe ausführen und buchen (auch bei Fehler); `units` = erledigte Einheiten (z. B. Clip-Sekunden). */
  async run<T>(kind: TaskKind, label: string, o: { candidate?: string; reason?: TaskReason; model?: string; units?: number }, fn: () => Promise<T>): Promise<T> {
    const a = Date.now()
    const units = o.units ?? 1
    try {
      const r = await fn()
      this.book({ kind, label, candidate: o.candidate, reason: o.reason ?? 'initial', model: o.model, ms: Date.now() - a, ok: true, units })
      return r
    } catch (e) {
      this.book({ kind, label, candidate: o.candidate, reason: o.reason ?? 'initial', model: o.model, ms: Date.now() - a, ok: false, error: e instanceof Error ? e.message.slice(0, 300) : String(e), units })
      throw e
    }
  }

  book(r: Omit<TaskRecord, 'at'>): void {
    this.tasks.push({ ...r, at: new Date().toISOString() })
    this.queued.set(r.kind, Math.max(0, (this.queued.get(r.kind) ?? 0) - r.units))
  }

  count(kind: TaskKind, reason?: TaskReason, candidate?: string): number {
    return this.tasks.filter((t) => t.kind === kind && (!reason || t.reason === reason) && (!candidate || t.candidate === candidate)).length
  }

  /** Gemessene Sekunden je Einheit (Mittel der erledigten Aufgaben); null = noch keine Messung. */
  secondsPerUnit(kind: TaskKind): number | null {
    const done = this.tasks.filter((t) => t.kind === kind && t.ok && t.units > 0)
    if (!done.length) return this.priors[kind] ?? null
    return done.reduce((s, t) => s + t.ms / 1000, 0) / done.reduce((s, t) => s + t.units, 0)
  }

  /** Restzeit aus der Warteschlange; null = „Zeit wird ermittelt“ (eine Art ohne Messung hat offene Arbeit). */
  remainingSeconds(extra: RemainingWork[] = []): number | null {
    const work: RemainingWork[] = [...this.queued.entries()].filter(([, u]) => u > 0).map(([k, u]) => ({ units: Math.ceil(u), measuredSecondsPerUnit: this.secondsPerUnit(k) }))
    const all = estimateRemainingSeconds([...work, ...extra])
    if (all === null) return null
    // Rendern läuft parallel zu Planung und Prüfung (Vorab-Render-Warteschlange) → nur der Teil zählt, der darüber hinausgeht
    const sec = (k: TaskKind): number => (this.queued.get(k) ?? 0) * (this.secondsPerUnit(k) ?? 0)
    return all - Math.min(sec('render'), sec('plan') + sec('rank') + sec('audit-packet') + sec('audit-judge'))
  }

  elapsedMs(): number { return Date.now() - this.t0 }

  /** Eigenes gemessenes Tempo je Art (für den nächsten Lauf als Ausgangswert). */
  rates(): Partial<Record<TaskKind, number>> {
    const out: Partial<Record<TaskKind, number>> = {}
    for (const k of new Set(this.tasks.map((t) => t.kind))) { const done = this.tasks.filter((t) => t.kind === k && t.ok && t.units > 0); if (done.length) out[k] = done.reduce((s, t) => s + t.ms / 1000, 0) / done.reduce((s, t) => s + t.units, 0) }
    return out
  }

  /** Zusammenfassung je Art für das Run-Manifest (geplante vs. tatsächliche Aufrufe, Wiederholungsgründe, Zeiten). */
  summary(): Record<string, { calls: number; failed: number; seconds: number; byReason: Record<string, number> }> {
    const out: Record<string, { calls: number; failed: number; seconds: number; byReason: Record<string, number> }> = {}
    for (const t of this.tasks) {
      const s = (out[t.kind] ??= { calls: 0, failed: 0, seconds: 0, byReason: {} })
      s.calls++; if (!t.ok) s.failed++
      s.seconds = Math.round((s.seconds + t.ms / 1000) * 10) / 10
      s.byReason[t.reason] = (s.byReason[t.reason] ?? 0) + 1
    }
    return out
  }
}

/** Restzeit lesbar für die Fortschrittszeile. */
export function etaText(sec: number | null): string {
  if (sec === null) return 'Zeit wird ermittelt'
  if (sec < 60) return 'noch unter 1 Min'
  const m = Math.round(sec / 60)
  return m >= 60 ? `noch ca. ${Math.floor(m / 60)} Std ${m % 60} Min` : `noch ca. ${m} Min`
}
