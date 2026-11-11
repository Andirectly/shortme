// Kandidaten allein aus Ton/Chat: Stellen, die im Transkript flach wirken (Rap, Imitation, Ausraster), aber hörbar herausstechen.
// Idee aus clips-studio (analysis/fusion.py: Signal-Spitzen als zusätzliche Fenster neben den Transkript-Kandidaten).
import type { AudioEvent } from './audioEvents'
import type { HeatPoint } from './heat'
import type { Sentence } from './sentences'
import type { Signals } from './signals'

const MIN_SCORE = 0.45

/** Zeitpunkte (Sekunden) der auffälligsten Stellen, mit Mindestabstand `minGap`, nach Zeit sortiert. */
export function signalPeaks(sig: Signals, events: AudioEvent[] | null | undefined, chat: HeatPoint[] | null | undefined, durationSec: number, count: number, minGap = 90): number[] {
  const n = Math.max(1, Math.ceil(durationSec))
  const raw = Array.from({ length: n }, (_, s) => 0.6 * (sig.burst[s] ?? 0) + 0.3 * (sig.loudness[s] ?? 0))
  for (const e of events ?? []) {
    const w = e.kind === 'laugh' || e.kind === 'applause' || e.kind === 'chat' ? 1 : e.kind === 'loud' ? 0.5 : 0
    if (w) for (let s = Math.max(0, Math.floor(e.start)); s <= Math.min(n - 1, Math.ceil(e.end)); s++) raw[s] += w
  }
  for (const p of chat ?? []) for (let s = Math.max(0, Math.floor(p.start)); s <= Math.min(n - 1, Math.ceil(p.end)); s++) raw[s] += p.value
  // 5-Sekunden-Mittel, damit einzelne Ausreißer-Sekunden keine Spitze ergeben
  const sm = raw.map((_, s) => { let t = 0; let c = 0; for (let k = s - 2; k <= s + 2; k++) if (k >= 0 && k < n) { t += raw[k]; c++ } return t / c })
  const order = sm.map((_, s) => s).sort((a, b) => sm[b] - sm[a])
  const out: number[] = []
  for (const s of order) {
    if (out.length >= count || sm[s] < MIN_SCORE) break
    if (out.every((t) => Math.abs(t - s) >= minGap)) out.push(s)
  }
  return out.sort((a, b) => a - b)
}

/** Satzbereich um einen Zeitpunkt: `before` Sekunden Aufbau davor, `after` danach (Satzgrenzen). */
export function peakCandidate(sentences: Sentence[], t: number, before = 25, after = 15): { first: number; last: number } | null {
  const at = sentences.findIndex((s) => s.end >= t)
  if (at < 0) return null
  let first = at
  while (first > 0 && sentences[first].start > t - before) first--
  let last = at
  while (last < sentences.length - 1 && sentences[last + 1].end <= t + after) last++
  return { first, last }
}
