// Untertitel als reine Daten (Wörter + Zeit + Tags + Preset-ID). Dieselben Funktionen erzeugen CSS und Wort-VTT für
// Export (@tscaps/engine) UND Editor-Vorschau – dadurch gilt „Vorschau = Export“.

/** Erscheinen/Bewegung der Wörter (reines CSS → Vorschau = Export). */
export type CaptionAnim = 'none' | 'pop' | 'fade' | 'slide' | 'kinetic' | 'glass'

export const ANIM_LABEL: Record<CaptionAnim, string> = { none: 'Keine', pop: 'Pop', fade: 'Einblenden', slide: 'Gleiten', kinetic: 'Kinetisch', glass: 'Glas' }

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
  /** Animation beim Erscheinen/Sprechen; fehlt = keine. */
  anim?: CaptionAnim
  /** Höchstens so viele Wörter je Zeile (Standard 6). */
  maxWords?: number
}

/** Überschreibungen des Stils (aus Stil-Studio und Editor) – eine Funktion für Vorschau UND Export. */
export interface CaptionOverrides { font?: string; outline?: number; upper?: boolean; maxWords?: number; anim?: CaptionAnim }

export function resolvePreset(base: CaptionPreset, o: CaptionOverrides = {}): CaptionPreset {
  return { ...base, font: o.font || base.font, outlineWidth: base.outlineWidth * (o.outline ?? 1), upper: o.upper ?? base.upper, maxWords: o.maxWords ?? base.maxWords, anim: o.anim ?? base.anim }
}

export const PRESETS: CaptionPreset[] = [
  { id: 'impact', name: 'Impact Gelb', font: 'Anton', size: 0.052, weight: 400, color: '#FFFFFF', highlight: '#FFD400', outline: '#000000', outlineWidth: 5, upper: true, box: false, wordsPerLine: 3, y: 0.68 },
  { id: 'clean', name: 'Clean Weiß', font: 'Poppins', size: 0.04, weight: 700, color: '#FFFFFF', highlight: '#A855F7', outline: '#000000', outlineWidth: 4, upper: false, box: false, wordsPerLine: 4, y: 0.68 },
  { id: 'box', name: 'Box Schwarz', font: 'Poppins', size: 0.04, weight: 700, color: '#FFFFFF', highlight: '#4ADE80', outline: '#000000', outlineWidth: 14, upper: false, box: true, wordsPerLine: 3, y: 0.68 },
  { id: 'pop', name: 'Pop Pink', font: 'Poppins', size: 0.044, weight: 700, color: '#FFFFFF', highlight: '#FF5C8A', outline: '#000000', outlineWidth: 5, upper: true, box: false, wordsPerLine: 3, y: 0.68 },
  { id: 'mono', name: 'Dezent', font: 'Poppins Medium', size: 0.034, weight: 500, color: '#E5E7EB', highlight: '#FFFFFF', outline: '#000000', outlineWidth: 3, upper: false, box: false, wordsPerLine: 5, y: 0.7 },
  { id: 'kinetic', name: 'Kinetisch', font: 'Anton', size: 0.05, weight: 400, color: '#FFFFFF', highlight: '#FFD400', outline: '#000000', outlineWidth: 4, upper: true, box: false, wordsPerLine: 4, y: 0.66, anim: 'kinetic' },
  { id: 'glass', name: 'Glas', font: 'Poppins', size: 0.04, weight: 600, color: '#FFFFFF', highlight: '#FFFFFF', outline: '#000000', outlineWidth: 0, upper: false, box: false, wordsPerLine: 4, y: 0.72, anim: 'glass' }
]

export interface CaptionStyleOptions { scale?: number; y?: number; highlight?: boolean; /** Schriftfamilie statt der des Stils. */ font?: string }

export type TagKind = 'emphasis' | 'entity' | 'hook'
/** Zusätzlich für Vorlagen: Füllwörter (nur aus der Wortliste, nicht vom LLM). */
export type WordClass = TagKind | 'filler'
export interface CaptionWord { w: string; start: number; end: number; tag?: TagKind }

