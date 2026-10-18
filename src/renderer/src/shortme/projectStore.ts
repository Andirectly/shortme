import { create } from 'zustand'
import type { PersonsPatch, ShortmeClips, ShortmePersons, ShortmeImport, ShortmeJob, ShortmeTranscript } from '@shared/shortme'

const api = (): Window['cutawan']['shortme'] | null => (typeof window !== 'undefined' && window.cutawan?.shortme ? window.cutawan.shortme : null)

interface ProjectState {
  /** Zuletzt importiertes Video (Sheet „Clips erstellen“). */
  imported: ShortmeImport | null
  importing: boolean
  importMessage: string
  importProgress: number
  importError: string
  job: ShortmeJob | null
  clipsFile: ShortmeClips | null
  transcript: ShortmeTranscript | null
  hasApi: boolean
  loadResults: (hash: string) => Promise<void>
  projects: ProjectCard[]
  loadProjects: () => Promise<void>
  deleteProject: (hash: string) => Promise<boolean>
  /** Titel des geöffneten Projekts (Clip-Übersicht). */
  currentTitle: string | null
  openProject: (hash: string) => Promise<boolean>
  init: () => void
  importPath: (path: string) => Promise<boolean>
  importUrl: (url: string) => Promise<boolean>
  clearImport: () => void
  startTranscribe: (diarize: boolean, query?: string, wanted?: number) => Promise<boolean>
  exportClips: (clipIds: string[], presetId: string, srt: boolean) => Promise<boolean>
  exportJob: ShortmeJob | null
  /** „Wer ist wer?“ */
  persons: ShortmePersons | null
  personsOpen: boolean
  pendingExport: { clipIds: string[]; presetId: string; srt: boolean } | null
  openPersons: () => void
  closePersons: () => void
  savePersons: (patch: PersonsPatch) => Promise<void>
  pause: () => Promise<void>
  resume: () => Promise<void>
  stop: () => Promise<void>
  discard: () => Promise<void>
}

export interface ProjectCard { hash: string; title: string; durationSec: number; clips: number; created: string; poster: string | null }

let unsub: Array<() => void> = []

export const useProject = create<ProjectState>((set, get) => ({
  imported: null,
  importing: false,
  importMessage: '',
  importProgress: 0,
  importError: '',
  job: null,
  clipsFile: null,
  transcript: null,
  exportJob: null,
  persons: null,
  personsOpen: false,
  pendingExport: null,
  openPersons: () => set({ personsOpen: true }),
  closePersons: () => set({ personsOpen: false, pendingExport: null }),
  savePersons: async (patch) => {
    const a = api()
    const hash = get().clipsFile?.hash
    if (!a || !hash) return
    const persons = await a.personsSave(hash, patch)
    const pending = get().pendingExport
    set({ persons, personsOpen: false, pendingExport: null })
    await get().loadResults(hash)
    if (pending) await get().exportClips(pending.clipIds, pending.presetId, pending.srt)
  },
  hasApi: false,
  projects: [],
  currentTitle: null,
  deleteProject: async (hash) => { const a = api(); if (!a) return false; const ok = await a.deleteProject(hash); if (ok) { if (get().clipsFile?.hash === hash) set({ clipsFile: null, persons: null }); await get().loadProjects() } return ok },
  loadProjects: async () => { const a = api(); if (a) set({ projects: await a.projects() }) },
  openProject: async (hash) => {
    const a = api()
    if (!a) return false
    await get().loadResults(hash)
    const p = get().projects.find((x) => x.hash === hash)
    set({ currentTitle: p?.title ?? null })
    return !!get().clipsFile
  },
  loadResults: async (hash) => {
    const a = api()
    if (!a) return
    const [clipsFile, transcript, persons] = await Promise.all([a.clips(hash), a.transcript(hash), a.persons(hash)])
    set({ clipsFile, transcript, persons })
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
      a.onImportProgress((p) => set({ importMessage: p.message, importProgress: p.progress }))
    ]
    void a.jobs().then((list) => { const live = list.find((j) => j.state === 'running' || j.state === 'queued' || j.state === 'paused'); if (live) set({ job: live }) })
  },
  importPath: async (path) => {
    const a = api()
    if (!a) return false
    set({ importing: true, importError: '', importProgress: 0, importMessage: 'Video wird geprüft …' })
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
    set({ importing: true, importError: '', importProgress: 0, importMessage: 'Link wird geprüft …' })
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
  startTranscribe: async (diarize, query, wanted) => {
    const a = api()
    const imp = get().imported
    if (!a || !imp) return false
    const job = await a.transcribe(imp.meta.hash, { diarize, query, wanted })
    set({ job, clipsFile: null, transcript: null })
    return true
  },
  exportClips: async (clipIds, presetId, srt) => {
    const a = api()
    const hash = get().clipsFile?.hash
    if (!a || !hash || clipIds.length === 0) return false
    // Unsichere Personenerkennung: erst „Wer ist wer?“ klären, dann exportieren
    if (get().persons?.needsReview) { set({ personsOpen: true, pendingExport: { clipIds, presetId, srt } }); return false }
    set({ exportJob: await a.exportClips(hash, clipIds, { presetId, srt }) })
    return true
  },
  pause: async () => { const j = get().job; if (j) await api()?.pause(j.id) },
  resume: async () => { const j = get().job; if (j) await api()?.resume(j.id) },
  stop: async () => { const j = get().job; if (j) await api()?.stop(j.id) },
  discard: async () => { const j = get().job; if (j) { await api()?.discard(j.id); set({ job: null }) } }
}))
