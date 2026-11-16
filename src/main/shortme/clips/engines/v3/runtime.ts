// Gemanagte Python-Laufzeit für Engine 3: eigene Umgebung unter <Daten>/runtime/py312-v3 (kein globales Python, kein globales pip).
// Installation: `uv` (fest gebundene Version, Prüfsumme laut GitHub-Release) legt Python 3.12 und die Umgebung an, danach Installation aus der
// gelockten Liste mit Hashes (resources/python/requirements.lock.txt, --require-hashes). Reparatur = erneut installieren; Entfernen = Ordner löschen.
import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app } from 'electron'
import { dataRoot } from '../../../../engines/paths'
import { writeFileAtomic } from '../../../atomic'

export const UV_VERSION = '0.13.1'
/** SHA-256 der Release-Datei uv-x86_64-pc-windows-msvc.zip (Release 0.13.1, aus der .sha256-Datei des Releases übernommen). */
export const UV_ZIP_SHA256 = '3b2661a463a5baea7f5076ea2b25ab71d77f36a6c0d809e5350651792f80a672'
const UV_URL = `https://github.com/astral-sh/uv/releases/download/${UV_VERSION}/uv-x86_64-pc-windows-msvc.zip`
const TORCH_INDEX = 'https://download.pytorch.org/whl/cu128'

export const runtimeRoot = (): string => join(dataRoot(), 'runtime')
export const venvDir = (): string => join(runtimeRoot(), 'py312-v3')
export const pythonExe = (): string => join(venvDir(), 'Scripts', 'python.exe')
const uvExe = (): string => join(runtimeRoot(), 'uv', 'uv.exe')
const markerFile = (): string => join(venvDir(), 'shortme-runtime.json')

/** Ordner mit worker.py, requirements.lock.txt und vendor/ (Entwicklung: Repo, Paket: resources). */
export function pythonResourceDir(): string {
  if (app?.isPackaged) return join(process.resourcesPath, 'python')
  return join(process.cwd(), 'resources', 'python')
}
export const workerScript = (): string => join(pythonResourceDir(), 'worker.py')
const lockFile = (): string => join(pythonResourceDir(), 'requirements.lock.txt')

const sha256 = (b: Buffer): string => createHash('sha256').update(b).digest('hex')

export interface RuntimeStatus { state: 'missing' | 'outdated' | 'ready'; detail: string; python?: string }

/** Ist die Umgebung vorhanden und passt sie zur gelockten Liste? (Hash der Liste steht im Marker.) */
export async function runtimeStatus(): Promise<RuntimeStatus> {
  if (!existsSync(pythonExe())) return { state: 'missing', detail: 'Python-Laufzeit nicht installiert' }
  try {
    const m = JSON.parse(await readFile(markerFile(), 'utf8')) as { lockSha256?: string; torch?: string }
    const cur = sha256(await readFile(lockFile()))
    if (m.lockSha256 !== cur) return { state: 'outdated', detail: 'Laufzeit passt nicht zur gelockten Paketliste (Reparatur nötig)', python: pythonExe() }
    return { state: 'ready', detail: `Python-Laufzeit bereit (torch ${m.torch ?? '?'})`, python: pythonExe() }
  } catch { return { state: 'missing', detail: 'Laufzeit unvollständig (kein Marker) – Reparatur nötig' } }
}

