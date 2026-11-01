import { create } from 'zustand'
import type { Level, Ratings } from '@shared/learn'
import { useStore } from './store'
import { FRAME_LABELS, frameFromLabel, type ContentType } from '@shared/videoKind'
import type { StyleDefaults } from '@shared/edits'
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
  /** Nur die Clipliste neu laden (während die Analyse noch läuft). */
  refreshClips: (hash: string) => Promise<void>
  projects: ProjectCard[]
  loadProjects: () => Promise<void>
  deleteProject: (hash: string) => Promise<boolean>
  /** Titel des geöffneten Projekts (Clip-Übersicht). */
  currentTitle: string | null
  openProject: (hash: string) => Promise<boolean>
  init: () => void
  importPath: (path: string) => Promise<boolean>
  importUrl: (url: string) => Promise<boolean>
  /** Twitch (VOD, Clip, laufendes VOD): mit `analyze` startet danach direkt die Clip-Analyse. */
  twitchImport: (url: string, opts: { section?: [number, number]; lastMinutes?: number; analyze?: boolean }) => Promise<boolean>
  /** Inhaltstyp für die Clip-Auswahl; Twitch-Importe schlagen „Stream/Gaming“ vor. */
  contentType: ContentType
  /** Wie der Typ zustande kam (für das Etikett „erkannt“); null = noch keine Einschätzung. */
  kindSource: 'twitch' | 'remembered' | 'detected' | 'manual' | null
  kindReason: string
  suggesting: boolean
  setContentType: (c: ContentType) => Promise<void>
  /** Gewählter Bildausschnitt (Anzeigename) – folgt dem Typ, bleibt änderbar. */
  frame: string
  setFrame: (f: string) => void
  suggest: () => Promise<void>
  clearImport: () => void
  startTranscribe: (diarize: boolean, query?: string, wanted?: number) => Promise<boolean>
  exportClips: (clipIds: string[], presetId: string, srt: boolean) => Promise<boolean>
  exportJob: ShortmeJob | null
  /** „Wer ist wer?“ */
  persons: ShortmePersons | null
  feedback: Ratings
  /** Globaler Standardstil der Untertitel (Stil-Studio). */
  style: StyleDefaults
  loadStyle: () => Promise<void>
  saveStyle: (s: StyleDefaults) => Promise<void>
  deleteClip: (clipId: string) => Promise<void>
  setFeedback: (clipId: string, rating: { level: Level; reasons: string[] } | null) => Promise<void>
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
let lastRefresh = 0

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
  feedback: {},
  style: {},
  loadStyle: async () => { const a = api(); if (a) set({ style: await a.styleGet() }) },
  saveStyle: async (st) => { const a = api(); if (a) set({ style: await a.styleSet(st) }) },
  deleteClip: async (clipId) => { const a = api(); const hash = get().clipsFile?.hash; if (!a || !hash) return; await a.deleteClip(hash, clipId); await get().refreshClips(hash) },
  setFeedback: async (clipId, rating) => { const a = api(); const hash = get().clipsFile?.hash; if (!a || !hash) return; set({ feedback: await a.feedbackSet(hash, clipId, rating) }) },
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
  refreshClips: async (hash) => {
    const a = api()
    if (!a) return
    const clipsFile = await a.clips(hash)
    if (clipsFile) set({ clipsFile })
  },
  loadResults: async (hash) => {
    const a = api()
    if (!a) return
    const [clipsFile, transcript, persons, feedback] = await Promise.all([a.clips(hash), a.transcript(hash), a.persons(hash), a.feedback(hash)])
    set({ clipsFile, transcript, persons, feedback })
  },
  init: () => {
    const a = api()
    set({ hasApi: !!a })
    if (!a) return
    void get().loadStyle()
    // Testlab-Schalter: der Hauptprozess entscheidet (Pipeline nutzt nur dann Testlab-Entscheidungen); erste Nutzung übernimmt den alten Wert
    void a.testlab.enabled().then((v) => { if (v === null) void a.testlab.setEnabled(useStore.getState().testlab); else useStore.setState({ testlab: v }) })
    unsub.forEach((u) => u())
    unsub = [
      a.onJob((j) => {
        if (j.title.startsWith('Export')) { set({ exportJob: j }); return }
        set((s) => (s.job && s.job.id !== j.id && s.job.state === 'running' ? s : { job: j }))
        if (j.state === 'done') void get().loadResults(j.hash)
        // Clips erscheinen, sobald sie fertig sind: Übersicht öffnet sich beim ersten fertigen Clip
        else if (j.stage === 'layout' && j.state === 'running') {
          const now = Date.now()
          if (now - lastRefresh > 1200) {
            lastRefresh = now
            void get().refreshClips(j.hash).then(() => {
              const f = get().clipsFile
              const ui = useStore.getState()
              if (f && f.hash === j.hash && ui.screen === 'processing' && f.clips.some((c) => !c.pending)) { set({ currentTitle: j.title }); ui.go('clips') }
            })
          }
        }
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
      void get().suggest()
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
      void get().suggest()
      return true
    } catch (e) {
      set({ importing: false, importError: e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e) })
      return false
    }
  },
  contentType: 'podcast',
  kindSource: null,
  kindReason: '',
  suggesting: false,
  frame: 'Smart',
  setFrame: (frame) => set({ frame }),
  setContentType: async (contentType) => {
    set({ contentType, kindSource: 'manual', kindReason: '' })
    const a = api()
    if (a) { const p = await a.profile(contentType).catch(() => null); if (p) set({ frame: FRAME_LABELS[p.frame] }) }
  },
  suggest: async () => {
    const a = api()
    const imp = get().imported
    if (!a || !imp) return
    set({ suggesting: true })
    try {
      const s = await a.suggestKind(imp.meta.hash)
      set({ contentType: s.kind, kindSource: s.source, kindReason: s.reason, frame: FRAME_LABELS[s.frame], suggesting: false })
    } catch { set({ suggesting: false }) }
  },
  twitchImport: async (url, opts) => {
    const a = api()
    if (!a) return false
    set({ importing: true, importError: '', importProgress: 0, importMessage: 'Twitch-Link wird geprüft …' })
    try {
      const r = await a.twitch.import(url, opts)
      set({ imported: r, importing: false })
      void get().suggest()
      return true
    } catch (e) {
      set({ importing: false, importError: e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e) })
      return false
    }
  },
  clearImport: () => set({ imported: null, importError: '', contentType: 'podcast', kindSource: null, kindReason: '' }),
  startTranscribe: async (diarize, query, wanted) => {
    const a = api()
    const imp = get().imported
    if (!a || !imp) return false
    const job = await a.transcribe(imp.meta.hash, { diarize, query, wanted, contentType: get().contentType, frame: frameFromLabel(get().frame) })
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
