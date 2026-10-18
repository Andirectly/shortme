import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { dataRoot } from '../engines/paths'
import { writeFileAtomic } from './atomic'
import type { EditState } from '../../shared/edits'

/** Globaler Standard-Untertitelstil (Stil-Studio → „Als Standard setzen“): gilt für jeden Clip ohne eigene Bearbeitung. */
export type StyleDefaults = Partial<EditState['caption']>
const file = (): string => join(dataRoot(), 'style.json')

export async function loadStyle(): Promise<StyleDefaults> {
  try { const s = JSON.parse(await readFile(file(), 'utf8')) as StyleDefaults; return typeof s === 'object' && s ? s : {} } catch { return {} }
}
export async function saveStyle(s: StyleDefaults): Promise<StyleDefaults> {
  const clean = Object.fromEntries(Object.entries(s).filter(([k, v]) => v !== undefined && v !== '' && ['presetId', 'scale', 'y', 'highlight', 'font', 'outline', 'upper', 'maxWords', 'anim'].includes(k)))
  await writeFileAtomic(file(), JSON.stringify(clean, null, 1))
  return clean
}