function run(cmd: string, args: string[], onLine: (l: string) => void, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { windowsHide: true, signal, env: { ...process.env, UV_NO_PROGRESS: '1', UV_PYTHON_DOWNLOADS: 'automatic' } })
    let tail = ''
    const feed = (d: Buffer): void => { for (const l of d.toString('utf8').split(/\r?\n/)) if (l.trim()) { tail = l; onLine(l) } }
    p.stdout.on('data', feed); p.stderr.on('data', feed)
    p.on('error', reject)
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd.split(/[\\/]/).pop()} endete mit Code ${code}: ${tail}`.slice(0, 400)))))
  })
}

/** uv herunterladen (nur die fest gebundene Version, Prüfsumme muss stimmen) und entpacken. */
async function ensureUv(onLine: (l: string) => void, signal?: AbortSignal): Promise<void> {
  if (existsSync(uvExe())) return
  onLine(`uv ${UV_VERSION} laden …`)
  const res = await fetch(UV_URL, { signal })
  if (!res.ok) throw new Error(`uv-Download fehlgeschlagen (HTTP ${res.status})`)
  const buf = Buffer.from(await res.arrayBuffer())
  if (sha256(buf) !== UV_ZIP_SHA256) throw new Error('uv-Download: Prüfsumme stimmt nicht – abgebrochen')
  const dir = join(runtimeRoot(), 'uv')
  await mkdir(dir, { recursive: true })
  const zip = join(dir, 'uv.zip')
  await writeFile(zip, buf)
  await run(join(process.env.SystemRoot ?? 'C:/Windows', 'System32', 'tar.exe'), ['-xf', zip, '-C', dir], onLine, signal) // Windows-bsdtar (kann zip); nicht das tar aus dem PATH (Git/MSYS)
  await rm(zip, { force: true })
  // das Archiv enthält uv.exe direkt oder in einem Unterordner
  if (!existsSync(uvExe())) throw new Error('uv.exe nach dem Entpacken nicht gefunden')
}

/** Laufzeit installieren oder reparieren. Fortschritt als Textzeilen (uv-Ausgabe). */
export async function installRuntime(onLine: (l: string) => void, signal?: AbortSignal): Promise<RuntimeStatus> {
  await mkdir(runtimeRoot(), { recursive: true })
  await ensureUv(onLine, signal)
  onLine('Python 3.12 und Umgebung anlegen …')
  await run(uvExe(), ['venv', venvDir(), '--python', '3.12', '--allow-existing'], onLine, signal)
  onLine('Pakete installieren (mehrere GB, Hashes werden geprüft) …')
  await run(uvExe(), ['pip', 'install', '--python', pythonExe(), '--require-hashes', '--extra-index-url', TORCH_INDEX, '--index-strategy', 'unsafe-best-match', '-r', lockFile()], onLine, signal)
  const torch = await new Promise<string>((resolve) => {
    let out = ''
    const p = spawn(pythonExe(), ['-c', 'import torch;print(torch.__version__)'], { windowsHide: true })
    p.stdout.on('data', (d: Buffer) => { out += d.toString() })
    p.on('close', () => resolve(out.trim()))
    p.on('error', () => resolve(''))
  })
  await writeFileAtomic(markerFile(), JSON.stringify({ lockSha256: sha256(await readFile(lockFile())), torch, uv: UV_VERSION, installedAt: new Date().toISOString() }))
  return runtimeStatus()
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// Zweite Umgebung (AV): MiniCPM-o braucht transformers==4.51.0, das Embedding-Modell ≥ 4.57 → getrennte Umgebung statt Versionskonflikt.
// Die Liste ist fest gepinnt, aber ohne Hashes (Lighthouse und CLIP kommen als Git-Commit, siehe Kopf der Datei).
export const avVenvDir = (): string => join(runtimeRoot(), 'py312-v3av')
export const avPythonExe = (): string => join(avVenvDir(), 'Scripts', 'python.exe')
const avLockFile = (): string => join(pythonResourceDir(), 'requirements-av.lock.txt')
const avMarker = (): string => join(avVenvDir(), 'shortme-runtime.json')

export async function avRuntimeStatus(): Promise<RuntimeStatus> {
  if (!existsSync(avPythonExe())) return { state: 'missing', detail: 'AV-Laufzeit (MiniCPM-o, Lighthouse) nicht installiert' }
  try {
    const m = JSON.parse(await readFile(avMarker(), 'utf8')) as { lockSha256?: string; torch?: string }
    if (m.lockSha256 !== sha256(await readFile(avLockFile()))) return { state: 'outdated', detail: 'AV-Laufzeit passt nicht zur Paketliste (Reparatur nötig)', python: avPythonExe() }
    return { state: 'ready', detail: `AV-Laufzeit bereit (torch ${m.torch ?? '?'})`, python: avPythonExe() }
  } catch { return { state: 'missing', detail: 'AV-Laufzeit unvollständig (kein Marker) – Reparatur nötig' } }
}

export async function installAvRuntime(onLine: (l: string) => void, signal?: AbortSignal): Promise<RuntimeStatus> {
  await mkdir(runtimeRoot(), { recursive: true })
  await ensureUv(onLine, signal)
  onLine('AV-Umgebung (Python 3.12) anlegen …')
  await run(uvExe(), ['venv', avVenvDir(), '--python', '3.12', '--allow-existing'], onLine, signal)
  onLine('AV-Pakete installieren (mehrere GB) …')
  await run(uvExe(), ['pip', 'install', '--python', avPythonExe(), '--extra-index-url', TORCH_INDEX, '--index-strategy', 'unsafe-best-match', '-r', avLockFile()], onLine, signal)
  const torch = await new Promise<string>((resolve) => {
    let out = ''
    const p = spawn(avPythonExe(), ['-c', 'import torch;print(torch.__version__)'], { windowsHide: true })
    p.stdout.on('data', (d: Buffer) => { out += d.toString() })
    p.on('close', () => resolve(out.trim()))
    p.on('error', () => resolve(''))
  })
  await writeFileAtomic(avMarker(), JSON.stringify({ lockSha256: sha256(await readFile(avLockFile())), torch, uv: UV_VERSION, installedAt: new Date().toISOString() }))
  return avRuntimeStatus()
}
