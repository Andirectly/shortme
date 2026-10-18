// Pipeline-Profile je Inhaltstyp (resources/profiles/<typ>.json) und gemerkte Auswahl pro Quelle / Kanal-Layouts.
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app } from 'electron'
import { dataRoot } from '../engines/paths'
import { writeFileAtomic } from './atomic'
import { FALLBACK_PROFILE, sanitizeProfile, type ContentType, type FrameChoice, type KindProfile } from '../../shared/videoKind'
import { sanitizeStream, type NRect, type StreamLayout } from '../../shared/streamLayout'

export function profileDir(): string {
  if (app?.isPackaged) return join(process.resourcesPath, 'profiles')
  return join(process.cwd(), 'resources', 'profiles')
}

export async function loadProfile(kind: ContentType | undefined): Promise<KindProfile> {
  const id = kind ?? 'podcast'
  try { return sanitizeProfile(JSON.parse(await readFile(join(profileDir(), `${id}.json`), 'utf8')), id) } catch { return { ...FALLBACK_PROFILE, id } }
}

// ── Letzte Auswahl pro Quelle (Twitch: pro Kanal) ──────────────────────────────────────────────
export interface SourceChoice { kind: ContentType; frame: FrameChoice }
const memFile = (): string => join(dataRoot(), 'sourcememory.json')

/** Schlüssel einer Quelle: Twitch-Kanal, Webseite eines Links oder der Ordner einer Datei. */
export function sourceKey(src: { channel?: string | null; url?: string; path?: string }): string | null {
  if (src.channel) return `twitch:${src.channel.toLowerCase()}`
  if (src.url) { try { return `url:${new URL(src.url).hostname.replace(/^www\./, '')}` } catch { return null } }
  if (src.path) return `dir:${src.path.replace(/[\\/][^\\/]*$/, '').toLowerCase()}`
  return null
}

async function readJson<T>(path: string, d: T): Promise<T> { try { return JSON.parse(await readFile(path, 'utf8')) as T } catch { return d } }

export async function rememberedChoice(key: string | null): Promise<SourceChoice | null> {
  if (!key) return null
  return (await readJson<Record<string, SourceChoice>>(memFile(), {}))[key] ?? null
}
export async function rememberChoice(key: string | null, c: SourceChoice): Promise<void> {
  if (!key) return
  const all = await readJson<Record<string, SourceChoice>>(memFile(), {})
  all[key] = c
  await writeFileAtomic(memFile(), JSON.stringify(all, null, 1))
}

// ── Kanal-Layouts (Facecam + Gameplay) ─────────────────────────────────────────────────────────
export interface ChannelLayout extends StreamLayout { channel: string; updatedAt: string }
const chFile = (): string => join(dataRoot(), 'streamlayouts.json')

export async function channelLayouts(): Promise<ChannelLayout[]> {
  const all = await readJson<Record<string, ChannelLayout>>(chFile(), {})
  return Object.values(all).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}
export async function channelLayout(channel: string | null | undefined): Promise<ChannelLayout | null> {
  if (!channel) return null
  const l = (await readJson<Record<string, ChannelLayout>>(chFile(), {}))[channel.toLowerCase()]
  if (!l) return null
  const fb: StreamLayout = { preset: 'top', cam: { x: 0.7, y: 0, w: 0.3, h: 0.3 }, game: { x: 0.25, y: 0, w: 0.5, h: 1 }, gap: 0 }
  return { ...sanitizeStream(l, fb), channel: channel.toLowerCase(), updatedAt: l.updatedAt }
}
export async function saveChannelLayout(channel: string, layout: StreamLayout): Promise<void> {
  const all = await readJson<Record<string, ChannelLayout>>(chFile(), {})
  all[channel.toLowerCase()] = { ...layout, channel: channel.toLowerCase(), updatedAt: new Date().toISOString() }
  await writeFileAtomic(chFile(), JSON.stringify(all, null, 1))
}
export async function deleteChannelLayout(channel: string): Promise<void> {
  const all = await readJson<Record<string, ChannelLayout>>(chFile(), {})
  delete all[channel.toLowerCase()]
  await writeFileAtomic(chFile(), JSON.stringify(all, null, 1))
}

export type { NRect }
