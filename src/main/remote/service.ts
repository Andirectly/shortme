/**
 * Remote Engine im Electron-Hauptprozess (Plan V4, Kap. 4): Einstellungen, P2P-Host, IPC, Tray, Login-Autostart.
 * Der Hauptprozess bleibt bei geschlossenem Fenster aktiv, solange „Im Hintergrund weiterlaufen“ an ist.
 */
import { app, BrowserWindow, ipcMain, Menu, nativeImage, safeStorage, Tray } from 'electron'
import { readFile } from 'node:fs/promises'
import { hostname } from 'node:os'
import { join } from 'node:path'
import { dataRoot } from '../engines/paths'
import { writeFileAtomic } from '../shortme/atomic'
import { RemoteHost, type PairRequest, type PeerStatus } from './host'
import { RemoteClient, RemoteWorker, type Net, type RemoteJobSettings } from './jobs'
import { realClientStore, realPipeline } from './pipeline'
import type { RemoteMessage } from '@shared/remote/protocol'
import { TrustStore, loadIdentity, type Sealer } from './trust'
import type { RemoteOverview, RemoteSettings } from '@shared/remote/ui'

const dir = (): string => join(dataRoot(), 'remote')
const settingsFile = (): string => join(dir(), 'settings.json')
const DEFAULTS = (): RemoteSettings => ({ enabled: false, startAtLogin: false, keepRunningInBackground: true, deviceName: hostname().slice(0, 80), relayKey: '' })

export async function loadRemoteSettings(): Promise<RemoteSettings> {
  try {
    const j = JSON.parse(await readFile(settingsFile(), 'utf8')) as Partial<RemoteSettings>
    const d = DEFAULTS()
    return {
      enabled: j.enabled === true,
      startAtLogin: j.startAtLogin === true,
      keepRunningInBackground: j.keepRunningInBackground !== false,
      deviceName: typeof j.deviceName === 'string' && j.deviceName.trim() ? j.deviceName.trim().slice(0, 80) : d.deviceName,
      relayKey: typeof j.relayKey === 'string' && /^[0-9a-f]{64}$/i.test(j.relayKey) ? j.relayKey.toLowerCase() : ''
    }
  } catch { return DEFAULTS() }
}

/**
 * Electron safeStorage (Keychain / DPAPI / libsecret). Unter Linux ohne Schlüsselring („basic_text“) gilt er als nicht verfügbar.
 * shortcut: Electron 35 hat nur die synchrone API; auf encryptStringAsync umstellen, sobald Electron ≥ der Version mit Async-API eingesetzt wird.
 */
