// Untertitel als reine Daten (Wörter + Zeit + Tags + Preset-ID). Dieselben Funktionen erzeugen CSS und Wort-VTT für
// Export (@tscaps/engine) UND Editor-Vorschau – dadurch gilt „Vorschau = Export“.

export interface CaptionPreset {
  id: string
  name: string
  font: string
  /** Schriftgröße als Anteil der Videohöhe (em). */
  size: number
  weight: number
  color: string
  highlight: string
  outline: string
  outlineWidth: number
  upper: boolean
  box: boolean
  wordsPerLine: number
  /** Vertikale Mitte der Untertitel (0..1 der Höhe). */
  y: number
}

export const PRESETS: CaptionPreset[] = [
  { id: 'impact', name: 'Impact Gelb', font: 'Anton', size: 0.052, weight: 400, color: '#FFFFFF', highlight: '#FFD400', outline: '#000000', outlineWidth: 5, upper: true, box: false, wordsPerLine: 3, y: 0.68 },
  { id: 'clean', name: 'Clean Weiß', font: 'Poppins', size: 0.04, weight: 700, color: '#FFFFFF', highlight: '#A855F7', outline: '#000000', outlineWidth: 4, upper: false, box: false, wordsPerLine: 4, y: 0.68 },
  { id: 'box', name: 'Box Schwarz', font: 'Poppins', size: 0.04, weight: 700, color: '#FFFFFF', highlight: '#4ADE80', outline: '#000000', outlineWidth: 14, upper: false, box: true, wordsPerLine: 3, y: 0.68 },
  { id: 'pop', name: 'Pop Pink', font: 'Poppins', size: 0.044, weight: 700, color: '#FFFFFF', highlight: '#FF5C8A', outline: '#000000', outlineWidth: 5, upper: true, box: false, wordsPerLine: 3, y: 0.68 },
  { id: 'mono', name: 'Dezent', font: 'Poppins Medium', size: 0.034, weight: 500, color: '#E5E7EB', highlight: '#FFFFFF', outline: '#000000', outlineWidth: 3, upper: false, box: false, wordsPerLine: 5, y: 0.7 }
]

export interface CaptionStyleOptions { scale?: number; y?: number; highlight?: boolean }

export type TagKind = 'emphasis' | 'entity' | 'hook'
export interface CaptionWord { w: string; start: number; end: number; tag?: TagKind }

/** Rahmen: 1080 px Breite entsprechen 100 cqw; Schriftgrößen in cqh (Container-Höhe = Videohöhe). */
export function captionCss(p: CaptionPreset, o: CaptionStyleOptions = {}): string {
  const size = (p.size * (o.scale ?? 1) * 100).toFixed(3)
  // ASS-Randbreite (px, außen) → em; `paint-order: stroke fill` zeigt nur die äußere Hälfte der Linie → doppelte Breite
  const strokeEm = (2 * p.outlineWidth) / (p.size * 1920)
  const hi = o.highlight !== false
  return `
.segment { font-family: '${p.font}', 'Poppins', system-ui, sans-serif; font-weight: ${p.weight}; font-size: ${size}cqh; color: ${p.color};
  ${p.box ? '' : `-webkit-text-stroke: ${strokeEm.toFixed(3)}em ${p.outline}; paint-order: stroke fill;`}
  text-shadow: 0 0.06em 0.18em rgba(0,0,0,0.55); text-align: center; line-height: 1.15; ${p.upper ? 'text-transform: uppercase;' : ''} }
.line { display: block; text-align: center; }
.word { display: inline-block; margin: 0 0.18em; ${p.box ? 'background: rgba(0,0,0,0.68); padding: 0.04em 0.22em; border-radius: 0.2em;' : ''} }
.word.word-being-narrated { color: ${p.highlight}; transform: scale(1.08); }
${hi ? `.word.emphasis, .word.entity, .word.hook { color: ${p.highlight}; }` : ''}
`.trim()
}

const normWord = (w: string): string => w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')

/** Wortlisten je Tag-Art für `WordlistTagger` (normalisierte Wörter). */
export function tagWordlists(words: CaptionWord[]): Record<TagKind, string[]> {
  const out: Record<TagKind, Set<string>> = { emphasis: new Set(), entity: new Set(), hook: new Set() }
  for (const w of words) if (w.tag) { const n = normWord(w.w); if (n) out[w.tag].add(n) }
  return { emphasis: [...out.emphasis], entity: [...out.entity], hook: [...out.hook] }
}

const vttTime = (t: number): string => {
  const ms = Math.max(0, Math.round(t * 1000))
  const p = (n: number, l = 2): string => String(n).padStart(l, '0')
  return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)}.${p(ms % 1000, 3)}`
}

/**
 * WebVTT mit Wortzeiten (`<hh:mm:ss.mmm>`-Marken). Eine Zeile = `perLine` Wörter; die Zeile endet spätestens, wenn die
 * nächste beginnt (keine überlappenden Zeilen), Nachlauf des letzten Wortes höchstens 0,25 s.
 */
export function buildVtt(words: CaptionWord[], perLine: number): string {
  const n = Math.max(1, perLine)
  let out = 'WEBVTT\n\n'
  for (let i = 0; i < words.length; i += n) {
    const g = words.slice(i, i + n)
    const next = words[i + n]
    const start = g[0].start
    const end = Math.max(g[g.length - 1].end, start + 0.05)
    // Zeilen dürfen sich nie überlappen (die Engine setzt gleichzeitige Zeilen sonst nebeneinander)
    const limit = next ? next.start - 0.02 : Infinity
    const cueEnd = Math.max(start + 0.05, Math.min(end + 0.25, limit))
    const text = g.map((w, k) => (k === 0 ? w.w : `<${vttTime(w.start)}>${w.w}`)).join(' ')
    out += `${vttTime(start)} --> ${vttTime(cueEnd)}\n${text}\n\n`
  }
  return out
}

/** Selektoren eines CSS-Textes mit einem Gültigkeitsbereich versehen (z. B. `.sm-cap`) – für die Editor-Vorschau mit demselben CSS. */
export function scopeCss(css: string, scope: string): string {
  return css
    .split('}')
    .map((rule) => {
      const i = rule.indexOf('{')
      if (i < 0) return ''
      const sel = rule.slice(0, i).split(',').map((s) => `${scope} ${s.trim()}`).join(', ')
      return `${sel} ${rule.slice(i)}}`
    })
    .filter(Boolean)
    .join('\n')
}
