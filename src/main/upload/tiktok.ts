// TikTok (Content Posting API, Modus Entwurf: /v2/post/publish/inbox/video/init/, Berechtigung video.upload).
// Anmeldung: Login Kit für Desktop – System-Browser, PKCE, Rückleitung http://localhost:8902/. Nur offizielle Schnittstellen.
import { createHash, randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import { open, stat } from 'node:fs/promises'
import { extname } from 'node:path'
import { shell } from 'electron'
import { secretDel, secretGet, secretSet } from '../twitch/token'
import { checkTikTokFile, planChunks, type ChunkPlan, type PlatformStatus } from '../../shared/upload'
import type { Platform, PlatformVideoStat } from './platform'
import { runUpload, type PutResult } from './tiktokUpload'

const API = 'https://open.tiktokapis.com'
export const REDIRECT = 'http://localhost:8902/'
const SCOPES = 'user.info.basic,video.upload,video.list'
const APP_KEY = 'Shortme/TikTok/app'
const TOKEN_KEY = 'Shortme/TikTok/token'

interface AppCreds { key: string; secret: string; /** TikTok-Doku nennt Hex, Standard wäre Base64url – beim Fehlschlag wird umgeschaltet. */ pkce?: 'hex' | 'b64' }
interface Tokens { access: string; refresh: string; accessUntil: number; refreshUntil: number; openId: string; name?: string }

const getJson = async <T>(k: string): Promise<T | null> => { const s = await secretGet(k); try { return s ? (JSON.parse(s) as T) : null } catch { return null } }
export const saveAppCreds = (c: AppCreds): Promise<string> => secretSet(APP_KEY, JSON.stringify({ ...c, key: c.key.trim(), secret: c.secret.trim() }))

/** Verständliche Meldungen zu TikTok-Fehlercodes. */
export function explain(code: string, message = ''): string {
  const m: Record<string, string> = {
    spam_risk_too_many_pending_share: 'In deiner TikTok-App liegen schon zu viele offene Entwürfe. Poste oder lösche erst welche.',
    access_token_invalid: 'Die Verbindung zu TikTok ist abgelaufen. Bitte neu verbinden.',
    scope_not_authorized: 'Für diese Aktion fehlt eine Berechtigung. Bitte TikTok neu verbinden und alle Häkchen setzen.',
    rate_limit_exceeded: 'Zu viele Anfragen an TikTok. Bitte in einer Minute noch mal versuchen.',
    invalid_param: `TikTok hat die Angaben abgelehnt${message ? ` (${message})` : ''}.`,
    url_ownership_unverified: 'TikTok konnte die Adresse nicht prüfen.'
  }
  return m[code] ?? `TikTok meldet: ${message || code}`
}

async function post(path: string, token: string | null, body: unknown, form = false): Promise<Record<string, unknown>> {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'content-type': form ? 'application/x-www-form-urlencoded' : 'application/json; charset=UTF-8', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: form ? new URLSearchParams(body as Record<string, string>).toString() : JSON.stringify(body)
  })
  const text = await res.text()
  try { return JSON.parse(text) as Record<string, unknown> } catch { throw new Error(`TikTok antwortet unerwartet (HTTP ${res.status}).`) }
}

const challenge = (verifier: string, mode: 'hex' | 'b64'): string => { const h = createHash('sha256').update(verifier); return mode === 'hex' ? h.digest('hex') : h.digest('base64url') }

function waitForCode(state: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const srv = createServer((req, res) => {
      const u = new URL(req.url ?? '/', REDIRECT)
      const code = u.searchParams.get('code')
      const err = u.searchParams.get('error')
      if (!code && !err) { res.writeHead(404).end(); return }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(`<!doctype html><meta charset="utf-8"><title>Shortme</title><body style="font:16px system-ui;background:#111;color:#eee;display:grid;place-items:center;height:100vh"><p>${code && u.searchParams.get('state') === state ? 'Verbunden. Du kannst dieses Fenster schließen.' : 'Anmeldung abgebrochen.'}</p>`)
      clearTimeout(timer); srv.close()
      if (err) reject(new Error('Anmeldung bei TikTok abgebrochen.'))
      else if (u.searchParams.get('state') !== state) reject(new Error('Anmeldung ungültig (State stimmt nicht).'))
      else resolve(code!)
    })
    const timer = setTimeout(() => { srv.close(); reject(new Error('Keine Anmeldung innerhalb von 3 Minuten.')) }, 180_000)
    srv.on('error', (e: NodeJS.ErrnoException) => { clearTimeout(timer); reject(new Error(e.code === 'EADDRINUSE' ? 'Port 8902 ist belegt. Bitte Shortme neu starten.' : e.message)) })
    srv.listen(8902, '127.0.0.1')
  })
}

