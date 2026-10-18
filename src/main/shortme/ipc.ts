import { readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dataRoot } from '../engines/paths'
import { listCustomFonts } from '../fonts'
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
import { loadClips, runAnalysis, layoutFile } from './clips/analysis'
import { loadPersons, personsFile, replanWithPersons } from './clips/persons'
import { writeFileAtomic } from './atomic'
import { modelsView, decide, activeModelId } from '../testlab/registry'
import { labSources, runLab } from '../testlab/lab'
import { prepareRemotionBrowser } from '../remotion/render'
import type { LabRunRequest } from '../../shared/models'
import { loadStyle, saveStyle } from './styleDefaults'
import type { StyleDefaults } from '../../shared/edits'
import { loadFeedback, saveFeedback } from './clips/feedback'
import type { PersonsPatch, ShortmePersons } from '@shared/shortme'
import { makeThumbs, thumbPath } from './clips/thumbs'
import { existsSync } from 'node:fs'
import { ensureLayoutInput, ensureSignals, loadLayoutInput } from './clips/analysis'
import { exportClip } from './render/exporter'
import { logDir } from '../log'
import { applyCaptionToAll, loadEdits, saveEdits } from './edits'
import { baseState, effectiveClip, stateOf, type CaptionPatch, type EditLog } from '../../shared/edits'
import { allPresets, deleteUserPreset, effectivePreset, saveUserPreset } from './presets'
import { sanitizePreset } from '../../shared/preset'
import { safeFileName } from './render/profiles'

export const jobs = new JobQueue()

const dataUrl = async (path: string): Promise<string | null> => {
  try { return `data:image/jpeg;base64,${(await readFile(path)).toString('base64')}` } catch { return null }
}

export async function withStills(r: ImportResult): Promise<ImportResult & { poster: string | null; ambient: string | null }> {
  return { ...r, poster: await dataUrl(projectFile(r.meta.hash, 'poster.jpg')), ambient: await dataUrl(projectFile(r.meta.hash, 'ambient.jpg')) }
}

