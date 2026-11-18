import { app, BrowserWindow, ipcMain, dialog } from 'electron'
import { join } from 'node:path'
import type { AssetStatus, CheckItem, HardwareInfo } from '@shared/engines'
import { AssetManager } from './manager'
import { CATALOG } from './catalog'
import { detectHardware } from './hardware'
import { LlamaServer, cleanupStale, killAllSidecars, liveSidecars } from './sidecars'
import { VramSequencer } from './vram'
import { runSystemCheck } from './systemcheck'
import { assetDir, dataRoot } from './paths'
import { ensureYtDlp } from '../pipeline/ytdlp'
import { ensureTool } from '../twitch/tools'

export const assets = new AssetManager()
export const llama = new LlamaServer()
export const vram = new VramSequencer()

let hwCache: HardwareInfo | null = null
export async function hardware(refresh = false): Promise<HardwareInfo> {
  if (!hwCache || refresh) hwCache = await detectHardware(dataRoot())
  return hwCache
}

// ASR läuft pro Auftrag in eigenem Prozess (asr/client.ts); als Resident sorgt er nur dafür, dass das LLM entladen ist.
/** Zeitweise anderes LLM (Testlab-Vergleich) – null = das empfohlene/aktive Modell. */
let llmOverride: string | null = null
vram.register({
  name: 'llm',
  load: async () => {
    const hw = await hardware()
    const id = llmOverride ?? hw.recommendedLlm
    const spec = CATALOG.find((c) => c.id === id)!
    // Das große Modell braucht den KV-Cache in q8 (16k Kontext in ca. 21 GB), kleine Karten sowieso
    const mm = spec.expect.find((e) => e.startsWith('mmproj'))
    await llama.start({ model: join(assetDir(id), spec.expect[0]), kvQuant: hw.kvQuant || id === 'qwen3-8-27b', ...(mm ? { mmproj: join(assetDir(id), mm), ctx: 8192 } : {}) })
  },
  unload: () => llama.stop()
})
// ASR-Stufe verlangt, dass das LLM entladen ist; LLM-Stufe entlädt ASR (hier nur Logik, ASR-Prozess endet selbst).
vram.register({ name: 'asr', load: async () => llama.stop(), unload: async () => undefined })

/** Exklusiv: LLM-Stufe (llama-server geladen, ASR nicht im VRAM). */
export const withLlm = <T>(fn: (baseUrl: string) => Promise<T>): Promise<T> => vram.use('llm', () => fn(llama.baseUrl!))
/** Wie withLlm, aber mit einem bestimmten LLM-Asset (Testlab); danach wird wieder das empfohlene Modell geladen. */
export async function withLlmModel<T>(assetId: string, fn: (baseUrl: string) => Promise<T>): Promise<T> {
  llmOverride = assetId
  // Der Sequencer merkt sich das geladene LLM: erst entladen, sonst bliebe ein zuvor gestartetes anderes Modell oder ein beendeter Server im Spiel
  await vram.releaseAll()
  try { return await withLlm(fn) } finally { llmOverride = null; await vram.releaseAll() }
}
/**
 * Neue Engine: Bild- und Audiomodell als eigene Residenten im selben Sequencer (kein zweiter GPU-Lock). Jede Modellphase erwirbt die Ressource selbst;
 * `use()` entlädt vorher LLM/ASR/das andere Modell. Nicht aus einem `withLlm`-Callback heraus aufrufen (würde auf sich selbst warten).
 */
const mmResident = (name: string, assetId: string, ctx: number): void => {
  vram.register({
    name,
    load: async () => {
      const spec = CATALOG.find((c) => c.id === assetId)
      if (!spec) throw new Error(`Modell nicht im Katalog: ${assetId}`)
      if (!(await assets.isInstalled(assetId))) throw new Error(`Modell fehlt: ${spec.name}`)
      const hw = await hardware()
      const mm = spec.expect.find((e) => e.startsWith('mmproj'))
      await llama.start({ model: join(assetDir(assetId), spec.expect[0]), ctx, kvQuant: hw.kvQuant, ...(mm ? { mmproj: join(assetDir(assetId), mm) } : {}) })
    },
    unload: () => llama.stop()
  })
}
mmResident('v2-vision', 'qwen3-vl-4b', 16384)
mmResident('v2-audio', 'voxtral-mini-3b', 8192)
export const withVision = <T>(fn: (baseUrl: string) => Promise<T>): Promise<T> => vram.use('v2-vision', () => fn(llama.baseUrl!))
export const withAudio = <T>(fn: (baseUrl: string) => Promise<T>): Promise<T> => vram.use('v2-audio', () => fn(llama.baseUrl!))

/** Exklusiv: ASR-Stufe (llama-server wird vorher entladen). */
export const withAsr = <T>(fn: () => Promise<T>): Promise<T> => vram.use('asr', fn)

export async function systemCheck(): Promise<CheckItem[]> {
  return runSystemCheck(assets, await hardware(true))
}

