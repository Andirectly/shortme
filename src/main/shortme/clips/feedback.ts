import { appendFile, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { dataRoot } from '../../engines/paths'
import { writeFileAtomic } from '../atomic'
import { projectFile } from '../project'
import { loadTranscript } from '../transcription'
import { loadClips } from './analysis'
import { loadHeat } from './heat'

/** Daumen je Clip: 1 = hoch, −1 = runter, 0 = zurückgenommen. */
export type Vote = -1 | 0 | 1
const file = (hash: string): string => projectFile(hash, 'feedback.json')

export async function loadFeedback(hash: string): Promise<Record<string, Vote>> {
  try { return JSON.parse(await readFile(file(hash), 'utf8')) as Record<string, Vote> } catch { return {} }
}

/**
 * Speichert die Bewertung am Projekt (feedback.json) und hängt einen vollständigen Datensatz an `<Daten>/feedback.jsonl` an
 * (Transkript, Kriterien, Score, Heatmap-Werte) – Grundlage für eine spätere Feinabstimmung/Kalibrierung.
 */
export async function saveFeedback(hash: string, clipId: string, vote: Vote): Promise<Record<string, Vote>> {
  const all = await loadFeedback(hash)
  if (vote === 0) delete all[clipId]; else all[clipId] = vote
  await writeFileAtomic(file(hash), JSON.stringify(all, null, 1))
  const [clips, tr, heat] = await Promise.all([loadClips(hash), loadTranscript(hash), loadHeat(hash)])
  const c = clips?.clips.find((x) => x.id === clipId)
  if (c && tr) {
    const text = tr.words.slice(c.firstWord, c.lastWord + 1).map((w) => w.w).join(' ')
    const heatPts = heat?.filter((p) => p.end > c.start && p.start < c.end)
    const rec = { at: new Date().toISOString(), project: hash, clipId, vote, start: c.start, end: c.end, durationSec: +(c.end - c.start).toFixed(1), score: c.score, criteria: c.criteria, heat: c.heat ?? null, heatCurve: heatPts ?? null, faceRatio: c.faceRatio, mode: clips?.mode, title: c.title, hookText: c.hookText, reason: c.reason, text }
    await appendFile(join(dataRoot(), 'feedback.jsonl'), JSON.stringify(rec) + '\n', 'utf8')
  }
  return all
}
