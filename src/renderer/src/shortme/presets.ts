import { create } from 'zustand'
import { BUILTIN_PRESETS, presetById, resolvePreset, type PresetPatch, type StylePreset } from '@shared/preset'

const api = (): Window['cutawan']['shortme'] | null => (typeof window !== 'undefined' && window.cutawan?.shortme ? window.cutawan.shortme : null)

interface PresetsState {
  /** Eingebaute + eigene Presets (Preset-Format Version 2). */
  all: StylePreset[]
  load: () => Promise<void>
  /** Speichern: `new` = neuer Name (neue Datei), `overwrite` = bestehendes eigenes Preset ersetzen. */
  save: (p: StylePreset, mode: 'new' | 'overwrite') => Promise<StylePreset | null>
  remove: (id: string) => Promise<void>
  importFiles: () => Promise<boolean>
  exportOne: (id: string) => Promise<boolean>
}

export const usePresets = create<PresetsState>((set) => ({
  all: BUILTIN_PRESETS,
  load: async () => { const a = api(); if (a) set({ all: await a.presets() }) },
  save: async (p, mode) => { const a = api(); if (!a) return null; const r = await a.presetSave(p, mode); set({ all: r.all }); return r.saved },
  remove: async (id) => { const a = api(); if (a) set({ all: await a.presetDelete(id) }) },
  importFiles: async () => { const a = api(); if (!a) return false; const r = await a.presetImport().catch(() => null); if (r) { set({ all: r }); return true } return false },
  exportOne: async (id) => { const a = api(); return a ? a.presetExport(id) : false }
}))

/** Wirksames Preset: Preset-ID + Änderungen (+ vorläufige Änderungen während eines Regler-Zugs). */
export function effective(all: StylePreset[], presetId: string, ...patches: Array<PresetPatch | null | undefined>): StylePreset {
  let p = presetById(presetId, all)
  for (const patch of patches) if (patch) p = resolvePreset(p, patch)
  return p
}

export const isBuiltin = (id: string): boolean => BUILTIN_PRESETS.some((b) => b.id === id)
