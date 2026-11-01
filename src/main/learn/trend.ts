import { writeFileAtomic } from '../shortme/atomic'
import { projectFile } from '../shortme/project'
import { topicsFile } from '../shortme/clips/topics'
import { loadLearnSettings, readJson } from './store'
import { ytJson } from './yt'

/** Erweitert (Standard aus): schwaches Trend-Signal zum Hauptthema über öffentliche YouTube-Suchergebnisse (nur per yt-dlp). Wird nur im Datensatz vermerkt, nie im Ranking benutzt. */
export async function fetchTrend(hash: string): Promise<void> {
  if (!(await loadLearnSettings()).trend) return
  const topic = (await readJson<{ main?: string }>(topicsFile(hash), {})).main
  if (!topic) return
  const d = await ytJson(['--flat-playlist', `ytsearchdate10:${topic}`]).catch(() => null)
  const views = ((d?.entries ?? []) as Array<{ view_count?: number }>).map((e) => e.view_count ?? 0).sort((a, b) => a - b)
  if (!views.length) return
  await writeFileAtomic(projectFile(hash, 'trend.json'), JSON.stringify({ topic, results: views.length, medianViews: views[views.length >> 1], at: new Date().toISOString() }))
}
