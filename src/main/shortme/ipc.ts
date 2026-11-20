import { readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dataRoot } from '../engines/paths'
import { listCustomFonts } from '../fonts'
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { join, resolve } from 'node:path'
import { importFile, importUrl, type ImportResult } from './importer'
import { controlDownloads } from '../pipeline/ytdlp'
import { JobQueue } from './jobs'
import { discardProject, loadMeta, projectFile, projectsRoot, saveMeta } from './project'
import { allowMediaPath } from '../mediaAccess'
import { editorAssets } from './editorAssets'
import { planExport } from './render/exporter'
import { editWindow, sanitizeLog } from '../../shared/edits'
import { loadTranscript, runTranscription } from './transcription'
import { findClip, loadClips, saveClips, layoutFile } from './clips/analysis'
import { ENGINE_LABEL, LEGACY_RUN_ID, isV3Profile } from '../../shared/engine'
import { registerEngineControlIpc, hasActiveJob, missingModelsFor, recomputeProject } from './engineIpc'
import { isLocalEngine, loadDefaultEngine } from './clips/engines/control'
import { setSelected } from './clips/engines/state'
import { runAnalysis } from './clips/analysis'
import type { SelectionEngineId, V3Profile } from '../../shared/engine'
import { loadPersons, personsFile, replanWithPersons } from './clips/persons'
import { writeFileAtomic } from './atomic'
import { defaultExportRoot, exportRoot, setExportRoot } from './exportDir'
import { modelsView, decide, activeModelId, testlabFlag, setTestlabEnabled } from '../testlab/registry'
import { labSources, runLab } from '../testlab/lab'
import { prepareRemotionBrowser } from '../remotion/render'
import type { LabRunRequest } from '../../shared/models'
import { loadStyle, saveStyle } from './styleDefaults'
import type { StyleDefaults } from '../../shared/edits'
import { loadRatings, saveRating } from './clips/feedback'
import { recordRating } from '../learn/catalog'
import type { Level } from '../../shared/learn'
import type { PersonsPatch, ShortmePersons } from '@shared/shortme'
import { makeThumbs, thumbPath } from './clips/thumbs'
import { existsSync } from 'node:fs'
import { ensureLayoutInput, ensureShots, ensureSignals, loadLayoutInput } from './clips/analysis'
import { exportClip } from './render/exporter'
import { addExport } from '../upload/store'
import { deleteClip } from './corrections'
import { logCorrection } from './corrections'
import { logDir } from '../log'
import { exportLogReport } from '../logExport'
import { applyCaptionToAll, loadEdits, saveEdits } from './edits'
import { baseState, effectiveClip, stateOf, type CaptionPatch, type EditLog } from '../../shared/edits'
import { allPresets, deleteUserPreset, effectivePreset, saveUserPreset } from './presets'
import { sanitizePreset } from '../../shared/preset'
import { safeFileName } from './render/profiles'
import type { ContentType, FrameChoice } from '../../shared/videoKind'
import { channelLayouts, deleteChannelLayout, loadProfile, rememberChoice, saveChannelLayout, sourceKey } from './profiles'
import { suggestKind } from './layout/suggest'
import { findFacecam } from './layout/facecam'
import { classifyScenes } from './layout/streamScenes'
import { mergeStreamScenes, scenesOf } from './layout/streamShots'
import { defaultStream, sanitizeStream, type StreamLayout } from '../../shared/streamLayout'

export const jobs = new JobQueue()

const dataUrl = async (path: string): Promise<string | null> => {
  try { return `data:image/jpeg;base64,${(await readFile(path)).toString('base64')}` } catch { return null }
}

export async function withStills(r: ImportResult): Promise<ImportResult & { poster: string | null; ambient: string | null }> {
  return { ...r, poster: await dataUrl(projectFile(r.meta.hash, 'poster.jpg')), ambient: await dataUrl(projectFile(r.meta.hash, 'ambient.jpg')) }
}

