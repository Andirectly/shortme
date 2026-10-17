import { readFile } from 'node:fs/promises'
import { emptyLog, push, sanitizeLog, type CaptionPatch, type EditLog } from '../../shared/edits'
import { writeFileAtomic } from './atomic'
import { projectFile } from './project'

const file = (hash: string, clipId: string): string => projectFile(hash, `edits/${clipId.replace(/[^\w.-]/g, '_')}.json`)

export async function loadEdits(hash: string, clipId: string): Promise<EditLog> {
  try { return sanitizeLog(JSON.parse(await readFile(file(hash, clipId), 'utf8')), clipId) } catch { return emptyLog(clipId) }
}

/** Autosave: jede Änderung des Logs landet atomar auf der Platte (Neustart stellt den Stand wieder her). */
export async function saveEdits(hash: string, log: EditLog): Promise<void> {
  await writeFileAtomic(file(hash, log.clipId), JSON.stringify(log))
}

/** „Auf alle anwenden“: Untertitel-Stil als Operation an alle genannten Clips hängen (je Clip einzeln rückgängig machbar). */
export async function applyCaptionToAll(hash: string, clipIds: string[], patch: CaptionPatch): Promise<void> {
  for (const id of clipIds) await saveEdits(hash, push(await loadEdits(hash, id), { t: 'caption', patch }))
}
