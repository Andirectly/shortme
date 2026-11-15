// Reine Logik der semantischen Suche (Engine 3): Fenster über die ganze Zeitachse, Anfragen, Ähnlichkeit je Anfrage, Spitzen → Rohvorschläge, Rangfusion.
// Embedding-Werte sind Ähnlichkeiten innerhalb EINES Modellraums und kein kalibrierter Viralitäts-Score: jede Anfrage wird für sich normalisiert (z-Wert über das Video).
import type { Npy2D } from './npy'
import type { Evidence, EventKind, RawProposal } from '../../../../../shared/engineV2'
import type { V3ProfileConfig } from './revisions'

export interface EmbedWindow { start: number; end: number; index: number }

/** Fenster [start, start+windowSec) mit Schritt hopSec bis zum Ende; das letzte reicht bis zur Dauer. Jede Sekunde der Datei liegt in mindestens einem Fenster. */
export function embedWindows(durationSec: number, cfg: Pick<V3ProfileConfig, 'windowSec' | 'hopSec'>): EmbedWindow[] {
  const out: EmbedWindow[] = []
  if (!(durationSec > 1)) return out
  for (let s = 0; s < durationSec - 0.5; s += cfg.hopSec) {
    const e = Math.min(durationSec, s + cfg.windowSec)
    out.push({ start: s, end: e, index: out.length })
    if (e >= durationSec) break
  }
  return out
}

/** Bildzeitpunkte eines Fensters: gleichmäßig in der Mitte der Teilstücke. */
export const frameTimesOf = (w: Pick<EmbedWindow, 'start' | 'end'>, n: number): number[] => Array.from({ length: n }, (_, k) => w.start + ((k + 0.5) / n) * (w.end - w.start))

export interface SearchQuery { id: string; text: string; kind: EventKind; /** Lesbare Beschreibung für Belege (deutsch). */ label: string; /** ab Profil-Rang aktiv (kleiner = früher) */ rank: number }

/** Feste, versionierte Anfragen (englisch: das Embedding-Modell ist darauf am stärksten; deutsche Entsprechung im Label). */
export const QUERY_SET: SearchQuery[] = [
  { id: 'laugh', text: 'a person laughing out loud', kind: 'reaktion', label: 'Person lacht laut', rank: 1 },
  { id: 'surprise', text: 'a person reacting with shock or surprise', kind: 'reaktion', label: 'Schreck- oder Überraschungsreaktion', rank: 2 },
  { id: 'fail', text: 'a funny fail, accident or mishap', kind: 'gameplay', label: 'Fail, Unfall oder Missgeschick', rank: 3 },
  { id: 'game', text: 'a dramatic or exciting moment in a video game', kind: 'gameplay', label: 'dramatischer Moment im Spiel', rank: 4 },
  { id: 'perform', text: 'a person singing, rapping or performing', kind: 'performance', label: 'Gesang, Rap oder Darbietung', rank: 5 },
  { id: 'impression', text: 'someone acting out a character or doing an impression', kind: 'performance', label: 'Imitation oder Rollenspiel', rank: 6 },
  { id: 'argue', text: 'a heated argument or confrontation between people', kind: 'konflikt', label: 'Streit oder Konfrontation', rank: 7 },
  { id: 'emotion', text: 'an emotional, touching or sad moment', kind: 'aussage', label: 'emotionaler Moment', rank: 8 },
  { id: 'cheer', text: 'people cheering or celebrating', kind: 'reaktion', label: 'Jubel oder Feier', rank: 9 },
  { id: 'story', text: 'a person telling an interesting story to the camera', kind: 'geschichte', label: 'Person erzählt eine Geschichte', rank: 10 },
  { id: 'rage', text: 'a person getting angry or screaming in frustration', kind: 'reaktion', label: 'Wut oder Frust', rank: 11 },
  { id: 'surprise2', text: 'an unexpected twist or sudden change on screen', kind: 'sonstiges', label: 'unerwartete Wendung im Bild', rank: 12 },
  { id: 'reveal', text: 'a reveal, unboxing or big announcement', kind: 'sonstiges', label: 'Enthüllung oder Ankündigung', rank: 13 },
  { id: 'dance', text: 'people dancing or doing something silly', kind: 'performance', label: 'Tanz oder Albernheit', rank: 14 }
]

export interface QueryScores { id: string; /** Kosinus je Fenster */ cos: Float32Array; mean: number; std: number; z: Float32Array }

