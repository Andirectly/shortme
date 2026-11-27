// Lernen aus dem, was der Nutzer über Clips sagt – über alle Projekte:
// 1. Spur-Gewichte: Review (freigegeben = gut, verworfen = schlecht) und Bewertungen (stark = gut, schlecht = schlecht; das Review hat Vorrang).
//    Welche Spuren einen Clip gefunden haben, steht in v2.eventNote („Lanes speech+audio …“ bzw. „Suchwege …“) – gilt auch für alte Läufe.
// 2. Vorlieben: Gründe der Bewertungen („Lustig“, „Ende abgeschnitten“ …) als kurzer Hinweis für die Rangfolge (shared/learnPrefs.ts).
import { readdir, readFile } from 'node:fs/promises'
import type { ShortmeClip } from '../../../../../shared/shortme'
import { projectFile, projectsRoot } from '../../../project'
import { sanitizeReviewFile } from '../../../../../shared/review'
import { preferenceHint } from '../../../../../shared/learnPrefs'
import type { Rating } from '../../../../../shared/learn'
import { loadRatings } from '../../feedback'
import { clipsPathFor, loadState } from '../state'
import { laneWeights, LANES, type Lane, type LaneSample } from './core'

export function lanesOfClip(clip: Pick<ShortmeClip, 'v2'>): Lane[] {
  const m = clip.v2?.eventNote?.match(/(?:Lanes|Suchwege) ([a-z+-]+)/)
  return m ? (m[1].split('+').filter((l) => (LANES as string[]).includes(l)) as Lane[]) : []
}

/** Ein Clip zählt einmal: Review-Entscheidung vor Bewertung; „mittel“ und offene Clips zählen nicht. */
export function verdicts(review: ReturnType<typeof sanitizeReviewFile>, ratings: Record<string, Rating>): Map<string, boolean> {
  const out = new Map<string, boolean>()
  for (const [id, r] of Object.entries(ratings)) if (r.level === 'strong' || r.level === 'bad') out.set(id, r.level === 'strong')
  for (const [id, r] of Object.entries(review)) if (r.status === 'freigegeben' || r.status === 'verworfen') out.set(id, r.status === 'freigegeben')
  return out
}

export async function learnedLaneWeights(): Promise<{ weights: Partial<Record<Lane, number>>; samples: number }> {
  const samples: LaneSample[] = []
  let hashes: string[]
  try { hashes = await readdir(projectsRoot()) } catch { return { weights: {}, samples: 0 } }
  for (const hash of hashes) {
    let review: ReturnType<typeof sanitizeReviewFile> = {}
    try { review = sanitizeReviewFile(JSON.parse(await readFile(projectFile(hash, 'review.json'), 'utf8'))) } catch { /* nur Bewertungen */ }
    const decided = verdicts(review, await loadRatings(hash))
    if (!decided.size) continue
    const lanes = new Map<string, Lane[]>()
    try {
      for (const run of (await loadState(hash)).runs) {
        const f = JSON.parse(await readFile(clipsPathFor(hash, run.runId), 'utf8').catch(() => '{}')) as { clips?: ShortmeClip[] }
        for (const c of f.clips ?? []) { const l = lanesOfClip(c); if (l.length) lanes.set(c.id, l) }
      }
    } catch { continue }
    for (const [id, ok] of decided) { const l = lanes.get(id); if (l) samples.push({ lanes: l, ok }) }
  }
  // ab 10 Urteilen (je Spur 4); die Glättung in laneWeights (+10 Schein-Urteile zum Mittel, Grenzen 0,7–1,3) verhindert Ausreißer bei wenigen Daten
  return { weights: laneWeights(samples, 10, 4), samples: samples.length }
}

/** Vorlieben aus den Gründen aller Bewertungen; leer, solange es zu wenige gibt. */
export async function learnedPreferences(): Promise<string> {
  let hashes: string[]
  try { hashes = await readdir(projectsRoot()) } catch { return '' }
  const all: Rating[] = []
  for (const hash of hashes) all.push(...Object.values(await loadRatings(hash)))
  return preferenceHint(all)
}
