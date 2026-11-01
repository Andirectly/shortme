// Werkbank: Typen, Leistungs-Normalisierung, Auswertung Creator ↔ Shortme, Gesamtübersicht. Rein.
import type { CreatorShort } from './learnData'
import { overlap } from './learnData'

export type WorkStatus = 'queued' | 'loading' | 'transcribing' | 'matched' | 'generated' | 'evaluated' | 'noshorts' | 'error'
export const STATUS_LABEL: Record<WorkStatus, string> = { queued: 'Wartet', loading: 'Lädt', transcribing: 'Transkribiert', matched: 'Shorts zugeordnet', generated: 'Shortme-Clips erzeugt', evaluated: 'Ausgewertet', noshorts: 'Ohne Shorts', error: 'Fehler' }

export interface WorkItem {
  id: string
  url: string
  title: string
  channel: string
  channelUrl?: string
  /** Veröffentlichung (ISO). */
  date: string
  durationSec: number
  status: WorkStatus
  /** Zugeordnete Creator-Shorts. */
  shorts: number
  hash?: string
  error?: string
  addedAt: string
  doneAt?: string
}

const DAY = 86_400_000
export const MIN_AGE_DAYS = 14
export const PEER_DAYS = 60
const median = (a: number[]): number => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2 }

/**
 * Leistung = Aufrufe / Median der Aufrufe der Shorts desselben Kanals (±60 Tage). Nie kanalübergreifend;
 * Shorts jünger als 14 Tage bekommen keinen Wert (null), ebenso Shorts mit weniger als 3 vergleichbaren Shorts.
 */
export function ratios(channelShorts: Array<{ id: string; views: number; date: string }>, now = Date.now()): Record<string, number | null> {
  const old = channelShorts.filter((s) => now - Date.parse(s.date) >= MIN_AGE_DAYS * DAY)
  const out: Record<string, number | null> = {}
  for (const s of channelShorts) {
    const t = Date.parse(s.date)
    const peers = old.filter((p) => Math.abs(Date.parse(p.date) - t) <= PEER_DAYS * DAY)
    const med = peers.length >= 3 ? median(peers.map((p) => p.views)) : 0
    out[s.id] = now - t >= MIN_AGE_DAYS * DAY && med > 0 ? +(s.views / med).toFixed(2) : null
  }
  return out
}

/** Pipeline-Stufe, an der ein Moment verloren ging (aus der Kandidaten-Spur der Auswahl). */
export type LossStage = 'Kandidatensuche' | 'Bewertung' | 'Finalisten-Vergleich' | 'Einrasten/Überlappung'
const FATE_STAGE: Record<string, LossStage> = { rated: 'Bewertung', finalist: 'Finalisten-Vergleich', overlap: 'Einrasten/Überlappung' }

export interface MomentEval {
  shortId: string
  source: 'creator' | 'reference'
  start: number
  end: number
  ratio: number | null
  /** Anteil des Creator-Moments, den ein Shortme-Clip überdeckt (0..1). */
  overlap: number
  hit: boolean
  /** Shortme minus Creator in Sekunden (negativ = Shortme beginnt früher). */
  startDelta: number | null
  endDelta: number | null
  clipId: string | null
  lost: LossStage | null
}
export interface EvalFile { at: string; hash: string; wanted: number; moments: MomentEval[] }

export const HIT_OVERLAP = 0.5

export function evaluate(shorts: CreatorShort[], clips: Array<{ id: string; start: number; end: number }>, trace: Array<{ start: number; end: number; fate: string }>): MomentEval[] {
  const out: MomentEval[] = []
  for (const s of shorts) for (const m of s.moments) {
    let best: { id: string; start: number; end: number } | null = null, bo = 0
    for (const c of clips) { const o = overlap(m, c); if (o > bo) { bo = o; best = c } }
    const hit = !!best && bo >= HIT_OVERLAP
    let lost: LossStage | null = null
    if (!hit) {
      const t = trace.filter((x) => x.fate !== 'selected' && overlap(m, x) >= HIT_OVERLAP).sort((a, b) => overlap(m, b) - overlap(m, a))[0]
      lost = t ? FATE_STAGE[t.fate] ?? 'Bewertung' : 'Kandidatensuche'
    }
    out.push({ shortId: s.id, source: s.source, start: m.start, end: m.end, ratio: s.ratio, overlap: +bo.toFixed(2), hit, startDelta: hit && best ? +(best.start - m.start).toFixed(1) : null, endDelta: hit && best ? +(best.end - m.end).toFixed(1) : null, clipId: hit && best ? best.id : null, lost })
  }
  return out
}

export interface Overview {
  videos: number
  moments: number
  hitRate: number | null
  meanStartDev: number | null
  meanEndDev: number | null
  lossStages: Array<{ stage: string; n: number }>
  /** Trefferquote je Auswertungs-Tag (Entwicklung über die Zeit). */
  timeline: Array<{ day: string; hitRate: number; n: number }>
}

const mean = (a: number[]): number | null => (a.length ? +(a.reduce((s, x) => s + x, 0) / a.length).toFixed(2) : null)

/** Gesamtübersicht über alle Auswertungen; nur Creator-Momente zählen (Referenz-Clips sind Vergleich, kein Maßstab). */
export function overview(evals: EvalFile[]): Overview {
  const ms = evals.flatMap((e) => e.moments.filter((m) => m.source === 'creator').map((m) => ({ ...m, day: e.at.slice(0, 10) })))
  const hits = ms.filter((m) => m.hit)
  const loss = new Map<string, number>()
  for (const m of ms) if (m.lost) loss.set(m.lost, (loss.get(m.lost) ?? 0) + 1)
  const days = [...new Set(ms.map((m) => m.day))].sort()
  return {
    videos: evals.length, moments: ms.length, hitRate: ms.length ? +(hits.length / ms.length).toFixed(3) : null,
    meanStartDev: mean(hits.map((m) => Math.abs(m.startDelta!))), meanEndDev: mean(hits.map((m) => Math.abs(m.endDelta!))),
    lossStages: [...loss].map(([stage, n]) => ({ stage, n })).sort((a, b) => b.n - a.n),
    timeline: days.map((day) => { const d = ms.filter((m) => m.day === day); return { day, hitRate: +(d.filter((m) => m.hit).length / d.length).toFixed(3), n: d.length } })
  }
}

export interface BlindResult { at: string; hash: string; left: { kind: 'shortme' | 'creator' | 'reference'; id: string }; right: { kind: 'shortme' | 'creator' | 'reference'; id: string }; choice: 'left' | 'right' | 'tie' }

/** Anteil der entschiedenen Blindtests, die der Shortme-Moment gewonnen hat. */
export function blindWinRate(rs: BlindResult[]): { rate: number | null; decided: number; total: number } {
  const dec = rs.filter((r) => r.choice !== 'tie')
  const win = dec.filter((r) => (r.choice === 'left' ? r.left : r.right).kind === 'shortme').length
  return { rate: dec.length ? +(win / dec.length).toFixed(3) : null, decided: dec.length, total: rs.length }
}

/** Ansicht eines Werkbank-Projekts (Hauptprozess → Oberfläche). */
export interface WbProject {
  title: string
  clips: Array<{ id: string; start: number; end: number; score: number; title: string; thumb: string | null; text: string }>
  shorts: Array<Omit<CreatorShort, 'moments'> & { moments: Array<{ start: number; end: number; score: number; text: string }> }>
  eval: EvalFile | null
}
export interface WbStatus { paused: boolean; current: string; bytes: number }
export interface WbOverview extends Overview { blind: ReturnType<typeof blindWinRate> }
