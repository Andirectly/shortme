// Renderer-unabhängiges Preset-Format (Version 2): eine JSON-Datei mit ALLEN Stil-, Animations- und Titelwerten.
// tscaps, ASS-Fallback und (später) Remotion lesen dasselbe JSON. `css` ist ein optionales Zusatzfeld nur für tscaps/Vorschau.
// Alle Maße beziehen sich auf das Ausgabebild 1080×1920 (Pixel) bzw. auf die Schriftgröße (em, %).

export type Appear = 'none' | 'fade' | 'pop' | 'slideUp' | 'blurIn'
export type ActiveMode = 'color' | 'colorScale' | 'colorGlow'
export type GlowColor = 'white' | 'yellow' | 'highlight'

/** Animation (Untertitel und Titel getrennt einstellbar). */
export interface AnimSpec {
  /** Erscheinen */
  appear: Appear
  /** Dauer 0–600 ms */
  appearMs: number
  /** Aktives Wort: nur Farbe / Farbe + Vergrößerung / Farbe + Glow-Puls */
  active: ActiveMode
  /** Vergrößerungsfaktor des aktiven Wortes 1,0–1,3 */
  activeScale: number
  /** Bewegungsgefühl: 1,0 = weich (kritisch gedämpft, kein Überschwingen) … 0,7 = federnd */
  damping: number
  /** Darstellung: Wort für Wort oder ganze Zeile auf einmal */
  display: 'word' | 'line'
  /** Verschwinden */
  disappear: 'none' | 'fade'
  /** Dauer 0–300 ms */
  disappearMs: number
}

export interface CaptionStyle {
  font: { family: string; weight: number }
  /** Schriftgröße in Pixeln (1080×1920): 90–110 */
  sizePx: number
  /** Zeilenabstand (Faktor) 1,1–1,25 */
  lineHeight: number
  upper: boolean
  color: string
  /** Hervorhebungsfarbe (aktives Wort, betonte Wörter) */
  highlight: string
  /** 2–4 Wörter pro Zeile */
  maxWords: number
  /** Vertikale Mitte 0..1 der Bildhöhe */
  y: number
  outline: { enabled: boolean; widthPct: number; color: string }
  shadow: { enabled: boolean; blurPct: number; opacity: number }
  glow: { enabled: boolean; strength: number; color: GlowColor; activeBoost: boolean }
  box: { enabled: boolean; color: string; opacity: number; paddingEm: number; radiusEm: number }
  anim: AnimSpec
  /** Sonder-Vorlagen mit eigener Struktur */
  template?: 'kinetic' | 'glass'
}

export interface TitleStyle {
  enabled: boolean
  /** weiße Box + schwarzer Text oder schwarze Box + weißer Text */
  variant: 'white' | 'black'
  font: { family: string; weight: number }
  sizePx: number
  /** Vertikale Mitte der Titelbox (0..1), Standard: oben in der Sicherheitszone */
  y: number
  /** Zeilenumbruch ab so vielen Zeichen */
  maxChars: number
  /** Anzeigedauer in Sekunden */
  seconds: number
  anim: AnimSpec
}

export interface StylePreset {
  version: 2
  id: string
  name: string
  caption: CaptionStyle
  title: TitleStyle
  /** Optionales eigenes CSS – nur tscaps/Vorschau */
  css?: string
}

export type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] }
export type PresetPatch = DeepPartial<Pick<StylePreset, 'caption' | 'title'>> & { css?: string }

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x)

/** Tiefes Zusammenführen: Werte aus `patch` überschreiben `base`; `undefined` wird übersprungen. */
export function deepMerge<T>(base: T, patch: unknown): T {
  if (!isObj(base) || !isObj(patch)) return (patch === undefined ? base : (patch as T))
  const out: Record<string, unknown> = { ...base }
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue
    out[k] = isObj(v) && isObj(out[k]) ? deepMerge(out[k], v) : v
  }
  return out as T
}

export const DEFAULT_ANIM: AnimSpec = { appear: 'fade', appearMs: 140, active: 'color', activeScale: 1.1, damping: 1, display: 'line', disappear: 'none', disappearMs: 120 }

export const DEFAULT_TITLE: TitleStyle = {
  enabled: false, variant: 'white', font: { family: 'TikTok Sans', weight: 700 }, sizePx: 72, y: 0.13, maxChars: 20, seconds: 3,
  anim: { appear: 'pop', appearMs: 320, active: 'color', activeScale: 1, damping: 1, display: 'line', disappear: 'fade', disappearMs: 200 }
}

const base = (): CaptionStyle => ({
  font: { family: 'Montserrat', weight: 800 }, sizePx: 100, lineHeight: 1.15, upper: false, color: '#FFFFFF', highlight: '#FFD60A', maxWords: 3, y: 0.68,
  outline: { enabled: true, widthPct: 8, color: '#000000' },
  shadow: { enabled: true, blurPct: 10, opacity: 0.6 },
  glow: { enabled: false, strength: 50, color: 'highlight', activeBoost: false },
  box: { enabled: false, color: '#000000', opacity: 0.7, paddingEm: 0.25, radiusEm: 0.15 },
  anim: { ...DEFAULT_ANIM }
})

const mk = (id: string, name: string, c: DeepPartial<CaptionStyle>, title: DeepPartial<TitleStyle> = {}): StylePreset => ({ version: 2, id, name, caption: deepMerge(base(), c), title: deepMerge({ ...DEFAULT_TITLE, anim: { ...DEFAULT_TITLE.anim } }, title) })

