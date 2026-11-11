// Dauer der Analyse abschätzen (Anzeige vor dem Start und Restzeit während des Laufs) und Clip-Anzahl/Kandidatenbudget.
export const MAX_CLIPS = 50
/** Höchstzahl bewerteter Kandidaten: je Kandidat 3–5 LLM-Aufrufe, darüber wächst die Zeit bei sehr langen Videos zu stark. */
export const MAX_CANDS = 90

/** Automatische Clip-Anzahl: etwa ein Clip je 2,5 Minuten Material (mindestens 4, höchstens 50). */
export const defaultWanted = (durationSec: number): number => Math.max(4, Math.min(MAX_CLIPS, Math.round(durationSec / 150)))
export const candidateBudget = (wanted: number): number => Math.min(MAX_CANDS, Math.max(10, Math.ceil(wanted * 3)))

export const STAGES = ['audio', 'asr', 'gaps', 'speakers', 'finalize', 'signals', 'shots', 'topics', 'candidates', 'rate', 'compare', 'snap', 'proofread', 'layout'] as const
export type Stage = (typeof STAGES)[number]
/** Anzeigezeile je Stufe: 0 Transkribieren, 1 Analysieren, 2 Clips finden. */
export const ROW_OF: Record<Stage, 0 | 1 | 2> = { audio: 0, asr: 0, gaps: 0, speakers: 0, finalize: 0, signals: 1, shots: 1, topics: 2, candidates: 2, rate: 2, compare: 2, snap: 2, proofread: 2, layout: 2 }
/** Stufen, die der Job unter anderem Namen meldet. */
const ALIAS: Record<string, Stage> = { llm: 'topics', texttiling: 'topics', thumbs: 'layout' }

/**
 * Sekunden je Stufe, gemessen auf einer RTX 5090 mit Parakeet + Qwen3-14B (1 h 47: Transkription 5 min, Kamerawechsel 10 min,
 * KI-Teil mit 10 Kandidaten 3 min). Andere Rechner weichen ab: `scale` (gemessen aus früheren Läufen) rechnet das um.
 */
export function estimateStages(durationSec: number, wanted?: number, scale = 1): Record<Stage, number> {
  const dur = Math.max(60, durationSec)
  const n = wanted ?? defaultWanted(dur)
  const words = (dur / 60) * 140
  const cands = candidateBudget(n)
  const s: Record<Stage, number> = {
    audio: 5 + 0.002 * dur,
    asr: 10 + 0.05 * dur,
    gaps: 0.005 * dur,
    speakers: 0,
    finalize: 3 + 0.002 * dur,
    signals: 5 + 0.01 * dur,
    shots: 0.095 * dur,
    topics: 3 + Math.ceil(words / 2200) * 4,
    candidates: Math.ceil(words / 3000) * 5,
    rate: cands * 9,
    compare: 30,
    snap: 0.5 * n,
    proofread: 3 * n,
    layout: 10 + 3 * n
  }
  for (const k of STAGES) s[k] *= scale
  return s
}

export const totalSec = (est: Record<Stage, number>): number => STAGES.reduce((t, k) => t + est[k], 0)

/** Zeitgewichtete Spannen (0…1) je Stufe und je Anzeigezeile: Balken und Restzeit richten sich nach der echten Dauer. */
export function spans(est: Record<Stage, number>): { stage: Record<Stage, [number, number]>; row: Array<[number, number]> } {
  const total = totalSec(est) || 1
  const stage = {} as Record<Stage, [number, number]>
  const row: Array<[number, number]> = [[1, 0], [1, 0], [1, 0]]
  let t = 0
  for (const k of STAGES) {
    const a = t / total
    t += est[k]
    stage[k] = [a, t / total]
    const r = row[ROW_OF[k]]
    row[ROW_OF[k]] = [Math.min(r[0], a), Math.max(r[1], t / total)]
  }
  return { stage, row }
}

/** Gesamtfortschritt (0…1) aus Stufe und Stufenfortschritt; unbekannte Stufe → null (Anzeige behält den letzten Stand). */
export function fractionOf(stage: string, progress: number, sp: Record<Stage, [number, number]>): number | null {
  const k = (STAGES as readonly string[]).includes(stage) ? (stage as Stage) : ALIAS[stage]
  if (!k) return null
  const [a, b] = sp[k]
  return a + (b - a) * Math.max(0, Math.min(1, progress))
}

/**
 * Restzeit in Sekunden. Solange noch wenig gelaufen ist, gilt die Schätzung mal `scale`; danach das gemessene Tempo seit dem ersten
 * gesehenen Stand (übersprungene, schon fertige Stufen verfälschen so nichts).
 */
export function remainingSec(est: Record<Stage, number>, fraction: number, startFraction: number, elapsedSec: number, scale = 1): number {
  const total = totalSec(est)
  const done = fraction - startFraction
  const pace = done >= 0.05 ? Math.max(0.3, Math.min(5, elapsedSec / (done * total))) : scale
  return Math.max(0, (1 - fraction) * total * pace)
}

/** „etwa 25 Min“, „etwa 1 Std 10 Min“, unter einer Minute „unter 1 Min“; auf 5 Minuten gerundet ab 20 Minuten. */
export function fmtEta(sec: number): string {
  if (sec < 60) return 'unter 1 Min'
  let m = Math.round(sec / 60)
  if (m >= 20) m = Math.round(m / 5) * 5
  return m >= 60 ? `${Math.floor(m / 60)} Std${m % 60 ? ` ${m % 60} Min` : ''}` : `${m} Min`
}
