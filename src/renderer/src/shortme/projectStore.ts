import { create } from 'zustand'
import type { Level, Ratings } from '@shared/learn'
import { useStore } from './store'
import type { ReviewStatus, ReviewView } from '@shared/review'
import { FRAME_LABELS, frameFromLabel, type ContentType } from '@shared/videoKind'
import type { StyleDefaults } from '@shared/edits'
import { isV3Profile, type AnalysisState, type SelectionEngineId, type V3Profile } from '@shared/engine'
import type { PersonsPatch, ShortmeClips, ShortmePersons, ShortmeImport, ShortmeJob, ShortmeTranscript } from '@shared/shortme'

const api = (): Window['cutawan']['shortme'] | null => (typeof window !== 'undefined' && window.cutawan?.shortme ? window.cutawan.shortme : null)

interface ProjectState {
  /** Zuletzt importiertes Video (Sheet „Clips erstellen“). */
  imported: ShortmeImport | null
  importing: boolean
  importMessage: string
  importProgress: number
  /** Download: geschätzte Restzeit (s), Tempo, pausiert? */
  importEta: number | null
  importSpeed: string
  importPaused: boolean
  controlImport: (action: 'pause' | 'resume' | 'cancel') => Promise<void>
  importError: string
  job: ShortmeJob | null
  clipsFile: ShortmeClips | null
  transcript: ShortmeTranscript | null
  hasApi: boolean
  loadResults: (hash: string, force?: boolean) => Promise<void>
  /** Engine-Wahl und Läufe des Projekts (Schalter in Clipliste und Erstellen-Dialog); getrennt von Job und angezeigter Clipliste. */
  engine: { hash: string | null; state: AnalysisState | null; pending: boolean; msg: string; missing: Array<{ id: string; name: string; sizeBytes: number }>; /** Modellprüfung der neuen Engine wurde ausgeführt (missing ist dann verlässlich). */ modelsChecked: boolean }
  /** Engine für neue Projekte (Erstellen-Dialog); wird als Standard gespeichert, zunächst die bisherige Engine. */
  startEngine: SelectionEngineId
  /** Analyseprofil der Engine 3 (Schnell/Ausgewogen/Gründlich); gilt für den nächsten Lauf. */
  startProfile: V3Profile
  setStartProfile: (p: V3Profile) => void
  startMissing: Array<{ id: string; name: string; sizeBytes: number }>
  setStartEngine: (e: SelectionEngineId) => Promise<void>
  loadEngine: (hash: string) => Promise<void>
  selectEngine: (engine: SelectionEngineId, cur: { query?: string; wanted?: number }) => Promise<void>
  recompute: (cur: { query?: string; wanted?: number }) => Promise<void>
  /** Nur die Clipliste neu laden (während die Analyse noch läuft). */
  refreshClips: (hash: string) => Promise<void>
  projects: ProjectCard[]
  loadProjects: () => Promise<void>
  deleteProject: (hash: string) => Promise<boolean>
  deleteProjects: (hashes: string[]) => Promise<{ deleted: number; skipped: number }>
  reanalyze: (hash: string) => Promise<boolean>
  /** Titel des geöffneten Projekts (Clip-Übersicht). */
  currentTitle: string | null
  /** Öffnet ein Projekt: läuft dafür gerade ein Job → Fortschritt ('processing'), sonst die Clips ('clips'); null = nichts zu zeigen. */
  openProject: (hash: string) => Promise<'clips' | 'processing' | 'start' | null>
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
  /** „Nur Untertitel“: transkribieren und einen Clip über das ganze Video anlegen (fertiges Video, wird nicht geschnitten). */
  startCaptionOnly: (diarize: boolean) => Promise<boolean>
  exportClips: (clipIds: string[], presetId: string, srt: boolean) => Promise<boolean>
  exportJob: ShortmeJob | null
  /** „Wer ist wer?“ */
  persons: ShortmePersons | null
  feedback: Ratings
  /** Nutzerfreigabe je Clip (Review), getrennt von KI-Prüfung und Lernbewertung. */
  review: Record<string, ReviewView>
  loadReview: (hash: string) => Promise<void>
  setReview: (clipId: string, status: ReviewStatus) => Promise<void>
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

export interface ProjectCard { hash: string; title: string; durationSec: number; clips: number; created: string; poster: string | null; /** Link (Web-Import) oder Dateipfad. */ source: string; isUrl: boolean; status?: 'none' | 'running' | 'done' }

let unsub: Array<() => void> = []
let lastRefresh = 0
let latestEngineReq = ''

export const useProject = create<ProjectState>((set, get) => ({
  imported: null,
  importing: false,
  importMessage: '',
  importProgress: 0,
  importEta: null,
  importSpeed: '',
  importPaused: false,
  controlImport: async (action) => { const a = api(); if (!a) return; if (await a.importControl(action)) set({ importPaused: action === 'pause', ...(action === 'pause' ? { importMessage: 'Download pausiert' } : {}) }) },
  importError: '',
  job: null,
  clipsFile: null,
  transcript: null,
  exportJob: null,
  persons: null,
  feedback: {},
  review: {},
  loadReview: async (hash) => {
    const a = api(); const f = get().clipsFile
    if (!a || !f || f.hash !== hash) return
    const r = await a.reviewState(hash, f.clips.map((c) => c.id))
    if (get().clipsFile?.hash === hash) set({ review: r })
  },
  setReview: async (clipId, status) => {
    const a = api(); const hash = get().clipsFile?.hash
    if (!a || !hash) return
    // sofort sichtbar (schnelles 1/2/3), danach mit dem gespeicherten Stand abgleichen
    const prev = get().review[clipId]
    set((s) => ({ review: { ...s.review, [clipId]: { ...(prev ?? { revision: '', changedSinceApproval: false }), status, updatedAt: new Date().toISOString() } } }))
    try { const v = await a.reviewSet(hash, clipId, status); if (get().clipsFile?.hash === hash) set((s) => ({ review: { ...s.review, [clipId]: v } })) } catch { set((s) => ({ review: { ...s.review, ...(prev ? { [clipId]: prev } : {}) } })) }
  },
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
  deleteProjects: async (hashes) => { const a = api(); if (!a) return { deleted: 0, skipped: 0 }; const r = await a.deleteProjects(hashes); if (r.deleted) { const cur = get().clipsFile?.hash; if (cur && hashes.includes(cur) && !(await a.projects()).some((p) => p.hash === cur)) set({ clipsFile: null, persons: null }); await get().loadProjects() } return r },
  loadProjects: async () => { const a = api(); if (a) set({ projects: await a.projects() }) },
  /** Projekt mit seinem bisherigen Inhaltstyp neu analysieren (Rechtsklick); der Verlauf zeigt sich im Verarbeitungsbild. */
  reanalyze: async (hash) => { const a = api(); if (!a) return false; set({ job: await a.reanalyze(hash), clipsFile: null, transcript: null }); return true },
  openProject: async (hash) => {
    const a = api()
    if (!a) return null
    const p = get().projects.find((x) => x.hash === hash)
    // noch in Arbeit (z. B. nach Tab-Wechsel wieder geöffnet): Fortschritt zeigen statt nichts zu tun
    const live = (await a.jobs()).filter((j) => j.hash === hash && ['running', 'queued', 'paused'].includes(j.state)).pop()
    if (live) { set({ job: live, currentTitle: p?.title ?? live.title }); return 'processing' }
    await get().loadResults(hash, true) // ausdrücklich geöffnet: immer laden (die Sperre gilt nur für späte Hintergrund-Ergebnisse)
    set({ currentTitle: p?.title ?? null })
    if (get().clipsFile?.clips.length) return 'clips'
    // noch nicht analysiert (z. B. gesicherte Live-Aufnahme): wie nach einem Import den Start-Dialog zeigen
    if (p && (p.isUrl ? await get().importUrl(p.source) : await get().importPath(p.source))) { useStore.getState().openSheet(true); return 'start' }
    return get().clipsFile ? 'clips' : null
  },
  engine: { hash: null, state: null, pending: false, msg: '', missing: [], modelsChecked: false },
  startEngine: 'adaptive-v3',
  startProfile: (() => { try { const v = localStorage.getItem('sm.v3profile'); return isV3Profile(v) ? v : 'balanced' } catch { return 'balanced' } })(),
  setStartProfile: (p) => { try { localStorage.setItem('sm.v3profile', p) } catch { /* nur Komfort */ } set({ startProfile: p }) },
  startMissing: [],
  setStartEngine: async (e) => {
    const a = api()
    set({ startEngine: e, startMissing: [] })
    if (!a) return
    await a.engineSetDefault(e)
    // Voraussetzungen sofort zeigen (keine Überraschung erst beim Start)
    const missing = await a.engineMissing(e)
    if (get().startEngine === e) set({ startMissing: missing })
  },
  loadEngine: async (hash) => {
    const a = api()
    if (!a) return
    latestEngineReq = hash
    const r = await a.engineState(hash)
    const missing = await a.engineMissing(r.state.selected) // Modelle der gewählten Engine (vorher fest Engine 2 → falsche Warnung bei Engine Mac)
    // verspätete Antwort für ein anderes Projekt überschreibt die aktuelle Ansicht nicht (maßgeblich ist die zuletzt angeforderte)
    if (latestEngineReq !== hash) return
    const cur = get().engine
    set({ engine: { ...cur, hash, state: r.state, missing, modelsChecked: true } })
  },
  selectEngine: async (engine, cur) => {
    const a = api()
    const hash = get().clipsFile?.hash ?? get().imported?.meta.hash
    if (!a || !hash || get().engine.pending) return
    set((s) => ({ engine: { ...s.engine, hash, pending: true, msg: '', missing: [] } }))
    try {
      const r = await a.engineSelect({ hash, engine, query: cur.query, contentType: get().contentType, frame: frameFromLabel(get().frame), wanted: cur.wanted, profile: get().startProfile })
      const msg = r.kind === 'busy' ? 'Es läuft gerade eine Analyse. Der Wechsel ist erst nach „Stoppen & behalten“ oder nach dem Ende möglich.' : ''
      set((s) => ({ engine: { hash, state: r.state, pending: false, msg, missing: r.kind === 'needs-models' ? r.missing : [], modelsChecked: s.engine.modelsChecked } }))
      if (r.kind === 'shown') await get().loadResults(hash, true)
      if (r.kind === 'started') { const live = (await a.jobs()).find((j) => j.id === r.jobId); if (live) set({ job: live }) }
    } catch (e) {
      set((s) => ({ engine: { ...s.engine, pending: false, msg: e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e) } }))
    }
  },
  recompute: async (cur) => {
    const a = api()
    const hash = get().clipsFile?.hash ?? get().imported?.meta.hash
    if (!a || !hash || get().engine.pending) return
    set((s) => ({ engine: { ...s.engine, hash, pending: true, msg: '', missing: [] } }))
    try {
      const r = await a.recompute(hash, { query: cur.query, contentType: get().contentType, frame: frameFromLabel(get().frame), wanted: cur.wanted, profile: get().startProfile })
      set((s) => ({ engine: { ...s.engine, pending: false, missing: r.missing ?? [] } }))
      if (r.jobId) { const live = (await a.jobs()).find((j) => j.id === r.jobId); if (live) set({ job: live }); await get().loadEngine(hash) }
    } catch (e) {
      set((s) => ({ engine: { ...s.engine, pending: false, msg: e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e) } }))
    }
  },
  refreshClips: async (hash) => {
    const a = api()
    if (!a) return
    const clipsFile = await a.clips(hash)
    // Verspätete Antwort eines anderen Projekts/Laufs darf die aktuelle Ansicht nicht überschreiben
    const cur = get().clipsFile
    if (clipsFile && (!cur || cur.hash === hash)) { set({ clipsFile }); void get().loadReview(hash) }
    // Transkript nachladen, falls es fehlt (Clips erscheinen schon während der Analyse); sonst zeigte der Editor Beispieltext
    if (clipsFile && !get().transcript) { const transcript = await a.transcript(hash); if (get().clipsFile?.hash === hash) set({ transcript }) }
  },
  loadResults: async (hash, force = false) => {
    const a = api()
    if (!a) return
    const [clipsFile, transcript, persons, feedback] = await Promise.all([a.clips(hash), a.transcript(hash), a.persons(hash), a.feedback(hash)])
    const cur = get().clipsFile
    if (!force && cur && cur.hash !== hash && get().engine.hash !== hash) return
    set({ clipsFile, transcript, persons, feedback, review: {} })
    void get().loadReview(hash)
  },
  init: () => {
    const a = api()
    set({ hasApi: !!a })
    if (!a) return
    void get().loadStyle()
    void a.engineDefault().then(async (e) => { set({ startEngine: e }); set({ startMissing: await a.engineMissing(e) }) })
    // Testlab-Schalter: der Hauptprozess entscheidet (Pipeline nutzt nur dann Testlab-Entscheidungen); erste Nutzung übernimmt den alten Wert
    void a.testlab.enabled().then((v) => { if (v === null) void a.testlab.setEnabled(useStore.getState().testlab); else useStore.setState({ testlab: v }) })
    unsub.forEach((u) => u())
    unsub = [
      // Remote Engine: von einem anderen Rechner übertragenes Projekt ist da → Projektliste aktualisieren
      a.remote.onProjectImported(() => void get().loadProjects()),
      a.onJob((j) => {
        if (j.title.startsWith('Export')) { set({ exportJob: j }); return }
        set((s) => (s.job && s.job.id !== j.id && s.job.state === 'running' ? s : { job: j }))
        if (['done', 'error', 'stopped'].includes(j.state) || get().engine.hash !== j.hash || (j.state === 'queued' && get().job?.id !== j.id)) void get().loadEngine(j.hash)
        if (j.state === 'done') void get().loadResults(j.hash)
        // Projektkarten: „Wird analysiert …“ / Clipzahl aktualisieren, wenn eine Analyse startet oder endet (nicht bei jedem Fortschritt)
        if (!j.title.startsWith('Export') && j.state !== 'running') void get().loadProjects()
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
      a.onImportProgress((p) => set((s) => ({ importMessage: s.importPaused ? 'Download pausiert' : p.message, importProgress: p.progress, importEta: p.etaSec ?? (p.progress >= 0.96 || p.progress < 0.15 ? null : s.importEta), importSpeed: p.speed ?? '' })))
    ]
    void a.jobs().then((list) => { const live = list.find((j) => j.state === 'running' || j.state === 'queued' || j.state === 'paused'); if (live) set({ job: live }) })
  },
  importPath: async (path) => {
    const a = api()
    if (!a) return false
    set({ importing: true, importError: '', importProgress: 0, importEta: null, importSpeed: '', importPaused: false, importMessage: 'Video wird geprüft …' })
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
    set({ importing: true, importError: '', importProgress: 0, importEta: null, importSpeed: '', importPaused: false, importMessage: 'Link wird geprüft …' })
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
    set({ importing: true, importError: '', importProgress: 0, importEta: null, importSpeed: '', importPaused: false, importMessage: 'Twitch-Link wird geprüft …' })
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
  startCaptionOnly: async (diarize) => {
    const a = api()
    const imp = get().imported
    if (!a || !imp) return false
    const job = await a.captionOnly(imp.meta.hash, { diarize })
    set({ job, clipsFile: null, transcript: null })
    return true
  },
  startTranscribe: async (diarize, query, wanted) => {
    const a = api()
    const imp = get().imported
    if (!a || !imp) return false
    const job = await a.transcribe(imp.meta.hash, { diarize, query, wanted, contentType: get().contentType, frame: frameFromLabel(get().frame), engine: get().startEngine, profile: get().startProfile })
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
