import { appendFile, readFile } from 'node:fs/promises'
import { baseState, stateOf, type EditLog } from '../../shared/edits'
import { diffStates, type CorrEvent, type CorrRecord } from '../../shared/corrections'
import { projectFile } from './project'
import { writeFileAtomic } from './atomic'
import type { ShortmeClip } from '../../shared/shortme'
import { loadClips } from './clips/analysis'
import { readJson } from '../learn/store'
import { loadTranscript } from './transcription'
import { loadStyle } from './styleDefaults'
import { collecting, notifyLearnChange } from '../learn/store'

const file = (hash: string): string => projectFile(hash, 'corrections.jsonl')

export async function logCorrection(hash: string, clipId: string, ev: CorrEvent[]): Promise<void> {
  if (!ev.length || !(await collecting())) return
  const at = new Date().toISOString()
  await appendFile(file(hash), ev.map((e) => JSON.stringify({ at, clipId, ...e })).join('\n') + '\n', 'utf8')
  notifyLearnChange()
}

export async function loadCorrections(hash: string): Promise<CorrRecord[]> {
  try { return (await readFile(file(hash), 'utf8')).split('\n').filter(Boolean).map((l) => JSON.parse(l) as CorrRecord) } catch { return [] }
}

/** Beim Speichern des Operationslogs: Zustand davor/danach vergleichen und die Unterschiede protokollieren. */
export async function logEditDiff(hash: string, before: EditLog, after: EditLog): Promise<void> {
  try {
    const clip = (await loadClips(hash))?.clips.find((c) => c.id === after.clipId)
    const tr = await loadTranscript(hash)
    if (!clip || !tr) return
    const base = baseState(clip, undefined, await loadStyle())
    await logCorrection(hash, after.clipId, diffStates(stateOf(base, before), stateOf(base, after), tr.words))
  } catch (e) { console.error('Korrektur-Protokoll:', e) }
}

export interface DeletedClip { clip: ShortmeClip; at: string; playedSec: number }
export const loadDeleted = (hash: string): Promise<DeletedClip[]> => readJson<DeletedClip[]>(projectFile(hash, 'deleted.json'), [])

/** Clip aus der Liste nehmen. Der Clip bleibt mit Wiedergabedauer in `deleted.json` (Lerndaten); Bewertung und Edits bleiben liegen. */
export async function deleteClip(hash: string, clipId: string): Promise<void> {
  const file = await loadClips(hash)
  const clip = file?.clips.find((c) => c.id === clipId)
  if (!file || !clip) return
  const playedSec = (await loadCorrections(hash)).reduce((s, e) => s + (e.clipId === clipId && e.kind === 'played' ? e.sec : 0), 0)
  await writeFileAtomic(projectFile(hash, 'deleted.json'), JSON.stringify([...(await loadDeleted(hash)), { clip, at: new Date().toISOString(), playedSec }]))
  await writeFileAtomic(projectFile(hash, 'clips.json'), JSON.stringify({ ...file, clips: file.clips.filter((c) => c.id !== clipId) }, null, 1))
  await logCorrection(hash, clipId, [{ kind: 'delete', playedSec }])
}
