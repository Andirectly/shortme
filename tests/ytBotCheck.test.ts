import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { runYtDlp, YtDlpError } from '../src/main/pipeline/ytdlp'

describe('YouTube-Bot-Prüfung', () => {
  it('wird als deutscher Hinweis auf die Anmeldung gemeldet', async () => {
    const fake = ['-e', "console.error('ERROR: [youtube] abc: Sign in to confirm you\\u2019re not a bot. Use --cookies-from-browser'); process.exit(1)"]
    const err = await runYtDlp(process.execPath, fake).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(YtDlpError)
    expect((err as Error).message).toMatch(/YouTube-Anmeldung/)
  })
  it('übergibt die gebündelte Node-Laufzeit als JS-Laufzeit, wenn sie installiert ist', async () => {
    const data = mkdtempSync(join(tmpdir(), 'sm-ytjs-'))
    const exe = join(data, 'models', 'node-runtime', 'node-v22.23.3-win-x64', 'node.exe')
    mkdirSync(dirname(exe), { recursive: true }); writeFileSync(exe, '')
    process.env.SHORTME_DATA = data
    try {
      // node (als falsches yt-dlp) lehnt die vorangestellte Option ab (Exit 9); ohne sie liefe `-e 0` fehlerfrei durch
      const err = await runYtDlp(process.execPath, ['-e', '0']).catch((e: unknown) => e)
      expect((err as Error).message).toContain('code 9')
    } finally { delete process.env.SHORTME_DATA; rmSync(data, { recursive: true, force: true }) }
  })
  it('andere Fehler bleiben unverändert', async () => {
    const err = await runYtDlp(process.execPath, ['-e', "console.error('ERROR: [youtube] abc: Video unavailable'); process.exit(1)"]).catch((e: unknown) => e)
    expect((err as Error).message).toBe('Video unavailable')
  })
})
