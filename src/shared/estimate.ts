// Dauer der Analyse abschätzen (Anzeige vor dem Start und Restzeit während des Laufs) und Clip-Anzahl/Kandidatenbudget.
export const MAX_CLIPS = 50
/** Höchstzahl bewerteter Kandidaten: je Kandidat 3–5 LLM-Aufrufe, darüber wächst die Zeit bei sehr langen Videos zu stark. */
export const MAX_CANDS = 90

/** Automatische Clip-Anzahl: ab 10 Minuten Material mindestens 10 zur Auswahl (Wunsch des Nutzers), darunter ein Clip je Minute (mindestens 4),
 *  lange Videos ein Clip je 2,5 Minuten (höchstens 50). */
export const defaultWanted = (durationSec: number): number => Math.min(MAX_CLIPS, Math.max(Math.min(10, Math.max(4, Math.round(durationSec / 60))), Math.round(durationSec / 150)))
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
export function estimateStages(durationSec: number, wanted?: number, scale = 1, engine: import('./engine').SelectionEngineId = 'legacy', v3Profile: 'fast' | 'balanced' | 'deep' = 'balanced'): Record<Stage, number> {
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
  if (engine === 'multimodal-v2' || engine === 'adaptive-v3' || engine === 'engine4' || engine === 'engine-mac' || engine === 'engine6') {
    // Neue Engine (gemessen auf RTX 5090, 293-s-Stream mit 11 Ereignissen: Text 15 s, Bild 4+43 s, Ton 14 s, Bewerten/Planen 55–70 s, Prüfen+Vergleich 85–130 s, Titel 18 s).
    // Die Zeit hängt an der Zahl der Ereignisse (Detailprüfung höchstens 50), nicht an der Videolänge allein; je Modellwechsel kommen ca. 8 s Ladezeit dazu.
    const ev = Math.min(50, Math.max(8, Math.round(dur / 26)))
    s.topics = 0
    s.candidates = (dur / 150) * 6 + 8
    s.rate = (engine === 'adaptive-v3' ? 0 : 0.012 * dur) + 5.5 * ev + 20
    s.snap = 7 * ev + 25
    s.compare = 3.5 * ev + Math.min(36, 1.6 * ev) * 4.4 + 8
    s.proofread = 3.5 * n + 5
    if (engine === 'adaptive-v3' || engine === 'engine4' || engine === 'engine-mac' || engine === 'engine6') {
      // Embedding-Index: Fenster × (Bilder holen + einbetten) + Modell laden; Startwerte, nach den ersten echten Läufen anpassen
      const hop = { fast: 12, balanced: 8, deep: 4 }[v3Profile], frames = { fast: 4, balanced: 4, deep: 6 }[v3Profile]
      s.candidates += (dur / hop) * (frames * 0.02 + 0.1) + 15
      if (v3Profile === 'deep') s.snap *= 1.4
    }
  }
  if (engine === 'engine-mac') {
    // Gemessen M1 Pro 16 GB (Nov. 2026): 26-min-Video in ~1 min transkribiert; Kamerawechsel laufen parallel zur Engine (keine eigene Wartezeit);
    // Engine Mac (mac2-throughput.json, 26-min-Video ≈ 35 min): Sprachsuche 35 s je Fenster (≈ 0,25 × Dauer), Bildsuche ≈ 0,18 × Dauer (entfällt, wenn gespeichert),
    // Ansehen 2 Pakete × 12 s je Kandidat (Wunsch + 4), Plan 25 s je Kandidat + Rangfolge ~60 s, Prüfung 2 Pakete × 18 s + Urteil 27 s je Clip; Rendern läuft parallel
    s.audio = 3 + 0.002 * dur; s.asr = 10 + 0.04 * dur; s.gaps = 0.002 * dur; s.finalize = 3; s.signals = 5; s.shots = 0
    s.topics = 0; s.candidates = 0.25 * dur + 0.18 * dur + 30; s.rate = (n + 4) * 24; s.snap = (n + 4) * 25 + 60; s.compare = n * 63 + 60; s.proofread = 0; s.layout = 10 + 3 * n
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

/** Echt gemessener Teilfortschritt aus der Jobmeldung („Bewerten (3/12)“, „Bild-Embeddings 64/111 Fenster“); null = kein verlässlicher Nenner. */
export function measuredStep(message: string | undefined): { done: number; total: number } | null {
  const m = message ? /(\d+)\s*\/\s*(\d+)/.exec(message) : null
  if (!m) return null
  const done = Number(m[1]), total = Number(m[2])
  return total > 0 && done >= 0 && done <= total ? { done, total } : null
}

/** Restzeit als ehrliche Spanne (Schätzung −20 % … +30 %), nie als Scheingenauigkeit. */
export function etaRange(sec: number): string {
  if (!Number.isFinite(sec) || sec <= 0) return 'Wird ermittelt'
  if (sec < 60) return 'unter 1 Min'
  // untere Grenze unter 1 Min → nur die obere nennen (sonst „unter 1–1 Min“)
  if (sec * 0.8 < 60) return `unter ${fmtEta(Math.max(60, sec * 1.3))}`
  const lo = fmtEta(sec * 0.8), hi = fmtEta(sec * 1.3)
  // „45–1 Std 15 Min“ liest sich wie 45 Std → über die Stundengrenze beide Werte ausschreiben
  return lo === hi ? `ca. ${lo}` : hi.includes('Std') && !lo.includes('Std') ? `ca. ${lo} – ${hi}` : `ca. ${lo.replace(/ Min$/, '')}–${hi}`
}

/** Dauer in Worten für „vergangen“: 45 s, 12 Min, 1 Std 05 Min. */
export function fmtElapsed(sec: number): string {
  const s = Math.max(0, Math.round(sec))
  if (s < 60) return `${s} s`
  const m = Math.floor(s / 60)
  return m >= 60 ? `${Math.floor(m / 60)} Std ${String(m % 60).padStart(2, '0')} Min` : `${m} Min`
}
