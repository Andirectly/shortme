// Twitch-Import über das gebündelte yt-dlp: VOD-, Clip- und Kanal-Links laufen über das normale Import-Feld.
import { ensureYtDlp, runYtDlp } from '../pipeline/ytdlp'
import { importUrl } from '../shortme/importer'
import { loadMeta, saveMeta } from '../shortme/project'
import { lastMinutesRange, parseTwitchUrl, type TwitchInfo, type TwitchMeta, type TwitchRef } from '../../shared/twitch'
import { readTwitchToken } from './token'
import { loadTwitchSettings } from './settings'
import { detectSilentRanges } from './silence'
import { downloadChatForProject } from './chat'
import type { ImportResult } from '../shortme/importer'

const MSG = {
  offline: 'Der Kanal ist gerade offline. Gib den Link eines VODs ein – oder starte den Live-Puffer, sobald der Kanal live geht.',
  noVods: 'Der Kanal ist live, speichert aber keine VODs. „Letzte Minuten“ ist deshalb nicht möglich – starte stattdessen den Live-Puffer.',
  noVodsOffline: 'Der Kanal ist offline und hat keine gespeicherten VODs.',
  sub: 'Dieses VOD ist nur für Abonnenten. Trage in den Einstellungen unter „Twitch“ deinen Token ein (optional), um es zu laden.',
  gone: 'Dieses VOD gibt es nicht mehr. VODs laufen je nach Kanal nach 7–60 Tagen ab.'
}

/** Verständliche Fehlermeldung statt rohem yt-dlp-Text. */
export function twitchErrorMessage(raw: string, hasToken: boolean): string {
  if (/subscriber|sub-?only|must be subscribed|subscribe to/i.test(raw)) return hasToken ? 'Dieses VOD ist nur für Abonnenten – dein Token gehört offenbar nicht zu einem Abonnenten des Kanals.' : MSG.sub
  if (/not currently live/i.test(raw)) return MSG.offline
  if (/404|does not exist|not found|deleted|expired|no longer available|unavailable/i.test(raw)) return MSG.gone
  return raw.replace(/^ERROR:\s*/, '').slice(0, 300)
}

async function authArgs(): Promise<string[]> {
  const t = await readTwitchToken()
  return t ? ['--add-header', `Authorization: OAuth ${t}`] : []
}

interface YtJson { id?: string; title?: string; duration?: number; uploader_id?: string; uploader?: string; is_live?: boolean; entries?: Array<{ id?: string; url?: string }> }

async function ytJson(bin: string, url: string, extra: string[] = []): Promise<YtJson> {
  return JSON.parse(await runYtDlp(bin, ['-J', '--no-warnings', ...(await authArgs()), ...extra, url])) as YtJson
}

/** Neuestes VOD eines Kanals, das gerade aufgezeichnet wird (is_live), sonst null. */
async function runningVod(bin: string, channel: string): Promise<{ url: string; durationSec: number; title: string } | null> {
  const list = await ytJson(bin, `https://www.twitch.tv/${channel}/videos?filter=archives&sort=time`, ['--flat-playlist', '--playlist-end', '3'])
  for (const e of list.entries ?? []) {
    const url = e.url ?? (e.id ? `https://www.twitch.tv/videos/${String(e.id).replace(/^v/, '')}` : null)
    if (!url) continue
    const v = await ytJson(bin, url, ['--no-playlist'])
    if (v.is_live && (v.duration ?? 0) > 0) return { url, durationSec: v.duration!, title: v.title ?? '' }
    break // nur das neueste VOD kann das laufende sein
  }
  return null
}

async function hasAnyVod(bin: string, channel: string): Promise<boolean> {
  try { return ((await ytJson(bin, `https://www.twitch.tv/${channel}/videos?filter=archives&sort=time`, ['--flat-playlist', '--playlist-end', '1'])).entries ?? []).length > 0 } catch { return false }
}

