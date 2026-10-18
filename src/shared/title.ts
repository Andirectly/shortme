// Titel im TikTok-Stil: Box(en) mit runden Ecken, eine Box pro Zeile, eng um den Text, mit verbundenen runden Ecken (SVG-Pfad).
// Eine Funktion für Vorschau (Editor) UND Export (Overlay-Bilder aus einem versteckten Fenster) → Vorschau = Export.
import { springEasing, type AnimSpec, type TitleStyle } from './preset'
import { FRAME_H } from './captions'

/** Titel auf Zeilen umbrechen: gleichmäßig verteilt, höchstens `maxChars` Zeichen je Zeile (Wörter bleiben ganz). */
export function wrapTitle(text: string, maxChars: number): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean)
  if (!words.length) return []
  const total = words.join(' ').length
  const n = Math.max(1, Math.ceil(total / Math.max(6, maxChars)))
  const target = Math.ceil(total / n)
  const lines: string[] = []
  let cur = ''
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w
    if (cur && next.length > target && lines.length < n - 1) { lines.push(cur); cur = w } else cur = next
  }
  if (cur) lines.push(cur)
  return lines
}

export interface TitleLayout {
  lines: Array<{ text: string; w: number }>
  w: number
  h: number
  lineH: number
  /** Pfad der Box-Vereinigung (Koordinaten 0..w, 0..h, Pixel im 1080×1920-Bild) */
  path: string
  fontPx: number
  radius: number
}

type P = [number, number]
const dedupe = (pts: P[]): P[] => {
  const out: P[] = []
  for (const p of pts) if (!out.length || Math.hypot(p[0] - out[out.length - 1][0], p[1] - out[out.length - 1][1]) > 1e-6) out.push(p)
  if (out.length > 1 && Math.hypot(out[0][0] - out[out.length - 1][0], out[0][1] - out[out.length - 1][1]) < 1e-6) out.pop()
  // gleichgerichtete (kollineare) Zwischenpunkte entfernen
  return out.filter((p, i) => { const a = out[(i + out.length - 1) % out.length], b = out[(i + 1) % out.length]; return Math.abs((p[0] - a[0]) * (b[1] - p[1]) - (p[1] - a[1]) * (b[0] - p[0])) > 1e-6 })
}

/** Polygon mit abgerundeten Ecken (konvex und konkav): Quadratkurve über jede Ecke, Radius ≤ halbe Kantenlänge. */
export function roundedPolygonPath(pts: P[], radius: number): string {
  const n = pts.length
  const seg = (i: number): { a: P; b: P } => {
    const v = pts[i], p = pts[(i + n - 1) % n], q = pts[(i + 1) % n]
    const d1 = Math.hypot(p[0] - v[0], p[1] - v[1]), d2 = Math.hypot(q[0] - v[0], q[1] - v[1])
    const r = Math.min(radius, d1 / 2, d2 / 2)
    return { a: [v[0] + ((p[0] - v[0]) / d1) * r, v[1] + ((p[1] - v[1]) / d1) * r], b: [v[0] + ((q[0] - v[0]) / d2) * r, v[1] + ((q[1] - v[1]) / d2) * r] }
  }
  const f = (n_: number): string => (Math.round(n_ * 100) / 100).toString()
  let d = ''
  for (let i = 0; i < n; i++) {
    const { a, b } = seg(i)
    d += `${i === 0 ? 'M' : 'L'}${f(a[0])} ${f(a[1])}Q${f(pts[i][0])} ${f(pts[i][1])} ${f(b[0])} ${f(b[1])}`
  }
  return `${d}Z`
}

/**
 * Layout: je Zeile eine Box (Breite = Text + Innenabstand), alle mittig gestapelt und lückenlos verbunden. `measure(text)` liefert die
 * Textbreite in Pixeln bei Schriftgröße `sizePx` (Aufrufer misst mit der geladenen Schrift).
 */
