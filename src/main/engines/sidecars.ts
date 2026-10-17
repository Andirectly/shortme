import { spawn, execFile, type ChildProcess } from 'node:child_process'
import { createServer } from 'node:net'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { assetDir, runDir } from './paths'
import { runCommand } from './hardware'

interface Tracked { pid: number; exe: string; name: string }
const live = new Map<number, { child: ChildProcess; info: Tracked }>()

const pidFile = (): string => join(runDir(), 'sidecars.json')

async function persist(): Promise<void> {
  await mkdir(runDir(), { recursive: true })
  await writeFile(pidFile(), JSON.stringify([...live.values()].map((l) => l.info)))
}

/** Beendet Prozess samt Kindern (Windows: taskkill /T). */
export async function killTree(pid: number): Promise<void> {
  await new Promise<void>((resolve) => {
    if (process.platform === 'win32') execFile('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, () => resolve())
    else { try { process.kill(pid, 'SIGKILL') } catch { /* schon beendet */ } resolve() }
  })
  // CUDA-Prozesse brauchen nach dem Kill noch einen Moment, bis sie wirklich weg sind (VRAM frei).
  for (let i = 0; i < 40; i++) {
    try { process.kill(pid, 0) } catch { return }
    await new Promise((r) => setTimeout(r, 100))
  }
}

export async function track(child: ChildProcess, name: string, exe: string): Promise<void> {
  if (!child.pid) return
  live.set(child.pid, { child, info: { pid: child.pid, exe, name } })
  child.once('exit', () => { live.delete(child.pid!); void persist() })
  await persist()
}

export const liveSidecars = (): string[] => [...live.values()].map((l) => l.info.name)

/** Beim App-Ende: alle gestarteten Sidecars samt Kindern beenden. */
export async function killAllSidecars(): Promise<void> {
  await Promise.all([...live.keys()].map((pid) => killTree(pid)))
  live.clear()
  await persist().catch(() => undefined)
}

async function isRunningAs(pid: number, exe: string): Promise<boolean> {
  try {
    if (process.platform === 'win32') {
      const out = await runCommand('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'])
      return out.toLowerCase().includes(exe.toLowerCase())
    }
    process.kill(pid, 0)
    return true
  } catch { return false }
}

/** Nach Absturz der App: verwaiste Sidecars der letzten Sitzung beenden (nur wenn Prozessname noch passt). */
export async function cleanupStale(): Promise<number> {
  let list: Tracked[] = []
  try { list = JSON.parse(await readFile(pidFile(), 'utf8')) } catch { return 0 }
  let n = 0
  for (const t of list) if (await isRunningAs(t.pid, t.exe)) { await killTree(t.pid); n++ }
  await writeFile(pidFile(), '[]').catch(() => undefined)
  return n
}

export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer()
    s.once('error', reject)
    s.listen(0, '127.0.0.1', () => { const p = (s.address() as { port: number }).port; s.close(() => resolve(p)) })
  })
}

export interface LlamaOptions { model: string; ctx?: number; kvQuant?: boolean; gpuLayers?: number }

/** llama-server als Kindprozess (OpenAI-kompatible API auf localhost). */
export class LlamaServer {
  private child: ChildProcess | null = null
  baseUrl: string | null = null
  private tail = ''

  static exe(): string { return join(assetDir('llama-server'), process.platform === 'win32' ? 'llama-server.exe' : 'llama-server') }
  get running(): boolean { return !!this.child && this.child.exitCode === null }

  async start(opts: LlamaOptions, signal?: AbortSignal): Promise<string> {
    if (this.running && this.baseUrl) return this.baseUrl
    const port = await freePort()
    const args = ['-m', opts.model, '-c', String(opts.ctx ?? 16384), '-ngl', String(opts.gpuLayers ?? 99), '-fa', 'on', '--host', '127.0.0.1', '--port', String(port), '--jinja', '-np', '1']
    if (opts.kvQuant) args.push('--cache-type-k', 'q8_0', '--cache-type-v', 'q8_0')
    const exe = LlamaServer.exe()
    const child = spawn(exe, args, { cwd: assetDir('llama-server'), stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    this.child = child
    const grab = (d: Buffer): void => { this.tail = (this.tail + d).slice(-2000) }
    child.stdout?.on('data', grab)
    child.stderr?.on('data', grab)
    child.once('exit', () => { if (this.child === child) { this.child = null; this.baseUrl = null } })
    await track(child, 'llama-server', 'llama-server')
    const url = `http://127.0.0.1:${port}`
    const t0 = Date.now()
    for (;;) {
      if (signal?.aborted) { await this.stop(); throw new Error('Abgebrochen') }
      if (child.exitCode !== null) throw new Error(`llama-server beendet (Code ${child.exitCode}): ${this.tail.slice(-400)}`)
      if (Date.now() - t0 > 180_000) { await this.stop(); throw new Error('llama-server startet nicht (Zeitüberschreitung)') }
      try { if ((await fetch(`${url}/health`)).ok) break } catch { /* noch nicht bereit */ }
      await new Promise((r) => setTimeout(r, 300))
    }
    this.baseUrl = url
    return url
  }

  async stop(): Promise<void> {
    const c = this.child
    this.child = null
    this.baseUrl = null
    if (c?.pid) { await killTree(c.pid); live.delete(c.pid); await persist().catch(() => undefined) }
  }
}
