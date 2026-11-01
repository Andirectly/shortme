import { appendFile, readFile } from 'node:fs/promises'
import { baseState, stateOf, type EditLog } from '../../shared/edits'
import { diffStates, type CorrEvent, type CorrRecord } from '../../shared/corrections'
import { projectFile } from './project'
import { loadClips } from './clips/analysis'
import { loadTranscript } from './transcription'
import { loadStyle } from './styleDefaults'

const file = (hash: string): string => projectFile(hash, 'corrections.jsonl')

export async function logCorrection(hash: string, clipId: string, ev: CorrEvent[]): Promise<void> {
  if (!ev.length) return
  const at = new Date().toISOString()
  await appendFile(file(hash), ev.map((e) => JSON.stringify({ at, clipId, ...e })).join('\n') + '\n', 'utf8')
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
