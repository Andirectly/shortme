// Review-Entscheidungen je Projekt (projects/<hash>/review.json). Getrennt von KI-Prüfung (Clipdaten) und Lernbewertung (ratings.json).
// Der Bearbeitungsstand (Fingerabdruck) wird hier aus Clip + Edit-Log berechnet, damit eine Freigabe nie unbemerkt auf veränderten Inhalt zeigt.
import { readFile } from 'node:fs/promises'
import { clipRevision, decide, reviewView, sanitizeReviewFile, type ReviewFile, type ReviewStatus, type ReviewView } from '../../shared/review'
import { writeFileAtomic } from './atomic'
import { projectFile } from './project'
import { loadEdits } from './edits'
import { findClip } from './clips/analysis'
import { logInfo } from '../log'

const file = (hash: string): string => projectFile(hash, 'review.json')
// Schreibvorgänge je Projekt nacheinander (schnelles 1/2/3 im Review darf keine Entscheidung überschreiben)
const chains = new Map<string, Promise<unknown>>()

export async function loadReview(hash: string): Promise<ReviewFile> {
  try { return sanitizeReviewFile(JSON.parse(await readFile(file(hash), 'utf8'))) } catch { return {} }
}

async function revisionOf(hash: string, clipId: string): Promise<string> {
  const found = await findClip(hash, clipId)
  if (!found) return ''
  return clipRevision(found.clip, await loadEdits(hash, clipId))
}

/** Sicht für die Oberfläche: Entscheidung + aktueller Bearbeitungsstand je angefragtem Clip (alte Projekte ohne Datei → alles „offen“). */
export async function reviewState(hash: string, clipIds: string[]): Promise<Record<string, ReviewView>> {
  const all = await loadReview(hash)
  const out: Record<string, ReviewView> = {}
  for (const id of clipIds.slice(0, 500)) out[id] = reviewView(all[id], await revisionOf(hash, id))
  return out
}

export function setReview(hash: string, clipId: string, status: ReviewStatus): Promise<ReviewView> {
  const run = async (): Promise<ReviewView> => {
    const all = await loadReview(hash)
    const rev = await revisionOf(hash, clipId)
    const next = decide(all[clipId], status, rev)
    if (next !== all[clipId]) { all[clipId] = next; await writeFileAtomic(file(hash), JSON.stringify(all, null, 1)); logInfo(`[Review] ${hash.slice(0, 8)} ${clipId} → ${status}`) }
    return reviewView(next, rev)
  }
  const p = (chains.get(hash) ?? Promise.resolve()).then(run, run)
  chains.set(hash, p.catch(() => undefined))
  return p
}
