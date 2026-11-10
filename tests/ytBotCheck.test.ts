import { describe, expect, it } from 'vitest'
import { runYtDlp, YtDlpError } from '../src/main/pipeline/ytdlp'

describe('YouTube-Bot-Prüfung', () => {
  it('wird als deutscher Hinweis auf die Anmeldung gemeldet', async () => {
    const fake = ['-e', "console.error('ERROR: [youtube] abc: Sign in to confirm you\\u2019re not a bot. Use --cookies-from-browser'); process.exit(1)"]
    const err = await runYtDlp(process.execPath, fake).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(YtDlpError)
    expect((err as Error).message).toMatch(/YouTube-Anmeldung/)
  })
  it('andere Fehler bleiben unverändert', async () => {
    const err = await runYtDlp(process.execPath, ['-e', "console.error('ERROR: [youtube] abc: Video unavailable'); process.exit(1)"]).catch((e: unknown) => e)
    expect((err as Error).message).toBe('Video unavailable')
  })
})
