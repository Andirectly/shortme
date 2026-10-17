import { create } from 'zustand'
import type { ShortmeImport, ShortmeJob } from '@shared/shortme'

const api = (): Window['cutawan']['shortme'] | null => (typeof window !== 'undefined' && window.cutawan?.shortme ? window.cutawan.shortme : null)

interface ProjectState {
  /** Zuletzt importiertes Video (Sheet „Clips erstellen“). */
  imported: ShortmeImport | null
  importing: boolean
  importMessage: string
  importError: string
  job: ShortmeJob | null
  hasApi: boolean
  init: () => void
  importPath: (path: string) => Promise<boolean>
  importUrl: (url: string) => Promise<boolean>
  clearImport: () => void
  startTranscribe: (diarize: boolean) => Promise<boolean>
  pause: () => Promise<void>
  resume: () => Promise<void>
  stop: () => Promise<void>
  discard: () => Promise<void>
}

let unsub: Array<() => void> = []

export const useProject = create<ProjectState>((set, get) => ({
  imported: null,
  importing: false,
  importMessage: '',
  importError: '',
  job: null,
  hasApi: false,
  init: () => {
    const a = api()
    set({ hasApi: !!a })
    if (!a) return
    unsub.forEach((u) => u())
    unsub = [
      a.onJob((j) => set((s) => (s.job && s.job.id !== j.id && s.job.state === 'running' ? s : { job: j }))),
      a.onImportProgress((p) => set({ importMessage: p.message }))
    ]
    void a.jobs().then((list) => { const live = list.find((j) => j.state === 'running' || j.state === 'queued' || j.state === 'paused'); if (live) set({ job: live }) })
  },
  importPath: async (path) => {
    const a = api()
    if (!a) return false
    set({ importing: true, importError: '', importMessage: 'Video wird geprüft …' })
    try {
      const r = await a.importFile(path)
      set({ imported: r, importing: false })
      return true
    } catch (e) {
      set({ importing: false, importError: e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e) })
      return false
    }
  },
  importUrl: async (url) => {
    const a = api()
    if (!a) return false
    set({ importing: true, importError: '', importMessage: 'Link wird geladen …' })
    try {
      const r = await a.importUrl(url)
      set({ imported: r, importing: false })
      return true
    } catch (e) {
      set({ importing: false, importError: e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e) })
      return false
    }
  },
  clearImport: () => set({ imported: null, importError: '' }),
  startTranscribe: async (diarize) => {
    const a = api()
    const imp = get().imported
    if (!a || !imp) return false
    const job = await a.transcribe(imp.meta.hash, { diarize })
    set({ job })
    return true
  },
  pause: async () => { const j = get().job; if (j) await api()?.pause(j.id) },
  resume: async () => { const j = get().job; if (j) await api()?.resume(j.id) },
  stop: async () => { const j = get().job; if (j) await api()?.stop(j.id) },
  discard: async () => { const j = get().job; if (j) { await api()?.discard(j.id); set({ job: null }) } }
}))
