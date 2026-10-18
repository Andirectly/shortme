import { cueTimes, glowColorOf, groupWords } from '@shared/captions'
import type { CaptionStyle } from '@shared/preset'
import type { ClipTagKind } from '@shared/shortme'

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
/** Deckkraft 0..1 → ASS-Alpha (00 = deckend, FF = durchsichtig). */
const assAlpha = (opacity: number): number => Math.round((1 - Math.max(0, Math.min(1, opacity))) * 255)
const alphaTag = (opacity: number): string => `&H${assAlpha(opacity).toString(16).padStart(2, '0').toUpperCase()}&`

export interface AssOptions { width: number; height: number; style: CaptionStyle }

/**
 * ASS-Fallback aus demselben Preset wie tscaps (renderer-unabhängiges JSON). Näherungen: Glow = weichgezeichnete Kontur-Ebene,
 * Schatten = weichgezeichnete schwarze Ebene ohne Versatz, Box = eckige ASS-Box (keine runden Ecken), Erscheinen = \fad/\t/\move,
 * aktives Wort = Farbe (+ Vergrößerung). Je Wortzustand ein Dialogue (keine Zeitverschiebung nach Pausenschnitten).
 */
export function buildAss(words: CapWord[], o: AssOptions): string {
  const s = o.style
  const k = o.height / 1920
  const fs = Math.round(s.sizePx * k)
  const bord = s.outline.enabled ? Math.max(0, (s.sizePx * s.outline.widthPct * k) / 100) : 0
  const y = Math.round(s.y * o.height)
  const boxPad = s.box.enabled ? Math.round(s.sizePx * s.box.paddingEm * k) : 0
  const style = (name: string, primary: string, outline: string, back: string, border: number, outlineW: number): string =>
    `Style: ${name},${s.font.family},${fs},${primary},${primary},${outline},${back},${s.font.weight >= 600 ? -1 : 0},0,0,0,100,100,0,0,${border},${outlineW},0,5,60,60,0,1`
  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: ${o.width}
PlayResY: ${o.height}
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding
${style('Cap', assColor(s.color), s.box.enabled ? assColor(s.box.color, assAlpha(s.box.opacity)) : assColor(s.outline.color), assColor('#000000', 0x80), s.box.enabled ? 3 : 1, s.box.enabled ? boxPad : bord)}

[Events]
Format: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text
`
  const lines: string[] = []
  const a = s.anim
  const groups = groupWords(words, s)
  const cues = cueTimes(groups)
  const glowC = glowColorOf(s)
  const glowR = s.glow.enabled ? (0.06 + 0.4 * (s.glow.strength / 100)) * s.sizePx * k : 0
  const glowA = s.glow.enabled ? Math.min(1, 0.3 + 0.6 * (s.glow.strength / 100)) : 0
  const pos = (cx: number, cy: number): string => `\\an5\\pos(${cx},${cy})`
  const cx = Math.round(o.width / 2)
  groups.forEach((grp, gi) => {
    const cue = cues[gi]
    const last = grp.length - 1
    const body = (active: number | null, layer: 'text' | 'glow' | 'shadow'): string => grp.map((w, i) => {
      const t = esc(s.upper ? w.w.toUpperCase() : w.w)
      const hidden = a.display === 'word' && active !== null && i > active
      const isActive = active === i
      const tagged = !!w.tag
      const col = isActive || tagged ? s.highlight : s.color
      const scale = isActive && a.active !== 'color' ? Math.round(a.activeScale * 100) : 100
      const vis = hidden ? '\\alpha&HFF&' : '\\alpha&H00&'
      if (layer === 'glow') return `{${vis}\\1a&HFF&\\3c${assOverride(glowC)}\\3a${alphaTag(isActive && s.glow.activeBoost ? Math.min(1, glowA * 1.25) : glowA)}\\bord${(bord + glowR * (isActive && s.glow.activeBoost ? 1.5 : 1)).toFixed(1)}\\blur${(glowR * 0.9).toFixed(1)}\\fscx${scale}\\fscy${scale}}${t}`
      if (layer === 'shadow') return `{${vis}\\1a&HFF&\\3c&H000000&\\3a${alphaTag(s.shadow.opacity)}\\bord${(bord + (s.sizePx * k * s.shadow.blurPct) / 100 * 0.5).toFixed(1)}\\blur${((s.sizePx * k * s.shadow.blurPct) / 100).toFixed(1)}\\fscx${scale}\\fscy${scale}}${t}`
      return `{${vis}\\c${assOverride(col)}\\fscx${scale}\\fscy${scale}}${t}`
    }).join(' ')
    const entry = (i: number): string => {
      if (i !== 0) return ''
      const ms = a.appearMs
      if (a.appear === 'fade') return `\\fad(${ms},0)`
      if (a.appear === 'pop') return `\\fscx60\\fscy60\\t(0,${ms},\\fscx100\\fscy100)`
      if (a.appear === 'blurIn') return `\\blur${Math.round(s.sizePx * k * 0.3)}\\t(0,${ms},\\blur0)`
      return ''
    }
    grp.forEach((w, i) => {
      const next = grp[i + 1]
      const start = i === 0 ? cue.start : w.start
      const end = next ? next.start : cue.end
      if (end - start < 0.02) return
      const fadeOut = i === last && a.disappear === 'fade' ? `\\fad(0,${a.disappearMs})` : ''
      const slide = a.appear === 'slideUp' && i === 0 ? `\\move(${cx},${y + Math.round(s.sizePx * k * 0.35)},${cx},${y},0,${a.appearMs})` : pos(cx, y)
      const head = (extra: string): string => `{${slide}${extra}${fadeOut}}`
      if (s.shadow.enabled && !s.box.enabled) lines.push(`Dialogue: 0,${assTime(start)},${assTime(end)},Cap,,0,0,0,,${head(entry(i))}${body(i, 'shadow')}`)
      if (s.glow.enabled && !s.box.enabled) lines.push(`Dialogue: 1,${assTime(start)},${assTime(end)},Cap,,0,0,0,,${head(entry(i))}${body(i, 'glow')}`)
      lines.push(`Dialogue: 2,${assTime(start)},${assTime(end)},Cap,,0,0,0,,${head(entry(i))}${body(i, 'text')}`)
    })
  })
  return header + lines.join('\n') + '\n'
}
