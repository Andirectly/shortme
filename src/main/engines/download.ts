import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, rename, rm, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { spawn } from 'node:child_process'
import { pipeline } from 'node:stream/promises'
import { Readable, Transform } from 'node:stream'

export class HashMismatchError extends Error {
  constructor(public expected: string, public actual: string) {
    super(`SHA-256 stimmt nicht überein (erwartet ${expected.slice(0, 12)}…, erhalten ${actual.slice(0, 12)}…)`)
  }
}

export interface DownloadOpts {
  size?: number
  sha256?: string
  signal?: AbortSignal
  onProgress?: (done: number, total: number) => void
  onVerify?: () => void
}

export async function sha256File(path: string, signal?: AbortSignal): Promise<string> {
  const h = createHash('sha256')
  await pipeline(createReadStream(path), h, { signal })
  return h.digest('hex')
}

/** Lädt `url` nach `dest`; setzt per HTTP-Range an `dest.part` fort, prüft SHA-256, benennt atomar um. */
export async function downloadFile(url: string, dest: string, opts: DownloadOpts = {}): Promise<void> {
  await mkdir(dirname(dest), { recursive: true })
  const part = `${dest}.part`
  let have = 0
  try { have = (await stat(part)).size } catch { have = 0 }
  if (opts.size && have > opts.size) { await rm(part, { force: true }); have = 0 }

  if (!opts.size || have < opts.size) {
    const res = await fetch(url, { headers: have > 0 ? { Range: `bytes=${have}-` } : {}, redirect: 'follow', signal: opts.signal })
    if (res.status === 416) {
      // Teildatei war schon vollständig oder ungültig → neu beginnen
      await rm(part, { force: true })
      have = 0
      return downloadFile(url, dest, opts)
    }
    if (!res.ok || !res.body) throw new Error(`Download fehlgeschlagen (HTTP ${res.status})`)
    const resumed = res.status === 206
    if (!resumed) have = 0
    const total = opts.size ?? have + Number(res.headers.get('content-length') ?? 0)
    let done = have
    const counter = new Transform({
      transform(chunk, _enc, cb) {
        done += chunk.length
        opts.onProgress?.(done, total)
        cb(null, chunk)
      }
    })
    opts.onProgress?.(done, total)
    await pipeline(Readable.fromWeb(res.body as never), counter, createWriteStream(part, { flags: resumed ? 'a' : 'w' }), { signal: opts.signal })
  }

  if (opts.sha256) {
    opts.onVerify?.()
    const actual = await sha256File(part, opts.signal)
    if (actual.toLowerCase() !== opts.sha256.toLowerCase()) {
      await rm(part, { force: true })
      throw new HashMismatchError(opts.sha256, actual)
    }
  }
  await rm(dest, { force: true })
  await rename(part, dest)
}

/** Entpackt .tar.bz2/.zip mit dem systemeigenen bsdtar (Windows 10+ liefert `tar.exe` mit). */
export function extractArchive(archive: string, destDir: string, signal?: AbortSignal): Promise<void> {
  const tar = process.platform === 'win32' ? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe') : 'tar'
  return new Promise<void>((resolve, reject) => {
    const p = spawn(tar, ['-xf', archive, '-C', destDir], { windowsHide: true, signal })
    let err = ''
    p.stderr.on('data', (d) => (err += d))
    p.on('error', reject)
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`Entpacken fehlgeschlagen (${code}): ${err.slice(-300)}`))))
  })
}