/** Eingebaute Presets (Gestaltungswerte A3: 90–110 px, Kontur 6–10 %, Schatten ohne Versatz ≈ 10 % Weichzeichnung bei 50–70 % Schwarz). */
export const BUILTIN_PRESETS: StylePreset[] = [
  mk('impact', 'Impact Gelb', { font: { family: 'Anton', weight: 400 }, sizePx: 108, upper: true, highlight: '#FFD400', maxWords: 3, outline: { widthPct: 9 }, anim: { appear: 'pop', appearMs: 160, active: 'colorScale', activeScale: 1.08, display: 'word' } }),
  mk('clean', 'Clean Weiß', { font: { family: 'Poppins', weight: 700 }, sizePx: 96, highlight: '#A855F7', maxWords: 4, outline: { widthPct: 7 }, anim: { appear: 'fade', appearMs: 150, display: 'line' } }),
  mk('box', 'Box Schwarz', { font: { family: 'Inter', weight: 700 }, sizePx: 92, highlight: '#4ADE80', maxWords: 3, outline: { enabled: false }, shadow: { enabled: false }, box: { enabled: true, color: '#000000', opacity: 0.72 }, anim: { appear: 'slideUp', appearMs: 200, display: 'line' } }),
  mk('pop', 'Pop Pink', { font: { family: 'Montserrat', weight: 800 }, sizePx: 98, upper: true, highlight: '#FF5C8A', maxWords: 3, outline: { widthPct: 8 }, anim: { appear: 'pop', appearMs: 180, active: 'colorScale', activeScale: 1.12, display: 'word' } }),
  mk('mono', 'Dezent', { font: { family: 'Inter', weight: 700 }, sizePx: 90, color: '#E5E7EB', highlight: '#FFFFFF', maxWords: 4, y: 0.7, outline: { widthPct: 6 }, anim: { appear: 'fade', appearMs: 120, display: 'line' } }),
  mk('glow-karaoke', 'Glow Karaoke', { font: { family: 'Montserrat', weight: 800 }, sizePx: 100, color: '#FFFFFF', highlight: '#FFD60A', maxWords: 3, outline: { widthPct: 7 }, glow: { enabled: true, strength: 55, color: 'white', activeBoost: true }, anim: { appear: 'fade', appearMs: 120, active: 'color', display: 'line' } }),
  mk('kinetic', 'Kinetisch', { font: { family: 'Anton', weight: 400 }, sizePx: 104, upper: true, highlight: '#FFD400', maxWords: 4, y: 0.66, outline: { widthPct: 8 }, template: 'kinetic', anim: { appear: 'pop', appearMs: 200, active: 'color', display: 'line' } }),
  mk('glass', 'Glas', { font: { family: 'TikTok Sans', weight: 700 }, sizePx: 92, highlight: '#FFFFFF', maxWords: 4, y: 0.72, outline: { enabled: false }, template: 'glass', anim: { appear: 'blurIn', appearMs: 300, display: 'line' } })
]

export const presetById = (id: string, extra: StylePreset[] = []): StylePreset => [...extra, ...BUILTIN_PRESETS].find((p) => p.id === id) ?? BUILTIN_PRESETS[0]

/** Preset + Änderungen (aus Stil-Studio/Editor) → wirksames Preset. */
export function resolvePreset(base: StylePreset, patch?: PresetPatch | null): StylePreset {
  return patch ? { ...deepMerge(base, patch), version: 2 } : base
}

const num = (x: unknown, lo: number, hi: number, d: number): number => (typeof x === 'number' && Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : d)

/** Importierte/gespeicherte Preset-Datei prüfen und auf gültige Werte begrenzen (fehlende Felder aus dem Standard). */
export function sanitizePreset(x: unknown): StylePreset | null {
  if (!isObj(x) || x.version !== 2 || typeof x.id !== 'string' || typeof x.name !== 'string') return null
  const m = deepMerge(mk(x.id, x.name, {}), { caption: x.caption, title: x.title }) as StylePreset
  const a = (s: AnimSpec): AnimSpec => ({ ...s, appearMs: num(s.appearMs, 0, 600, 140), disappearMs: num(s.disappearMs, 0, 300, 120), activeScale: num(s.activeScale, 1, 1.3, 1.1), damping: num(s.damping, 0.7, 1, 1) })
  m.caption.anim = a(m.caption.anim)
  m.title.anim = a(m.title.anim)
  m.caption.maxWords = Math.round(num(m.caption.maxWords, 1, 6, 3))
  m.caption.sizePx = num(m.caption.sizePx, 40, 200, 100)
  m.title.sizePx = num(m.title.sizePx, 30, 160, 72)
  m.caption.glow.strength = num(m.caption.glow.strength, 0, 100, 50)
  m.id = x.id.replace(/[^\w.-]/g, '_').slice(0, 60) || 'preset'
  if (typeof x.css === 'string') m.css = x.css.slice(0, 20000)
  return m
}

/**
 * Feder → CSS `linear()`-Easing (Dämpfungsgrad 1,0 = weich/kein Überschwingen, 0,7 = federnd). `ms` = Einschwingzeit.
 * Apple-Richtlinie: Standard 1,0; Überschwingen nur bewusst (Regler).
 */
export function springEasing(damping: number, ms: number): string {
  const z = Math.min(1, Math.max(0.3, damping))
  const T = Math.max(0.05, ms / 1000)
  const w = z >= 1 ? 5.8 / T : 3.9 / (z * T)
  const n = 28
  const pts: string[] = []
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * T
    let v: number
    if (z >= 1) v = 1 - (1 + w * t) * Math.exp(-w * t)
    else { const wd = w * Math.sqrt(1 - z * z); v = 1 - Math.exp(-z * w * t) * (Math.cos(wd * t) + ((z * w) / wd) * Math.sin(wd * t)) }
    pts.push((i === n ? 1 : v).toFixed(4).replace(/\.?0+$/, '') || '0')
  }
  return `linear(${pts.join(', ')})`
}
