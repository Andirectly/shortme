import { mkdir, readdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { dataRoot } from '../engines/paths'
import { BUILTIN_PRESETS, presetById, resolvePreset, sanitizePreset, type StylePreset } from '../../shared/preset'
import type { EditState } from '../../shared/edits'
import { writeFileAtomic } from './atomic'

const dir = (): string => join(dataRoot(), 'presets')

/** Eigene Presets (JSON-Dateien, renderer-unabhängiges Format Version 2). */
export async function listUserPresets(): Promise<StylePreset[]> {
  await mkdir(dir(), { recursive: true })
  const out: StylePreset[] = []
  for (const f of (await readdir(dir())).filter((n) => n.endsWith('.json'))) {
    try { const p = sanitizePreset(JSON.parse(await readFile(join(dir(), f), 'utf8'))); if (p) out.push(p) } catch { /* defekte Datei überspringen */ }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

export async function allPresets(): Promise<StylePreset[]> { return [...BUILTIN_PRESETS, ...(await listUserPresets())] }

const slug = (name: string): string => name.toLowerCase().normalize('NFKD').replace(/[^\w]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'preset'

/** Speichern: neuer Name → neue Datei (`u-<name>`), überschreiben → gleiche ID (eingebaute Presets lassen sich nicht überschreiben). */
export async function saveUserPreset(p: StylePreset, mode: 'new' | 'overwrite'): Promise<StylePreset> {
  await mkdir(dir(), { recursive: true })
  const existing = await listUserPresets()
  let id = p.id
  if (mode === 'new' || BUILTIN_PRESETS.some((b) => b.id === id)) {
    id = `u-${slug(p.name)}`
    let n = 2
    while (existing.some((e) => e.id === id) || BUILTIN_PRESETS.some((b) => b.id === id)) id = `u-${slug(p.name)}-${n++}`
  }
  const saved = sanitizePreset({ ...p, id }) as StylePreset
  await writeFileAtomic(join(dir(), `${saved.id}.json`), JSON.stringify(saved, null, 2))
  return saved
}

export async function deleteUserPreset(id: string): Promise<void> {
  if (BUILTIN_PRESETS.some((b) => b.id === id)) return
  await rm(join(dir(), `${id.replace(/[^\w.-]/g, '_')}.json`), { force: true })
}

/** Wirksames Preset eines Clips: Preset + Änderungen aus den Editor-Operationen. */
export function effectivePreset(all: StylePreset[], caption: EditState['caption']): StylePreset {
  return resolvePreset(presetById(caption.presetId, all), caption.style)
}
