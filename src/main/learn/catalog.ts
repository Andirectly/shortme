// Bewertungskatalog: lokal in <Daten>/learn/catalog.json, Abgleich mit einem privaten GitHub-Repo (Datei catalog.json) über die Contents-API.
// Kein git nötig; der Token liegt nur in der Windows-Anmeldeinformationsverwaltung (Ziel „Shortme/GitHub“).
import { readdir } from 'node:fs/promises'
import { hostname } from 'node:os'
import { loadMeta, projectsRoot } from '../shortme/project'
import { loadClips } from '../shortme/clips/analysis'
import { loadTranscript } from '../shortme/transcription'
import { loadRatings } from '../shortme/clips/feedback'
import { writeFileAtomic } from '../shortme/atomic'
import { secretDel, secretGet, secretSet } from '../twitch/token'
import { entryKey, parseCatalog, ratingCounts, sameEntries, syncEntries, videoKey, type CatalogEntries, type CatalogEntry, type CatalogStatus } from '../../shared/catalog'
import type { Level } from '../../shared/learn'
import { learnFile, notifyLearnChange, readJson } from './store'

const TOKEN_TARGET = 'Shortme/GitHub'
const FILE = 'catalog.json'
const REPO_RE = /^[\w.-]+\/[\w.-]+$/
const machine = hostname()

interface SyncConfig { repo: string; lastSync?: string; lastError?: string | null; backfilled?: boolean }
const cfgFile = (): string => learnFile('catalog-sync.json')
const loadCfg = (): Promise<SyncConfig> => readJson<SyncConfig>(cfgFile(), { repo: '' })
const saveCfg = (c: SyncConfig): Promise<void> => writeFileAtomic(cfgFile(), JSON.stringify(c, null, 1))

export const loadCatalog = async (): Promise<CatalogEntries> => parseCatalog(await readJson<unknown>(learnFile(FILE), null))
const saveCatalog = (e: CatalogEntries): Promise<void> => writeFileAtomic(learnFile(FILE), JSON.stringify({ version: 1, entries: e }, null, 1))

export async function catalogStatus(): Promise<CatalogStatus> {
  const [cfg, cat, token] = await Promise.all([loadCfg(), loadCatalog(), secretGet(TOKEN_TARGET)])
  const rated = Object.values(cat).filter((e) => e.level)
  return { configured: !!(token && cfg.repo), repo: cfg.repo, machine, entries: rated.length, fromOthers: rated.filter((e) => e.machine !== machine).length, counts: ratingCounts(cat), lastSync: cfg.lastSync ?? null, lastError: cfg.lastError ?? null }
}

/** Bewertung eines Clips in den Katalog schreiben (`null` = zurückgenommen) und einen Abgleich vormerken. */
export async function recordRating(hash: string, clipId: string, rating: { level: Level; reasons: string[] } | null, at = new Date().toISOString()): Promise<void> {
  const [meta, clips] = await Promise.all([loadMeta(hash), loadClips(hash)])
  const clip = clips?.clips.find((c) => c.id === clipId)
  if (!meta || !clip) return
  const tr = await loadTranscript(hash)
  const text = (tr?.words ?? []).filter((w) => w.start >= clip.start - 0.05 && w.end <= clip.end + 0.05).map((w) => w.w).join(' ').slice(0, 400)
  const video = videoKey({ hash, sourceUrl: meta.sourceUrl, twitch: meta.twitch })
  const key = entryKey(video, clip.start, clip.end)
  const entry: CatalogEntry = { key, video, videoTitle: meta.title, clipId, start: clip.start, end: clip.end, title: clip.title, text, criteria: clip.criteria, level: rating?.level ?? null, reasons: rating?.reasons ?? [], at, machine }
  const cat = await loadCatalog()
  // schon ein jüngerer Eintrag (z. B. von einem anderen Rechner)? Dann nichts überschreiben
  if (cat[key] && (cat[key].at > at || (!rating && !cat[key].level))) return
  await saveCatalog({ ...cat, [key]: entry })
  scheduleSync()
}

/** Einmalig: schon vorhandene Bewertungen aller Projekte eintragen. */
async function backfill(): Promise<void> {
  for (const h of await readdir(projectsRoot()).catch(() => [] as string[])) {
    const ratings = await loadRatings(h)
    for (const [id, r] of Object.entries(ratings)) await recordRating(h, id, r, r.at).catch((e) => console.error('Katalog', h, id, e))
  }
}

