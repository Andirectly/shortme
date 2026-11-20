// Spur-Gewichte aus echten Review-Entscheidungen (freigegeben = gut, verworfen = schlecht) über alle Projekte.
// Welche Spuren einen Clip gefunden haben, steht in v2.eventNote („Lanes speech+audio …“ bzw. „Suchwege …“) – gilt auch für alte Läufe.
import { readdir, readFile } from 'node:fs/promises'
import type { ShortmeClip } from '../../../../../shared/shortme'
import { projectFile, projectsRoot } from '../../../project'
import { sanitizeReviewFile } from '../../../../../shared/review'
import { clipsPathFor, loadState } from '../state'
import { laneWeights, LANES, type Lane, type LaneSample } from './core'

export function lanesOfClip(clip: Pick<ShortmeClip, 'v2'>): Lane[] {
  const m = clip.v2?.eventNote?.match(/(?:Lanes|Suchwege) ([a-z+-]+)/)
  return m ? (m[1].split('+').filter((l) => (LANES as string[]).includes(l)) as Lane[]) : []
}

export async function learnedLaneWeights(): Promise<{ weights: Partial<Record<Lane, number>>; samples: number }> {
  const samples: LaneSample[] = []
  let hashes: string[]
  try { hashes = await readdir(projectsRoot()) } catch { return { weights: {}, samples: 0 } }
  for (const hash of hashes) {
    let review: ReturnType<typeof sanitizeReviewFile>
    try { review = sanitizeReviewFile(JSON.parse(await readFile(projectFile(hash, 'review.json'), 'utf8'))) } catch { continue }
    const decided = Object.entries(review).filter(([, r]) => r.status === 'freigegeben' || r.status === 'verworfen')
    if (!decided.length) continue
    const lanes = new Map<string, Lane[]>()
    try {
      for (const run of (await loadState(hash)).runs) {
        const f = JSON.parse(await readFile(clipsPathFor(hash, run.runId), 'utf8').catch(() => '{}')) as { clips?: ShortmeClip[] }
        for (const c of f.clips ?? []) { const l = lanesOfClip(c); if (l.length) lanes.set(c.id, l) }
      }
    } catch { continue }
    for (const [id, r] of decided) { const l = lanes.get(id); if (l) samples.push({ lanes: l, ok: r.status === 'freigegeben' }) }
  }
  return { weights: laneWeights(samples), samples: samples.length }
}