/** Rahmen: 1080 px Breite entsprechen 100 cqw; Schriftgrößen in cqh (Container-Höhe = Videohöhe). */
export function captionCss(p: CaptionPreset, o: CaptionStyleOptions = {}): string {
  return `${baseCss(p, o)}
${animCss(p)}`
}

function baseCss(p: CaptionPreset, o: CaptionStyleOptions): string {
  const size = (p.size * (o.scale ?? 1) * 100).toFixed(3)
  // ASS-Randbreite (px, außen) → em; `paint-order: stroke fill` zeigt nur die äußere Hälfte der Linie → doppelte Breite
  const strokeEm = (2 * p.outlineWidth) / (p.size * 1920)
  const hi = o.highlight !== false
  return `
.segment { white-space: nowrap; font-family: '${p.font}', 'Poppins', system-ui, sans-serif; font-weight: ${p.weight}; font-size: ${size}cqh; color: ${p.color};
  ${p.box ? '' : `-webkit-text-stroke: ${strokeEm.toFixed(3)}em ${p.outline}; paint-order: stroke fill;`}
  text-shadow: 0 0.06em 0.18em rgba(0,0,0,0.55); text-align: center; line-height: 1.15; ${p.upper ? 'text-transform: uppercase;' : ''} }
.line { display: block; text-align: center; }
.word { display: inline-block; margin: 0 0.18em; ${p.box ? 'background: rgba(0,0,0,0.68); padding: 0.04em 0.22em; border-radius: 0.2em;' : ''} }
.word.word-being-narrated { color: ${p.highlight}; transform: scale(1.08); }
${hi ? `.word.emphasis, .word.entity, .word.hook { color: ${p.highlight}; }` : ''}
`.trim()
}

/** CSS der Animation. `.word` erscheint beim Zeilenstart, `.word-being-narrated` ist das gerade gesprochene Wort. */
function animCss(p: CaptionPreset): string {
  switch (p.anim) {
    case 'pop': return `@keyframes sm-pop { 0% { transform: scale(0.6); opacity: 0 } 60% { transform: scale(1.14); opacity: 1 } 100% { transform: scale(1) } }
.word { animation: sm-pop 0.22s cubic-bezier(0.2, 0.9, 0.3, 1.2) both; animation-delay: var(--on-segment-starts, 0s); }`
    case 'fade': return `@keyframes sm-fade { from { opacity: 0 } to { opacity: 1 } }
.word { animation: sm-fade 0.2s ease-out both; animation-delay: var(--on-segment-starts, 0s); }`
    case 'slide': return `@keyframes sm-slide { from { transform: translateY(0.35em); opacity: 0; filter: blur(0.08em) } to { transform: none; opacity: 1; filter: none } }
.word { animation: sm-slide 0.24s ease-out both; animation-delay: var(--on-segment-starts, 0s); }`
    case 'kinetic': return `.line { display: flex; align-items: baseline; justify-content: center; }
.word { font-size: 0.66em; opacity: 0.9; margin: 0 0.1em; }
.word.emphasis, .word.entity, .word.hook { font-size: 1.6em; opacity: 1; color: ${p.highlight}; animation: sm-kin 0.26s cubic-bezier(0.2, 0.9, 0.3, 1.25) both; animation-delay: var(--on-segment-starts, 0s); }
.word.filler { font-size: 0.5em; opacity: 0.5; }
.word.word-being-narrated { transform: none; color: ${p.highlight}; opacity: 1; }
@keyframes sm-kin { 0% { transform: scale(0.55) translateY(0.15em); opacity: 0 } 65% { transform: scale(1.12) } 100% { transform: none; opacity: 1 } }`
    case 'glass': return `.line { display: inline-block; padding: 0.22em 0.62em; border-radius: 0.72em; background: linear-gradient(180deg, rgba(255,255,255,0.28), rgba(255,255,255,0.12)); border: 0.05em solid rgba(255,255,255,0.4); box-shadow: 0 0.2em 0.9em rgba(0,0,0,0.38), inset 0 0.05em 0 rgba(255,255,255,0.55); }
.word { opacity: 0.74; animation: sm-glass 0.3s ease-out both; animation-delay: var(--on-segment-starts, 0s); }
.word.emphasis, .word.entity, .word.hook { font-weight: 700; opacity: 0.95; }
.word.word-being-narrated { opacity: 1; transform: none; color: #fff; text-shadow: 0 0 0.4em rgba(255,255,255,0.6), 0 0.06em 0.18em rgba(0,0,0,0.5); }
@keyframes sm-glass { from { filter: blur(0.3em); opacity: 0; transform: translateY(0.2em) } to { filter: none } }`
    default: return ''
  }
}

