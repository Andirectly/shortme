// Zielordner für Exporte: gewählter Ordner (<Daten>/export-dir.json) oder Standard Videos\Shortme.
import { existsSync } from 'node:fs'
import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app } from 'electron'
import { dataRoot } from '../engines/paths'
import { writeFileAtomic } from './atomic'

const file = (): string => join(dataRoot(), 'export-dir.json')
export const defaultExportRoot = (): string => join(app.getPath('videos'), 'Shortme')

export async function exportRoot(): Promise<string> {
  try {
    const dir = (JSON.parse(await readFile(file(), 'utf8')) as { dir?: string }).dir
    // gewählter Ordner (z. B. USB-Laufwerk) nicht mehr da → Standard statt Fehler
    if (dir && existsSync(dir)) return dir
  } catch { /* noch nichts gewählt */ }
  return defaultExportRoot()
}

export async function setExportRoot(dir: string | null): Promise<string> {
  if (dir) await mkdir(dir, { recursive: true })
  await writeFileAtomic(file(), JSON.stringify({ dir }))
  return exportRoot()
}