async function storeTokens(r: Record<string, unknown>, prevName?: string): Promise<Tokens> {
  if (typeof r.access_token !== 'string') throw new Error(`Anmeldung fehlgeschlagen: ${String(r.error_description ?? r.error ?? 'unbekannt')}`)
  const now = Date.now()
  const t: Tokens = { access: r.access_token, refresh: String(r.refresh_token), accessUntil: now + Number(r.expires_in) * 1000, refreshUntil: now + Number(r.refresh_expires_in) * 1000, openId: String(r.open_id ?? ''), name: prevName }
  await secretSet(TOKEN_KEY, JSON.stringify(t))
  return t
}

/** Gültiger Zugriffstoken; erneuert automatisch, bei abgelaufener Erneuerung verständliche Meldung. */
async function accessToken(): Promise<string> {
  const t = await getJson<Tokens>(TOKEN_KEY)
  if (!t) throw new Error('TikTok ist nicht verbunden.')
  if (t.accessUntil - Date.now() > 60_000) return t.access
  if (t.refreshUntil < Date.now()) throw new Error('Die Verbindung zu TikTok ist abgelaufen. Bitte neu verbinden.')
  const app = await getJson<AppCreds>(APP_KEY)
  if (!app) throw new Error('TikTok-Zugangsdaten fehlen.')
  const r = await post('/v2/oauth/token/', null, { client_key: app.key, client_secret: app.secret, grant_type: 'refresh_token', refresh_token: t.refresh }, true)
  if (typeof r.access_token !== 'string') throw new Error('Die Verbindung zu TikTok ist abgelaufen. Bitte neu verbinden.')
  return (await storeTokens(r, t.name)).access
}

async function api(path: string, body: unknown): Promise<Record<string, unknown>> {
  const r = await post(path, await accessToken(), body)
  const e = r.error as { code?: string; message?: string } | undefined
  if (e?.code && e.code !== 'ok') throw new Error(explain(e.code, e.message))
  return (r.data ?? {}) as Record<string, unknown>
}

const MIME: Record<string, string> = { '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm' }

async function putChunk(url: string, path: string, plan: ChunkPlan, i: number): Promise<PutResult> {
  const [a, b] = plan.ranges[i]
  const buf = Buffer.alloc(b - a + 1)
  const fh = await open(path, 'r')
  try { await fh.read(buf, 0, buf.length, a) } finally { await fh.close() }
  const res = await fetch(url, { method: 'PUT', headers: { 'content-type': MIME[extname(path).toLowerCase()] ?? 'video/mp4', 'content-length': String(buf.length), 'content-range': `bytes ${a}-${b}/${plan.videoSize}` }, body: buf })
  const m = /bytes\s+\d+-(\d+)\//.exec(res.headers.get('content-range') ?? '')
  return { status: res.status, received: m ? Number(m[1]) : undefined }
}

async function waitForInbox(publishId: string, signal?: AbortSignal): Promise<string> {
  for (let i = 0; i < 20; i++) {
    signal?.throwIfAborted()
    const d = await api('/v2/post/publish/status/fetch/', { publish_id: publishId })
    const s = String(d.status ?? '')
    if (s === 'SEND_TO_USER_INBOX' || s === 'PUBLISH_COMPLETE') return 'Entwurf in deiner TikTok-App'
    if (s === 'FAILED') throw new Error(`TikTok konnte das Video nicht verarbeiten (${String(d.fail_reason ?? 'unbekannt')}).`)
    await new Promise((r) => setTimeout(r, 3000))
  }
  return 'Hochgeladen, TikTok verarbeitet noch'
}