const electronSealer: Sealer = {
  available: () => safeStorage.isEncryptionAvailable() && !(process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text'),
  seal: (s) => safeStorage.encryptString(s),
  open: (b) => safeStorage.decryptString(b)
}

let host: RemoteHost | null = null
let syncTimer: NodeJS.Timeout | null = null
let worker: RemoteWorker | null = null
let client: RemoteClient | null = null
let settings: RemoteSettings = DEFAULTS()
let error: RemoteOverview['error']
let invite: RemoteOverview['invite']
const pairRequests = new Map<string, PairRequest>()
let tray: Tray | null = null
let showWindow: () => void = () => undefined

export const keepRunningInBackground = (): boolean => settings.enabled && settings.keepRunningInBackground
/** Vom Login-Autostart versteckt gestartet? Dann kein Fenster öffnen. */
export const startedHidden = (): boolean => process.argv.includes('--hidden') || (process.platform === 'darwin' && app.getLoginItemSettings().wasOpenedAsHidden)

function overview(): RemoteOverview {
  const trust = trustStore
  return {
    settings,
    thisDevice: host ? { deviceId: host.deviceId, name: settings.deviceName, platform: process.platform } : null,
    error,
    invite,
    pairRequests: [...pairRequests.values()],
    jobs: (client?.list() ?? []).map((j) => {
      const clips = Object.values(j.clips)
      return {
        jobId: j.jobId, deviceId: j.deviceId, deviceName: trust?.get(j.deviceId)?.name ?? j.deviceId.slice(0, 8), url: j.url, title: j.title, createdAt: j.createdAt,
        compute: j.rejected ? 'rejected' : j.compute ?? (j.accepted ? 'accepted' : 'sending'), stage: j.stage, progress: j.progress, lastUpdateAt: j.lastUpdateAt, rejected: j.rejected,
        workerOnline: !!host?.isOnline(j.deviceId), projectHash: j.projectHash, projectImported: !!j.projectImported,
        bundleDone: Object.values(j.bundle).filter((b) => b.done).length, bundleTotal: j.bundleTotal,
        clipsReady: clips.filter((c) => c.ready).length, clipsPending: clips.filter((c) => !c.ready).length
      }
    }),
    workerJobs: (worker?.list() ?? []).map((j) => ({ jobId: j.request.jobId, from: trust?.get(j.origin)?.name ?? j.origin.slice(0, 8), url: j.request.source.kind === 'url' ? j.request.source.url : '', compute: j.compute, stage: j.stage, error: j.error?.message, published: j.published.length, pendingOffers: j.offers.filter((o) => !o.acked).length, updatedAt: j.updatedAt })),
    devices: (trust?.list() ?? []).filter((p) => !p.revokedAt).map((p) => {
      const s = host?.status(p.deviceId)
      return { deviceId: p.deviceId, name: p.name, platform: p.platform, pairedAt: p.pairedAt, permissions: p.permissions, connectivity: s?.connectivity ?? (p.revokedByPeerAt ? 'revoked' : 'offline'), route: s?.route ?? 'unknown', lastSeenAt: s?.lastSeenAt ?? p.lastSeenAt }
    })
  }
}

let broadcastTimer: NodeJS.Timeout | null = null
/** Häufige Fortschrittsereignisse bündeln (höchstens ~4×/s an die Fenster). */
function broadcastSoon(): void {
  if (broadcastTimer) return
  broadcastTimer = setTimeout(() => { broadcastTimer = null; broadcast() }, 250)
}

function broadcast(): void {
  const o = overview()
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send('remote:overview', o)
  updateTray(o)
}

let trustStore: TrustStore | null = null

async function startHost(): Promise<void> {
  if (host) return
  error = undefined
  try {
    const keys = await loadIdentity(dir(), electronSealer)
    trustStore = await new TrustStore(join(dir(), 'trust.json')).load()
    const h = new RemoteHost({ keys, name: settings.deviceName, platform: process.platform, trust: trustStore, relay: settings.relayKey ? Buffer.from(settings.relayKey, 'hex') : null })
    const net: Net = { deviceId: keys.deviceId, send: (id, body) => h.send(id, body as never), driveChannel: (id, t) => h.driveChannel(id, t), isOnline: (id) => h.isOnline(id) }
    const root = dir()
    worker = new RemoteWorker(root, net, realPipeline)
    client = new RemoteClient(root, net, realClientStore((hash) => { for (const w of BrowserWindow.getAllWindows()) w.webContents.send('remote:projectImported', hash); broadcast() }))
    await Promise.all([worker.load(), client.load()])
    worker.on('changed', broadcastSoon)
    client.on('changed', broadcastSoon)
    h.on('message', (from: string, m: RemoteMessage) => { void worker?.onMessage(from, m); void client?.onMessage(from, m) })
    h.on('status', (s: PeerStatus) => {
      // Nach Wiederverbindung: Stand austauschen, Outbox nachliefern, nicht angenommene Aufträge erneut senden
      if (s.connectivity === 'online-direct' || s.connectivity === 'online-relay') { worker?.resend(s.deviceId); client?.reconnected(s.deviceId) }
      broadcast()
    })
    h.on('pair-request', (r: PairRequest) => { pairRequests.set(r.deviceId, r); broadcast(); showWindow() })
    h.on('paired', (id: string) => { pairRequests.delete(id); invite = undefined; broadcast() })
    h.on('pair-declined', (id: string) => { pairRequests.delete(id); broadcast() })
    h.on('protocol-error', (id: string, e: Error) => console.warn('[remote] Protokollfehler von', id.slice(0, 8), e.message))
    await h.start()
    host = h
    // Abgleich alle 30 s: einzelne Steuernachrichten können bei einem Verbindungswechsel verloren gehen (Worker liefert
    // unquittierte Angebote nach, Client sendet nicht angenommene Aufträge erneut; beide Seiten deduplizieren)
    syncTimer = setInterval(() => {
      for (const p of trustStore?.list() ?? []) if (h.isOnline(p.deviceId)) { worker?.resend(p.deviceId); client?.reconnected(p.deviceId) }
    }, 30_000)
  } catch (e) {
    const err = e as Error & { code?: string }
    error = { code: err.code ?? 'REMOTE_START_FAILED', message: err.message }
    console.error('[remote] Start fehlgeschlagen:', err.message)
  }
}

async function stopHost(): Promise<void> {
  const h = host
  host = null
  if (syncTimer) clearInterval(syncTimer)
  syncTimer = null
  worker?.removeAllListeners()
  client?.removeAllListeners()
  client?.stop()
  worker = null
  client = null
  invite = undefined
  pairRequests.clear()
  await h?.stop().catch(() => undefined)
}

function applyLoginItem(): void {
  if (!app.isPackaged) return // Entwicklung: keinen Autostart für electron.exe eintragen
  app.setLoginItemSettings({ openAtLogin: settings.enabled && settings.startAtLogin, openAsHidden: true, args: ['--hidden'] })
}

function updateTray(o: RemoteOverview): void {
  if (!keepRunningInBackground()) { tray?.destroy(); tray = null; return }
  if (!tray) {
    const icon = nativeImage.createFromPath(app.isPackaged ? join(process.resourcesPath, 'icon.png') : join(app.getAppPath(), 'build/icon.png')).resize({ width: 16, height: 16 })
    tray = new Tray(icon)
    tray.on('click', () => showWindow())
  }
  const online = o.devices.filter((d) => d.connectivity === 'online-direct' || d.connectivity === 'online-relay').length
  const state = o.thisDevice ? `Remote-Worker aktiv · ${online}/${o.devices.length} Geräte online` : `Remote-Worker nicht verbunden${o.error ? ` (${o.error.message})` : ''}`
  tray.setToolTip(`Shortme – ${state}`)
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: state, enabled: false },
    { type: 'separator' },
    { label: 'Shortme öffnen', click: () => showWindow() },
    { label: 'Worker beenden', click: () => app.quit() }
  ]))
}

