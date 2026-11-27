import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { dataRoot } from '../engines/paths'
import { writeFileAtomic } from './atomic'
import type { StyleDefaults } from '../../shared/edits'

const file = (): string => join(dataRoot(), 'style.json')

/** Cold-Opener-Regler: ganze Sekunden 0–5 (alles andere = aus). */
const coldOpen = (x: unknown): number | undefined => (typeof x === 'number' && Number.isFinite(x) ? Math.max(0, Math.min(5, Math.round(x))) || undefined : undefined)

/** Globaler Standard (Stil-Studio → „Als Standard festlegen“, Erstellen-Dialog): Preset, Änderungen daran, Titel an/aus. Alte Dateien (vor Preset-Format 2) werden ignoriert. */
export async function loadStyle(): Promise<StyleDefaults> {
  try {
    const s = JSON.parse(await readFile(file(), 'utf8')) as Record<string, unknown>
    return { presetId: typeof s.presetId === 'string' ? s.presetId : undefined, style: typeof s.style === 'object' && s.style ? (s.style as StyleDefaults['style']) : undefined, titleEnabled: typeof s.titleEnabled === 'boolean' ? s.titleEnabled : undefined, captionsEnabled: typeof s.captionsEnabled === 'boolean' ? s.captionsEnabled : undefined, coldOpenSec: coldOpen(s.coldOpenSec) }
  } catch { return {} }
}
export async function saveStyle(s: StyleDefaults): Promise<StyleDefaults> {
  const clean: StyleDefaults = { ...(s.presetId ? { presetId: s.presetId } : {}), ...(s.style ? { style: s.style } : {}), ...(typeof s.titleEnabled === 'boolean' ? { titleEnabled: s.titleEnabled } : {}), ...(typeof s.captionsEnabled === 'boolean' ? { captionsEnabled: s.captionsEnabled } : {}), ...(coldOpen(s.coldOpenSec) ? { coldOpenSec: coldOpen(s.coldOpenSec) } : {}) }
  await writeFileAtomic(file(), JSON.stringify(clean, null, 1))
  return clean
}