export const tiktok: Platform = {
  id: 'tiktok',
  name: 'TikTok',
  async status(): Promise<PlatformStatus> {
    const base = { id: 'tiktok' as const, name: 'TikTok', available: true }
    const app = await getJson<AppCreds>(APP_KEY)
    if (!app?.key || !app.secret) return { ...base, connected: false, needsSetup: true }
    const t = await getJson<Tokens>(TOKEN_KEY)
    if (!t) return { ...base, connected: false }
    if (t.refreshUntil < Date.now()) return { ...base, connected: false, message: 'Verbindung abgelaufen, bitte neu verbinden.' }
    return { ...base, connected: true, account: t.name }
  },
  async connect(): Promise<void> {
    const app = await getJson<AppCreds>(APP_KEY)
    if (!app?.key || !app.secret) throw new Error('Bitte erst Client key und Client secret eintragen.')
    const mode = app.pkce ?? 'hex'
    const verifier = randomBytes(48).toString('base64url')
    const state = randomBytes(16).toString('hex')
    const url = `https://www.tiktok.com/v2/auth/authorize/?${new URLSearchParams({ client_key: app.key, response_type: 'code', scope: SCOPES, redirect_uri: REDIRECT, state, code_challenge: challenge(verifier, mode), code_challenge_method: 'S256' })}`
    const wait = waitForCode(state)
    wait.catch(() => undefined)
    await shell.openExternal(url)
    const code = await wait
    const r = await post('/v2/oauth/token/', null, { client_key: app.key, client_secret: app.secret, code: decodeURIComponent(code), grant_type: 'authorization_code', redirect_uri: REDIRECT, code_verifier: verifier }, true)
    if (typeof r.access_token !== 'string') {
      // Verschlüsselung der PKCE-Prüfsumme wechseln; der nächste Versuch nutzt die andere Schreibweise
      await saveAppCreds({ ...app, pkce: mode === 'hex' ? 'b64' : 'hex' })
      throw new Error(`TikTok hat die Anmeldung abgelehnt (${String(r.error_description ?? r.error ?? 'unbekannt')}). Bitte noch einmal auf Verbinden klicken.`)
    }
    const t = await storeTokens(r)
    try {
      const u = await fetch(`${API}/v2/user/info/?fields=display_name`, { headers: { authorization: `Bearer ${t.access}` } })
      const name = ((await u.json()) as { data?: { user?: { display_name?: string } } }).data?.user?.display_name
      if (name) await secretSet(TOKEN_KEY, JSON.stringify({ ...t, name }))
    } catch { /* Name ist nur Anzeige */ }
  },
  async disconnect(): Promise<void> {
    const t = await getJson<Tokens>(TOKEN_KEY)
    const app = await getJson<AppCreds>(APP_KEY)
    if (t && app) await post('/v2/oauth/revoke/', null, { client_key: app.key, client_secret: app.secret, token: t.access }, true).catch(() => undefined)
    await secretDel(TOKEN_KEY)
  },
  check: checkTikTokFile,
  async upload(job, path, report, signal): Promise<void> {
    const size = (await stat(path)).size
    const plan = planChunks(size)
    const resume = job.uploadUrl && job.publishId && job.initAt !== undefined ? { publishId: job.publishId, uploadUrl: job.uploadUrl, initAt: job.initAt, chunksDone: job.chunksDone ?? 0 } : undefined
    const done = await runUpload(plan, resume, {
      init: async (p) => {
        const d = await api('/v2/post/publish/inbox/video/init/', { source_info: { source: 'FILE_UPLOAD', video_size: p.videoSize, chunk_size: p.chunkSize, total_chunk_count: p.total } })
        return { publishId: String(d.publish_id), uploadUrl: String(d.upload_url) }
      },
      put: (url, p, i) => { signal?.throwIfAborted(); return putChunk(url, path, p, i) },
      now: Date.now,
      sleep: (ms) => new Promise((r) => setTimeout(r, ms))
    }, (s) => report({ publishId: s.publishId, uploadUrl: s.uploadUrl, initAt: s.initAt, chunksDone: s.chunksDone, progress: s.chunksDone / plan.total * 0.95, message: `Lädt hoch (${s.chunksDone}/${plan.total})` }))
    await report({ message: 'TikTok verarbeitet …', progress: 0.97 })
    await report({ state: 'entwurf', progress: 1, message: await waitForInbox(done.publishId, signal) })
  },
  /** Teil 3 (nicht aktiviert): Aufrufzahlen über die Display API (video.list). */
  async fetchStats(): Promise<PlatformVideoStat[]> {
    const token = await accessToken()
    const res = await fetch(`${API}/v2/video/list/?fields=id,video_description,create_time,view_count,like_count,comment_count,share_count`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ max_count: 20 }) })
    const j = (await res.json()) as { data?: { videos?: Array<Record<string, unknown>> } }
    return (j.data?.videos ?? []).map((v) => ({ id: String(v.id), description: String(v.video_description ?? ''), createdAt: Number(v.create_time) * 1000, views: Number(v.view_count ?? 0), likes: Number(v.like_count ?? 0), comments: Number(v.comment_count ?? 0), shares: Number(v.share_count ?? 0) }))
  }
}
