import { createServer, type Server } from 'node:http'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile, mkdir, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { parseNvidiaSmi, recommend } from '../src/main/engines/hardware'
import { downloadFile, HashMismatchError } from '../src/main/engines/download'
import { AssetManager } from '../src/main/engines/manager'
import { VramSequencer } from '../src/main/engines/vram'
import { tokensToWords } from '../src/main/engines/asr/protocol'
import type { AssetSpec } from '../src/shared/engines'

const DATA = Buffer.from(Array.from({ length: 300_000 }, (_, i) => i % 251))
const SHA = createHash('sha256').update(DATA).digest('hex')
let server: Server
let base = ''
let dir = ''

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'shortme-engines-'))
  server = createServer((req, res) => {
    const range = req.headers.range?.match(/bytes=(\d+)-/)
    if (req.url === '/nolength') { res.writeHead(200); res.end(DATA); return }
    if (range) {
      const start = Number(range[1])
      if (start >= DATA.length) { res.writeHead(416); res.end(); return }
      res.writeHead(206, { 'content-length': DATA.length - start, 'content-range': `bytes ${start}-${DATA.length - 1}/${DATA.length}` })
      res.end(DATA.subarray(start))
    } else {
      res.writeHead(200, { 'content-length': DATA.length })
      res.end(DATA)
    }
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
})
afterAll(async () => { server.close(); await rm(dir, { recursive: true, force: true }) })

describe('hardware', () => {
  it('parst nvidia-smi und wählt die GPU mit dem meisten VRAM', () => {
    const gpu = parseNvidiaSmi('NVIDIA GeForce RTX 3050, 6144, 5000, 560.1\nNVIDIA GeForce RTX 5090, 32607, 30000, 610.88\n')
    expect(gpu).toMatchObject({ name: 'NVIDIA GeForce RTX 5090', totalMb: 32607, freeMb: 30000, driver: '610.88' })
    expect(parseNvidiaSmi('')).toBeNull()
    expect(parseNvidiaSmi('Fehler: keine Treiber')).toBeNull()
  })
  it('empfiehlt Profil nach VRAM', () => {
    expect(recommend(32607)).toEqual({ profile: 'standard', recommendedLlm: 'qwen3-14b', kvQuant: false })
    expect(recommend(12288)).toEqual({ profile: 'standard', recommendedLlm: 'qwen3-14b', kvQuant: true })
    expect(recommend(8192)).toMatchObject({ profile: 'kompakt', recommendedLlm: 'qwen3-8b' })
    expect(recommend(0).profile).toBe('cpu')
  })
})

describe('download', () => {
  it('lädt und prüft SHA-256', async () => {
    const dest = join(dir, 'a.bin')
    await downloadFile(`${base}/a`, dest, { size: DATA.length, sha256: SHA })
    expect((await readFile(dest)).equals(DATA)).toBe(true)
  })
  it('setzt eine Teildatei per Range fort', async () => {
    const dest = join(dir, 'b.bin')
    await writeFile(`${dest}.part`, DATA.subarray(0, 100_000))
    let first = -1
    await downloadFile(`${base}/b`, dest, { size: DATA.length, sha256: SHA, onProgress: (d) => { if (first < 0) first = d } })
    expect(first).toBeGreaterThanOrEqual(100_000)
    expect((await readFile(dest)).equals(DATA)).toBe(true)
  })
  it('verwirft die Datei bei falschem Hash', async () => {
    const dest = join(dir, 'c.bin')
    await expect(downloadFile(`${base}/c`, dest, { size: DATA.length, sha256: 'ab'.repeat(32) })).rejects.toBeInstanceOf(HashMismatchError)
    await expect(stat(dest)).rejects.toThrow()
    await expect(stat(`${dest}.part`)).rejects.toThrow()
  })
  it('beginnt neu, wenn der Server keine Ranges kann', async () => {
    const dest = join(dir, 'd.bin')
    await writeFile(`${dest}.part`, DATA.subarray(0, 5000))
    await downloadFile(`${base}/nolength`, dest, { sha256: SHA })
    expect((await readFile(dest)).equals(DATA)).toBe(true)
  })
})

describe('AssetManager', () => {
  const spec = (id: string, sha = SHA): AssetSpec => ({ id, name: id, kind: 'vision', note: '', files: [{ url: `${base}/m`, name: 'model.onnx', size: DATA.length, sha256: sha }], expect: ['model.onnx'] })

  it('installiert, meldet Status und erkennt Installation', async () => {
    const m = new AssetManager([spec('one')], (id) => join(dir, 'models', id))
    const states: string[] = []
    m.on('status', (s) => states.push(s.state))
    expect((await m.list())[0].state).toBe('missing')
    await m.install('one')
    expect(states).toContain('downloading')
    expect(states).toContain('verifying')
    expect((await m.list())[0]).toMatchObject({ state: 'installed', progress: 1 })
  })

  it('meldet Hash-Fehler und räumt auf', async () => {
    const m = new AssetManager([spec('bad', 'cd'.repeat(32))], (id) => join(dir, 'models', id))
    await expect(m.install('bad')).rejects.toBeInstanceOf(HashMismatchError)
    expect((await m.list())[0]).toMatchObject({ state: 'error' })
  })

  it('importiert aus einem Ordner (USB) mit Hash-Prüfung', async () => {
    const usb = join(dir, 'usb', 'nested')
    await mkdir(usb, { recursive: true })
    await writeFile(join(usb, 'model.onnx'), DATA)
    const m = new AssetManager([spec('imp'), spec('imp-bad', 'ef'.repeat(32))], (id) => join(dir, 'models2', id))
    const r = await m.importFolder(join(dir, 'usb'))
    expect(r.imported).toEqual(['imp'])
    expect(r.skipped).toEqual(['imp-bad'])
    expect(await m.isInstalled('imp')).toBe(true)
  })
})

describe('VramSequencer', () => {
  it('hält ASR und LLM nie gleichzeitig geladen', async () => {
    const log: string[] = []
    let loaded = 0
    let maxLoaded = 0
    const mk = (name: string) => ({
      name,
      load: async () => { loaded++; maxLoaded = Math.max(maxLoaded, loaded); log.push(`+${name}`); await new Promise((r) => setTimeout(r, 5)) },
      unload: async () => { loaded--; log.push(`-${name}`) }
    })
    const s = new VramSequencer()
    s.register(mk('asr'))
    s.register(mk('llm'))
    await Promise.all([s.use('asr', async () => log.push('run-asr')), s.use('llm', async () => log.push('run-llm')), s.use('llm', async () => log.push('run-llm2')), s.use('asr', async () => log.push('run-asr2'))])
    expect(maxLoaded).toBe(1)
    expect(log).toEqual(['+asr', 'run-asr', '-asr', '+llm', 'run-llm', 'run-llm2', '-llm', '+asr', 'run-asr2'])
    await s.releaseAll()
    expect(loaded).toBe(0)
  })
})

describe('tokensToWords', () => {
  it('baut Wörter aus SentencePiece-Tokens', () => {
    const w = tokensToWords(['▁Hal', 'lo', '▁Welt'], [1, 1.2, 1.6], undefined, 2)
    expect(w).toEqual([{ w: 'Hallo', start: 1, end: 1.6 }, { w: 'Welt', start: 1.6, end: 2 }])
  })
})
