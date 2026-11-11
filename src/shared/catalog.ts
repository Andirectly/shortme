// Bewertungskatalog: Bewertungen (stark/mittel/schlecht + Gründe) aller Rechner in einer Datei, die über ein privates GitHub-Repo abgeglichen wird.
// Eintrag je Clip; beim Zusammenführen gewinnt die jüngere Bewertung (`at`). Zurückgenommene Bewertungen bleiben als `level: null` stehen,
// damit sie auch auf den anderen Rechnern verschwinden.
import type { Level } from './learn'
import { splitOf, type CandRecord } from './learnData'

export interface CatalogEntry {
  key: string
  /** Stabiler Video-Schlüssel (siehe `videoKey`), unabhängig vom Rechner. */
  video: string
  videoTitle: string
  clipId: string
  start: number
  end: number
  title: string
  /** Anfang des Clip-Textes (zum späteren Lernen auf Rechnern ohne das Video). */
  text: string
  criteria: { hook: number; payoff: number; quotable: number; standalone: number; density: number } | null
  level: Level | null
  reasons: string[]
  at: string
  machine: string
}
export type CatalogEntries = Record<string, CatalogEntry>

export interface CatalogStatus {
  configured: boolean
  repo: string
  machine: string
  entries: number
  /** Bewertungen von anderen Rechnern. */
  fromOthers: number
  counts: Record<Level, number>
  lastSync: string | null
  lastError: string | null
}
export interface CatalogFile { version: 1; entries: CatalogEntries }

/** Gleiches Video auf mehreren Rechnern = gleicher Schlüssel (Datei-Hash passt nicht, wenn derselbe Link zweimal geladen wird). */
export function videoKey(m: { hash: string; sourceUrl?: string; twitch?: { vodId?: string | null } | null }): string {
  if (m.twitch?.vodId) return `twitch:${m.twitch.vodId}`
  const u = m.sourceUrl?.trim()
  if (u) {
    const yt = u.match(/(?:youtu\.be\/|[?&]v=|\/shorts\/|\/live\/)([\w-]{11})/)
    if (yt) return `yt:${yt[1]}`
    return `url:${u.replace(/[?#].*$/, '').toLowerCase()}`
  }
  return `file:${m.hash}`
}

export const entryKey = (video: string, start: number, end: number): string => `${video}|${Math.round(start * 10)}-${Math.round(end * 10)}`

/** Zusammenführen: je Schlüssel gewinnt der jüngere Eintrag, bei Gleichstand `a`. */
export function mergeEntries(a: CatalogEntries, b: CatalogEntries): CatalogEntries {
  const out: CatalogEntries = { ...a }
  for (const [k, e] of Object.entries(b)) if (!out[k] || e.at > out[k].at) out[k] = e
  return out
}

export const sameEntries = (a: CatalogEntries, b: CatalogEntries): boolean => {
  const ka = Object.keys(a)
  return ka.length === Object.keys(b).length && ka.every((k) => b[k] && b[k].at === a[k].at && b[k].level === a[k].level)
}

/** Datei prüfen: nur gültige Einträge übernehmen (fremde Datei = Vertrauensgrenze). */
export function parseCatalog(raw: unknown): CatalogEntries {
  const out: CatalogEntries = {}
  const entries = (raw as { entries?: Record<string, unknown> } | null)?.entries
  if (!entries || typeof entries !== 'object') return out
  for (const [k, v] of Object.entries(entries)) {
    const e = v as Partial<CatalogEntry> | null
    if (!e || typeof e.video !== 'string' || typeof e.at !== 'string' || !Number.isFinite(e.start) || !Number.isFinite(e.end)) continue
    if (e.level !== null && e.level !== 'strong' && e.level !== 'mid' && e.level !== 'bad') continue
    out[k] = { key: k, video: e.video, videoTitle: String(e.videoTitle ?? ''), clipId: String(e.clipId ?? ''), start: e.start as number, end: e.end as number, title: String(e.title ?? ''), text: String(e.text ?? '').slice(0, 400), criteria: e.criteria ?? null, level: e.level, reasons: Array.isArray(e.reasons) ? e.reasons.map(String).slice(0, 8) : [], at: e.at, machine: String(e.machine ?? '') }
  }
  return out
}

/** Bewertungen von Videos, die es lokal nicht gibt, als Datensatz-Zeilen (gehen in Zähler, Muster und Paare des Lernbereichs ein). */
export function remoteCandidates(entries: CatalogEntries, localVideos: Set<string>): CandRecord[] {
  return Object.values(entries).filter((e) => e.level && !localVideos.has(e.video)).map((e) => {
    const vid = `cat:${e.video}`
    return { id: `cat:${e.key}`, vid, source: 'shortme' as const, contentType: null, start: e.start, end: e.end, transcript: e.text, marks: [], rubric: e.criteria, heat: null, rating: { level: e.level!, reasons: e.reasons }, corrections: null, exported: false, playedSec: 0, fate: 'rated', split: splitOf(vid) }
  })
}

export interface Remote {
  pull(): Promise<{ entries: CatalogEntries; sha: string | null }>
  /** `conflict` = der Stand auf dem Server hat sich inzwischen geändert (SHA passt nicht mehr). */
  push(entries: CatalogEntries, sha: string | null): Promise<'ok' | 'conflict'>
}

/** Abgleich: Remote holen, zusammenführen, bei Änderungen zurückschreiben; bei Konflikt (anderer Rechner war schneller) einmal wiederholen. */
export async function syncEntries(local: CatalogEntries, remote: Remote): Promise<{ merged: CatalogEntries; pushed: boolean }> {
  let cur = local
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await remote.pull()
    cur = mergeEntries(cur, r.entries)
    if (sameEntries(cur, r.entries)) return { merged: cur, pushed: false }
    if ((await remote.push(cur, r.sha)) === 'ok') return { merged: cur, pushed: true }
  }
  throw new Error('Abgleich kollidierte zweimal mit einem anderen Rechner, später erneut versuchen.')
}

export function ratingCounts(entries: CatalogEntries): Record<Level, number> {
  const c: Record<Level, number> = { strong: 0, mid: 0, bad: 0 }
  for (const e of Object.values(entries)) if (e.level) c[e.level]++
  return c
}