export function registerShortmeIpc(): void {
  registerEngineControlIpc(jobs)
  const broadcast = (channel: string, payload: unknown): void => { for (const w of BrowserWindow.getAllWindows()) w.webContents.send(channel, payload) }
  jobs.on('job', (j) => broadcast('shortme:job', j))
  jobs.on('removed', (id) => broadcast('shortme:job-removed', id))

  ipcMain.handle('shortme:importFile', async (_e, path: string) => withStills(await importFile(path)))
  ipcMain.handle('shortme:importUrl', async (_e, url: string) => withStills(await importUrl(url, (p, message, extra) => broadcast('shortme:importProgress', { progress: p, message, ...extra }))))
  /** Laufenden Download pausieren, fortsetzen oder abbrechen (Pause nur macOS). */
  ipcMain.handle('shortme:importControl', (_e, action: unknown) => (action === 'pause' || action === 'resume' || action === 'cancel' ? controlDownloads(action) : false))
  // Inhaltstyp-Vorschlag, Facecam-Layouts pro Kanal
  ipcMain.handle('shortme:suggestKind', async (_e, hash: string) => { const meta = await loadMeta(hash); if (!meta) throw new Error('Projekt nicht gefunden'); return suggestKind(meta) })
  /** Inhaltstyp nachträglich ändern: Ausschnitt und Ranking werden neu berechnet (Transkript bleibt). */
  ipcMain.handle('shortme:reanalyze', async (_e, hash: string, kindIn?: ContentType, frame?: FrameChoice, engine?: SelectionEngineId) => {
    const meta = await loadMeta(hash)
    if (!meta) throw new Error('Projekt nicht gefunden')
    // Quellvideo gelöscht (z. B. Speicher sparen)? Bei Links vor der Analyse neu laden (im Job), sonst klare Meldung
    if (!existsSync(meta.sourcePath) && !meta.sourceUrl) throw new Error('Das Quellvideo gibt es nicht mehr. Bitte die Datei erneut importieren.')
    // ohne Angabe (Rechtsklick „Neu analysieren“): bisheriger Inhaltstyp des Projekts, sonst Vorschlag; Engine = die für das Projekt gewählte
    const kind = kindIn ?? meta.contentType ?? (await suggestKind(meta)).kind
    const r = await recomputeProject(jobs, hash, { contentType: kind, frame, engine })
    if (r.jobId === null) throw new Error(`Für die neue Engine fehlen Modelle: ${r.missing.map((m) => m.name).join(', ')}. Bitte im Modell-Manager installieren.`)
    return jobs.get(r.jobId)!
  })
  ipcMain.handle('shortme:profile', (_e, kind: ContentType) => loadProfile(kind))
  ipcMain.handle('shortme:channelLayouts', () => channelLayouts())
  ipcMain.handle('shortme:channelLayoutDelete', async (_e, channel: string) => { await deleteChannelLayout(channel); return channelLayouts() })
  ipcMain.handle('shortme:channelLayoutSave', async (_e, channel: string, layout: StreamLayout) => { await saveChannelLayout(channel, sanitizeStream(layout, layout)); return channelLayouts() })
  /** Facecam in einem Projekt neu suchen (Editor: „Facecam suchen“, wenn der Clip noch kein Facecam-Layout hat). */
  ipcMain.handle('shortme:findStream', async (_e, hash: string) => {
    const meta = await loadMeta(hash)
    if (!meta) throw new Error('Projekt nicht gefunden')
    const f = await findFacecam(meta.sourcePath, 0, meta.durationSec)
    return f ? defaultStream({ width: meta.width, height: meta.height }, f.cam) : null
  })
  /** Facecams eines Clips pro Szene neu erkennen (bei Szenen, in denen eine andere Person/Kamera an anderer Stelle sitzt); schreibt die Shots in den Lauf des Clips. */
  ipcMain.handle('shortme:redetectCams', async (_e, hash: string, clipId: string) => {
    const meta = await loadMeta(hash)
    const found = await findClip(hash, clipId)
    if (!meta || !found) throw new Error('Clip nicht gefunden')
    const clip = found.clip
    const dims = { width: meta.width, height: meta.height }
    let base: StreamLayout | null = clip.stream ?? null
    if (!base) { const f = await findFacecam(meta.sourcePath, clip.start, clip.end, 10).catch(() => null); if (f) base = defaultStream(dims, f.cam) }
    if (!base) return { changed: false, scenes: 0, others: 0 }
    const cuts = await ensureShots(meta)
    const known: StreamLayout[] = []
    const scenes = await classifyScenes(meta.sourcePath, scenesOf(clip.start, clip.end, cuts), base, dims, known)
    const planned = (clip.shots ?? []).filter((s) => s.layout !== 'stream')
    const shots = mergeStreamScenes(clip.start, clip.end, planned, scenes, base)
    const file = await loadClips(hash, found.runId)
    if (file) await saveClips(hash, { ...file, clips: file.clips.map((c) => (c.id === clipId ? { ...c, shots, stream: base ?? undefined } : c)) })
    return { changed: true, scenes: scenes.length, others: known.length }
  })
  /** Verarbeitung: Transkription (0–55 %), dann Analyse + Clip-Auswahl (55–100 %). */
  ipcMain.handle('shortme:transcribe', async (_e, hash: string, opts: { diarize?: boolean; query?: string; wanted?: number; contentType?: ContentType; frame?: FrameChoice; engine?: SelectionEngineId; profile?: V3Profile }) => {
    const meta = await loadMeta(hash)
    if (!meta) throw new Error('Projekt nicht gefunden')
    if (hasActiveJob(jobs, hash)) throw new Error('Für dieses Projekt läuft schon eine Analyse.')
    // Engine: Wahl im Erstellen-Dialog, sonst Standard für neue Projekte (zunächst die bisherige Engine); sie bleibt als Projektauswahl gespeichert
    const engine = opts?.engine && isLocalEngine(opts.engine) ? opts.engine : await loadDefaultEngine()
    { const missing = await missingModelsFor(engine); if (missing.length) throw new Error(`Für ${ENGINE_LABEL[engine]} fehlen Modelle: ${missing.map((m) => m.name).join(', ')}. Bitte im Modell-Manager installieren.`) }
    await setSelected(hash, engine)
    // Inhaltstyp am Projekt merken und als letzte Auswahl dieser Quelle (Twitch: des Kanals) speichern
    if (opts?.contentType) {
      meta.contentType = opts.contentType
      await saveMeta(meta)
      await rememberChoice(sourceKey({ channel: meta.twitch?.channel, url: meta.sourceUrl, path: meta.sourcePath }), { kind: opts.contentType, frame: opts.frame ?? (await loadProfile(opts.contentType)).frame })
    }
    return jobs.enqueue(hash, meta.title, async ({ signal, report, timing }) => {
      await runTranscription(meta, { diarize: !!opts?.diarize, signal, onProgress: (p) => report(p.stage, p.fraction, p.message) })
      await runAnalysis(meta, { engine, profile: isV3Profile(opts?.profile) ? opts.profile : undefined, query: opts?.query, contentType: opts?.contentType, frame: opts?.frame, wanted: opts?.wanted, signal, onProgress: report, timing })
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
  ipcMain.handle('shortme:feedback', (_e, hash: string) => loadRatings(hash))
  ipcMain.handle('shortme:feedbackSet', async (_e, hash: string, clipId: string, rating: { level: Level; reasons: string[] } | null) => {
    const all = await saveRating(hash, clipId, rating)
    void recordRating(hash, clipId, rating).catch((e) => console.error('Katalog:', e)) // Bewertungskatalog (Abgleich über GitHub)
    return all
  })
  // Testlab: Modell-Plätze, Quellen, Vergleich, Entscheidung
  ipcMain.handle('testlab:models', () => modelsView())
  ipcMain.handle('testlab:enabled', () => testlabFlag())
  ipcMain.handle('testlab:setEnabled', (_e, on: boolean) => setTestlabEnabled(on))
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
    await saveClips(hash, { ...file, clips })
    return personsView(hash)
  })
  ipcMain.handle('shortme:clips', async (_e, hash: string) => {
    const file = await loadClips(hash)
    if (!file) return null
    const m = await loadMeta(hash)
    if (m) allowMediaPath(m.sourcePath)
    // Fehlende Vorschaubilder (ältere Projekte, früherer Fehler) beim Öffnen nachholen
    if (m) {
      const missing = file.clips.filter((c) => !c.pending && !existsSync(thumbPath(hash, c.id)))
      if (missing.length) await makeThumbs(m, missing).catch((e) => console.error('Vorschaubilder:', e))
    }
    const thumbs: Record<string, string | null> = {}
    for (const c of file.clips) thumbs[c.id] = await dataUrl(thumbPath(hash, c.id))
    // `engine`/`runId` kommen aus der Datei; ältere Projekte haben sie nicht und gelten als bisherige Engine
    return { ...file, engine: file.engine ?? 'legacy', runId: file.runId ?? LEGACY_RUN_ID, contentType: m?.contentType ?? null, channel: m?.twitch?.channel ?? null, thumbs, source: m ? { path: resolve(m.sourcePath), width: m.width, height: m.height, title: m.title, durationSec: m.durationSec } : null }
  })
  /** Export: ausgewählte Clips nacheinander rendern (Pausen entfernt, −14 LUFS, Untertitel eingebrannt). */
  ipcMain.handle('shortme:export', async (_e, hash: string, clipIds: string[], opts: { srt?: boolean; captions?: boolean }) => {
    const meta = await loadMeta(hash)
    const transcript = await loadTranscript(hash)
    if (!meta || !transcript) throw new Error('Projekt, Clips oder Transkript fehlen')
    // Clips werden jetzt über alle Läufe gefunden und für den Job festgehalten: ein späterer Enginewechsel ändert diesen Export nicht
    const clips = (await Promise.all(clipIds.map((id) => findClip(hash, id)))).flatMap((f) => (f ? [f.clip] : []))
    if (!clips.length) throw new Error('Projekt, Clips oder Transkript fehlen')
    const outDir = join(await exportRoot(), safeFileName(meta.title, 'Projekt'))
    return jobs.enqueue(hash, `Export: ${meta.title}`, async ({ signal, report }) => {
      const signals = await ensureSignals(meta)
      const noTitle: string[] = []
      for (let i = 0; i < clips.length; i++) {
        // Editor-Operationen anwenden: Beschnitt, herausgeschnittene Wörter, Hook, Untertitel-Stil, Layout-Überschreibungen
        const st = stateOf(baseState(clips[i], undefined, await loadStyle()), await loadEdits(hash, clips[i].id))
        const eff = effectiveClip(clips[i], transcript.words, st, (await loadLayoutInput(hash, clips[i].id)) ?? (await ensureLayoutInput(meta, clips[i])))
        const exp = await exportClip(meta, eff, transcript, signals, { outDir, style: effectivePreset(await allPresets(), st.caption), srt: !!opts?.srt, captions: opts?.captions !== false, extraCuts: eff.removed, wordEdits: eff.wordEdits, coldOpenSec: (await loadStyle()).coldOpenSec ?? 0, hook: st.hook.enabled, renderer: (await activeModelId('renderer')) === 'remotion_renderer' ? 'remotion' : 'tscaps', seamCaption: st.caption.style.caption?.y === undefined, seamTitle: st.caption.style.title?.y === undefined, caption: { highlight: st.caption.highlight }, hookSeconds: st.hook.seconds, hookText: st.hook.text, signal, onProgress: (f, m) => report('export', (i + f) / clips.length, `${clips[i].title}: ${m}`) })
        if (exp.titleDropped) noTitle.push(`${eff.title}: ${exp.titleDropped}`)
        await logCorrection(hash, clips[i].id, [{ kind: 'export', durationSec: +exp.durationSec.toFixed(1) }])
        await addExport({ hash, clipId: clips[i].id, title: eff.title, hookText: st.hook.text || eff.hookText, path: exp.path, durationSec: exp.durationSec })
      }
      void shell.openPath(outDir)
      return `${clips.length === 1 ? 'Clip' : `${clips.length} Clips`} exportiert nach ${outDir}${noTitle.length ? ` – ohne Titel (Einblendung fehlgeschlagen: ${noTitle[0]})` : ''}`
    })
  })
  ipcMain.handle('shortme:exportDir', async () => ({ dir: await exportRoot(), isDefault: (await exportRoot()) === defaultExportRoot() }))
  ipcMain.handle('shortme:exportDirChoose', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const r = await dialog.showOpenDialog(win!, { title: 'Zielordner für Exporte', defaultPath: await exportRoot(), properties: ['openDirectory', 'createDirectory'] })
    if (!r.canceled && r.filePaths[0]) await setExportRoot(r.filePaths[0])
    return { dir: await exportRoot(), isDefault: (await exportRoot()) === defaultExportRoot() }
  })
  ipcMain.handle('shortme:exportDirReset', async () => { await setExportRoot(null); return { dir: await exportRoot(), isDefault: true } })
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
  ipcMain.handle('shortme:played', (_e, hash: string, clipId: string, sec: number) => (sec >= 1 ? logCorrection(hash, clipId, [{ kind: 'played', sec: Math.round(sec) }]) : undefined))
  ipcMain.handle('shortme:deleteClip', (_e, hash: string, clipId: string) => deleteClip(hash, clipId))
  ipcMain.handle('shortme:applyAll', (_e, hash: string, clipIds: string[], patch: CaptionPatch) => applyCaptionToAll(hash, clipIds, patch))
  ipcMain.handle('shortme:openLogs', () => shell.openPath(logDir()))
  /** Fehlerbericht (Systeminfo + letzte Sitzungen) nach Downloads, Upload ins private Repo; Ordner zeigen. */
  ipcMain.handle('shortme:exportLog', async () => { const r = await exportLogReport(); shell.showItemInFolder(r.path); return r })
  /** Projektliste: Titel, Dauer, Clip-Anzahl und 16:9-Vorschaubild (YouTube-Thumbnail bzw. Screenshot). */
  /** Projekt löschen (mit Rückfrage): Analyse, Clips, Bearbeitungen; ein per Link geladenes Video wird mit entfernt, eine eigene Originaldatei nie. */
  ipcMain.handle('shortme:deleteProject', async (e, hash: string) => {
    const meta = await loadMeta(hash)
    if (!meta) return false
    const win = BrowserWindow.fromWebContents(e.sender)
    const dl = resolve(dataRoot(), 'downloads')
    const inDl = resolve(meta.sourcePath).toLowerCase().startsWith(dl.toLowerCase())
    // Eigene Originaldatei nur auf ausdrücklichen Wunsch (eigener Knopf) und dauerhaft entfernen.
    const buttons = inDl ? ['Löschen', 'Abbrechen'] : ['Projekt löschen', 'Projekt + Originaldatei löschen', 'Abbrechen']
    const cancel = buttons.length - 1
    const box = { type: 'warning' as const, buttons, defaultId: cancel, cancelId: cancel, title: 'Projekt löschen', message: `„${meta.title}“ löschen?`, detail: inDl ? 'Clips, Bearbeitungen und Analyse werden entfernt; das per Link geladene Video wird ebenfalls gelöscht.' : `Clips, Bearbeitungen und Analyse werden entfernt. „Projekt + Originaldatei löschen“ entfernt zusätzlich die Videodatei dauerhaft von der Festplatte (nicht im Papierkorb):
${meta.sourcePath}` }
    const r = win ? await dialog.showMessageBox(win, box) : await dialog.showMessageBox(box)
    if (r.response === cancel) return false
    await discardProject(hash)
    if (inDl || r.response === 1) await rm(meta.sourcePath, { force: true }).catch(() => undefined)
    return true
  })
  /** Mehrere Projekte auf einmal löschen (Auswahl in „Projekte“): ein Dialog für alle, laufende Projekte werden übersprungen. */
  ipcMain.handle('shortme:deleteProjects', async (e, hashes: string[]) => {
    const metas = (await Promise.all([...new Set(hashes)].map((h) => loadMeta(h)))).filter((m): m is NonNullable<typeof m> => !!m)
    const busy = metas.filter((m) => hasActiveJob(jobs, m.hash))
    const todo = metas.filter((m) => !busy.includes(m))
    if (!todo.length) return { deleted: 0, skipped: busy.length }
    const dl = resolve(dataRoot(), 'downloads').toLowerCase()
    const own = todo.filter((m) => !resolve(m.sourcePath).toLowerCase().startsWith(dl))
    const buttons = own.length ? ['Projekte löschen', 'Projekte + Originaldateien löschen', 'Abbrechen'] : ['Löschen', 'Abbrechen']
    const cancel = buttons.length - 1
    const detail = [
      'Clips, Bearbeitungen und Analyse werden entfernt; per Link geladene Videos werden ebenfalls gelöscht.',
      own.length ? `„Projekte + Originaldateien löschen“ entfernt zusätzlich ${own.length} eigene Videodatei${own.length === 1 ? '' : 'en'} dauerhaft von der Festplatte (nicht im Papierkorb).` : '',
      busy.length ? `${busy.length} Projekt${busy.length === 1 ? '' : 'e'} wird gerade verarbeitet und bleibt erhalten.` : ''
    ].filter(Boolean).join('\n')
    const box = { type: 'warning' as const, buttons, defaultId: cancel, cancelId: cancel, title: 'Projekte löschen', message: `${todo.length} Projekt${todo.length === 1 ? '' : 'e'} löschen?`, detail }
    const win = BrowserWindow.fromWebContents(e.sender)
    const r = win ? await dialog.showMessageBox(win, box) : await dialog.showMessageBox(box)
    if (r.response === cancel) return { deleted: 0, skipped: busy.length }
    for (const m of todo) {
      await discardProject(m.hash)
      if (resolve(m.sourcePath).toLowerCase().startsWith(dl) || (own.length && r.response === 1)) await rm(m.sourcePath, { force: true }).catch(() => undefined)
    }
    return { deleted: todo.length, skipped: busy.length }
  })
  ipcMain.handle('shortme:projects', async () => {
    const out: Array<{ hash: string; title: string; durationSec: number; clips: number; created: string; poster: string | null; source: string; isUrl: boolean; /** none = noch nie analysiert, running = Analyse läuft, done = Clipliste vorhanden */ status: 'none' | 'running' | 'done' }> = []
    for (const d of await readdir(projectsRoot()).catch(() => [] as string[])) {
      const meta = await loadMeta(d)
      if (!meta) continue
      allowMediaPath(meta.sourcePath)
      const clips = await loadClips(d)
      out.push({ hash: meta.hash, title: meta.title, durationSec: meta.durationSec, clips: clips?.clips.length ?? 0, created: meta.created, poster: await dataUrl(projectFile(meta.hash, 'poster.jpg')), source: meta.sourceUrl ?? meta.sourcePath, isUrl: !!meta.sourceUrl, status: hasActiveJob(jobs, meta.hash) ? 'running' : clips ? 'done' : 'none' })
    }
    return out.sort((a, b) => b.created.localeCompare(a.created))
  })
  /** Editor: echte Wellenform und Filmstreifen des Clips. */
  ipcMain.handle('shortme:editorAssets', async (_e, hash: string, clipId: string) => {
    const meta = await loadMeta(hash)
    const clip = (await findClip(hash, clipId))?.clip
    if (!meta || !clip) throw new Error('Clip nicht gefunden')
    const [start, end] = editWindow(clip.start, clip.end, meta.durationSec)
    return editorAssets(meta, { id: clip.id, start, end })
  })
  /** Editor: exakt der Plan, den der Export verwendet (Pausenschnitte, Stücke mit Ausschnitt/Zoom) → Vorschau = Export. */
  ipcMain.handle('shortme:previewPlan', async (_e, hash: string, clipId: string, rawLog: unknown, presetId?: string) => {
    const meta = await loadMeta(hash)
    const transcript = await loadTranscript(hash)
    const clip = (await findClip(hash, clipId))?.clip
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