/** Füllwörter (DE/EN): in „Kinetisch“ klein und blass, damit das Hauptwort wirkt. */
const FILLERS = new Set(['und', 'oder', 'aber', 'also', 'ja', 'äh', 'ähm', 'halt', 'eben', 'dann', 'so', 'ne', 'na', 'ok', 'okay', 'mal', 'nur', 'ich', 'du', 'er', 'sie', 'es', 'wir', 'ihr', 'der', 'die', 'das', 'ein', 'eine', 'ist', 'sind', 'war', 'hab', 'habe', 'zu', 'in', 'an', 'auf', 'mit', 'von', 'für', 'and', 'but', 'uh', 'um', 'like', 'the', 'a', 'of', 'to', 'is', 'it', 'i', 'you', 'we', 'that'])
export const isFiller = (w: string): boolean => FILLERS.has(w.toLowerCase().replace(/[^p{L}p{N}]/gu, ''))

const normWord = (w: string): string => w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')

/** Wortlisten je Tag-Art für `WordlistTagger` (normalisierte Wörter). */
export function tagWordlists(words: CaptionWord[]): Record<WordClass, string[]> {
  const out: Record<WordClass, Set<string>> = { emphasis: new Set(), entity: new Set(), hook: new Set(), filler: new Set() }
  for (const w of words) { const n = normWord(w.w); if (!n) continue; if (w.tag) out[w.tag].add(n); else if (FILLERS.has(n)) out.filler.add(n) }
  // ein Wort, das irgendwo betont ist, wird nirgends als Füllwort abgesetzt
  for (const k of ['emphasis', 'entity', 'hook'] as const) for (const n of out[k]) out.filler.delete(n)
  return { emphasis: [...out.emphasis], entity: [...out.entity], hook: [...out.hook], filler: [...out.filler] }
}