export function registerEngineIpc(): void {
  const broadcast = (channel: string, payload: unknown): void => { for (const w of BrowserWindow.getAllWindows()) w.webContents.send(channel, payload) }
  assets.on('status', (s: AssetStatus) => broadcast('engines:status', s))

  ipcMain.handle('engines:catalog', () => CATALOG)
  ipcMain.handle('engines:hardware', (_e, refresh?: boolean) => hardware(refresh))
  ipcMain.handle('engines:list', () => assets.list())
  ipcMain.handle('engines:install', (_e, id: string) => assets.install(id).catch(() => undefined))
  ipcMain.handle('engines:pause', (_e, id: string) => assets.pause(id))
  ipcMain.handle('engines:cancel', (_e, id: string) => assets.cancel(id))
  ipcMain.handle('engines:check', () => systemCheck())
  ipcMain.handle('engines:ytdlp', async () => { await ensureYtDlp(() => undefined) })
  ipcMain.handle('engines:importFolder', async () => {
    const r = await dialog.showOpenDialog({ properties: ['openDirectory'], title: 'Ordner mit Modelldateien wählen' })
    if (r.canceled || !r.filePaths[0]) return null
    return assets.importFolder(r.filePaths[0])
  })
  /** Assistent: alles Empfohlene (Reihenfolge: klein → groß), fortsetzbar. */
  ipcMain.handle('engines:installRecommended', () => installRecommended())
  // Einrichtung schon begonnen (mind. ein Modell da), aber unvollständig (Abbruch, App beendet) → beim Start still weiterladen
  void (async () => {
    const ids = await recommendedIds()
    const have = await Promise.all(ids.map((id) => assets.isInstalled(id)))
    if (have.some(Boolean) && !have.every(Boolean)) await installRecommended()
  })().catch(() => undefined)
}

const recommendedIds = async (): Promise<string[]> =>
  ['silero-vad', 'transnetv2', 'yolov8n-pose', 'face-embed', 'yamnet', 'llama-server', 'node-runtime', 'speaker-segmentation', 'speaker-embedding', 'parakeet-v3', (await hardware()).recommendedLlm]

let installing: Promise<AssetStatus[]> | null = null
/** Alles Empfohlene der Reihe nach installieren (fortsetzbar; ein Lauf zur Zeit). */
function installRecommended(): Promise<AssetStatus[]> {
  return (installing ??= (async () => {
    for (const id of await recommendedIds()) {
      // Netzabbrüche bei großen Modellen: bis zu 5 Versuche, der Download setzt an der .part-Datei fort
      for (let i = 0; i < 5 && !(await assets.isInstalled(id)); i++) {
        await assets.install(id).catch(() => undefined)
        const st = (await assets.list()).find((x) => x.id === id)?.state
        if (st === 'paused' || st === 'missing') break // vom Nutzer pausiert/abgebrochen → nicht erzwingen
        if (st !== 'installed') await new Promise((r) => setTimeout(r, 5000))
      }
    }
    await ensureYtDlp(() => undefined).catch(() => undefined)
    if (process.platform === 'darwin') await ensureTool('streamlink').catch(() => undefined) // kein portables Mac-Release → gleich mit einrichten
    return assets.list()
  })().finally(() => { installing = null }))
}

/** Kindprozesse sauber beenden; muss vor `app.quit()` fertig sein. */
export function installEngineLifecycle(): void {
  void cleanupStale()
  let done = false
  app.on('before-quit', (e) => {
    if (done) return
    e.preventDefault()
    done = true
    const t = Date.now()
    // Notausgang: hängt das Aufräumen (Kindprozess, offener Auftrag), bleibt sonst ein unsichtbarer Prozess zurück, der den nächsten Start blockiert
    setTimeout(() => app.exit(0), 6000)
    void killAllSidecars().finally(() => { if (process.env.SHORTME_SELFTEST) console.log(`SELFTEST sidecars killed in ${Date.now() - t}ms`); app.quit() })
  })
  process.once('exit', () => { void killAllSidecars() })
}

/** Abnahme im echten Electron-Prozess: `SHORTME_SELFTEST=<wav>` startet ASR + LLM und beendet die App (siehe docs/PROGRESS.md M2). */
export function runSelfTestIfRequested(): void {
  const wav = process.env.SHORTME_SELFTEST
  if (!wav) return
  void (async () => {
    try {
      const { transcribeWav } = await import('./asr/client')
      const r = await withAsr(() => transcribeWav(wav, { maxSeconds: 20 }))
      console.log(`SELFTEST asr words=${r.segments.reduce((n, s) => n + s.words.length, 0)}`)
      await withLlm(async (url) => { const ok = (await fetch(`${url}/health`)).ok; console.log(`SELFTEST llm health=${ok} pid-children=${liveSidecars().join(',')}`) })
    } catch (e) {
      console.log(`SELFTEST error ${e instanceof Error ? e.message : e}`)
    }
    app.quit()
  })()
}
