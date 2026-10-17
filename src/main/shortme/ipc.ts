import { readdir, readFile, writeFile } from 'node:fs/promises'
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { join, resolve } from 'node:path'
import { importFile, importUrl, type ImportResult } from './importer'
import { JobQueue } from './jobs'
import { discardProject, loadMeta, projectFile, projectsRoot } from './project'
import { allowMediaPath } from '../mediaAccess'
import { editorAssets } from './editorAssets'
import { planExport } from './render/exporter'
import { sanitizeLog } from '../../shared/edits'
import { loadTranscript, runTranscription } from './transcription'
import { loadClips, runAnalysis } from './clips/analysis'
import { thumbPath } from './clips/thumbs'
import { ensureSignals } from './clips/analysis'
import { exportClip } from './render/exporter'
import { logDir } from '../log'
import { applyCaptionToAll, loadEdits, saveEdits } from './edits'
import { baseState, effectiveClip, stateOf, type CaptionPatch, type EditLog } from '../../shared/edits'
import { PRESETS, type CaptionPreset } from './render/ass'
import { safeFileName } from './render/profiles'

export const jobs = new JobQueue()

const dataUrl = async (path: string): Promise<string | null> => {
  try { return `data:image/jpeg;base64,${(await readFile(path)).toString('base64')}` } catch { return null }
}

async function withStills(r: ImportResult): Promise<ImportResult & { poster: string | null; ambient: string | null }> {
  return { ...r, poster: await dataUrl(projectFile(r.meta.hash, 'poster.jpg')), ambient: await dataUrl(projectFile(r.meta.hash, 'ambient.jpg')) }
}

