import { readFile } from 'node:fs/promises'
import { BrowserWindow, ipcMain } from 'electron'
import { importFile, importUrl, type ImportResult } from './importer'
import { JobQueue } from './jobs'
import { discardProject, loadMeta, projectFile } from './project'
import { loadTranscript, runTranscription } from './transcription'
import { loadClips, runAnalysis } from './clips/analysis'
import { thumbPath } from './clips/thumbs'

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
    const thumbs: Record<string, string | null> = {}
    for (const c of file.clips) thumbs[c.id] = await dataUrl(thumbPath(hash, c.id))
    return { ...file, thumbs }
  })
  ipcMain.handle('shortme:jobs', () => jobs.list())
  ipcMain.handle('shortme:pause', (_e, id: string) => jobs.pause(id))
  ipcMain.handle('shortme:resume', (_e, id: string) => jobs.resume(id))
  ipcMain.handle('shortme:stop', (_e, id: string) => jobs.stop(id))
  ipcMain.handle('shortme:discard', (_e, id: string) => jobs.discard(id))
  ipcMain.handle('shortme:transcript', (_e, hash: string) => loadTranscript(hash))
}
