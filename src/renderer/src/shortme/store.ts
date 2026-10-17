import { create } from 'zustand'
import { CLIPS } from './data'
import { allClips } from './clipData'

export type Screen = 'start' | 'projects' | 'studio' | 'models' | 'settings' | 'processing' | 'clips' | 'editor'
export type NavId = 'start' | 'projects' | 'studio' | 'models' | 'settings'

interface Op { label: string; undo: () => void; redo: () => void }

interface State {
  screen: Screen
  sheetOpen: boolean
  view: 'grid' | 'list'
  selected: string[]
  activeClip: string
  presetId: string
  progress: number // 0..1 simulierte Verarbeitung
  paused: boolean
  /* Erstellen-Optionen (letzte Auswahl wird gemerkt) */
  opts: { format: string; frame: string; length: string; captions: string; removePauses: boolean; workflow: string; query: string }
  /* Editor: nicht-destruktive Operationen */
  trim: [number, number]
  hookText: string
  undoStack: Op[]
  redoStack: Op[]
  go: (s: Screen) => void
  setOpts: (o: Partial<State['opts']>) => void
  toggleSelect: (id: string) => void
  setView: (v: 'grid' | 'list') => void
  setPreset: (id: string) => void
  openSheet: (b: boolean) => void
  setProgress: (p: number) => void
  setPaused: (b: boolean) => void
  openClip: (id: string) => void
  apply: (op: Op) => void
  undo: () => void
  redo: () => void
  setTrim: (t: [number, number]) => void
  setHook: (t: string) => void
}

const load = <T,>(k: string, d: T): T => { try { const v = localStorage.getItem(k); return v ? (JSON.parse(v) as T) : d } catch { return d } }
const save = (k: string, v: unknown): void => { try { localStorage.setItem(k, JSON.stringify(v)) } catch { /* ignore */ } }

export const useStore = create<State>((set, get) => ({
  screen: 'start',
  sheetOpen: false,
  view: load('sm.view', 'grid'),
  selected: [],
  activeClip: CLIPS[0].id,
  presetId: load('sm.preset', 'impact'),
  progress: 0,
  paused: false,
  opts: load('sm.opts', { format: '9:16', frame: 'Smart', length: 'Automatisch', captions: 'preset', removePauses: true, workflow: 'Prüfen & Bearbeiten', query: '' }),
  trim: [0, 47],
  hookText: CLIPS[0].hook,
  undoStack: [],
  redoStack: [],
  go: (screen) => set({ screen }),
  setOpts: (o) => { const opts = { ...get().opts, ...o }; save('sm.opts', opts); set({ opts }) },
  toggleSelect: (id) => set((s) => ({ selected: s.selected.includes(id) ? s.selected.filter((x) => x !== id) : [...s.selected, id] })),
  setView: (view) => { save('sm.view', view); set({ view }) },
  setPreset: (presetId) => { save('sm.preset', presetId); set({ presetId }) },
  openSheet: (sheetOpen) => set({ sheetOpen }),
  setProgress: (progress) => set({ progress }),
  setPaused: (paused) => set({ paused }),
  openClip: (id) => { const c = allClips().find((x) => x.id === id) ?? CLIPS[0]; set({ activeClip: id, screen: 'editor', trim: [0, c.duration], hookText: c.hook, undoStack: [], redoStack: [] }) },
  apply: (op) => { op.redo(); set((s) => ({ undoStack: [...s.undoStack, op], redoStack: [] })) },
  undo: () => { const { undoStack } = get(); const op = undoStack[undoStack.length - 1]; if (!op) return; op.undo(); set((s) => ({ undoStack: s.undoStack.slice(0, -1), redoStack: [...s.redoStack, op] })) },
  redo: () => { const { redoStack } = get(); const op = redoStack[redoStack.length - 1]; if (!op) return; op.redo(); set((s) => ({ redoStack: s.redoStack.slice(0, -1), undoStack: [...s.undoStack, op] })) },
  setTrim: (trim) => set({ trim }),
  setHook: (hookText) => set({ hookText })
}))
