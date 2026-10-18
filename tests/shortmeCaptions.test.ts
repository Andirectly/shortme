import { describe, expect, it } from 'vitest'
import { FROZEN_CSS, buildVtt, captionCss, cueTimes, glowShadows, groupWords, lineBudget, scopeCss, segmentVars, tagWordlists, wordVars, type CaptionWord } from '../src/shared/captions'
import { BUILTIN_PRESETS, deepMerge, resolvePreset, sanitizePreset, springEasing, type StylePreset } from '../src/shared/preset'

const P = (id: string): StylePreset => BUILTIN_PRESETS.find((p) => p.id === id)!
const words: CaptionWord[] = [
  { w: 'Hallo', start: 0.5, end: 0.9 }, { w: 'du', start: 1, end: 1.2 }, { w: 'schöne', start: 1.3, end: 1.8, tag: 'emphasis' },
  { w: 'Welt.', start: 1.75, end: 2.4, tag: 'entity' }, { w: 'Neu', start: 4, end: 4.3 }
]
const CUE_RE = /(\d\d:\d\d:\d\d\.\d{3}) --> (\d\d:\d\d:\d\d\.\d{3})\n(.*)\n/g

describe('Untertitel-Daten', () => {
  it('VTT: Wortzeiten, eine Zeile je Gruppe, Satzende beendet die Zeile, nie überlappend', () => {
    const groups = groupWords(words, P('impact').caption)
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

  it('Zeilenzeiten überlappen nie, auch bei überlappenden ASR-Wortzeiten', () => {
    const w: CaptionWord[] = [{ w: 'a.', start: 0, end: 1 }, { w: 'b.', start: 0.5, end: 0.9 }, { w: 'c.', start: 0.6, end: 1.5 }, { w: 'd.', start: 0.7, end: 1.2 }]
    const cues = cueTimes(groupWords(w, P('clean').caption))
    expect(cues).toHaveLength(4)
    for (let i = 1; i < cues.length; i++) expect(cues[i - 1].end <= cues[i].start + 0.05).toBe(true)
  })

  it('Gruppierung: immer einzeilig und ≤ maxWords; alle Presets, nichts geht verloren', () => {
    const text = 'Das ist ein ziemlich langer Satz ohne Satzzeichen der eigentlich nie aufhört weil er einfach immer weiterläuft und weiterläuft und weiterläuft'.split(' ')
    const ws: CaptionWord[] = text.map((w, i) => ({ w, start: i * 0.3, end: i * 0.3 + 0.25 }))
    for (const p of BUILTIN_PRESETS) {
      const { usablePx, fontPx, charEm } = lineBudget(p.caption)
      const groups = groupWords(ws, p.caption)
      expect(groups.flat().map((w) => w.w)).toEqual(text)
      for (const g of groups) {
        expect(g.length).toBeLessThanOrEqual(Math.max(1, p.caption.maxWords))
        const chars = g.reduce((n, w) => n + w.w.length, 0)
        if (p.caption.template !== 'kinetic') expect(chars * charEm * fontPx).toBeLessThanOrEqual(usablePx + 1e-6)
      }
    }
  })

  it('Gruppierung: Pause und Komma als Umbruchstellen', () => {
    const ws: CaptionWord[] = [
      { w: 'Erstens', start: 0, end: 0.4 }, { w: 'ja', start: 0.45, end: 0.7 },
      { w: 'dann', start: 2, end: 2.3 }, { w: 'gehen', start: 2.35, end: 2.6 }, { w: 'wir,', start: 2.65, end: 2.9 }, { w: 'weil', start: 2.95, end: 3.2 }, { w: 'es', start: 3.25, end: 3.4 }
    ]
    const g = groupWords(ws, P('clean').caption).map((x) => x.map((w) => w.w))
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

describe('Gestaltungswerte (A3) für alle Presets', () => {
  it('90–110 px, Kontur 6–10 %, Zeilenabstand 1,1–1,25, 2–4 Wörter, nur lokale fette serifenlose Schriften', () => {
    const fonts = ['TikTok Sans', 'Montserrat', 'Inter', 'Poppins', 'Anton']
    for (const p of BUILTIN_PRESETS) {
      const c = p.caption
      expect(c.sizePx, p.id).toBeGreaterThanOrEqual(66)
      expect(c.sizePx, p.id).toBeLessThanOrEqual(84)
      if (c.outline.enabled) { expect(c.outline.widthPct, p.id).toBeGreaterThanOrEqual(6); expect(c.outline.widthPct, p.id).toBeLessThanOrEqual(10) }
      expect(c.lineHeight, p.id).toBeGreaterThanOrEqual(1.1)
      expect(c.lineHeight, p.id).toBeLessThanOrEqual(1.25)
      expect(c.maxWords, p.id).toBeGreaterThanOrEqual(2)
      expect(c.maxWords, p.id).toBeLessThanOrEqual(4)
      expect(fonts, p.id).toContain(c.font.family)
      if (c.shadow.enabled) { expect(c.shadow.blurPct).toBeCloseTo(10, 0); expect(c.shadow.opacity).toBeGreaterThanOrEqual(0.5); expect(c.shadow.opacity).toBeLessThanOrEqual(0.7) }
      if (c.box.enabled) { expect(c.box.paddingEm).toBe(0.25); expect(c.box.radiusEm).toBe(0.15) }
    }
  })
})

describe('Untertitel-CSS (gemeinsam für Export und Vorschau)', () => {
  it('Schrift, Größe in cqh (px/19,2), Kontur in em, Schatten ohne Versatz, Tag-Klassen', () => {
    const css = captionCss(P('impact').caption)
    expect(css).toContain("'Anton'")
    expect(css).toContain('font-size: 4.219cqh') // 81 px
    expect(css).toContain('text-transform: uppercase')
    expect(css).toContain('-webkit-text-stroke: 0.180em') // 9 % → 2 × 9 %
    expect(css).toContain('0 0 0.100em rgba(0,0,0,0.600)')
    expect(css).toContain('.word.emphasis')
    expect(captionCss(P('impact').caption, { highlight: false })).not.toContain('.word.emphasis')
  })
  it('Box-Preset: Hintergrundbox mit Innenabstand 0,25 em und Radius 0,15 em, keine Kontur', () => {
    const css = captionCss(P('box').caption)
    expect(css).toContain('background: rgba(0,0,0,0.720)')
    expect(css).toContain('border-radius: 0.15em')
    expect(css).toContain('padding: 0.125em 0.25em')
    expect(css).not.toContain('-webkit-text-stroke')
  })
  it('Animationen hängen an den Zeit-Variablen (eingefroren): Wort-für-Wort an der Wortzeit, Zeile am Segmentbeginn', () => {
    const word = captionCss(P('impact').caption)
    expect(word).toContain('animation-delay: var(--on-word-being-narrated-starts, 0s)')
    const line = captionCss(P('clean').caption)
    expect(line).toContain('animation-delay: var(--on-segment-starts, 0s)')
    expect(line).toContain('@keyframes sm-in')
    expect(FROZEN_CSS).toContain('animation-play-state: paused !important')
  })
  it('Verschwinden: nur wenn gewählt, Verzögerung bis Segmentende', () => {
    const p = resolvePreset(P('clean'), { caption: { anim: { disappear: 'fade', disappearMs: 200 } } })
    expect(captionCss(p.caption)).toContain('calc(var(--on-segment-ends, 999s) - 200ms)')
    expect(captionCss(P('clean').caption)).not.toContain('animation: sm-out')
  })
  it('Zeit-Variablen wie in tscaps: relativ zur Abspielzeit, negativ = vergangen', () => {
    expect(segmentVars({ start: 1, end: 3 }, 2)).toEqual({ '--on-segment-starts': '-1.000s', '--on-segment-ends': '1.000s' })
    expect(wordVars({ start: 2.5, end: 2.9 }, 2)['--on-word-being-narrated-starts']).toBe('0.500s')
  })
  it('scopeCss setzt jeden Selektor unter den Bereich und lässt @keyframes unverändert', () => {
    const s = scopeCss('.a, .b .c { color: red; }\n@keyframes k { from { opacity: 0 } }\n.d { top: 0; }', '.sm-cap')
    expect(s).toContain('.sm-cap .a, .sm-cap .b .c { color: red; }')
    expect(s).toContain('@keyframes k { from { opacity: 0 } }')
    expect(s).toContain('.sm-cap .d { top: 0; }')
  })
})

describe('Glow Karaoke (A4)', () => {
  it('Stärke steuert Radius und Deckkraft; aus = keine Glow-Schatten; Farbe folgt Hervorhebung', () => {
    const base = P('glow-karaoke').caption
    expect(glowShadows(base).length).toBe(2)
    const weak = glowShadows({ ...base, glow: { ...base.glow, strength: 10 } })[0]
    const strong = glowShadows({ ...base, glow: { ...base.glow, strength: 100 } })[0]
    const r = (x: string): number => parseFloat(x.split(' ')[2])
    expect(r(strong)).toBeGreaterThan(r(weak))
    expect(glowShadows({ ...base, glow: { ...base.glow, enabled: false } })).toEqual([])
    expect(glowShadows({ ...base, glow: { ...base.glow, color: 'highlight' } })[0]).toContain('255,214,10')
    expect(glowShadows(base, 1.6)[0]).not.toBe(glowShadows(base, 1)[0]) // aktives Wort stärker
  })
  it('Preset: Text weiß, aktives Wort #FFD60A, dünne Kontur 6–8 %', () => {
    const c = P('glow-karaoke').caption
    expect(c.color).toBe('#FFFFFF'); expect(c.highlight).toBe('#FFD60A')
    expect(c.outline.widthPct).toBeGreaterThanOrEqual(6); expect(c.outline.widthPct).toBeLessThanOrEqual(8)
  })
})

describe('Preset-Format (A2)', () => {
  it('JSON-Rundlauf: sanitizePreset liefert dasselbe Preset, Werte werden begrenzt', () => {
    const p = P('glow-karaoke')
    expect(sanitizePreset(JSON.parse(JSON.stringify(p)))).toEqual(p)
    const bad = sanitizePreset({ ...p, caption: { ...p.caption, sizePx: 999, anim: { ...p.caption.anim, appearMs: 5000, damping: 0.1, activeScale: 9 } } })!
    expect(bad.caption.sizePx).toBe(200)
    expect(bad.caption.anim.appearMs).toBe(600)
    expect(bad.caption.anim.damping).toBe(0.7)
    expect(bad.caption.anim.activeScale).toBe(1.3)
    expect(sanitizePreset({ id: 'x' })).toBeNull()
  })
  it('deepMerge: tief, ohne undefined', () => {
    expect(deepMerge({ a: { b: 1, c: 2 }, d: 3 }, { a: { b: 9 }, d: undefined })).toEqual({ a: { b: 9, c: 2 }, d: 3 })
  })
  it('Feder-Easing: weich (1,0) überschwingt nie, federnd (0,7) schon', () => {
    const vals = (e: string): number[] => e.slice(7, -1).split(',').map(Number)
    expect(Math.max(...vals(springEasing(1, 300)))).toBeLessThanOrEqual(1.0001)
    expect(Math.max(...vals(springEasing(0.7, 300)))).toBeGreaterThan(1.02)
  })
})
