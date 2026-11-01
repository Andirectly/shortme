// Lernen: Bewertung, Gründe (reine Typen/Konstanten; Logik der Auswertung siehe unten und shared/learnPairs.ts).

export type Level = 'strong' | 'mid' | 'bad'
export const LEVELS: Level[] = ['strong', 'mid', 'bad']
export const LEVEL_LABEL: Record<Level, string> = { strong: 'Stark', mid: 'Mittel', bad: 'Schlecht' }
/** Rang für Paare: stark > mittel > schlecht. */
export const LEVEL_RANK: Record<Level, number> = { strong: 2, mid: 1, bad: 0 }

export const REASONS: Record<Level, string[]> = {
  strong: ['Starker Hook', 'Lustig', 'Emotional', 'Hilfreich'],
  mid: ['Hook schwach', 'Anfang falsch', 'Ende abgeschnitten', 'Ohne Kontext unverständlich', 'Langweilig', 'Falscher Bildausschnitt', 'Untertitel-Fehler'],
  bad: ['Hook schwach', 'Anfang falsch', 'Ende abgeschnitten', 'Ohne Kontext unverständlich', 'Langweilig', 'Falscher Bildausschnitt', 'Untertitel-Fehler']
}

export interface Rating { level: Level; reasons: string[]; at: string }
export type Ratings = Record<string, Rating>

/** Bereinigt eine gelesene Bewertung (Dateiinhalt ist nicht vertrauenswürdig). */
export function sanitizeRating(x: unknown): Rating | null {
  const r = x as Partial<Rating> | null
  if (!r || !LEVELS.includes(r.level as Level)) return null
  const ok = new Set(REASONS[r.level as Level])
  return { level: r.level as Level, reasons: Array.isArray(r.reasons) ? r.reasons.filter((s): s is string => typeof s === 'string' && ok.has(s)) : [], at: typeof r.at === 'string' ? r.at : '' }
}

/** Alte Daumen (feedback.json) → Stufen: hoch = stark, runter = schlecht. */
export function fromThumbs(old: Record<string, unknown>): Ratings {
  const out: Ratings = {}
  for (const [id, v] of Object.entries(old)) if (v === 1 || v === -1) out[id] = { level: v === 1 ? 'strong' : 'bad', reasons: [], at: '' }
  return out
}