export function layoutTitle(text: string, t: TitleStyle, measure: (text: string) => number): TitleLayout {
  const lines = wrapTitle(text, t.maxChars)
  const fontPx = t.sizePx
  const padX = fontPx * 0.42
  const lineH = fontPx * 1.32
  const radius = fontPx * 0.34
  const widths = lines.map((l) => Math.ceil(measure(l)) + padX * 2)
  const maxW = Math.max(0, ...widths)
  const pts: P[] = []
  widths.forEach((w, i) => { const x = maxW / 2 + w / 2; pts.push([x, i * lineH], [x, (i + 1) * lineH]) })
  for (let i = widths.length - 1; i >= 0; i--) { const x = maxW / 2 - widths[i] / 2; pts.push([x, (i + 1) * lineH], [x, i * lineH]) }
  const clean = pts.length ? dedupe(pts) : []
  return { lines: lines.map((l, i) => ({ text: l, w: widths[i] })), w: maxW, h: lines.length * lineH, lineH, path: clean.length >= 3 ? roundedPolygonPath(clean, radius) : '', fontPx, radius }
}

const FROM: Record<string, string> = { none: 'opacity: 0', fade: 'opacity: 0', pop: 'opacity: 0; transform: scale(0.7)', slideUp: 'opacity: 0; transform: translateY(0.9em)', blurIn: 'opacity: 0; filter: blur(14px)' }

/** CSS der Titel-Animation (eingefroren wie bei den Untertiteln: Verzögerung aus `--on-title-starts/-ends`). */
export function titleCss(t: TitleStyle): string {
  const a: AnimSpec = t.anim
  const ms = a.appear === 'none' ? 1 : Math.max(1, a.appearMs)
  const outMs = Math.max(1, a.disappearMs)
  return [
    `.sm-title { transform-origin: 50% 50%; ${a.disappear === 'fade' ? `animation: sm-t-in ${ms}ms ${springEasing(a.damping, Math.max(ms, 120))} both, sm-t-out ${outMs}ms linear both; animation-delay: var(--on-title-starts, 0s), calc(var(--on-title-ends, 999s) - ${outMs}ms);` : `animation: sm-t-in ${ms}ms ${springEasing(a.damping, Math.max(ms, 120))} both; animation-delay: var(--on-title-starts, 0s);`} }`,
    `@keyframes sm-t-in { from { ${FROM[a.appear] ?? FROM.fade} } }`,
    '@keyframes sm-t-out { to { opacity: 0 } }'
  ].join('\n')
}

export const titleColors = (t: TitleStyle): { box: string; text: string } => (t.variant === 'white' ? { box: '#FFFFFF', text: '#0A0A0A' } : { box: '#000000', text: '#FFFFFF' })

/** SVG-Markup des Titels (Pixelmaße im 1080×1920-Bild); Breite/Höhe in `cqh`/`cqw`-fähiger Form über viewBox. */
export function titleSvg(l: TitleLayout, t: TitleStyle): string {
  const c = titleColors(t)
  const texts = l.lines.map((ln, i) => `<text x="${l.w / 2}" y="${i * l.lineH + l.lineH / 2}" text-anchor="middle" dominant-baseline="central" dy="0.04em" fill="${c.text}" font-family="'${t.font.family}', 'TikTok Sans', system-ui, sans-serif" font-weight="${t.font.weight}" font-size="${l.fontPx}">${ln.text.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</text>`).join('')
  return `<svg class="sm-title" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${l.w} ${l.h}" width="${l.w}" height="${l.h}" style="display:block;overflow:visible"><path d="${l.path}" fill="${c.box}"/>${texts}</svg>`
}

/** Mittelpunkt der Titelbox im Bild: oben in der Sicherheitszone (`y` = Anteil der Bildhöhe). */
export const titleTopPx = (l: TitleLayout, t: TitleStyle): number => t.y * FRAME_H - l.h / 2