export function registerShortmeIpc(): void {
  const broadcast = (channel: string, payload: unknown): void => { for (const w of BrowserWindow.getAllWindows()) w.webContents.send(channel, payload) }
  jobs.on('job', (j) => broadcast('shortme:job', j))
  jobs.on('removed', (id) => broadcast('shortme:job-removed', id))

  ipcMain.handle('shortme:importFile', async (_e, path: string) => withStills(await importFile(path)))
  ipcMain.handle('shortme:importUrl', async (_e, url: string) => withStills(await importUrl(url, (p, message) => broadcast('shortme:importProgress', { progress: p, message }))))
  /** Verarbeitung: Transkription (0–55 %), dann Analyse + Clip-Auswahl (55–100 %). */
  ipcMain.handle('shortme:transcribe', async (_e, hash: string, opts: { diarize?: boolean; query?: string; wanted?: number }) => {
    const meta = await loadMeta(hash)
    if (!meta) throw new Error('Projekt nicht gefunden')
    return jobs.enqueue(hash, meta.title, async ({ signal, report }) => {
      await runTranscription(meta, { diarize: !!opts?.diarize, signal, onProgress: (p) => report(p.stage, p.fraction, p.message) })
      await runAnalysis(meta, { query: opts?.query, wanted: opts?.wanted, signal, onProgress: report })
    }, () => discardProject(hash))
  })
  ipcMain.handle('shortme:clips', async (_e, hash: string) => {
    const file = await loadClips(hash)
    if (!file) return null
    const m = await loadMeta(hash)
    if (m) allowMediaPath(m.sourcePath)
    const thumbs: Record<string, string | null> = {}
    for (const c of file.clips) thumbs[c.id] = await dataUrl(thumbPath(hash, c.id))
    return { ...file, thumbs, source: m ? { path: resolve(m.sourcePath), width: m.width, height: m.height, title: m.title, durationSec: m.durationSec } : null }
  })
  /** Export: ausgewählte Clips nacheinander rendern (Pausen entfernt, −14 LUFS, Untertitel eingebrannt). */
  ipcMain.handle('shortme:export', async (_e, hash: string, clipIds: string[], opts: { presetId?: string; srt?: boolean; captions?: boolean }) => {
    const meta = await loadMeta(hash)
    const file = await loadClips(hash)
    const transcript = await loadTranscript(hash)
    if (!meta || !file || !transcript) throw new Error('Projekt, Clips oder Transkript fehlen')
    const clips = file.clips.filter((c) => clipIds.includes(c.id))
    const outDir = join(app.getPath('videos'), 'Shortme', safeFileName(meta.title, 'Projekt'))
    return jobs.enqueue(hash, `Export: ${meta.title}`, async ({ signal, report }) => {
      const signals = await ensureSignals(meta)
      for (let i = 0; i < clips.length; i++) {
        // Editor-Operationen anwenden: Beschnitt, herausgeschnittene Wörter, Hook, Untertitel-Stil, Layout-Überschreibungen
        const st = stateOf(baseState(clips[i], opts?.presetId), await loadEdits(hash, clips[i].id))
        const eff = effectiveClip(clips[i], transcript.words, st)
        await exportClip(meta, eff, transcript, signals, { outDir, presetId: st.caption.presetId, srt: !!opts?.srt, captions: opts?.captions !== false, extraCuts: eff.removed, caption: { scale: st.caption.scale, y: st.caption.y, highlight: st.caption.highlight }, hookSeconds: st.hook.seconds, hookText: st.hook.text, signal, onProgress: (f, m) => report('export', (i + f) / clips.length, `${clips[i].title}: ${m}`) })
      }
      void shell.openPath(outDir)
    })
  })
  /** Preset als Datei speichern/laden (JSON, Format = CaptionPreset). */
  ipcMain.handle('shortme:presetExport', async (_e, id: string) => {
    const preset = PRESETS.find((p) => p.id === id)
    if (!preset) return false
    const r = await dialog.showSaveDialog({ defaultPath: `${preset.name}.shortme-preset.json`, filters: [{ name: 'Shortme-Preset', extensions: ['json'] }] })
    if (r.canceled || !r.filePath) return false
    await writeFile(r.filePath, JSON.stringify(preset, null, 2), 'utf8')
    return true
  })
  ipcMain.handle('shortme:presetImport', async () => {
    const r = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'Shortme-Preset', extensions: ['json'] }] })
    if (r.canceled || !r.filePaths[0]) return null
    const p = JSON.parse(await readFile(r.filePaths[0], 'utf8')) as Partial<CaptionPreset>
    const ok = typeof p.id === 'string' && typeof p.name === 'string' && typeof p.font === 'string' && typeof p.size === 'number' && typeof p.color === 'string' && typeof p.highlight === 'string'
    if (!ok) throw new Error('Keine gültige Preset-Datei')
    return p
  })
  ipcMain.handle('shortme:editsLoad', (_e, hash: string, clipId: string) => loadEdits(hash, clipId))
  ipcMain.handle('shortme:editsSave', (_e, hash: string, log: EditLog) => saveEdits(hash, log))
  ipcMain.handle('shortme:applyAll', (_e, hash: string, clipIds: string[], patch: CaptionPatch) => applyCaptionToAll(hash, clipIds, patch))
  ipcMain.handle('shortme:openLogs', () => shell.openPath(logDir()))
  /** Projektliste: Titel, Dauer, Clip-Anzahl und 16:9-Vorschaubild (YouTube-Thumbnail bzw. Screenshot). */
  ipcMain.handle('shortme:projects', async () => {
    const out: Array<{ hash: string; title: string; durationSec: number; clips: number; created: string; poster: string | null }> = []
    for (const d of await readdir(projectsRoot()).catch(() => [] as string[])) {
      const meta = await loadMeta(d)
      if (!meta) continue
      allowMediaPath(meta.sourcePath)
      const clips = await loadClips(d)
      out.push({ hash: meta.hash, title: meta.title, durationSec: meta.durationSec, clips: clips?.clips.length ?? 0, created: meta.created, poster: await dataUrl(projectFile(meta.hash, 'poster.jpg')) })
    }
    return out.sort((a, b) => b.created.localeCompare(a.created))
  })
  /** Editor: echte Wellenform und Filmstreifen des Clips. */
  ipcMain.handle('shortme:editorAssets', async (_e, hash: string, clipId: string) => {
    const meta = await loadMeta(hash)
    const clip = (await loadClips(hash))?.clips.find((c) => c.id === clipId)
    if (!meta || !clip) throw new Error('Clip nicht gefunden')
    return editorAssets(meta, clip)
  })
  /** Editor: exakt der Plan, den der Export verwendet (Pausenschnitte, Stücke mit Ausschnitt/Zoom) → Vorschau = Export. */
  ipcMain.handle('shortme:previewPlan', async (_e, hash: string, clipId: string, rawLog: unknown, presetId?: string) => {
    const meta = await loadMeta(hash)
    const file = await loadClips(hash)
    const transcript = await loadTranscript(hash)
    const clip = file?.clips.find((c) => c.id === clipId)
    if (!meta || !clip || !transcript) throw new Error('Clip nicht gefunden')
    allowMediaPath(meta.sourcePath)
    const st = stateOf(baseState(clip, presetId), sanitizeLog(rawLog, clipId))
    const eff = effectiveClip(clip, transcript.words, st)
    const signals = await ensureSignals(meta)
    const plan = planExport(eff, transcript, signals, true, eff.removed)
    return { start: eff.start, end: eff.end, duration: plan.duration, cuts: plan.cuts, shots: eff.shots ?? [], pieces: plan.pieces.map((p) => ({ src0: p.src0, src1: p.src1, out0: p.out0, zoom: p.zoom, shot: p.shot })) }
  })
  ipcMain.handle('shortme:jobs', () => jobs.list())
  ipcMain.handle('shortme:pause', (_e, id: string) => jobs.pause(id))
  ipcMain.handle('shortme:resume', (_e, id: string) => jobs.resume(id))
  ipcMain.handle('shortme:stop', (_e, id: string) => jobs.stop(id))
  ipcMain.handle('shortme:discard', (_e, id: string) => jobs.discard(id))
  ipcMain.handle('shortme:transcript', (_e, hash: string) => loadTranscript(hash))
}

/** Abnahme im echten Electron-Prozess: `SHORTME_SELFTEST_EXPORT=<hash>:<clipId>[:ass]` exportiert einen Clip und beendet die App. */
export async function runExportSelfTestIfRequested(): Promise<void> {
  const spec = process.env.SHORTME_SELFTEST_EXPORT
  if (!spec) return
  const [hash, clipId, engine] = spec.split(':')
  try {
    const meta = await loadMeta(hash)
    const file = await loadClips(hash)
    const transcript = await loadTranscript(hash)
    const clip = file?.clips.find((c) => c.id === clipId) ?? file?.clips[0]
    if (!meta || !clip || !transcript) throw new Error('Projekt/Clip/Transkript fehlt')
    const signals = await ensureSignals(meta)
    const t0 = Date.now()
    const r = await exportClip(meta, clip, transcript, signals, { outDir: join(process.cwd(), '.tmp', 'selftest-export'), engine: engine === 'ass' ? 'ass' : 'tscaps', hook: true })
    console.log(`SELFTEST export engine=${r.captionEngine} path=${r.path} dur=${r.durationSec.toFixed(2)} took=${((Date.now() - t0) / 1000).toFixed(1)}s`)
  } catch (e) {
    console.log(`SELFTEST export error ${e instanceof Error ? e.message : e}`)
  }
  app.quit()
}
