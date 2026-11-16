// Neue Auswahl-Engine: Datenverträge und reine Logik (Ereignisse, Belege, Schnittpläne, Zusammenführen, Budgets, Paarvergleich).
// Alle Zeiten sind Quellsekunden, endlich, geordnet und innerhalb des Videos. Fehlende Evidenz ist kein Qualitätswert null: sie heißt „ungeprüft“.

export type EvidenceModality = 'text' | 'audio' | 'visual' | 'chat'
/** signal-only: nur ein Signal (z. B. Lautheit), observed: ein Modell hat Medien wirklich geprüft, unknown: nicht geprüft, failed: Prüfung fehlgeschlagen. */
export type EvidenceState = 'signal-only' | 'observed' | 'unknown' | 'failed'

export const EVENT_KINDS = ['aussage', 'geschichte', 'witz', 'performance', 'reaktion', 'gameplay', 'konflikt', 'sonstiges'] as const
export type EventKind = (typeof EVENT_KINDS)[number]
export const isEventKind = (x: unknown): x is EventKind => (EVENT_KINDS as readonly string[]).includes(x as string)

export interface Evidence {
  id: string
  modality: EvidenceModality
  state: EvidenceState
  /** Quelle der Beobachtung: `text-llm`, `yamnet`, Modellname, `chat`, `heat`, `frames`. */
  source: string
  start: number
  end: number
  observation: string
  /** Modell-/Projektor-/Prompt-Revision, mit der die Beobachtung entstand. */
  modelRev?: string
  /** Bilder: Kennung → Quellzeit der Frames, die das Modell gesehen hat. */
  frames?: Array<{ id: string; t: number }>
  /** Text: erster/letzter Wortindex im Transkript. */
  wordRange?: [number, number]
  /** Warum unsicher oder nicht geprüft (Klartext). */
  uncertainty?: string
  /** Ton: vom Modell gehörte Darbietung (Quellsekunden) – erweitert den Schnittbereich. */
  performance?: { start: number; end: number }
}

export interface HighlightEvent {
  id: string
  start: number
  end: number
  /** Zeitpunkt des eigentlichen Moments (Pointe, Reaktion, Höhepunkt). */
  anchor: number
  kind: EventKind
  summary: string
  /** Welche Suchquellen den Kandidaten gefunden haben. */
  foundBy: EvidenceModality[]
  evidenceIds: string[]
  /** Ohne diese Beobachtungswege ist der Moment nicht beurteilbar (z. B. Gesang → audio, Fail → visual). */
  requiredModalities: EvidenceModality[]
  missingContext: string[]
}

export interface Piece { start: number; end: number }

export interface EditorialPlan {
  eventId: string
  variantId: string
  /** Erhaltene Quellbereiche in zeitlicher Reihenfolge (höchstens 3). */
  keep: Piece[]
  reason: string
  verification: 'verified' | 'needs-review' | 'failed'
}

export const V2_LIMITS = {
  textWindowSec: 180, textOverlapSec: 30, textWindowMaxWords: 700, rawPerWindow: 6,
  detailMax: 50, reservePerSource: 6,
  imagesPerEvent: 5, imageWidth: 640, audioWindowSec: 30, audioOverlapSec: 4,
  visualSampleEverySec: 30, visualTopChanges: 40,
  finalists: 24, matches: 36, maxVariantsPerEvent: 3, maxPieces: 3,
  minClipSec: 15, maxClipSec: 75, absMaxClipSec: 90,
  mergeOverlap: 0.3, mergeAnchorSec: 15, minPieceSec: 2.5, seamPadSec: 0.15
} as const

const fin = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x)

/** Zeitbereich gültig? Endlich, geordnet, innerhalb [0, duration]. */
export const validRange = (start: unknown, end: unknown, durationSec: number): boolean => fin(start) && fin(end) && start >= 0 && end > start && end <= durationSec + 0.001

/** Bereich in die Videodauer klemmen; null, wenn danach nichts übrig bleibt. */
export function clampRange(start: number, end: number, durationSec: number): Piece | null {
  if (!fin(start) || !fin(end)) return null
  const s = Math.max(0, Math.min(start, durationSec)), e = Math.max(0, Math.min(end, durationSec))
  return e - s >= 0.2 ? { start: s, end: e } : null
}