async function applySettings(next: RemoteSettings): Promise<void> {
  const restart = next.enabled !== settings.enabled || next.deviceName !== settings.deviceName || next.relayKey !== settings.relayKey
  settings = next
  applyLoginItem()
  if (restart) { await stopHost(); if (settings.enabled) await startHost() }
  broadcast()
}

export async function initRemote(opts: { showWindow: () => void }): Promise<void> {
  showWindow = opts.showWindow
  settings = await loadRemoteSettings()
  applyLoginItem()

  ipcMain.handle('remote:overview', () => overview())
  ipcMain.handle('remote:setSettings', async (_e, patch: Partial<RemoteSettings>) => {
    const merged = { ...settings, ...patch }
    await writeFileAtomic(settingsFile(), JSON.stringify(merged, null, 2))
    await applySettings(await loadRemoteSettings()) // gleiche Validierung wie beim Laden
    return overview()
  })
  const need = (): RemoteHost => { if (!host) throw new Error('Remote-Worker ist nicht aktiv'); return host }
  ipcMain.handle('remote:createInvite', async () => { invite = await need().createInvite(); broadcast(); return overview() })
  ipcMain.handle('remote:acceptInvite', async (_e, code: string) => { await need().acceptInvite(String(code)); return overview() })
  ipcMain.handle('remote:cancelInvite', () => { host?.cancelInvite(); invite = undefined; pairRequests.clear(); broadcast(); return overview() })
  ipcMain.handle('remote:confirmPairing', async (_e, deviceId: string, accept: boolean) => { await need().confirmPairing(String(deviceId), accept === true); if (!accept) pairRequests.delete(deviceId); broadcast(); return overview() })
  ipcMain.handle('remote:unpair', async (_e, deviceId: string) => { await need().unpair(String(deviceId)); broadcast(); return overview() })
  ipcMain.handle('remote:testConnection', async (_e, deviceId: string) => {
    const t0 = Date.now()
    const ok = await need().ping(String(deviceId))
    return { ok, ms: ok ? Date.now() - t0 : null, route: host?.status(String(deviceId)).route ?? 'unknown' }
  })

  ipcMain.handle('remote:submitUrl', async (_e, deviceId: string, url: string, opts: RemoteJobSettings) => {
    if (!client || !trustStore?.isTrusted(String(deviceId))) throw new Error('Gerät ist nicht gekoppelt oder der Remote-Worker ist aus')
    if (!host?.isOnline(String(deviceId))) throw new Error('Das Gerät ist gerade nicht erreichbar. Bitte dort Shortme starten und erneut versuchen.')
    const j = await client.submit(String(deviceId), String(url).trim(), opts ?? {})
    broadcast()
    return j.jobId
  })
  ipcMain.handle('remote:cancelJob', (_e, jobId: string) => client?.cancel(String(jobId)) ?? false)
  ipcMain.handle('remote:forgetJob', async (_e, jobId: string) => { await client?.forget(String(jobId)); broadcast(); return overview() })

  if (settings.enabled) await startHost()
  broadcast()
  app.on('before-quit', () => { void stopHost() })
}
