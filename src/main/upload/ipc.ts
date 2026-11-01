import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import { extname } from 'node:path'
import { BrowserWindow, clipboard, ipcMain } from 'electron'
import { withLlm } from '../engines'
import { allowMediaPath } from '../mediaAccess'
import { FFPROBE_PATH } from '../pipeline/ffmpeg'
import { loadClips } from '../shortme/clips/analysis'
import { chatJson, loadPrompt, str } from '../shortme/clips/llm'
import { loadTranscript } from '../shortme/transcription'
import { DRAFT_LIMIT, draftsIn24h, type FileFacts, type PlatformId, type UploadJob, type UploadOverview } from '../../shared/upload'
import { comingSoon, type Platform } from './platform'
import { loadExports, loadJobs, saveJob } from './store'
import { saveAppCreds, tiktok } from './tiktok'

const PLATFORMS: Platform[] = [tiktok]
const SOON = [comingSoon('youtube', 'YouTube'), comingSoon('instagram', 'Instagram')]
const find = (id: PlatformId): Platform => { const p = PLATFORMS.find((x) => x.id === id); if (!p) throw new Error('Plattform noch nicht verfügbar') ; return p }
const notify = (): void => { for (const w of BrowserWindow.getAllWindows()) w.webContents.send('upload:changed') }

function probe(path: string): Promise<FileFacts> {
  return new Promise((resolve, reject) => {
    execFile(FFPROBE_PATH, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,avg_frame_rate:format=duration', '-of', 'json', path], { maxBuffer: 1 << 24, windowsHide: true }, async (err, out) => {
      if (err) return reject(new Error('Die Datei lässt sich nicht lesen.'))
      const j = JSON.parse(out) as { streams?: Array<{ width: number; height: number; avg_frame_rate: string }>; format?: { duration?: string } }
      const s = j.streams?.[0]
      const [n, d] = (s?.avg_frame_rate ?? '0/1').split('/').map(Number)
      resolve({ ext: extname(path), size: (await stat(path)).size, durationSec: Number(j.format?.duration ?? 0), width: s?.width ?? 0, height: s?.height ?? 0, fps: d ? n / d : 0 })
    })
  })
}

async function overview(): Promise<UploadOverview> {
  const [exports, jobs] = await Promise.all([loadExports(), loadJobs()])
  const live = exports.filter((e) => existsSync(e.path))
  for (const e of live.slice(0, 50)) allowMediaPath(e.path)
  const platforms = [...(await Promise.all(PLATFORMS.map((p) => p.status()))), ...(await Promise.all(SOON.map((p) => p.status())))]
  return { platforms, exports: live, jobs, drafts: Object.fromEntries(PLATFORMS.map((p) => [p.id, draftsIn24h(jobs, p.id)])) }
}

export function registerUploadIpc(): void {
  ipcMain.handle('upload:overview', overview)
  ipcMain.handle('upload:saveCreds', async (_e, id: PlatformId, key: string, secret: string) => {
    if (id !== 'tiktok' || !key.trim() || !secret.trim()) throw new Error('Client key und Client secret eintragen.')
    await saveAppCreds({ key, secret })
    return true
  })
  ipcMain.handle('upload:connect', async (_e, id: PlatformId) => { try { await find(id).connect(); return null } catch (e) { return e instanceof Error ? e.message : String(e) } })
  ipcMain.handle('upload:disconnect', async (_e, id: PlatformId) => { await find(id).disconnect(); return true })

  /** Bildunterschrift + Hashtags vom lokalen LLM, editierbar. */
  ipcMain.handle('upload:suggest', async (_e, exportId: string) => {
    const rec = (await loadExports()).find((x) => x.id === exportId)
    if (!rec) throw new Error('Export nicht gefunden')
    const [file, tr] = await Promise.all([loadClips(rec.hash), loadTranscript(rec.hash)])
    const clip = file?.clips.find((c) => c.id === rec.clipId)
    const text = clip && tr ? tr.words.slice(clip.firstWord, clip.lastWord + 1).map((w) => w.w).join(' ').slice(0, 3000) : rec.title
    const prompt = await loadPrompt('caption', { title: rec.title, hook: rec.hookText, text })
    const r = await withLlm((url) => chatJson(url, prompt, {
      schema: { type: 'object', additionalProperties: false, required: ['caption', 'hashtags'], properties: { caption: { type: 'string' }, hashtags: { type: 'array', items: { type: 'string' }, minItems: 2, maxItems: 6 } } },
      validate: (x) => { const o = x as { caption: unknown; hashtags: unknown }; return { caption: str(o.caption, 300, 'caption'), hashtags: (Array.isArray(o.hashtags) ? o.hashtags : []).map((h) => String(h).replace(/[#\s]/g, '')).filter(Boolean).slice(0, 6) } }
    }))
    return r
  })

  /** Prüfen und senden. Rückgabe: Fehlermeldung vor dem Start (sonst null); Verlauf kommt über `upload:changed`. */
  ipcMain.handle('upload:send', async (_e, exportId: string, id: PlatformId, caption: string, resumeJobId?: string): Promise<string | null> => {
    const p = find(id)
    const rec = (await loadExports()).find((x) => x.id === exportId)
    if (!rec || !existsSync(rec.path)) return 'Die exportierte Datei gibt es nicht mehr.'
    const st = await p.status()
    if (!st.connected) return `${p.name} ist nicht verbunden.`
    const jobs = await loadJobs()
    const old = resumeJobId ? jobs.find((j) => j.id === resumeJobId) : undefined
    if (!old && draftsIn24h(jobs, id) >= DRAFT_LIMIT) return `Schon ${DRAFT_LIMIT} offene Entwürfe in den letzten 24 Stunden. Poste oder lösche erst welche in der TikTok-App.`
    let facts: FileFacts
    try { facts = await probe(rec.path) } catch (e) { return e instanceof Error ? e.message : String(e) }
    const problems = p.check(facts)
    if (problems.length) return problems.join(' ')
    clipboard.writeText(caption)
    let job: UploadJob = old ? { ...old, state: 'wartend', message: 'Wartet …', caption } : { id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, exportId, platform: id, state: 'wartend', progress: 0, message: 'Wartet …', caption, createdAt: new Date().toISOString() }
    await saveJob(job); notify()
    void (async () => {
      const report = async (patch: Partial<UploadJob>): Promise<void> => { job = { ...job, ...patch }; await saveJob(job); notify() }
      try {
        await report({ state: 'laedt', message: 'Lädt hoch …' })
        await p.upload(job, rec.path, report)
      } catch (e) {
        await report({ state: 'fehler', message: e instanceof Error ? e.message : String(e) })
      }
    })()
    return null
  })
}