async function api(token: string, method: string, repo: string, body?: unknown, raw = false): Promise<Response> {
  return fetch(`https://api.github.com/repos/${repo}/contents/${FILE}`, {
    method, signal: AbortSignal.timeout(20_000), body: body ? JSON.stringify(body) : undefined,
    headers: { Authorization: `Bearer ${token}`, Accept: raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json', 'User-Agent': 'Shortme', 'X-GitHub-Api-Version': '2022-11-28', ...(body ? { 'Content-Type': 'application/json' } : {}) }
  })
}

const explain = (status: number): string => status === 401 ? 'Der Token wird von GitHub abgelehnt (abgelaufen oder falsch).' : status === 403 ? 'Keine Berechtigung: Der Token braucht „Contents: Read and write“ für dieses Repo.' : status === 404 ? 'Repo nicht gefunden (Name prüfen, Token muss Zugriff darauf haben).' : `GitHub meldet Fehler ${status}.`

/** Remote-Stand holen: Einträge und SHA (null = Datei gibt es noch nicht). */
async function pull(token: string, repo: string): Promise<{ entries: CatalogEntries; sha: string | null }> {
  const r = await api(token, 'GET', repo)
  if (r.status === 404) {
    // Datei fehlt noch ODER Repo/Token falsch: Repo selbst prüfen
    const repoRes = await fetch(`https://api.github.com/repos/${repo}`, { headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'Shortme' }, signal: AbortSignal.timeout(20_000) })
    if (!repoRes.ok) throw new Error(explain(repoRes.status))
    return { entries: {}, sha: null }
  }
  if (!r.ok) throw new Error(explain(r.status))
  const j = (await r.json()) as { sha: string; content?: string; size?: number }
  const content = j.content && j.size ? Buffer.from(j.content, 'base64').toString('utf8') : (j.size ? await (await api(token, 'GET', repo, undefined, true)).text() : '')
  return { entries: parseCatalog(content ? JSON.parse(content) : null), sha: j.sha }
}

let syncing: Promise<CatalogStatus> | null = null
let timer: ReturnType<typeof setTimeout> | null = null

/** Lokal und remote zusammenführen; bei Änderungen zurückschreiben (bei Konflikt einmal wiederholen). */
export function syncNow(): Promise<CatalogStatus> {
  return (syncing ??= (async () => {
    const cfg = await loadCfg()
    try {
      const token = await secretGet(TOKEN_TARGET)
      if (!token || !cfg.repo) throw new Error('Nicht verbunden.')
      if (!cfg.backfilled) { await backfill(); cfg.backfilled = true }
      const local = await loadCatalog()
      const repo = cfg.repo
      const { merged } = await syncEntries(local, {
        pull: () => pull(token, repo),
        push: async (entries, sha) => {
          const put = await api(token, 'PUT', repo, { message: `Abgleich ${machine}`, content: Buffer.from(JSON.stringify({ version: 1, entries }, null, 1)).toString('base64'), ...(sha ? { sha } : {}) })
          if (put.ok) return 'ok'
          if (put.status === 409 || put.status === 422) return 'conflict'
          throw new Error(explain(put.status))
        }
      })
      if (!sameEntries(merged, local)) { await saveCatalog(merged); notifyLearnChange() }
      await saveCfg({ ...cfg, lastSync: new Date().toISOString(), lastError: null })
    } catch (e) {
      await saveCfg({ ...cfg, lastError: e instanceof Error ? e.message : String(e) })
    }
    return catalogStatus()
  })().finally(() => { syncing = null }))
}

/** Abgleich einige Sekunden nach der letzten Bewertung (nur wenn verbunden). */
export function scheduleSync(delayMs = 60_000): void {
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => { timer = null; void catalogStatus().then(async (s) => { if (s.configured) await syncNow() }).catch(() => undefined) }, delayMs)
  timer.unref?.()
}

export async function connectCatalog(repo: string, token: string): Promise<CatalogStatus> {
  const r = repo.trim()
  if (!REPO_RE.test(r) || !token.trim()) throw new Error('Repo als „Besitzer/Name“ und Token eintragen.')
  await secretSet(TOKEN_TARGET, token.trim())
  await saveCfg({ repo: r, lastError: null })
  const st = await syncNow()
  if (st.lastError) { await secretDel(TOKEN_TARGET); await saveCfg({ repo: '' }); throw new Error(st.lastError) }
  return st
}

/** Trennen: Token entfernen, der lokale Katalog bleibt. */
export async function disconnectCatalog(): Promise<CatalogStatus> {
  await secretDel(TOKEN_TARGET)
  await saveCfg({ repo: '' })
  return catalogStatus()
}
