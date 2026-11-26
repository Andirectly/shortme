import { describe, expect, it } from 'vitest'
import { buildCaptionOnlyClip } from '../src/main/shortme/clips/captionOnly'

describe('Nur Untertitel: Clip über das ganze Video', () => {
  it('9:16 bleibt unbeschnitten, ganze Länge, alle Wörter, als captionOnly markiert', () => {
    const c = buildCaptionOnlyClip({ title: 'mein-short.mp4', durationSec: 42.5, width: 1080, height: 1920 }, 120)
    expect(c).toMatchObject({ start: 0, end: 42.5, firstWord: 0, lastWord: 119, captionOnly: true, title: 'mein-short' })
    expect(c.shots).toEqual([{ start: 0, end: 42.5, layout: 'fixed', cx: 0.5, zoom: 1 }])
  })
  it('16:9 wird ganz ins Bild gesetzt (kein Beschnitt), ohne Sprache wortlos', () => {
    const c = buildCaptionOnlyClip({ title: 'Video', durationSec: 10, width: 1920, height: 1080 }, 0)
    expect(c.shots?.[0].layout).toBe('fit')
    expect(c.lastWord).toBe(-1)
    expect((c as { wordless?: boolean }).wordless).toBe(true)
  })
})
