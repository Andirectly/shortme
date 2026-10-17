import { create } from 'zustand'
import type { ShortmeClips, ShortmeImport, ShortmeJob, ShortmeTranscript } from '@shared/shortme'

const api = (): Window['cutawan']['shortme'] | null => (typeof window !== 'undefined' && window.cutawan?.shortme ? window.cutawan.shortme : null)

interface ProjectState {
  /** Zuletzt importiertes Video (Sheet „Clips erstellen“). */
  imported: ShortmeImport | null
  importing: boolean
  importMessage: string
  importError: string
  job: ShortmeJob | null
  clipsFile: ShortmeClips | null
  transcript: ShortmeTranscript | null
  hasApi: boolean
  loadResults: (hash: string) => Promise<void>
  init: () => void
  importPath: (path: string) => Promise<boolean>
  importUrl: (url: string) => Promise<boolean>
  clearImport: () => void
  startTranscribe: (diarize: boolean, query?: string) => Promise<boolean>
  exportClips: (clipIds: string[], presetId: string, srt: boolean) => Promise<boolean>
  exportJob: ShortmeJob | null
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
  clipsFile: null,
  transcript: null,
  exportJob: null,
  hasApi: false,
  loadResults: async (hash) => {
    const a = api()
    if (!a) return
    const [clipsFile, transcript] = await Promise.all([a.clips(hash), a.transcript(hash)])
    set({ clipsFile, transcript })
  },
  init: () => {
    const a = api()
    set({ hasApi: !!a })
    if (!a) return
    unsub.forEach((u) => u())
    unsub = [
      a.onJob((j) => {
        if (j.title.startsWith('Export')) { set({ exportJob: j }); return }
        set((s) => (s.job && s.job.id !== j.id && s.job.state === 'running' ? s : { job: j }))
        if (j.state === 'done') void get().loadResults(j.hash)
      }),
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
  startTranscribe: async (diarize, query) => {
    const a = api()
    const imp = get().imported
    if (!a || !imp) return false
    const job = await a.transcribe(imp.meta.hash, { diarize, query })
    set({ job, clipsFile: null, transcript: null })
    return true
  },
  exportClips: async (clipIds, presetId, srt) => {
    const a = api()
    const hash = get().clipsFile?.hash
    if (!a || !hash || clipIds.length === 0) return false
    set({ exportJob: await a.exportClips(hash, clipIds, { presetId, srt }) })
    return true
  },
  pause: async () => { const j = get().job; if (j) await api()?.pause(j.id) },
  resume: async () => { const j = get().job; if (j) await api()?.resume(j.id) },
  stop: async () => { const j = get().job; if (j) await api()?.stop(j.id) },
  discard: async () => { const j = get().job; if (j) { await api()?.discard(j.id); set({ job: null }) } }
}))
