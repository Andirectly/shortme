import { describe, expect, it } from 'vitest'
import { PRESETS, buildVtt, captionCss, scopeCss, tagWordlists, type CaptionWord } from '../src/shared/captions'

const words: CaptionWord[] = [
  { w: 'Hallo', start: 0.5, end: 0.9 }, { w: 'du', start: 1, end: 1.2 }, { w: 'schöne', start: 1.3, end: 1.8, tag: 'emphasis' },
  { w: 'Welt.', start: 1.75, end: 2.4, tag: 'entity' }, { w: 'Neu', start: 4, end: 4.3 }
]

describe('Untertitel-Daten', () => {
  it('VTT: Wortzeiten, Zeilen von höchstens n Wörtern, nie überlappend', () => {
    const vtt = buildVtt(words, 3)
    expect(vtt.startsWith('WEBVTT')).toBe(true)
    const cues = [...vtt.matchAll(/(\d\d:\d\d:\d\d\.\d{3}) --> (\d\d:\d\d:\d\d\.\d{3})\n(.*)\n/g)]
    expect(cues).toHaveLength(2)
    expect(cues[0][3]).toBe('Hallo <00:00:01.000>du <00:00:01.300>schöne')
    const toS = (t: string): number => { const [h, m, s] = t.split(':'); return Number(h) * 3600 + Number(m) * 60 + Number(s) }
    expect(toS(cues[0][2])).toBeLessThanOrEqual(toS(cues[1][1]))
    expect(toS(cues[0][2])).toBeGreaterThan(toS(cues[0][1]))
  })

  it('VTT: Überlappende Wortzeiten (ASR) erzeugen trotzdem keine überlappenden Zeilen', () => {
    const w: CaptionWord[] = [{ w: 'a', start: 0, end: 1 }, { w: 'b', start: 0.5, end: 0.9 }, { w: 'c', start: 0.6, end: 1.5 }, { w: 'd', start: 0.7, end: 1.2 }]
    const cues = [...buildVtt(w, 2).matchAll(/(\d\d:\d\d:\d\d\.\d{3}) --> (\d\d:\d\d:\d\d\.\d{3})/g)]
    expect(cues).toHaveLength(2)
    expect(cues[0][2] <= cues[1][1] || cues[0][2] === '00:00:00.680').toBe(true)
  })

  it('Tag-Wortlisten: normalisiert, je Art getrennt, ohne Duplikate', () => {
    const l = tagWordlists([...words, { w: 'SCHÖNE!', start: 9, end: 9.5, tag: 'emphasis' }])
    expect(l.emphasis).toEqual(['schöne'])
    expect(l.entity).toEqual(['welt'])
    expect(l.hook).toEqual([])
  })
})

describe('Untertitel-CSS (gemeinsam für Export und Vorschau)', () => {
  it('enthält Schrift, Größe in cqh, Hervorhebung und Tag-Klassen', () => {
    const css = captionCss(PRESETS[0])
    expect(css).toContain("'Anton'")
    expect(css).toContain('font-size: 5.200cqh')
    expect(css).toContain('text-transform: uppercase')
    expect(css).toContain('.word.word-being-narrated { color: #FFD400')
    expect(css).toContain('.word.emphasis')
    expect(captionCss(PRESETS[0], { scale: 1.5 })).toContain('font-size: 7.800cqh')
    expect(captionCss(PRESETS[0], { highlight: false })).not.toContain('.word.emphasis')
  })
  it('Box-Preset: Hintergrundbox statt Kontur', () => {
    const css = captionCss(PRESETS.find((p) => p.id === 'box')!)
    expect(css).toContain('background: rgba(0,0,0,0.68)')
    expect(css).not.toContain('-webkit-text-stroke')
  })
  it('scopeCss setzt jeden Selektor unter den Bereich', () => {
    const s = scopeCss('.a, .b .c { color: red; }\n.d { top: 0; }', '.sm-cap')
    expect(s).toBe('.sm-cap .a, .sm-cap .b .c { color: red; }\n.sm-cap .d { top: 0; }')
  })
  it('alle Presets liefern gültige Werte', () => {
    for (const p of PRESETS) {
      expect(p.size).toBeGreaterThan(0.02)
      expect(p.wordsPerLine).toBeGreaterThanOrEqual(1)
      expect(captionCss(p)).toContain(p.highlight)
    }
  })
})