export async function inspectTwitch(url: string): Promise<TwitchInfo | null> {
  const ref = parseTwitchUrl(url)
  if (!ref) return null
  const bin = await ensureYtDlp(() => undefined)
  const hasToken = !!(await readTwitchToken())
  const base = { ref, channel: null as string | null, title: '', durationSec: 0, live: null as TwitchInfo['live'], message: null as string | null }
  try {
    if (ref.kind === 'vod') {
      const j = await ytJson(bin, `https://www.twitch.tv/videos/${ref.id}`, ['--no-playlist'])
      return { ...base, state: 'vod', channel: j.uploader_id ?? j.uploader ?? null, title: j.title ?? '', durationSec: j.duration ?? 0 }
    }
    if (ref.kind === 'clip') {
      const j = await ytJson(bin, ref.channel ? `https://www.twitch.tv/${ref.channel}/clip/${ref.slug}` : `https://clips.twitch.tv/${ref.slug}`, ['--no-playlist'])
      return { ...base, state: 'clip', channel: j.uploader_id ?? ref.channel ?? null, title: j.title ?? '', durationSec: j.duration ?? 0 }
    }
    // Kanal: live?
    let liveTitle: string | null = null
    try { liveTitle = (await ytJson(bin, `https://www.twitch.tv/${ref.channel}`, ['--no-playlist'])).title ?? '' } catch (e) {
      const raw = e instanceof Error ? e.message : String(e)
      if (!/not currently live/i.test(raw)) throw e
    }
    if (liveTitle === null) {
      const vods = await hasAnyVod(bin, ref.channel)
      return { ...base, state: vods ? 'offline' : 'novods', channel: ref.channel, message: vods ? MSG.offline : MSG.noVodsOffline }
    }
    const vod = await runningVod(bin, ref.channel)
    if (!vod) return { ...base, state: 'novods', channel: ref.channel, title: liveTitle, message: MSG.noVods }
    return { ...base, state: 'live', channel: ref.channel, title: liveTitle, live: { vodUrl: vod.url, vodDurationSec: vod.durationSec, title: vod.title } }
  } catch (e) {
    throw new Error(twitchErrorMessage(e instanceof Error ? e.message : String(e), hasToken), { cause: e })
  }
}

export interface TwitchImportOptions {
  /** Zeitbereich im VOD (Sekunden), bei Clips ignoriert. */
  section?: [number, number]
  /** „Letzte N Minuten“ eines laufenden VODs (Kanal-Link, der gerade live ist). */
  lastMinutes?: number
}

export async function importTwitch(url: string, opts: TwitchImportOptions, onProgress: (p: number, message: string) => void): Promise<ImportResult> {
  const ref: TwitchRef | null = parseTwitchUrl(url)
  if (!ref) throw new Error('Das ist kein Twitch-Link.')
  const hasToken = !!(await readTwitchToken())
  onProgress(0, 'Twitch-Link wird geprüft …')
  const info = await inspectTwitch(url)
  if (!info) throw new Error('Das ist kein Twitch-Link.')
  if (info.state === 'offline' || info.state === 'novods') throw new Error(info.message ?? MSG.offline)

  let target = url
  let section = opts.section
  let kind: TwitchMeta['kind'] = ref.kind === 'clip' ? 'clip' : 'vod'
  let vodId: string | null = ref.kind === 'vod' ? ref.id : null
  if (info.state === 'live') {
    if (!info.live) throw new Error(MSG.noVods)
    target = info.live.vodUrl
    vodId = target.split('/').pop() ?? null
    kind = 'live'
    section = lastMinutesRange(info.live.vodDurationSec, opts.lastMinutes ?? 5)
  }
  if (ref.kind === 'clip') section = undefined
  const settings = await loadTwitchSettings()
  let res: ImportResult
  try {
    res = await importUrl(target, onProgress, { section, extraArgs: await authArgs(), urlLabel: info.title || undefined })
  } catch (e) {
    throw new Error(twitchErrorMessage(e instanceof Error ? e.message : String(e), hasToken), { cause: e })
  }
  const meta = (await loadMeta(res.meta.hash)) ?? res.meta
  const tw: TwitchMeta = { kind, channel: info.channel, vodId, offsetSec: section?.[0] ?? 0, silent: [], chat: false }
  if (kind !== 'clip') {
    onProgress(0.97, 'Stumme Abschnitte werden gesucht …')
    tw.silent = await detectSilentRanges(meta.sourcePath, meta.durationSec).catch(() => [])
  }
  if (settings.chatSignal && info.channel !== null && (vodId || ref.kind === 'clip')) {
    onProgress(0.98, 'Chat wird geladen …')
    tw.chat = await downloadChatForProject(meta.hash, ref.kind === 'clip' ? ref.slug : vodId!, ref.kind === 'clip' ? undefined : section, meta.durationSec).catch((e) => { console.error('Chat:', e); return false })
  }
  meta.twitch = tw
  const title = kind === 'live' ? `${info.live?.title ?? info.title} (letzte ${opts.lastMinutes ?? 5} Min)` : info.title
  if (title && meta.title !== title) meta.title = title
  await saveMeta(meta)
  return { ...res, meta }
}
