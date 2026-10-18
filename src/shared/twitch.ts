// Twitch: Link-Erkennung, Zeitbereiche, Typen zwischen Main und Renderer.

export type TwitchRef =
  | { kind: 'vod'; id: string }
  | { kind: 'clip'; slug: string; channel?: string }
  | { kind: 'channel'; channel: string }

const RESERVED = new Set(['videos', 'directory', 'settings', 'downloads', 'jobs', 'p', 'search', 'subscriptions', 'wallet', 'turbo', 'prime', 'store', 'friends', 'inventory', 'drops', 'broadcast', 'popout', 'embed', 'u'])

/** Erkennt VOD-, Clip- und Kanal-Links (twitch.tv, m.twitch.tv, clips.twitch.tv). */
export function parseTwitchUrl(input: string): TwitchRef | null {
  let u: URL
  try { u = new URL(/^https?:\/\//i.test(input.trim()) ? input.trim() : `https://${input.trim()}`) } catch { return null }
  const host = u.hostname.toLowerCase().replace(/^(www\.|m\.)/, '')
  const parts = u.pathname.split('/').filter(Boolean)
  if (host === 'clips.twitch.tv') return parts[0] ? { kind: 'clip', slug: parts[0] } : null
  if (host !== 'twitch.tv') return null
  if (parts[0] === 'videos' && /^\d+$/.test(parts[1] ?? '')) return { kind: 'vod', id: parts[1] }
  if (parts[1] === 'clip' && parts[2]) return { kind: 'clip', slug: parts[2], channel: parts[0].toLowerCase() }
  if (parts[0] && !RESERVED.has(parts[0].toLowerCase()) && /^\w{2,25}$/.test(parts[0])) return { kind: 'channel', channel: parts[0].toLowerCase() }
  return null
}

export const isTwitchUrl = (s: string): boolean => parseTwitchUrl(s) !== null

/** Zeitbereich „letzte N Minuten“ im (laufenden) VOD: [Start, Ende] in Sekunden. */
export function lastMinutesRange(vodDurationSec: number, minutes: number): [number, number] {
  const m = Math.max(1, Math.min(minutes, 24 * 60))
  return [Math.max(0, Math.floor(vodDurationSec - m * 60)), Math.floor(vodDurationSec)]
}

/** yt-dlp `--download-sections`-Wert. */
export const sectionArg = (r: [number, number]): string => `*${r[0]}-${r[1]}`

export const fmtHms = (sec: number): string => {
  const s = Math.max(0, Math.round(sec))
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`
}

/** Eingabe wie „1:30:00“, „90:00“ oder „5400“ → Sekunden (NaN bei Unsinn). */
export function parseHms(s: string): number {
  const p = s.trim().split(':').map(Number)
  if (!p.length || p.some((x) => !Number.isFinite(x) || x < 0)) return NaN
  return p.reduce((a, b) => a * 60 + b, 0)
}

export type TwitchState = 'vod' | 'clip' | 'live' | 'offline' | 'novods'

export interface TwitchInfo {
  ref: TwitchRef
  state: TwitchState
  channel: string | null
  title: string
  durationSec: number
  /** Kanal ist live und hat ein laufendes VOD: dessen Adresse und bisherige Länge. */
  live: { vodUrl: string; vodDurationSec: number; title: string } | null
  /** Verständliche Meldung (offline, keine VODs, Abonnenten-VOD …). */
  message: string | null
}

/** Twitch-Bezug eines Projekts (Quelle, Versatz im VOD, stumme Abschnitte, Chat vorhanden). */
export interface TwitchMeta {
  kind: 'vod' | 'clip' | 'live'
  channel: string | null
  vodId: string | null
  /** Beginn des geladenen Ausschnitts im VOD (s). */
  offsetSec: number
  /** Digitale Stille (von Twitch stumm geschaltet), Projektzeit. */
  silent: Array<[number, number]>
  chat: boolean
}

export interface TwitchStatus {
  tools: { streamlink: string | null; twitchdownloader: string | null }
  hasToken: boolean
  chatSignal: boolean
}

export interface LiveSegmentInfo { count: number; bytes: number; seconds: number }

export interface LiveStatus {
  running: boolean
  channel: string | null
  startedAt: number | null
  runtimeSec: number
  bufferSec: number
  bufferMinutes: number
  bytes: number
  /** Letzter Fehler / Hinweis (z. B. Kanal offline). */
  message: string | null
  chat: boolean
  adsSkipped: number
}

export interface LiveSave {
  hash: string
  title: string
  channel: string
  seconds: number
  at: string
}
