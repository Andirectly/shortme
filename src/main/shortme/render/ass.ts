import type { ClipTagKind } from '@shared/shortme'

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

export interface CapWord { w: string; start: number; end: number; tag?: ClipTagKind }

/** `#RRGGBB` → ASS `&HBBGGRR&`. */
export const assColor = (hex: string, alpha = 0): string => {
  const h = hex.replace('#', '')
  const r = h.slice(0, 2); const g = h.slice(2, 4); const b = h.slice(4, 6)
  return `&H${alpha.toString(16).padStart(2, '0')}${b}${g}${r}`.toUpperCase()
}

/** Farbe für Override-Tags (`\c&HBBGGRR&`). */
export const assOverride = (hex: string): string => {
  const h = hex.replace('#', '')
  return `&H${h.slice(4, 6)}${h.slice(2, 4)}${h.slice(0, 2)}&`.toUpperCase()
}

/** Sekunden → `H:MM:SS.cc`. */
export const assTime = (t: number): string => {
  const cs = Math.max(0, Math.round(t * 100))
  const h = Math.floor(cs / 360000)
  const m = Math.floor((cs % 360000) / 6000)
  const s = Math.floor((cs % 6000) / 100)
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`
}

const esc = (t: string): string => t.replace(/\\/g, '\\\\').replace(/\{/g, '(').replace(/\}/g, ')')

export interface AssOptions { width: number; height: number; preset: CaptionPreset; hook?: { text: string; seconds: number } | null; hookColor?: string; hookBox?: string }

/**
 * ASS aus Wörtern auf der GEKÜRZTEN Zeitleiste. Je Wortgruppe ein Block; innerhalb der Gruppe färbt jedes Wort während seiner
 * Sprechzeit auf die Hervorhebungsfarbe (ein Dialogue pro Wortzustand → keine Zeitverschiebung nach Pausenschnitten).
 */
export function buildAss(words: CapWord[], o: AssOptions): string {
  const p = o.preset
  const fs = Math.round(p.size * o.height)
  const border = p.box ? 3 : 1
  const y = Math.round(p.y * o.height)
  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: ${o.width}
PlayResY: ${o.height}
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding
Style: Cap,${p.font},${fs},${assColor(p.color)},${assColor(p.color)},${assColor(p.outline)},${assColor('#000000', 0x60)},${p.weight >= 600 ? -1 : 0},0,0,0,100,100,0,0,${border},${p.box ? 0 : p.outlineWidth},${p.box ? 0 : 2},5,60,60,0,1
Style: Hook,Poppins,${Math.round(0.042 * o.height)},${assColor(o.hookColor ?? '#FFFFFF')},${assColor('#FFFFFF')},${assColor(o.hookBox ?? '#000000', 0x40)},${assColor('#000000', 0x90)},-1,0,0,0,100,100,0,0,3,18,4,8,70,70,${Math.round(0.08 * o.height)},1

[Events]
Format: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text
`
  const lines: string[] = []
  if (o.hook?.text) lines.push(`Dialogue: 1,${assTime(0)},${assTime(o.hook.seconds)},Hook,,0,0,0,,{\\fad(150,200)}${esc(o.hook.text)}`)
  const n = Math.max(1, p.wordsPerLine)
  for (let g = 0; g < words.length; g += n) {
    const grp = words.slice(g, g + n)
    const text = (i: number | null): string => grp.map((w, k) => {
      const t = esc(p.upper ? w.w.toUpperCase() : w.w)
      const active = i === k
      const tagged = !!w.tag
      return active || tagged ? `{\\c${assOverride(p.highlight)}${active ? '\\fscx108\\fscy108' : ''}}${t}{\\c${assOverride(p.color)}\\fscx100\\fscy100}` : t
    }).join(' ')
    grp.forEach((w, k) => {
      const next = grp[k + 1]
      const start = w.start
      // Ende: bis zum nächsten Wort der Gruppe, beim letzten Wort bis zu 0,25 s nach Wortende (kein Flackern in kurzen Lücken)
      const end = next ? next.start : Math.min(w.end + 0.25, words[g + n]?.start ?? Infinity)
      if (end - start < 0.02) return
      lines.push(`Dialogue: 0,${assTime(start)},${assTime(end)},Cap,,0,0,0,,{\\an5\\pos(${Math.round(o.width / 2)},${y})}${text(k)}`)
    })
  }
  return header + lines.join('\n') + '\n'
}