export function registerShortmeIpc(): void {
  const broadcast = (channel: string, payload: unknown): void => { for (const w of BrowserWindow.getAllWindows()) w.webContents.send(channel, payload) }
  jobs.on('job', (j) => broadcast('shortme:job', j))
  jobs.on('removed', (id) => broadcast('shortme:job-removed', id))

  ipcMain.handle('shortme:importFile', async (_e, path: string) => withStills(await importFile(path)))
  ipcMain.handle('shortme:importUrl', async (_e, url: string) => withStills(await importUrl(url, (p, message) => broadcast('shortme:importProgress', { progress: p, message }))))
  /** Verarbeitung: Transkription (0–55 %), dann Analyse + Clip-Auswahl (55–100 %). */
  ipcMain.handle('shortme:transcribe', async (_e, hash: string, opts: { diarize?: boolean; query?: string; wanted?: number; contentType?: 'auto' | 'stream' }) => {
    const meta = await loadMeta(hash)
    if (!meta) throw new Error('Projekt nicht gefunden')
    return jobs.enqueue(hash, meta.title, async ({ signal, report }) => {
      await runTranscription(meta, { diarize: !!opts?.diarize, signal, onProgress: (p) => report(p.stage, p.fraction, p.message) })
      await runAnalysis(meta, { query: opts?.query, contentType: opts?.contentType, wanted: opts?.wanted, signal, onProgress: report })
    }, () => discardProject(hash))
  })
  const personsView = async (hash: string): Promise<ShortmePersons | null> => {
    const pf = await loadPersons(hash)
    if (!pf) return null
    const persons = await Promise.all(pf.persons.map(async (p) => ({ id: p.id, label: p.label, role: p.role, seconds: p.seconds, thumb: p.thumb ? await dataUrl(projectFile(hash, p.thumb)) : null })))
    return { confirmed: pf.confirmed, confidence: pf.confidence, needsReview: pf.needsReview && !pf.confirmed, persons }
  }
  /** @font-face (Data-URL) für eine eigene Schrift – für die Editor-Vorschau. */
  ipcMain.handle('shortme:fontCss', async (_e, family: string) => {
    const f = (await listCustomFonts()).find((x) => x.family === family)
    if (!f) return ''
    const otf = f.fileName.toLowerCase().endsWith('.otf')
    return `@font-face { font-family: '${family}'; font-weight: 400 900; src: url(data:font/${otf ? 'otf' : 'ttf'};base64,${(await readFile(f.path)).toString('base64')}) format('${otf ? 'opentype' : 'truetype'}'); }`
  })
  ipcMain.handle('shortme:feedback', (_e, hash: string) => loadFeedback(hash))
  ipcMain.handle('shortme:feedbackSet', (_e, hash: string, clipId: string, vote: number) => saveFeedback(hash, clipId, vote === 1 ? 1 : vote === -1 ? -1 : 0))
  // Testlab: Modell-Plätze, Quellen, Vergleich, Entscheidung
  ipcMain.handle('testlab:models', () => modelsView())
  ipcMain.handle('testlab:sources', async () => { const l = await labSources(); for (const s of l) allowMediaPath(s.path); return l })
  ipcMain.handle('testlab:run', (_e, req: LabRunRequest) => runLab(req, (p) => broadcast('testlab:progress', p)))
  ipcMain.handle('testlab:prepareRemotion', () => prepareRemotionBrowser((_f, message) => broadcast('testlab:progress', { side: 'B', message })).catch(() => ''))
  ipcMain.handle('testlab:decide', (_e, slot: string, keep: string, drop: string) => decide(slot, keep, drop))
  ipcMain.handle('shortme:styleGet', () => loadStyle())
  ipcMain.handle('shortme:styleSet', (_e, style: StyleDefaults) => saveStyle(style))
  ipcMain.handle('shortme:persons', (_e, hash: string) => personsView(hash))
  /** Zuordnung speichern (gilt für das ganze Video) und alle Clips neu planen – ohne neue Analyse. */
  ipcMain.handle('shortme:personsSave', async (_e, hash: string, patch: PersonsPatch) => {
    const pf = await loadPersons(hash)
    const file = await loadClips(hash)
    if (!pf || !file) return null
    for (const p of pf.persons) { if (patch.labels?.[p.id]) p.label = String(patch.labels[p.id]).slice(0, 40); if (patch.roles?.[p.id]) p.role = patch.roles[p.id] }
    pf.confirmed = true
    await writeFileAtomic(personsFile(hash), JSON.stringify(pf, null, 1))
    const clips = await replanWithPersons(hash, file.clips, (id) => loadLayoutInput(hash, id), (id, input) => writeFileAtomic(layoutFile(hash, id), JSON.stringify(input)))
    await writeFileAtomic(projectFile(hash, 'clips.json'), JSON.stringify({ ...file, clips }, null, 1))
    return personsView(hash)
  })
  ipcMain.handle('shortme:clips', async (_e, hash: string) => {
    const file = await loadClips(hash)
    if (!file) return null
    const m = await loadMeta(hash)
    if (m) allowMediaPath(m.sourcePath)
    // Fehlende Vorschaubilder (ältere Projekte, früherer Fehler) beim Öffnen nachholen
    if (m) {
      const missing = file.clips.filter((c) => !existsSync(thumbPath(hash, c.id)))
      if (missing.length) await makeThumbs(m, missing).catch((e) => console.error('Vorschaubilder:', e))
    }
    const thumbs: Record<string, string | null> = {}
    for (const c of file.clips) thumbs[c.id] = await dataUrl(thumbPath(hash, c.id))
    return { ...file, thumbs, source: m ? { path: resolve(m.sourcePath), width: m.width, height: m.height, title: m.title, durationSec: m.durationSec } : null }
  })
  /** Export: ausgewählte Clips nacheinander rendern (Pausen entfernt, −14 LUFS, Untertitel eingebrannt). */
  ipcMain.handle('shortme:export', async (_e, hash: string, clipIds: string[], opts: { srt?: boolean; captions?: boolean }) => {
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
        const st = stateOf(baseState(clips[i], undefined, await loadStyle()), await loadEdits(hash, clips[i].id))
        const eff = effectiveClip(clips[i], transcript.words, st, (await loadLayoutInput(hash, clips[i].id)) ?? (await ensureLayoutInput(meta, clips[i])))
        await exportClip(meta, eff, transcript, signals, { outDir, style: effectivePreset(await allPresets(), st.caption), srt: !!opts?.srt, captions: opts?.captions !== false, extraCuts: eff.removed, wordEdits: eff.wordEdits, hook: st.hook.enabled, renderer: (await activeModelId('renderer')) === 'remotion_renderer' ? 'remotion' : 'tscaps', caption: { highlight: st.caption.highlight }, hookSeconds: st.hook.seconds, hookText: st.hook.text, signal, onProgress: (f, m) => report('export', (i + f) / clips.length, `${clips[i].title}: ${m}`) })
      }
      void shell.openPath(outDir)
    })
  })
  /** Presets (renderer-unabhängiges JSON, Version 2): eingebaut + eigene; speichern, überschreiben, löschen, importieren, exportieren. */
  ipcMain.handle('shortme:presets', () => allPresets())
  ipcMain.handle('shortme:presetSave', async (_e, p: unknown, mode: 'new' | 'overwrite') => { const ok = sanitizePreset(p); if (!ok) throw new Error('Ungültiges Preset'); const saved = await saveUserPreset(ok, mode); return { saved, all: await allPresets() } })
  ipcMain.handle('shortme:presetDelete', async (_e, id: string) => { await deleteUserPreset(id); return allPresets() })
  ipcMain.handle('shortme:presetExport', async (_e, id: string) => {
    const preset = (await allPresets()).find((p) => p.id === id)
    if (!preset) return false
    const r = await dialog.showSaveDialog({ defaultPath: `${preset.name}.shortme-preset.json`, filters: [{ name: 'Shortme-Preset', extensions: ['json'] }] })
    if (r.canceled || !r.filePath) return false
    await writeFile(r.filePath, JSON.stringify(preset, null, 2), 'utf8')
    return true
  })
  ipcMain.handle('shortme:presetImport', async () => {
    const r = await dialog.showOpenDialog({ properties: ['openFile', 'multiSelections'], filters: [{ name: 'Shortme-Preset', extensions: ['json'] }] })
    if (r.canceled || !r.filePaths.length) return null
    let n = 0
    for (const f of r.filePaths) { const p = sanitizePreset(JSON.parse(await readFile(f, 'utf8'))); if (p) { await saveUserPreset(p, 'new'); n++ } }
    if (!n) throw new Error('Keine gültige Preset-Datei')
    return allPresets()
  })
  ipcMain.handle('shortme:editsLoad', (_e, hash: string, clipId: string) => loadEdits(hash, clipId))
  ipcMain.handle('shortme:editsSave', (_e, hash: string, log: EditLog) => saveEdits(hash, log))
  ipcMain.handle('shortme:applyAll', (_e, hash: string, clipIds: string[], patch: CaptionPatch) => applyCaptionToAll(hash, clipIds, patch))
  ipcMain.handle('shortme:openLogs', () => shell.openPath(logDir()))
  /** Projektliste: Titel, Dauer, Clip-Anzahl und 16:9-Vorschaubild (YouTube-Thumbnail bzw. Screenshot). */
  /** Projekt löschen (mit Rückfrage): Analyse, Clips, Bearbeitungen; ein per Link geladenes Video wird mit entfernt, eine eigene Originaldatei nie. */
  ipcMain.handle('shortme:deleteProject', async (e, hash: string) => {
    const meta = await loadMeta(hash)
    if (!meta) return false
    const win = BrowserWindow.fromWebContents(e.sender)
    const box = { type: 'warning' as const, buttons: ['Löschen', 'Abbrechen'], defaultId: 1, cancelId: 1, title: 'Projekt löschen', message: `„${meta.title}“ löschen?`, detail: 'Clips, Bearbeitungen und Analyse werden entfernt. Deine Originaldatei bleibt erhalten; ein per Link geladenes Video wird ebenfalls gelöscht.' }
    const r = win ? await dialog.showMessageBox(win, box) : await dialog.showMessageBox(box)
    if (r.response !== 0) return false
    await discardProject(hash)
    const dl = resolve(dataRoot(), 'downloads')
    if (resolve(meta.sourcePath).toLowerCase().startsWith(dl.toLowerCase())) await rm(meta.sourcePath, { force: true }).catch(() => undefined)
    return true
  })
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
    const st = stateOf(baseState(clip, presetId, await loadStyle()), sanitizeLog(rawLog, clipId))
    const eff = effectiveClip(clip, transcript.words, st, (await loadLayoutInput(hash, clipId)) ?? (await ensureLayoutInput(meta, clip)))
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
    const r = await exportClip(meta, clip, transcript, signals, { outDir: join(process.cwd(), '.tmp', 'selftest-export'), engine: engine === 'ass' ? 'ass' : 'tscaps', hook: !process.env.SHORTME_SELFTEST_NOTITLE, renderer: process.env.SHORTME_SELFTEST_RENDERER === 'remotion' ? 'remotion' : 'tscaps', hookText: process.env.SHORTME_SELFTEST_TITLE, style: effectivePreset(await allPresets(), { presetId: process.env.SHORTME_SELFTEST_PRESET ?? 'glow-karaoke', highlight: true, zone: 'Aus', style: process.env.SHORTME_SELFTEST_PATCH ? JSON.parse(process.env.SHORTME_SELFTEST_PATCH) : {} }) })
    console.log(`SELFTEST export engine=${r.captionEngine} path=${r.path} dur=${r.durationSec.toFixed(2)} took=${((Date.now() - t0) / 1000).toFixed(1)}s`)
  } catch (e) {
    console.log(`SELFTEST export error ${e instanceof Error ? e.message : e}`)
  }
  app.quit()
}