/** Ähnlichkeit jeder Anfrage zu jedem Fenster (Zeilen sind normalisiert, Kosinus = Skalarprodukt) und z-Wert je Anfrage über alle Fenster. */
export function scoreQueries(vec: Npy2D, q: Npy2D, ids: string[]): QueryScores[] {
  if (vec.cols !== q.cols) throw new Error(`Embedding-Dimensionen passen nicht (${vec.cols} ≠ ${q.cols}): nie Räume verschiedener Modelle mischen`)
  if (q.rows !== ids.length) throw new Error('Anzahl Anfragen und Vektoren verschieden')
  return ids.map((id, j) => {
    const cos = new Float32Array(vec.rows)
    for (let i = 0; i < vec.rows; i++) { let d = 0; for (let k = 0; k < vec.cols; k++) d += vec.data[i * vec.cols + k] * q.data[j * q.cols + k]; cos[i] = d }
    let m = 0; for (const c of cos) m += c; m /= Math.max(1, cos.length)
    let v = 0; for (const c of cos) v += (c - m) * (c - m); const std = Math.sqrt(v / Math.max(1, cos.length)) || 1e-6
    return { id, cos, mean: m, std, z: Float32Array.from(cos, (c) => (c - m) / std) }
  })
}

export interface Peak { query: string; windows: number[]; start: number; end: number; anchor: number; cos: number; z: number }

/** Spitzen je Anfrage: die K besten Fenster mit z ≥ minZ; benachbarte Fenster derselben Anfrage werden zu einem Bereich verbunden. */
export function peaksOf(scores: QueryScores, wins: EmbedWindow[], opt: { topK: number; minZ: number; mergeGapSec: number }): Peak[] {
  const idx = [...scores.z.keys()].filter((i) => scores.z[i] >= opt.minZ).sort((a, b) => scores.z[b] - scores.z[a]).slice(0, opt.topK).sort((a, b) => a - b)
  const out: Peak[] = []
  for (const i of idx) {
    const last = out[out.length - 1]
    if (last && wins[i].start - last.end <= opt.mergeGapSec) {
      last.windows.push(i); last.end = Math.max(last.end, wins[i].end)
      if (scores.z[i] > last.z) { last.z = scores.z[i]; last.cos = scores.cos[i]; last.anchor = (wins[i].start + wins[i].end) / 2 }
    } else out.push({ query: scores.id, windows: [i], start: wins[i].start, end: wins[i].end, anchor: (wins[i].start + wins[i].end) / 2, cos: scores.cos[i], z: scores.z[i] })
  }
  return out
}

/** Spitzen → Rohvorschläge samt Signal-Belegen (state signal-only: Abruf-Treffer, noch nicht von einem Modell „verstanden“/geprüft). */
export function peaksToProposals(peaks: Peak[], queries: SearchQuery[], modelRev: string, durationSec: number): { proposals: RawProposal[]; evidence: Evidence[] } {
  const byId = new Map(queries.map((q) => [q.id, q]))
  const proposals: RawProposal[] = [], evidence: Evidence[] = []
  const zmax = Math.max(4, ...peaks.map((p) => p.z))
  peaks.forEach((p, n) => {
    const q = byId.get(p.query)!
    const id = `em${n + 1}`
    const start = Math.max(0, p.start - 8), end = Math.min(durationSec, Math.max(p.end + 4, start + 20))
    evidence.push({ id, modality: 'visual', state: 'signal-only', source: 'qwen3-vl-embedding-2b', start: p.start, end: p.end, observation: `Bild-Embedding ähnlich zu „${q.label}“ (Kosinus ${p.cos.toFixed(3)}, z ${p.z.toFixed(1)})`, modelRev, uncertainty: 'Abruf-Treffer im Embedding-Raum, kein Verständnis des Ablaufs; Ähnlichkeit ist kein Qualitätswert' })
    proposals.push({ start, end, anchor: p.anchor, source: 'visual', kind: q.kind, summary: q.label, strength: Math.min(1, p.z / zmax), evidenceIds: [id] })
  })
  return { proposals, evidence }
}

/**
 * Rangfusion (Reciprocal Rank, k = 60) je Quelle: Rang innerhalb der eigenen Quelle bestimmt die Stärke, nicht der Rohwert (Kosinus, LLM-Rang, Lautstärke
 * sind nicht vergleichbar). Stärke = 60 / (60 + Rang) mit Rang 0 = bester Vorschlag der Quelle.
 */
export function fuseRrf(raw: RawProposal[], k = 60): RawProposal[] {
  const out: RawProposal[] = []
  for (const src of ['text', 'audio', 'visual', 'chat'] as const) {
    const mine = raw.filter((r) => r.source === src).sort((a, b) => b.strength - a.strength)
    mine.forEach((r, rank) => out.push({ ...r, strength: k / (k + rank) }))
  }
  return out
}
