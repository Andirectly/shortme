// Engine 4 – Stufen-Checkpoints (Fortsetzen nach Abbruch/Absturz): teure Modellschritte werden mit einem Schlüssel aus Quelle, Eingabe, Profil,
// Prompt- und Modellrevision gespeichert. Ändert sich etwas davon, passt der Schlüssel nicht mehr → neu rechnen (kein falscher Treffer).
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { projectDir } from '../../../project'
import { writeFileAtomic } from '../../../atomic'

export const checkpointKey = (parts: unknown[]): string => createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 32)
const file = (hash: string, kind: string, key: string): string => join(projectDir(hash), 'analysis', 'shared', 'v4-checkpoints', `${kind}-${key}.json`)

export async function loadCheckpoint<T>(hash: string, kind: string, key: string): Promise<T | null> {
  try { return JSON.parse(await readFile(file(hash, kind, key), 'utf8')) as T } catch { return null }
}
export const saveCheckpoint = (hash: string, kind: string, key: string, value: unknown): Promise<void> => writeFileAtomic(file(hash, kind, key), JSON.stringify(value))
