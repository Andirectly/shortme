// Live-Puffer: Streamlink (--twitch-low-latency) → FFmpeg schneidet einen Ringpuffer aus ~10-s-Segmenten. Läuft im Hintergrund weiter,
// auch wenn man in der App den Bereich wechselt. Beim Stoppen werden die Segmente gelöscht. (Logik-Vorlage Live-Archivierung: Zibbp/ganymede, nur nachgelesen.)
import { spawn, execFile, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { dataRoot } from '../engines/paths'
import { FFMPEG_PATH, runBinary } from '../pipeline/ffmpeg'
import { importFile } from '../shortme/importer'
import { loadMeta, saveMeta } from '../shortme/project'
import { writeFileAtomic } from '../shortme/atomic'
import type { LiveSave, LiveStatus, TwitchMeta } from '../../shared/twitch'
import { ensureTool } from './tools'
import { readTwitchToken } from './token'
import { loadTwitchSettings } from './settings'
import { ChatRecorder } from './liveChat'
import { chatFile, storeChat, type ChatMsg } from './chat'

export const SEGMENT_SEC = 10
const liveDir = (): string => join(dataRoot(), 'live')
const segDir = (): string => join(liveDir(), 'segments')
const savesFile = (): string => join(liveDir(), 'saves.json')

interface Seg { name: string; path: string; mtime: number; size: number }

/** Segmente (Dateien `r<Lauf>_<Nr>.ts`) in Aufnahmereihenfolge. */
export async function listSegments(): Promise<Seg[]> {
  if (!existsSync(segDir())) return []
  const out: Seg[] = []
  for (const name of await readdir(segDir())) {
    if (!/^r\d+_\d+\.ts$/.test(name)) continue
    const path = join(segDir(), name)
    try { const st = await stat(path); out.push({ name, path, mtime: st.mtimeMs, size: st.size }) } catch { /* verschwunden */ }
  }
  return out.sort((a, b) => a.mtime - b.mtime || a.name.localeCompare(b.name))
}

/** Wie viele der neuesten Segmente decken `minutes` ab? */
export const segmentsFor = (minutes: number): number => Math.max(1, Math.ceil((minutes * 60) / SEGMENT_SEC))

let sl: ChildProcess | null = null
let ff: ChildProcess | null = null
let running = false
let channel: string | null = null
let startedAt: number | null = null
let message: string | null = null
let adsSkipped = 0
let bufferMinutes = 15
let timer: NodeJS.Timeout | null = null
let retryTimer: NodeJS.Timeout | null = null
let chat: ChatRecorder | null = null
let cached = { bytes: 0, count: 0 }

function killTree(p: ChildProcess | null): void {
  if (!p?.pid) return
  try { execFile('taskkill', ['/PID', String(p.pid), '/T', '/F'], { windowsHide: true }, () => undefined) } catch { p.kill() }
}

async function prune(): Promise<void> {
  const segs = await listSegments()
  const keep = segmentsFor(bufferMinutes) + 1
  for (const s of segs.slice(0, Math.max(0, segs.length - keep))) await rm(s.path, { force: true })
  const left = segs.slice(Math.max(0, segs.length - keep))
  cached = { bytes: left.reduce((n, s) => n + s.size, 0), count: left.length }
}

async function launch(): Promise<void> {
  if (!running || !channel) return
  const slBin = await ensureTool('streamlink')
  const token = await readTwitchToken()
  const runId = Date.now()
  const args = ['--twitch-low-latency', '--loglevel', 'info', '--retry-streams', '10', '--retry-max', '30', ...(token ? ['--twitch-api-header', `Authorization=OAuth ${token}`] : []), '-O', `twitch.tv/${channel}`, 'best']
  sl = spawn(slBin, args, { windowsHide: true })
  ff = spawn(FFMPEG_PATH, ['-hide_banner', '-loglevel', 'error', '-i', 'pipe:0', '-c', 'copy', '-f', 'segment', '-segment_time', String(SEGMENT_SEC), '-segment_format', 'mpegts', '-reset_timestamps', '1', join(segDir(), `r${runId}_%05d.ts`)], { windowsHide: true })
  sl.stdout!.pipe(ff.stdin!)
  ff.stdin!.on('error', () => undefined)
  let buf = ''
  sl.stderr!.on('data', (d: Buffer) => {
    buf += d.toString()
    const lines = buf.split(/\r?\n/)
    buf = lines.pop() ?? ''
    for (const l of lines) {
      if (/advertisement break/i.test(l)) adsSkipped++
      else if (/offline|No playable streams|not (currently )?live/i.test(l)) message = 'Der Kanal ist gerade offline – der Puffer startet, sobald er live geht.'
      else if (/Opening stream/i.test(l)) message = null
    }
  })
  const mine = sl
  mine.on('close', () => {
    if (sl !== mine) return
    sl = null
    try { ff?.stdin?.end() } catch { /* schon zu */ }
    if (running) { message ??= 'Verbindung beendet – neuer Versuch …'; retryTimer = setTimeout(() => void launch().catch((e) => { message = String(e) }), 5000) }
  })
}

export async function startLive(rawChannel: string): Promise<LiveStatus> {
  const name = rawChannel.trim().toLowerCase().replace(/^https?:\/\/(www\.)?twitch\.tv\//, '').split(/[/?]/)[0]
  if (!/^\w{2,25}$/.test(name)) throw new Error('Das ist kein gültiger Twitch-Kanal.')
  if (running) await stopLive()
  const settings = await loadTwitchSettings()
  bufferMinutes = settings.bufferMinutes
  await rm(segDir(), { recursive: true, force: true })
  await mkdir(segDir(), { recursive: true })
  running = true; channel = name; startedAt = Date.now(); message = null; adsSkipped = 0; cached = { bytes: 0, count: 0 }
  chat = settings.chatSignal ? new ChatRecorder(name, (bufferMinutes + 3) * 60) : null
  chat?.start()
  timer = setInterval(() => void prune().catch(() => undefined), 5000)
  await launch()
  return liveStatus()
}

/** Stoppt die Aufnahme und löscht alle Segmente. */
export async function stopLive(): Promise<LiveStatus> {
  running = false
  if (timer) clearInterval(timer)
  if (retryTimer) clearTimeout(retryTimer)
  timer = retryTimer = null
  chat?.stop(); chat = null
  const procs = [sl, ff]
  sl = null; ff = null
  for (const p of procs) killTree(p)
  await new Promise((r) => setTimeout(r, 400))
  await rm(segDir(), { recursive: true, force: true }).catch(() => undefined)
  cached = { bytes: 0, count: 0 }
  channel = null; startedAt = null
  return liveStatus()
}

export function liveStatus(): LiveStatus {
  return {
    running, channel, startedAt, runtimeSec: startedAt ? Math.round((Date.now() - startedAt) / 1000) : 0,
    bufferSec: cached.count * SEGMENT_SEC, bufferMinutes, bytes: cached.bytes, message, chat: !!chat, adsSkipped
  }
}

export async function loadSaves(): Promise<LiveSave[]> {
  try { return JSON.parse(await readFile(savesFile(), 'utf8')) as LiveSave[] } catch { return [] }
}

/** Letzte `minutes` Minuten sichern: Segmente zusammenfügen → Projekt (mit Chat, falls mitgeschrieben). */
export async function saveLive(minutes: number): Promise<{ hash: string; title: string; seconds: number }> {
  if (!channel) throw new Error('Der Live-Puffer läuft nicht.')
  const want = segmentsFor(minutes)
  const segs = (await listSegments()).filter((s) => s.size > 0)
  const take = segs.slice(Math.max(0, segs.length - want))
  if (take.length === 0) throw new Error('Der Puffer ist noch leer – warte einen Moment.')
  const dir = join(liveDir(), 'save')
  await rm(dir, { recursive: true, force: true })
  await mkdir(dir, { recursive: true })
  const list = join(dir, 'list.txt')
  await writeFile(list, take.map((s) => `file '${s.path.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`).join('\n'), 'utf8')
  const at = new Date()
  const stamp = `${at.getFullYear()}${String(at.getMonth() + 1).padStart(2, '0')}${String(at.getDate()).padStart(2, '0')}-${String(at.getHours()).padStart(2, '0')}${String(at.getMinutes()).padStart(2, '0')}${String(at.getSeconds()).padStart(2, '0')}`
  const outDir = join(dataRoot(), 'downloads')
  await mkdir(outDir, { recursive: true })
  const out = join(outDir, `live_${channel}_${stamp}.mp4`)
  await runBinary(FFMPEG_PATH, ['-hide_banner', '-nostats', '-y', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', '-bsf:a', 'aac_adtstoasc', '-movflags', '+faststart', out])
  await rm(dir, { recursive: true, force: true })
  const res = await importFile(out)
  const meta = (await loadMeta(res.meta.hash)) ?? res.meta
  const tw: TwitchMeta = { kind: 'live', channel, vodId: null, offsetSec: 0, silent: [], chat: false }
  if (chat) {
    // Zeitsynchron: Beginn des gesicherten Bereichs = Änderungszeit des ersten Segments minus Segmentlänge
    const startWall = take[0].mtime - SEGMENT_SEC * 1000
    const msgs: ChatMsg[] = chat.messagesSince(startWall)
    tw.chat = await storeChat(meta.hash, msgs, meta.durationSec).catch(() => false)
    if (tw.chat) await writeFileAtomic(chatFile(meta.hash), JSON.stringify({ comments: msgs.map((m) => ({ content_offset_seconds: m.t, message: { body: m.text } })) })).catch(() => undefined)
  }
  meta.twitch = tw
  meta.title = `${channel} – live ${new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} (letzte ${minutes} Min)`
  await saveMeta(meta)
  const saves = await loadSaves()
  saves.unshift({ hash: meta.hash, title: meta.title, channel: channel!, seconds: Math.round(meta.durationSec), at: new Date().toISOString() })
  await mkdir(liveDir(), { recursive: true })
  await writeFileAtomic(savesFile(), JSON.stringify(saves.slice(0, 50), null, 1))
  return { hash: meta.hash, title: meta.title, seconds: meta.durationSec }
}

/** App-Start: Reste einer früheren Sitzung entfernen (Segmente gehören nur zu einem laufenden Puffer). */
export async function cleanupLiveLeftovers(): Promise<void> { await rm(segDir(), { recursive: true, force: true }).catch(() => undefined) }
