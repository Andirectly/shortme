import { describe, expect, it } from 'vitest'
import { AUDIO_VERSION, wavSeconds } from '../src/main/shortme/transcription'

describe('Audio-Zeitachse', () => {
  it('Länge einer 16-kHz-Mono-WAV aus der Dateigröße', () => {
    expect(wavSeconds(44 + 32000 * 10)).toBe(10)
    expect(wavSeconds(44)).toBe(0)
    expect(wavSeconds(10)).toBe(0)
  })
  it('Marker-Version 2 (Zeitachsen-Ausgleich) – alte Projekte tragen „1“ und werden einmal geprüft', () => {
    expect(AUDIO_VERSION).toBe('2')
  })
})
