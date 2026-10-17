import { EventEmitter } from 'node:events'
import { copyFile, mkdir, readdir, rm, stat } from 'node:fs/promises'
import { join, basename } from 'node:path'
import type { AssetSpec, AssetStatus } from '@shared/engines'
import { CATALOG } from './catalog'
import { assetDir } from './paths'
import { downloadFile, extractArchive, sha256File, HashMismatchError } from './download'

async function exists(p: string, minSize = 0): Promise<boolean> {
  try { return (await stat(p)).size >= minSize } catch { return false }
}

/** Modell-/Engine-Manager: Status, Download (fortsetzbar, SHA-256), Entpacken, Ordner-Import. */
export class AssetManager extends EventEmitter {
  private status = new Map<string, AssetStatus>()
  private aborts = new Map<string, AbortController>()

  constructor(private catalog: AssetSpec[] = CATALOG, private dirOf: (id: string) => string = assetDir) { super() }

  private set(id: string, patch: Partial<AssetStatus>): AssetStatus {
    const spec = this.catalog.find((c) => c.id === id)!
    const cur = this.status.get(id) ?? { id, state: 'missing', progress: 0, bytesDone: 0, bytesTotal: spec.files.reduce((n, f) => n + f.size, 0) }
    const next = { ...cur, ...patch }
    this.status.set(id, next)
    this.emit('status', next)
    return next
  }

  async isInstalled(id: string): Promise<boolean> {
    const spec = this.catalog.find((c) => c.id === id)!
    if (spec.platform && spec.platform !== process.platform) return false
    for (const rel of spec.expect) if (!(await exists(join(this.dirOf(id), rel), 1))) return false
    return true
  }

  async list(): Promise<AssetStatus[]> {
    const out: AssetStatus[] = []
    for (const s of this.catalog) {
      const live = this.status.get(s.id)
      if (live && ['downloading', 'verifying', 'extracting', 'paused', 'error'].includes(live.state)) { out.push(live); continue }
      const installed = await this.isInstalled(s.id)
      out.push(this.set(s.id, { state: installed ? 'installed' : 'missing', progress: installed ? 1 : 0, error: undefined }))
    }
    return out
  }

  pause(id: string): void {
    this.aborts.get(id)?.abort('pause')
  }

  cancel(id: string): void {
    this.aborts.get(id)?.abort('cancel')
  }

  /** Installiert (bzw. setzt fort). Wirft bei Fehler; Status wird zusätzlich als `error` gesetzt. */
  async install(id: string): Promise<void> {
    const spec = byIdIn(this.catalog, id)
    if (await this.isInstalled(id)) { this.set(id, { state: 'installed', progress: 1 }); return }
    const ac = new AbortController()
    this.aborts.set(id, ac)
    const dir = this.dirOf(id)
    const total = spec.files.reduce((n, f) => n + f.size, 0)
    let doneBefore = 0
    try {
      await mkdir(dir, { recursive: true })
      this.set(id, { state: 'downloading', progress: 0, bytesDone: 0, bytesTotal: total, error: undefined })
      for (const f of spec.files) {
        const dest = join(dir, f.name)
        const base = doneBefore
        await downloadFile(f.url, dest, {
          size: f.size,
          sha256: f.sha256 || undefined,
          signal: ac.signal,
          onProgress: (d) => this.set(id, { state: 'downloading', bytesDone: base + d, progress: (base + d) / total * (spec.extract ? 0.95 : 1) }),
          onVerify: () => this.set(id, { state: 'verifying' })
        })
        doneBefore += f.size
      }
      if (spec.extract) {
        this.set(id, { state: 'extracting', progress: 0.96 })
        for (const f of spec.files) {
          await extractArchive(join(dir, f.name), dir, ac.signal)
          await rm(join(dir, f.name), { force: true })
        }
      }
      if (!(await this.isInstalled(id))) throw new Error('Installation unvollständig (erwartete Dateien fehlen)')
      this.set(id, { state: 'installed', progress: 1, bytesDone: total })
    } catch (e) {
      const reason = ac.signal.aborted ? String(ac.signal.reason) : ''
      if (reason === 'pause') { this.set(id, { state: 'paused' }); return }
      if (reason === 'cancel') { await rm(dir, { recursive: true, force: true }); this.set(id, { state: 'missing', progress: 0, bytesDone: 0 }); return }
      if (e instanceof HashMismatchError) await rm(dir, { recursive: true, force: true })
      this.set(id, { state: 'error', error: e instanceof Error ? e.message : String(e) })
      throw e
    } finally {
      this.aborts.delete(id)
    }
  }

  /**
   * Ordner-Import (z. B. USB-Stick): sucht im Ordner (rekursiv, 3 Ebenen) Dateien, die den Katalog-Dateien
   * (Archivname, Zieldatei oder erwartete Datei) entsprechen, prüft SHA-256 und kopiert sie in den Datenordner.
   */
  async importFolder(folder: string): Promise<{ imported: string[]; skipped: string[] }> {
    const found = new Map<string, string>()
    const walk = async (dir: string, depth: number): Promise<void> => {
      for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
        const p = join(dir, e.name)
        if (e.isDirectory() && depth < 3) await walk(p, depth + 1)
        else if (e.isFile()) found.set(e.name.toLowerCase(), p)
      }
    }
    await walk(folder, 0)
    const imported: string[] = []
    const skipped: string[] = []
    for (const spec of this.catalog) {
      if (await this.isInstalled(spec.id)) continue
      const files = spec.files.map((f) => ({ f, src: found.get(f.name.toLowerCase()) ?? found.get(basename(new URL(f.url).pathname).toLowerCase()) }))
      if (files.some((x) => !x.src)) continue
      let ok = true
      for (const { f, src } of files) {
        if (f.sha256 && (await sha256File(src!)) !== f.sha256) { ok = false; break }
      }
      if (!ok) { skipped.push(spec.id); continue }
      const dir = this.dirOf(spec.id)
      await mkdir(dir, { recursive: true })
      for (const { f, src } of files) {
        await copyFile(src!, join(dir, f.name))
        if (spec.extract) { await extractArchive(join(dir, f.name), dir); await rm(join(dir, f.name), { force: true }) }
      }
      if (await this.isInstalled(spec.id)) imported.push(spec.id)
      else skipped.push(spec.id)
    }
    return { imported, skipped }
  }
}

const byIdIn = (catalog: AssetSpec[], id: string): AssetSpec => {
  const s = catalog.find((c) => c.id === id)
  if (!s) throw new Error(`Unbekanntes Asset: ${id}`)
  return s
}
