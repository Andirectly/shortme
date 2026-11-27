import { describe, expect, it } from 'vitest'
import { lyricLines, type LyricWord } from '../src/shared/lyricLines'

const w = (s: string, t: number, e = t + 0.3): LyricWord => ({ w: s, t, e, g: Math.round(t * 10), edited: false })

describe('Lyrics-Zeilen', () => {
  it('bricht an Satzende, langer Pause und spätestens nach 7 Wörtern', () => {
    const words = [w('Hallo', 0), w('Welt.', 0.4), w('Wie', 1), w('geht', 1.4), w('es', 3), ...'a b c d e f g h'.split(' ').map((x, i) => w(x, 4 + i * 0.4))]
    expect(lyricLines(words).map((l) => l.map((x) => x.w).join(' '))).toEqual(['Hallo Welt.', 'Wie geht', 'es', 'a b c d e f g', 'h'])
  })
})