/** Ausgabelänge eines Plans (Summe der erhaltenen Stücke), nicht end − start des umschließenden Bereichs. */
export const outputDuration = (keep: Piece[]): number => keep.reduce((n, p) => n + (p.end - p.start), 0)

/** Plan prüfen: 1–3 Stücke, geordnet, ohne Überlappung, innerhalb des Videos, jedes ≥ Mindestlänge. Liefert Fehlertext oder null. */
export function checkKeep(keep: Piece[], durationSec: number, limits: { maxPieces: number; minPiece: number } = { maxPieces: V2_LIMITS.maxPieces, minPiece: V2_LIMITS.minPieceSec }): string | null {
  if (!keep.length) return 'keine Stücke'
  if (keep.length > limits.maxPieces) return `mehr als ${limits.maxPieces} Stücke`
  for (let i = 0; i < keep.length; i++) {
    const p = keep[i]
    if (!validRange(p.start, p.end, durationSec)) return `Stück ${i + 1}: ungültige Zeiten`
    if (p.end - p.start < limits.minPiece && keep.length > 1) return `Stück ${i + 1} zu kurz`
    if (i > 0 && p.start < keep[i - 1].end) return `Stück ${i + 1} überlappt oder liegt vor dem vorigen`
  }
  return null
}

/** Automatisch entfernte Abschnitte = Lücken zwischen den erhaltenen Stücken (Quellzeiten), getrennt von manuell gelöschten Wörtern gespeichert. */
export function autoCutsOf(keep: Piece[]): Piece[] {
  const out: Piece[] = []
  for (let i = 1; i < keep.length; i++) if (keep[i].start - keep[i - 1].end > 0.05) out.push({ start: keep[i - 1].end, end: keep[i].start })
  return out
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// Rohvorschläge → Ereignisse

export interface RawProposal {
  start: number
  end: number
  /** Zeitpunkt des Moments (Standard: Mitte). */
  anchor?: number
  source: EvidenceModality
  /** Engine 3: eigener Rangkanal (z. B. 'visual-embed', 'temporal'); Rangfusion arbeitet je Kanal, Standard = Quelle. */
  channel?: string
  kind?: EventKind
  summary?: string
  /** Stärke innerhalb der Quelle 0..1 (nur zum Ordnen innerhalb der Quelle, kein Qualitätsmaß). */
  strength: number
  missingContext?: string[]
  evidenceIds?: string[]
}

const overlapRatio = (a: Piece, b: Piece): number => {
  const lo = Math.max(a.start, b.start), hi = Math.min(a.end, b.end)
  return hi <= lo ? 0 : (hi - lo) / Math.min(a.end - a.start, b.end - b.start)
}

/**
 * Rohvorschläge verschiedener Quellen zu Ereignissen zusammenführen (Überlappung oder naher Ankerzeitpunkt). Die Fundquellen bleiben erhalten.
 * Keine starre Mindestabstands-Unterdrückung: verschiedene nahe Momente (> `mergeAnchorSec` auseinander, wenig Überlappung) bleiben getrennt.
 */
export function clusterProposals(raw: RawProposal[], durationSec: number): Array<HighlightEvent & { strength: Partial<Record<EvidenceModality, number>> }> {
  const items = raw.filter((r) => validRange(r.start, r.end, durationSec)).map((r) => ({ ...r, anchor: fin(r.anchor) && r.anchor >= r.start && r.anchor <= r.end ? r.anchor : (r.start + r.end) / 2 })).sort((a, b) => a.start - b.start || b.strength - a.strength)
  const groups: Array<typeof items> = []
  for (const it of items) {
    const g = groups.find((grp) => grp.some((m) => overlapRatio(m, it) >= V2_LIMITS.mergeOverlap || Math.abs(m.anchor - it.anchor) <= V2_LIMITS.mergeAnchorSec * (m.source === it.source ? 0.4 : 1)))
    if (g) g.push(it); else groups.push([it])
  }
  return groups.map((g, i) => {
    const text = g.find((m) => m.source === 'text')
    const best = [...g].sort((a, b) => b.strength - a.strength)[0]
    const start = Math.min(...g.map((m) => m.start)), end = Math.max(...g.map((m) => m.end))
    const foundBy = [...new Set(g.map((m) => m.source))]
    const strength: Partial<Record<EvidenceModality, number>> = {}
    for (const m of g) strength[m.source] = Math.max(strength[m.source] ?? 0, m.strength)
    return {
      id: `e${i + 1}`, start, end, anchor: best.anchor, kind: (text ?? best).kind ?? 'sonstiges', summary: (text ?? g.find((m) => m.summary) ?? best).summary ?? '',
      foundBy, evidenceIds: [...new Set(g.flatMap((m) => m.evidenceIds ?? []))], requiredModalities: [], missingContext: [...new Set(g.flatMap((m) => m.missingContext ?? []))], strength
    }
  })
}

/**
 * Welche Ereignisse bekommen die teure Detailprüfung? Gleichmäßig über die Zeitachse (Zeitfächer), mit Mindestanteil je Suchquelle, damit weder
 * Text noch Ton noch Bild die anderen verdrängen. Gibt die Auswahl und das Protokoll (Abdeckung, Gründe fürs Auslassen) zurück.
 */
export function pickDetailSet<E extends HighlightEvent & { strength: Partial<Record<EvidenceModality, number>> }>(events: E[], durationSec: number, budget: number, reservePerSource: number): { picked: E[]; skipped: Array<{ id: string; reason: string }>; binsCovered: number; bins: number } {
  const bins = Math.max(1, Math.min(budget, Math.ceil(durationSec / 300)))
  const score = (e: E): number => Math.max(...Object.values(e.strength).map((v) => v ?? 0), 0) + 0.15 * (e.foundBy.length - 1)
  const chosen = new Set<string>()
  const byScore = [...events].sort((a, b) => score(b) - score(a))
  // 1) Reserve je Quelle
  for (const src of ['text', 'audio', 'visual', 'chat'] as const) {
    let n = 0
    for (const e of byScore) { if (n >= reservePerSource || chosen.size >= budget) break; if (e.foundBy.includes(src) && !chosen.has(e.id)) { chosen.add(e.id); n++ } }
  }
  // 2) reihum je Zeitfach das beste noch nicht gewählte, bis das Budget voll ist
  const binOf = (e: E): number => Math.min(bins - 1, Math.floor((e.anchor / durationSec) * bins))
  const perBin: E[][] = Array.from({ length: bins }, () => [])
  for (const e of byScore) perBin[binOf(e)].push(e)
  for (let round = 0; chosen.size < budget; round++) {
    let added = false
    for (let b = 0; b < bins && chosen.size < budget; b++) { const e = perBin[b].find((x) => !chosen.has(x.id)); if (e) { chosen.add(e.id); added = true } }
    if (!added) break
  }
  const picked = events.filter((e) => chosen.has(e.id))
  const covered = new Set(picked.map(binOf)).size
  return { picked, skipped: events.filter((e) => !chosen.has(e.id)).map((e) => ({ id: e.id, reason: 'Budget der Detailprüfung ausgeschöpft' })), binsCovered: covered, bins }
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// Globaler Vergleich: Begegnungen planen, Bradley-Terry

export type Outcome = 'a' | 'b' | 'tie' | 'bothWeak'
export interface MatchResult { a: number; b: number; outcome: Outcome }

/** Kleiner deterministischer Zufall (mulberry32) für reproduzierbare Begegnungspläne. */
export function rng(seed: number): () => number {
  let t = seed >>> 0
  return () => { t += 0x6d2b79f5; let x = Math.imul(t ^ (t >>> 15), 1 | t); x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x; return ((x ^ (x >>> 14)) >>> 0) / 4294967296 }
}

/** Zusammenhängender Begegnungsgraph: Ring über alle (zufällige Reihenfolge) plus Sehnen, insgesamt `matches` verschiedene Paare (höchstens n(n−1)/2). */
export function scheduleMatches(n: number, matches: number, seed = 1): Array<[number, number]> {
  if (n < 2) return []
  const rand = rng(seed)
  const order = Array.from({ length: n }, (_, i) => i).sort(() => rand() - 0.5)
  const seen = new Set<string>()
  const out: Array<[number, number]> = []
  const add = (x: number, y: number): void => { const k = x < y ? `${x}-${y}` : `${y}-${x}`; if (x !== y && !seen.has(k)) { seen.add(k); out.push([x, y]) } }
  for (let i = 0; i < n; i++) add(order[i], order[(i + 1) % n])
  const max = Math.min(matches, (n * (n - 1)) / 2)
  for (let step = 2; out.length < max && step < n; step++) for (let i = 0; i < n && out.length < max; i++) add(order[i], order[(i + step) % n])
  return out.slice(0, Math.max(max, Math.min(n, out.length)))
}

/** Ist der Vergleichsgraph zusammenhängend? (Sonst gäbe es keine gemeinsame Rangordnung.) */
export function isConnected(n: number, results: Array<{ a: number; b: number }>): boolean {
  if (n <= 1) return true
  const adj: number[][] = Array.from({ length: n }, () => [])
  for (const r of results) { adj[r.a].push(r.b); adj[r.b].push(r.a) }
  const seen = new Set<number>([0]); const stack = [0]
  while (stack.length) for (const v of adj[stack.pop()!]) if (!seen.has(v)) { seen.add(v); stack.push(v) }
  return seen.size === n
}

/**
 * Bradley-Terry (MM-Algorithmus) mit schwachem Prior. Unentschieden zählen halb für jeden, „beide schwach“ zählt gar nicht.
 * Rückgabe: Stärke je Kandidat (normiert, Mittel 1) oder null, wenn der Graph nicht zusammenhängt – dann gibt es keinen erfundenen Rang.
 */
export function bradleyTerry(n: number, results: MatchResult[], iters = 200): number[] | null {
  const counted = results.filter((r) => r.outcome !== 'bothWeak')
  if (!isConnected(n, counted)) return null
  const wins = new Array<number>(n).fill(0.5) // Prior: halber Sieg gegen einen Durchschnittsgegner
  const games: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0))
  for (const r of counted) {
    games[r.a][r.b]++; games[r.b][r.a]++
    if (r.outcome === 'a') wins[r.a]++; else if (r.outcome === 'b') wins[r.b]++; else { wins[r.a] += 0.5; wins[r.b] += 0.5 }
  }
  let p = new Array<number>(n).fill(1)
  for (let it = 0; it < iters; it++) {
    const next = p.map((_, i) => {
      let denom = 1 / (p[i] + 1) // Prior-Spiel gegen Stärke 1
      for (let j = 0; j < n; j++) if (games[i][j]) denom += games[i][j] / (p[i] + p[j])
      return wins[i] / denom
    })
    const mean = next.reduce((a, b) => a + b, 0) / n
    p = next.map((v) => v / mean)
  }
  return p
}

/** Reihenfolge der Kandidaten nach Stärke (absteigend); Gleichstände bleiben stabil in Eingabereihenfolge. */
export const rankOrder = (strength: number[]): number[] => strength.map((s, i) => ({ s, i })).sort((x, y) => y.s - x.s || x.i - y.i).map((x) => x.i)

/** Beide Reihenfolgen eines Paares zu einem Ergebnis zusammenführen: Uneinigkeit = Unentschieden (Positions-Bias), beide „schwach“ = bothWeak. */
export function combineOrders(ab: 'A' | 'B' | 'tie' | 'bothWeak', ba: 'A' | 'B' | 'tie' | 'bothWeak'): Outcome {
  if (ab === 'bothWeak' && ba === 'bothWeak') return 'bothWeak'
  const first = ab === 'A' ? 'a' : ab === 'B' ? 'b' : null // erste Reihenfolge: A = Kandidat a
  const second = ba === 'A' ? 'b' : ba === 'B' ? 'a' : null // zweite Reihenfolge vertauscht: A = Kandidat b
  if (first && second) return first === second ? first : 'tie'
  return first ?? second ?? 'tie'
}
