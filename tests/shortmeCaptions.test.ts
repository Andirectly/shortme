import { describe, expect, it } from 'vitest'
import { PRESETS, buildVtt, captionCss, groupWords, lineBudgetEm, scopeCss, tagWordlists, type CaptionWord } from '../src/shared/captions'

const words: CaptionWord[] = [
  { w: 'Hallo', start: 0.5, end: 0.9 }, { w: 'du', start: 1, end: 1.2 }, { w: 'schöne', start: 1.3, end: 1.8, tag: 'emphasis' },
  { w: 'Welt.', start: 1.75, end: 2.4, tag: 'entity' }, { w: 'Neu', start: 4, end: 4.3 }
]

const CUE_RE = /(\d\d:\d\d:\d\d\.\d{3}) --> (\d\d:\d\d:\d\d\.\d{3})\n(.*)\n/g
const CUE_RE2 = /(\d\d:\d\d:\d\d\.\d{3}) --> (\d\d:\d\d:\d\d\.\d{3})/g

describe('Untertitel-Daten', () => {
  it('VTT: Wortzeiten, eine Zeile je Gruppe, Satzende beendet die Zeile, nie überlappend', () => {
    const groups = groupWords(words, PRESETS[0])
    expect(groups.map((g) => g.map((w) => w.w))).toEqual([['Hallo', 'du', 'schöne'], ['Welt.'], ['Neu']])
    const vtt = buildVtt(groups)
    expect(vtt.startsWith('WEBVTT')).toBe(true)
    const cues = [...vtt.matchAll(CUE_RE)]
    expect(cues).toHaveLength(3)
    expect(cues[0][3]).toBe('Hallo <00:00:01.000>du <00:00:01.300>schöne')
    const toS = (t: string): number => { const [h, m, s] = t.split(':'); return Number(h) * 3600 + Number(m) * 60 + Number(s) }
    expect(toS(cues[0][2])).toBeLessThanOrEqual(toS(cues[1][1]))
    expect(toS(cues[0][2])).toBeGreaterThan(toS(cues[0][1]))
  })

  it('VTT: Überlappende Wortzeiten (ASR) erzeugen trotzdem keine überlappenden Zeilen', () => {
    const w: CaptionWord[] = [{ w: 'a.', start: 0, end: 1 }, { w: 'b.', start: 0.5, end: 0.9 }, { w: 'c.', start: 0.6, end: 1.5 }, { w: 'd.', start: 0.7, end: 1.2 }]
    const cues = [...buildVtt(groupWords(w, PRESETS[0])).matchAll(CUE_RE2)]
    expect(cues).toHaveLength(4)
    for (let i = 1; i < cues.length; i++) expect(cues[i - 1][2] <= cues[i][1] || cues[i - 1][2] <= '00:00:00.720').toBe(true)
  })

  it('Gruppierung: immer einzeilig – keine Zeile breiter als das Zeichenbudget, höchstens 6 Wörter', () => {
    const text = 'Das ist ein ziemlich langer Satz ohne Satzzeichen der eigentlich nie aufhört weil er einfach immer weiterläuft und weiterläuft und weiterläuft'.split(' ')
    const ws: CaptionWord[] = text.map((w, i) => ({ w, start: i * 0.3, end: i * 0.3 + 0.25 }))
    for (const p of PRESETS) {
      const { usablePx, fontPx, charEm } = lineBudgetEm(p)
      const groups = groupWords(ws, p)
      expect(groups.flat().map((w) => w.w)).toEqual(text) // nichts verloren, Reihenfolge erhalten
      for (const g of groups) {
        expect(g.length).toBeLessThanOrEqual(6)
        const chars = g.reduce((n, w) => n + w.w.length, 0)
        if (p.anim !== 'kinetic') expect(chars * charEm * fontPx).toBeLessThanOrEqual(usablePx + 1e-6) // Kinetisch: Nebenwörter sind kleiner
      }
    }
  })

  it('Gruppierung: Pause und Komma als Umbruchstellen', () => {
    const ws: CaptionWord[] = [
      { w: 'Erstens', start: 0, end: 0.4 }, { w: 'ja', start: 0.45, end: 0.7 },
      { w: 'dann', start: 2, end: 2.3 }, { w: 'gehen', start: 2.35, end: 2.6 }, { w: 'wir,', start: 2.65, end: 2.9 }, { w: 'weil', start: 2.95, end: 3.2 }, { w: 'es', start: 3.25, end: 3.4 }
    ]
    const g = groupWords(ws, PRESETS[1]).map((x) => x.map((w) => w.w))
    expect(g[0]).toEqual(['Erstens', 'ja']) // Pause > 0,45 s
    expect(g.flat()).toHaveLength(7)
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
