import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type {
  AnalyzeOptions,
  CaptionVideoOptions,
  AppSettings,
  Clip,
  CustomFont,
  ExportOptions,
  BackgroundReframeEvent,
  ExportProgress,
  ExportResult,
  GpuEncoderStatus,
  ImportProgress,
  PipelineProgress,
  Project,
  ProjectSummary,
  SettingsUpdate,
  TimelineData,
  UpdateCheckResult,
  UpdateDownloadState
} from '@shared/types'
import type { OpenRouterCatalog } from '@shared/openrouter'
import type { AssetSpec, AssetStatus, CheckItem, HardwareInfo } from '@shared/engines'
import type { CaptionPatch, EditLog } from '@shared/edits'
import type { StylePreset } from '@shared/preset'
import type { StyleDefaults } from '@shared/edits'
import type { LabResult, LabRunRequest, LabSource, ModelsView } from '@shared/models'
import type { PersonsPatch, PreviewPlan, ShortmeClips, ShortmePersons, ShortmeImport, ShortmeJob, ShortmeTranscript } from '@shared/shortme'

const api = {
  checkSubscriptionSetup: (): Promise<{ message: string; requestsToday: number }> => ipcRenderer.invoke('settings:checkSubscription'),
  checkLocalWhisperSetup: (): Promise<{ message: string }> => ipcRenderer.invoke('settings:checkLocalWhisper'),
  listOpenRouterModels: (refresh = false): Promise<OpenRouterCatalog> => ipcRenderer.invoke('openrouter:models', refresh),
  checkOpenRouterKey: (key?: string): Promise<{ message: string }> => ipcRenderer.invoke('openrouter:checkKey', key),
  installLocalWhisper: (model: 'small' | 'large-v3', pythonPath: string): Promise<{ pythonPath: string; modelPath: string }> =>
    ipcRenderer.invoke('settings:installLocalWhisper', model, pythonPath),
  cancelLocalWhisperInstall: (): Promise<void> => ipcRenderer.invoke('settings:cancelLocalWhisperInstall'),
  onLocalWhisperInstallProgress: (cb: (p: ImportProgress) => void): (() => void) => {
    const listener = (_e: Electron.IpcRendererEvent, p: ImportProgress): void => cb(p)
    ipcRenderer.on('whisper:installProgress', listener)
    return () => ipcRenderer.removeListener('whisper:installProgress', listener)
  },
  selectVideo: (): Promise<string | null> => ipcRenderer.invoke('dialog:selectVideo'),
  selectDirectory: (): Promise<string | null> => ipcRenderer.invoke('dialog:selectDirectory'),

  createProject: (videoPath: string): Promise<Project> => ipcRenderer.invoke('project:create', videoPath),
  createProjectFromUrl: (url: string): Promise<Project> =>
    ipcRenderer.invoke('project:createFromUrl', url),
  analyzeProject: (projectId: string, options: AnalyzeOptions): Promise<Project> =>
    ipcRenderer.invoke('project:analyze', projectId, options),
  captionWholeVideo: (projectId: string, options: CaptionVideoOptions): Promise<Project> =>
    ipcRenderer.invoke('project:captionWholeVideo', projectId, options),
  cancelAnalyze: (projectId: string): Promise<void> =>
    ipcRenderer.invoke('project:cancelAnalyze', projectId),
  listProjects: (): Promise<ProjectSummary[]> => ipcRenderer.invoke('project:list'),
  loadProject: (id: string): Promise<Project> => ipcRenderer.invoke('project:load', id),
  deleteProject: (id: string): Promise<void> => ipcRenderer.invoke('project:delete', id),
  renameProject: (id: string, name: string): Promise<Project> => ipcRenderer.invoke('project:rename', id, name),
  relinkVideo: (projectId: string): Promise<Project> =>
    ipcRenderer.invoke('project:relinkVideo', projectId),
  updateClip: (projectId: string, clip: Clip): Promise<Project> =>
    ipcRenderer.invoke('project:updateClip', projectId, clip),
  ensureReframe: (projectId: string, clipId: string, retryLayout = false): Promise<Project> =>
    ipcRenderer.invoke('clip:ensureReframe', projectId, clipId, retryLayout),
  updateTranscriptWord: (
    projectId: string,
    segmentId: number,
    wordIndex: number,
    text: string
  ): Promise<Project> =>
    ipcRenderer.invoke('project:updateTranscriptWord', projectId, segmentId, wordIndex, text),

  exportClip: (projectId: string, opts: ExportOptions): Promise<ExportResult> =>
    ipcRenderer.invoke('clip:export', projectId, opts),
  cancelExport: (clipId: string): Promise<void> => ipcRenderer.invoke('clip:cancelExport', clipId),
  generateCaption: (projectId: string, clipId: string): Promise<Project> =>
    ipcRenderer.invoke('clip:generateCaption', projectId, clipId),

  getTimeline: (videoPath: string, startSec: number, endSec: number): Promise<TimelineData> =>
    ipcRenderer.invoke('video:timeline', videoPath, startSec, endSec),

  getSettings: (): Promise<AppSettings> => ipcRenderer.invoke('settings:get'),
  updateSettings: (update: SettingsUpdate): Promise<AppSettings> => ipcRenderer.invoke('settings:update', update),
  listFonts: (): Promise<CustomFont[]> => ipcRenderer.invoke('fonts:list'),
  addFonts: (): Promise<CustomFont[]> => ipcRenderer.invoke('fonts:add'),
  removeFont: (fileName: string): Promise<CustomFont[]> => ipcRenderer.invoke('fonts:remove', fileName),
  importCookiesFile: (): Promise<AppSettings> => ipcRenderer.invoke('cookies:import'),
  clearCookiesFile: (): Promise<AppSettings> => ipcRenderer.invoke('cookies:clear'),
  selectBrandingLogo: (): Promise<AppSettings> => ipcRenderer.invoke('branding:selectLogo'),
  checkForUpdates: (): Promise<UpdateCheckResult> => ipcRenderer.invoke('updates:check'),
  downloadUpdate: (): Promise<UpdateDownloadState> => ipcRenderer.invoke('updates:download'),
  getUpdateDownloadState: (): Promise<UpdateDownloadState> => ipcRenderer.invoke('updates:state'),
  openUpdateInstaller: (): Promise<void> => ipcRenderer.invoke('updates:openInstaller'),
  cancelUpdateDownload: (): Promise<void> => ipcRenderer.invoke('updates:cancel'),
  installUpdate: (): Promise<void> => ipcRenderer.invoke('updates:install'),
  updateFromSource: (): Promise<void> => ipcRenderer.invoke('updates:updateFromSource'),
  onSourceUpdateProgress: (cb: (p: ImportProgress) => void): (() => void) => {
    const listener = (_e: Electron.IpcRendererEvent, p: ImportProgress): void => cb(p)
    ipcRenderer.on('update:sourceProgress', listener)
    return () => ipcRenderer.removeListener('update:sourceProgress', listener)
  },
  onUpdateDownloadState: (cb: (p: UpdateDownloadState) => void): (() => void) => {
    const listener = (_e: Electron.IpcRendererEvent, p: UpdateDownloadState): void => cb(p)
    ipcRenderer.on('update:state', listener)
    return () => ipcRenderer.removeListener('update:state', listener)
  },
  downloadGpuFfmpeg: (): Promise<GpuEncoderStatus> => ipcRenderer.invoke('settings:downloadGpuFfmpeg'),
  onGpuProgress: (cb: (p: ImportProgress) => void): (() => void) => {
    const listener = (_e: Electron.IpcRendererEvent, p: ImportProgress): void => cb(p)
    ipcRenderer.on('gpu:progress', listener)
    return () => ipcRenderer.removeListener('gpu:progress', listener)
  },

  showItemInFolder: (path: string): Promise<void> => ipcRenderer.invoke('shell:showItemInFolder', path),

  onPipelineProgress: (cb: (p: PipelineProgress) => void): (() => void) => {
    const listener = (_e: Electron.IpcRendererEvent, p: PipelineProgress): void => cb(p)
    ipcRenderer.on('pipeline:progress', listener)
    return () => ipcRenderer.removeListener('pipeline:progress', listener)
  },
  onBackgroundReframe: (cb: (e: BackgroundReframeEvent) => void): (() => void) => {
    const listener = (_e: Electron.IpcRendererEvent, e: BackgroundReframeEvent): void => cb(e)
    ipcRenderer.on('clip:backgroundReframe', listener)
    return () => ipcRenderer.removeListener('clip:backgroundReframe', listener)
  },
  onExportProgress: (cb: (p: ExportProgress) => void): (() => void) => {
    const listener = (_e: Electron.IpcRendererEvent, p: ExportProgress): void => cb(p)
    ipcRenderer.on('export:progress', listener)
    return () => ipcRenderer.removeListener('export:progress', listener)
  },
  onImportProgress: (cb: (p: ImportProgress) => void): (() => void) => {
    const listener = (_e: Electron.IpcRendererEvent, p: ImportProgress): void => cb(p)
    ipcRenderer.on('import:progress', listener)
    return () => ipcRenderer.removeListener('import:progress', listener)
  },

  /** Shortme: Engines & Modell-Manager (M2). */
  engines: {
    catalog: (): Promise<AssetSpec[]> => ipcRenderer.invoke('engines:catalog'),
    hardware: (refresh = false): Promise<HardwareInfo> => ipcRenderer.invoke('engines:hardware', refresh),
    list: (): Promise<AssetStatus[]> => ipcRenderer.invoke('engines:list'),
    install: (id: string): Promise<void> => ipcRenderer.invoke('engines:install', id),
    pause: (id: string): Promise<void> => ipcRenderer.invoke('engines:pause', id),
    cancel: (id: string): Promise<void> => ipcRenderer.invoke('engines:cancel', id),
    check: (): Promise<CheckItem[]> => ipcRenderer.invoke('engines:check'),
    installYtDlp: (): Promise<void> => ipcRenderer.invoke('engines:ytdlp'),
    importFolder: (): Promise<{ imported: string[]; skipped: string[] } | null> => ipcRenderer.invoke('engines:importFolder'),
    installRecommended: (): Promise<AssetStatus[]> => ipcRenderer.invoke('engines:installRecommended'),
    onStatus: (cb: (s: AssetStatus) => void): (() => void) => {
      const listener = (_e: Electron.IpcRendererEvent, s: AssetStatus): void => cb(s)
      ipcRenderer.on('engines:status', listener)
      return () => ipcRenderer.removeListener('engines:status', listener)
    }
  },

  /** Verstecktes Untertitel-Renderfenster (@tscaps/engine, M6+). */
  captions: {
    ready: (): void => ipcRenderer.send('captions:ready'),
    onRun: (cb: (job: unknown) => void): void => { ipcRenderer.on('captions:run', (_e, job) => cb(job)) },
    progress: (fraction: number): void => ipcRenderer.send('captions:progress', fraction),
    readFile: (path: string): Promise<ArrayBuffer> => ipcRenderer.invoke('captions:read', path),
    writeFile: (path: string, data: ArrayBuffer): Promise<void> => ipcRenderer.invoke('captions:write', path, data),
    done: (error?: string): void => ipcRenderer.send('captions:done', error ?? null)
  },

  /** Shortme: Import, Transkription, Jobs (M3). */
  shortme: {
    importFile: (path: string): Promise<ShortmeImport> => ipcRenderer.invoke('shortme:importFile', path),
    importUrl: (url: string): Promise<ShortmeImport> => ipcRenderer.invoke('shortme:importUrl', url),
    transcribe: (hash: string, opts: { diarize?: boolean; query?: string; wanted?: number }): Promise<ShortmeJob> => ipcRenderer.invoke('shortme:transcribe', hash, opts),
    jobs: (): Promise<ShortmeJob[]> => ipcRenderer.invoke('shortme:jobs'),
    pause: (id: string): Promise<void> => ipcRenderer.invoke('shortme:pause', id),
    resume: (id: string): Promise<void> => ipcRenderer.invoke('shortme:resume', id),
    stop: (id: string): Promise<void> => ipcRenderer.invoke('shortme:stop', id),
    discard: (id: string): Promise<void> => ipcRenderer.invoke('shortme:discard', id),
    exportClips: (hash: string, clipIds: string[], opts: { presetId?: string; srt?: boolean; captions?: boolean }): Promise<ShortmeJob> => ipcRenderer.invoke('shortme:export', hash, clipIds, opts),
    editsLoad: (hash: string, clipId: string): Promise<EditLog> => ipcRenderer.invoke('shortme:editsLoad', hash, clipId),
    editsSave: (hash: string, log: EditLog): Promise<void> => ipcRenderer.invoke('shortme:editsSave', hash, log),
    applyAll: (hash: string, clipIds: string[], patch: CaptionPatch): Promise<void> => ipcRenderer.invoke('shortme:applyAll', hash, clipIds, patch),
    openLogs: (): Promise<string> => ipcRenderer.invoke('shortme:openLogs'),
    presetExport: (id: string): Promise<boolean> => ipcRenderer.invoke('shortme:presetExport', id),
    presetImport: (): Promise<StylePreset[] | null> => ipcRenderer.invoke('shortme:presetImport'),
    presets: (): Promise<StylePreset[]> => ipcRenderer.invoke('shortme:presets'),
    presetSave: (p: StylePreset, mode: 'new' | 'overwrite'): Promise<{ saved: StylePreset; all: StylePreset[] }> => ipcRenderer.invoke('shortme:presetSave', p, mode),
    presetDelete: (id: string): Promise<StylePreset[]> => ipcRenderer.invoke('shortme:presetDelete', id),
    projects: (): Promise<Array<{ hash: string; title: string; durationSec: number; clips: number; created: string; poster: string | null }>> => ipcRenderer.invoke('shortme:projects'),
    editorAssets: (hash: string, clipId: string): Promise<{ peaks: number[]; step: number; strip: string[] }> => ipcRenderer.invoke('shortme:editorAssets', hash, clipId),
    previewPlan: (hash: string, clipId: string, log: EditLog, presetId?: string): Promise<PreviewPlan> => ipcRenderer.invoke('shortme:previewPlan', hash, clipId, log, presetId),
    styleGet: (): Promise<StyleDefaults> => ipcRenderer.invoke('shortme:styleGet'),
    styleSet: (style: StyleDefaults): Promise<StyleDefaults> => ipcRenderer.invoke('shortme:styleSet', style),
    feedback: (hash: string): Promise<Record<string, -1 | 0 | 1>> => ipcRenderer.invoke('shortme:feedback', hash),
    feedbackSet: (hash: string, clipId: string, vote: -1 | 0 | 1): Promise<Record<string, -1 | 0 | 1>> => ipcRenderer.invoke('shortme:feedbackSet', hash, clipId, vote),
    testlab: {
      models: (): Promise<ModelsView> => ipcRenderer.invoke('testlab:models'),
      sources: (): Promise<LabSource[]> => ipcRenderer.invoke('testlab:sources'),
      run: (req: LabRunRequest): Promise<{ a: LabResult; b: LabResult }> => ipcRenderer.invoke('testlab:run', req),
      prepareRemotion: (): Promise<string> => ipcRenderer.invoke('testlab:prepareRemotion'),
      decide: (slot: string, keep: string, drop: string): Promise<ModelsView> => ipcRenderer.invoke('testlab:decide', slot, keep, drop),
      onProgress: (cb: (p: { side: 'A' | 'B'; message: string }) => void): (() => void) => {
        const l = (_e: Electron.IpcRendererEvent, p: { side: 'A' | 'B'; message: string }): void => cb(p)
        ipcRenderer.on('testlab:progress', l)
        return () => ipcRenderer.removeListener('testlab:progress', l)
      }
    },
    fontCss: (family: string): Promise<string> => ipcRenderer.invoke('shortme:fontCss', family),
    deleteProject: (hash: string): Promise<boolean> => ipcRenderer.invoke('shortme:deleteProject', hash),
    persons: (hash: string): Promise<ShortmePersons | null> => ipcRenderer.invoke('shortme:persons', hash),
    personsSave: (hash: string, patch: PersonsPatch): Promise<ShortmePersons | null> => ipcRenderer.invoke('shortme:personsSave', hash, patch),
    clips: (hash: string): Promise<ShortmeClips | null> => ipcRenderer.invoke('shortme:clips', hash),
    transcript: (hash: string): Promise<ShortmeTranscript | null> => ipcRenderer.invoke('shortme:transcript', hash),
    onJob: (cb: (j: ShortmeJob) => void): (() => void) => {
      const l = (_e: Electron.IpcRendererEvent, j: ShortmeJob): void => cb(j)
      ipcRenderer.on('shortme:job', l)
      return () => ipcRenderer.removeListener('shortme:job', l)
    },
    onImportProgress: (cb: (p: { progress: number; message: string }) => void): (() => void) => {
      const l = (_e: Electron.IpcRendererEvent, p: { progress: number; message: string }): void => cb(p)
      ipcRenderer.on('shortme:importProgress', l)
      return () => ipcRenderer.removeListener('shortme:importProgress', l)
    }
  },

  /** Build a media:// URL the renderer can use in <video>/<img> tags. */
  mediaUrl: (absolutePath: string): string => `media://file/${encodeURIComponent(absolutePath)}`,

  /**
   * Absolute path for a dropped File. Electron removed File.path under the
   * sandbox, so drag-and-drop has to resolve the path through webUtils here in
   * the preload rather than reading it off the File in the renderer.
   */
  pathForFile: (file: File): string => webUtils.getPathForFile(file),

  /** OS platform, for platform-specific chrome (mac vibrancy, drag regions). */
  platform: process.env.CUTAWAN_FORCE_GLASS ? 'darwin' : process.platform
}

export type CutawanApi = typeof api

contextBridge.exposeInMainWorld('cutawan', api)
