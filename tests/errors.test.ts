import { describe, expect, it } from 'vitest'
import { friendlyError } from '../src/main/shortme/errors'

describe('friendlyError', () => {
  it('übersetzt typische Fehler in verständliche Sätze', () => {
    const enospc = Object.assign(new Error('write failed'), { code: 'ENOSPC' })
    expect(friendlyError(enospc)).toMatch(/Speicher ist voll/)
    expect(friendlyError(new Error('Node-Laufzeit fehlt – bitte im Modell-Manager installieren'))).toMatch(/Node-Laufzeit/)
    expect(friendlyError(new Error('llama-server beendet (Code 1): CUDA error: out of memory'))).toMatch(/Sprachmodell/)
    expect(friendlyError(new Error('SHA-256 stimmt nicht überein (erwartet ab…)'))).toMatch(/beschädigt/)
    expect(friendlyError(new Error('Download fehlgeschlagen (HTTP 503)'))).toMatch(/Netzwerk/)
    expect(friendlyError(new Error('ffmpeg exited with code 1'))).toMatch(/FFmpeg/)
    expect(friendlyError(Object.assign(new Error('x'), { code: 'ENOENT' }))).toMatch(/nicht gefunden/)
  })
  it('kürzt unbekannte lange Meldungen und gibt kurze unverändert zurück', () => {
    expect(friendlyError(new Error('kaputt'))).toBe('kaputt')
    expect(friendlyError('x'.repeat(500)).length).toBeLessThan(260)
  })
})