const vttTime = (t: number): string => {
  const ms = Math.max(0, Math.round(t * 1000))
  const p = (n: number, l = 2): string => String(n).padStart(l, '0')
  return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)}.${p(ms % 1000, 3)}`
}

/** Mittlere Zeichenbreite (in em) je Schrift – für das Zeilenbudget; Großbuchstaben sind breiter. */
const CHAR_EM: Record<string, number> = { Anton: 0.4, Poppins: 0.58, 'Poppins Medium': 0.56 }
const UPPER_FACTOR = 1.14
const SENTENCE_END = /[.!?…]["”')]*$/
const CLAUSE_END = /[,;:]["”')]*$/

/** Wie viele Zeichen (einschließlich Wortabstand/Box-Polster) passen bei dieser Schrift auf EINE Zeile des 1080-px-Bildes? */
export function lineBudgetEm(p: CaptionPreset, scale = 1): { usablePx: number; fontPx: number; charEm: number } {
  const fontPx = p.size * scale * 1920
  const charEm = (CHAR_EM[p.font] ?? 0.58) * (p.upper ? UPPER_FACTOR : 1)
  return { usablePx: 1080 * 0.86, fontPx, charEm }
}

/**
 * Wörter → Untertitel-Zeilen, immer EINZEILIG: eine Zeile endet, wenn das Zeichenbudget voll ist, nach Satzende,
 * bei einer Sprechpause (> 0,45 s) oder bei maximal 6 Wörtern; Kommas sind bevorzugte Umbruchstellen ab 60 % Füllung.
 * Kurze Reste (1 kurzes Wort) werden an die Vorzeile gehängt, wenn sie noch passen.
 */
export function groupWords<T extends CaptionWord>(words: T[], p: CaptionPreset, scale = 1): T[][] {
  const { usablePx, fontPx, charEm } = lineBudgetEm(p, scale)
  const gapEm = 0.36 + 0.22 + (p.box ? 0.44 : 0) // Wortabstand + Box-Polster je Wort
  // Kinetisch: Hauptwörter ≈ 1,6×, Nebenwörter ≈ 0,66×, Füllwörter 0,5× – sonst läuft die Zeile über
  const factor = (w: T): number => (p.anim === 'kinetic' ? (w.tag ? 1.6 : isFiller(w.w) ? 0.5 : 0.66) : 1)
  const widthEm = (g: T[]): number => g.reduce((n, w) => n + w.w.length * charEm * factor(w), 0) + Math.max(0, g.length - 1) * gapEm + (p.box ? 0.44 : 0) + (p.anim === 'glass' ? 1.4 : 0)
  const fits = (g: T[]): boolean => widthEm(g) * fontPx <= usablePx
  const groups: T[][] = []
  let cur: T[] = []
  for (let i = 0; i < words.length; i++) {
    const w = words[i]
    const prev = cur[cur.length - 1]
    const pause = prev && w.start - prev.end > 0.45
    if (cur.length && (!fits([...cur, w]) || cur.length >= (p.maxWords ?? 6) || pause)) { groups.push(cur); cur = [] }
    cur.push(w)
    const full = widthEm(cur) * fontPx / usablePx
    if (SENTENCE_END.test(w.w) || (CLAUSE_END.test(w.w) && full >= 0.6)) { groups.push(cur); cur = [] }
  }
  if (cur.length) groups.push(cur)
  // einzelnes kurzes Restwort an die Vorzeile hängen (wenn es noch passt und nicht über einen Satzschluss hinweg)
  for (let i = groups.length - 1; i > 0; i--) {
    const g = groups[i]
    const before = groups[i - 1]
    if (g.length === 1 && g[0].w.length <= 4 && !SENTENCE_END.test(before[before.length - 1].w) && g[0].start - before[before.length - 1].end < 0.3 && fits([...before, g[0]])) { before.push(g[0]); groups.splice(i, 1) }
  }
  return groups
}

/**
 * WebVTT mit Wortzeiten (`<hh:mm:ss.mmm>`-Marken). Eine Zeile = eine Gruppe aus `groupWords`; die Zeile endet spätestens, wenn
 * die nächste beginnt (keine überlappenden Zeilen), Nachlauf des letzten Wortes höchstens 0,25 s.
 */
export function buildVtt(groups: CaptionWord[][]): string {
  let out = 'WEBVTT\n\n'
  groups.forEach((g, gi) => {
    const nextStart = groups[gi + 1]?.[0].start
    const start = g[0].start
    const end = Math.max(g[g.length - 1].end, start + 0.05)
    // Zeilen dürfen sich nie überlappen (die Engine setzt gleichzeitige Zeilen sonst nebeneinander)
    const limit = nextStart !== undefined ? nextStart - 0.02 : Infinity
    const cueEnd = Math.max(start + 0.05, Math.min(end + 0.25, limit))
    const text = g.map((w, k) => (k === 0 ? w.w : `<${vttTime(w.start)}>${w.w}`)).join(' ')
    out += `${vttTime(start)} --> ${vttTime(cueEnd)}\n${text}\n\n`
  })
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
