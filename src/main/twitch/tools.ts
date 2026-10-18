// Twitch-Werkzeuge: Streamlink (BSD-2-Clause) und TwitchDownloaderCLI (MIT). Wie yt-dlp beim ersten Gebrauch aus den offiziellen
// GitHub-Releases in <Daten>/bin geladen (Logik-Vorlage Live-Archivierung: Zibbp/ganymede, nur nachgelesen).
import { spawn } from 'node:child_process'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { dataRoot } from '../engines/paths'
import { downloadFile, extractArchive } from '../engines/download'

export type ToolId = 'streamlink' | 'twitchdownloader'
type Progress = (fraction: number, message: string) => void

interface ToolSpec { repo: string; asset: RegExp; exe: string; label: string; license: string }

export const TOOLS: Record<ToolId, ToolSpec> = {
  // Portable Windows-Builds (enthalten Python-Laufzeit), nicht das Quellarchiv des Hauptprojekts
  streamlink: { repo: 'streamlink/windows-builds', asset: /^streamlink-.*-x86_64\.zip$/, exe: 'streamlink.exe', label: 'Streamlink', license: 'BSD-2-Clause' },
  twitchdownloader: { repo: 'lay295/TwitchDownloader', asset: /^TwitchDownloaderCLI-.*-Windows-x64\.zip$/, exe: 'TwitchDownloaderCLI.exe', label: 'TwitchDownloaderCLI', license: 'MIT' }
}

const toolDir = (id: ToolId): string => join(dataRoot(), 'bin', id)

/** Pfad der ausführbaren Datei (sucht bis zu zwei Ebenen tief, da Archive oft einen Unterordner enthalten). */
export function toolPath(id: ToolId): string | null {
  const root = toolDir(id)
  const exe = TOOLS[id].exe
  if (!existsSync(root)) return null
  const walk = (dir: string, depth: number): string | null => {
    const direct = join(dir, exe)
    if (existsSync(direct)) return direct
    if (depth <= 0) return null
    for (const n of readdirSync(dir)) {
      const p = join(dir, n)
      try { if (statSync(p).isDirectory()) { const r = walk(p, depth - 1); if (r) return r } } catch { /* weiter */ }
    }
    return null
  }
  return walk(root, 3)
}

export function runTool(bin: string, args: string[], opts: { timeoutMs?: number; anyExit?: boolean; onLine?: (l: string) => void; signal?: AbortSignal } = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, { windowsHide: true, signal: opts.signal })
    let out = ''
    let err = ''
    let buf = ''
    const timer = opts.timeoutMs ? setTimeout(() => p.kill(), opts.timeoutMs) : null
    const feed = (d: Buffer): void => {
      const t = d.toString()
      if (opts.onLine) { buf += t; const ls = buf.split(/\r?\n|\r/); buf = ls.pop() ?? ''; for (const l of ls) opts.onLine(l) }
    }
    p.stdout.on('data', (d: Buffer) => { out += d; feed(d) })
    p.stderr.on('data', (d: Buffer) => { err += d; if (err.length > 65536) err = err.slice(-32768); feed(d) })
    p.on('error', (e) => { if (timer) clearTimeout(timer); reject(e) })
    p.on('close', (code) => { if (timer) clearTimeout(timer); if (code === 0 || opts.anyExit) resolve(out || err)
      else reject(new Error(`${bin} Exit ${code}: ${(err || out).trim().split('\n').slice(-3).join(' | ').slice(0, 400)}`)) })
  })
}

export async function ensureTool(id: ToolId, onProgress: Progress = () => undefined): Promise<string> {
  const have = toolPath(id)
  if (have) return have
  const spec = TOOLS[id]
  onProgress(0, `${spec.label} wird geladen (einmalig) …`)
  const rel = await fetch(`https://api.github.com/repos/${spec.repo}/releases/latest`, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Shortme' } })
  if (!rel.ok) throw new Error(`${spec.label}: Release nicht abrufbar (HTTP ${rel.status})`)
  const json = (await rel.json()) as { tag_name: string; assets: Array<{ name: string; size: number; browser_download_url: string }> }
  const asset = json.assets.find((a) => spec.asset.test(a.name))
  if (!asset) throw new Error(`${spec.label}: kein passendes Release-Paket gefunden`)
  const dir = toolDir(id)
  await rm(dir, { recursive: true, force: true })
  await mkdir(dir, { recursive: true })
  const zip = join(dataRoot(), 'bin', `${id}.zip`)
  await downloadFile(asset.browser_download_url, zip, { size: asset.size, onProgress: (d, t) => onProgress(t ? (d / t) * 0.9 : 0, `${spec.label} wird geladen …`) })
  onProgress(0.92, `${spec.label} wird entpackt …`)
  await extractArchive(zip, dir)
  await rm(zip, { force: true })
  await writeFile(join(dir, 'VERSION.txt'), `${json.tag_name}\n`)
  const bin = toolPath(id)
  if (!bin) throw new Error(`${spec.label}: ${spec.exe} nach dem Entpacken nicht gefunden`)
  return bin
}

/** Versionsnummer für den Systemcheck (null = nicht geladen / startet nicht). */
export async function toolVersion(id: ToolId): Promise<string | null> {
  const bin = toolPath(id)
  if (!bin) return null
  try {
    const out = await runTool(bin, ['--version'], { timeoutMs: 20000, anyExit: true })
    const m = out.match(/\d+\.\d+(\.\d+)*/)
    return m ? m[0] : out.trim().split('\n')[0].slice(0, 40)
  } catch { return null }
}
