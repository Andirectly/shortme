import { describe, expect, it, vi } from 'vitest'
import { chmod, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
vi.mock('electron', () => ({ app: { isPackaged: false, getPath: () => tmpdir() } }))
import { downloadUrlVideo, stopAllYtDlp } from '../src/main/pipeline/ytdlp'

// Falsches yt-dlp: zählt Aufrufe, wartet, beendet sich dann erfolgreich (oder wird vorher gestoppt)
async function fakeBin(dir: string, sleepSec: number): Promise<string> {
  const bin = join(dir, 'yt-dlp-fake')
  await writeFile(bin, `#!/bin/sh\necho x >> "${join(dir, 'calls')}"\nsleep ${sleepSec}\nexit 0\n`)
  await chmod(bin, 0o755)
  return bin
}

describe.skipIf(process.platform === 'win32')('Download-Schutz', () => {
  it('gleiches Ziel zweimal gleichzeitig → nur ein yt-dlp-Prozess', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ytdlp-guard-'))
    const bin = await fakeBin(dir, 1)
    const out = join(dir, 'v1.mp4')
    const msgs: string[] = []
    await Promise.all([downloadUrlVideo(bin, 'https://example.invalid/v1', out, () => undefined), downloadUrlVideo(bin, 'https://example.invalid/v1', out, (p) => msgs.push(p.message))])
    expect((await readFile(join(dir, 'calls'), 'utf8')).trim().split('\n')).toHaveLength(1)
    expect(msgs[0]).toMatch(/schon heruntergeladen/)
    // danach darf derselbe Download wieder starten
    await downloadUrlVideo(bin, 'https://example.invalid/v1', out, () => undefined)
    expect((await readFile(join(dir, 'calls'), 'utf8')).trim().split('\n')).toHaveLength(2)
  })
  it('stopAllYtDlp beendet laufende Downloads samt Kindern', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ytdlp-stop-'))
    const bin = await fakeBin(dir, 30)
    const t0 = Date.now()
    const p = downloadUrlVideo(bin, 'https://example.invalid/v2', join(dir, 'v2.mp4'), () => undefined)
    await new Promise((r) => setTimeout(r, 300))
    stopAllYtDlp()
    await expect(p).rejects.toThrow()
    expect(Date.now() - t0).toBeLessThan(5000)
  })
})
