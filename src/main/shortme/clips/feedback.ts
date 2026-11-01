import { readFile } from 'node:fs/promises'
import { writeFileAtomic } from '../atomic'
import { projectFile } from '../project'
import { notifyLearnChange } from '../../learn/store'
import { fromThumbs, sanitizeRating, type Rating, type Ratings } from '../../../shared/learn'

const file = (hash: string): string => projectFile(hash, 'ratings.json')

/** Bewertungen je Clip (stark/mittel/schlecht + Gründe); alte Daumen (feedback.json) werden übernommen. */
export async function loadRatings(hash: string): Promise<Ratings> {
  try {
    const raw = JSON.parse(await readFile(file(hash), 'utf8')) as Record<string, unknown>
    const out: Ratings = {}
    for (const [id, v] of Object.entries(raw)) { const r = sanitizeRating(v); if (r) out[id] = r }
    return out
  } catch { /* noch keine neue Datei */ }
  try { return fromThumbs(JSON.parse(await readFile(projectFile(hash, 'feedback.json'), 'utf8')) as Record<string, unknown>) } catch { return {} }
}

/** `null` nimmt die Bewertung zurück. Der Datensatz (dataset/) wird aus den Projektdateien neu gebaut, nicht hier angehängt. */
export async function saveRating(hash: string, clipId: string, rating: Pick<Rating, 'level' | 'reasons'> | null): Promise<Ratings> {
  const all = await loadRatings(hash)
  const r = rating && sanitizeRating({ ...rating, at: new Date().toISOString() })
  if (r) all[clipId] = r; else delete all[clipId]
  await writeFileAtomic(file(hash), JSON.stringify(all, null, 1))
  notifyLearnChange()
  return all
}
