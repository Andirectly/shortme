import { BrowserWindow, ipcMain } from 'electron'
import { discardProject, loadMeta, saveMeta } from '../shortme/project'
import { loadProfile, rememberChoice, sourceKey } from '../shortme/profiles'
import { runTranscription } from '../shortme/transcription'
import { runAnalysis } from '../shortme/clips/analysis'
import { jobs, withStills } from '../shortme/ipc'
import type { TwitchStatus } from '../../shared/twitch'
import { toolVersion } from './tools'
import { clearTwitchToken, hasTwitchToken, saveTwitchToken } from './token'
import { loadTwitchSettings, saveTwitchSettings, type TwitchSettings } from './settings'
import { importTwitch, inspectTwitch, type TwitchImportOptions } from './import'
import { cleanupLiveLeftovers, liveStatus, loadSaves, saveLive, startLive, stopLive } from './live'

/** Transkription + Clip-Analyse für ein Twitch-Projekt (Inhaltstyp Stream/Gaming). */
async function analyze(hash: string): Promise<void> {
  const meta = await loadMeta(hash)
  if (!meta) throw new Error('Projekt nicht gefunden')
  meta.contentType = 'stream'
  await saveMeta(meta)
  await rememberChoice(sourceKey({ channel: meta.twitch?.channel }), { kind: 'stream', frame: (await loadProfile('stream')).frame })
  await jobs.enqueue(hash, meta.title, async ({ signal, report }) => {
    await runTranscription(meta, { diarize: false, signal, onProgress: (p) => report(p.stage, p.fraction, p.message) })
    await runAnalysis(meta, { contentType: 'stream', frame: (await loadProfile('stream')).frame, signal, onProgress: report })
  }, () => discardProject(hash))
}

export function registerTwitchIpc(): void {
  const broadcast = (channel: string, payload: unknown): void => { for (const w of BrowserWindow.getAllWindows()) w.webContents.send(channel, payload) }
  void cleanupLiveLeftovers()

  ipcMain.handle('twitch:status', async (): Promise<TwitchStatus> => ({
    tools: { streamlink: await toolVersion('streamlink'), twitchdownloader: await toolVersion('twitchdownloader') },
    hasToken: await hasTwitchToken(),
    chatSignal: (await loadTwitchSettings()).chatSignal
  }))
  ipcMain.handle('twitch:settings', () => loadTwitchSettings())
  ipcMain.handle('twitch:setSettings', (_e, patch: Partial<TwitchSettings>) => saveTwitchSettings(patch))
  ipcMain.handle('twitch:setToken', async (_e, token: string) => { if (token.trim()) await saveTwitchToken(token); else await clearTwitchToken(); return hasTwitchToken() })

  ipcMain.handle('twitch:inspect', (_e, url: string) => inspectTwitch(url))
  /** Importiert VOD/Clip/„letzte Minuten“; mit `analyze` startet danach automatisch die Clip-Analyse. */
  ipcMain.handle('twitch:import', async (_e, url: string, opts: TwitchImportOptions & { analyze?: boolean }) => {
    const res = await importTwitch(url, opts, (p, message) => broadcast('shortme:importProgress', { progress: p, message }))
    if (opts.analyze) await analyze(res.meta.hash)
    return withStills(res)
  })

  ipcMain.handle('twitch:liveStart', async (_e, channel: string) => { const s = await startLive(channel); broadcast('twitch:live', s); return s })
  ipcMain.handle('twitch:liveStop', async () => { const s = await stopLive(); broadcast('twitch:live', s); return s })
  ipcMain.handle('twitch:liveStatus', () => liveStatus())
  ipcMain.handle('twitch:liveSaves', () => loadSaves())
  ipcMain.handle('twitch:liveSave', async (_e, minutes: number) => {
    const r = await saveLive(Math.max(1, Math.min(120, Math.round(minutes))))
    await analyze(r.hash)
    return r
  })
}

export async function shutdownTwitch(): Promise<void> { await stopLive().catch(() => undefined) }
