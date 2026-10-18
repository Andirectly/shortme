// Untertitel als reine Daten (Wörter + Zeit + Tags) + Preset (shared/preset.ts). Dieselben Funktionen erzeugen CSS, Wortgruppen,
// Zeit-Variablen und WebVTT für Export (@tscaps/engine) UND Editor-Vorschau – dadurch gilt „Vorschau = Export“.
import { springEasing, type CaptionStyle, type GlowColor } from './preset'

export type TagKind = 'emphasis' | 'entity' | 'hook'
/** Zusätzlich für Vorlagen: Füllwörter (nur aus der Wortliste, nicht vom LLM). */
export type WordClass = TagKind | 'filler'
export interface CaptionWord { w: string; start: number; end: number; tag?: TagKind }

/** Rahmen: Bildhöhe 1920 px = 100 cqh, Breite 1080 px = 100 cqw. */
export const FRAME_W = 1080
export const FRAME_H = 1920
const cqh = (px: number): string => `${(px / (FRAME_H / 100)).toFixed(3)}cqh`

const GLOW_RGB: Record<Exclude<GlowColor, 'highlight'>, string> = { white: '#FFFFFF', yellow: '#FFD60A' }
const hexToRgb = (hex: string): [number, number, number] => { const h = hex.replace('#', ''); return [parseInt(h.slice(0, 2), 16) || 0, parseInt(h.slice(2, 4), 16) || 0, parseInt(h.slice(4, 6), 16) || 0] }
export const rgba = (hex: string, a: number): string => { const [r, g, b] = hexToRgb(hex); return `rgba(${r},${g},${b},${Math.max(0, Math.min(1, a)).toFixed(3)})` }
export const glowColorOf = (s: CaptionStyle): string => (s.glow.color === 'highlight' ? s.highlight : GLOW_RGB[s.glow.color])

/** Glow als text-shadow-Ebenen: Radius und Deckkraft wachsen mit der Stärke 0–100 (`boost` = stärker auf dem aktiven Wort). */
export function glowShadows(s: CaptionStyle, boost = 1): string[] {
  if (!s.glow.enabled || s.glow.strength <= 0) return []
  const k = s.glow.strength / 100
  const r = (0.06 + 0.4 * k) * boost
  const a = Math.min(1, (0.3 + 0.6 * k) * Math.min(1.25, boost))
  const c = glowColorOf(s)
  return [`0 0 ${r.toFixed(3)}em ${rgba(c, a)}`, `0 0 ${(r * 2.2).toFixed(3)}em ${rgba(c, a * 0.55)}`]
}

/** Schatten ohne Versatz: Weichzeichnung in % der Schriftgröße, Deckkraft der schwarzen Fläche. */
export const dropShadow = (s: CaptionStyle): string[] => (s.shadow.enabled ? [`0 0 ${(s.shadow.blurPct / 100).toFixed(3)}em ${rgba('#000000', s.shadow.opacity)}`] : [])

/** Aus dem Stil: Wortfarbe, Grundschatten, Schatten des aktiven Worts. */
function shadows(s: CaptionStyle): { base: string; active: string } {
  const d = dropShadow(s)
  const base = [...glowShadows(s), ...d]
  const active = [...glowShadows(s, s.glow.activeBoost ? 1.6 : 1), ...d]
  return { base: base.length ? base.join(', ') : 'none', active: active.length ? active.join(', ') : 'none' }
}

/**
 * CSS der Untertitel. Animationen sind „eingefroren“ (tscaps setzt Pause + negative Verzögerung je Bild; die Vorschau macht dasselbe
 * mit denselben Variablen, siehe `timeVars`) – darum hängen alle Verzögerungen an den Engine-Variablen `--on-…-starts/-ends`.
 */
export function captionCss(s: CaptionStyle, o: { highlight?: boolean; css?: string } = {}): string {
  const hi = o.highlight !== false
  const sh = shadows(s)
  const a = s.anim
  const ease = springEasing(a.damping, Math.max(a.appearMs, 120))
  const appearMs = Math.max(1, a.appearMs)
  const inDelay = a.display === 'word' ? 'var(--on-word-being-narrated-starts, 0s)' : 'var(--on-segment-starts, 0s)'
  const from: Record<string, string> = { none: 'opacity: 0', fade: 'opacity: 0', pop: 'opacity: 0; transform: scale(0.6)', slideUp: 'opacity: 0; transform: translateY(0.35em)', blurIn: 'opacity: 0; filter: blur(0.3em)' }
  const dur = a.appear === 'none' ? 1 : appearMs
  const strokeEm = s.outline.enabled ? (2 * s.outline.widthPct) / 100 : 0
  const pad = s.box.paddingEm
  const actMs = 130
  // aktives Wort
  const act: string[] = ['color: var(--hi)']
  if (a.active === 'colorScale') act.push(`scale: ${a.activeScale}`)
  if (s.glow.enabled || a.active === 'colorGlow') act.push(`text-shadow: ${sh.active === 'none' && a.active === 'colorGlow' ? glowShadows({ ...s, glow: { ...s.glow, enabled: true, color: 'highlight' } }, 1.6).join(', ') : sh.active}`)
  const pulse = a.active === 'colorGlow'
    ? `@keyframes sm-act-in { 0% { } 45% { color: var(--hi); text-shadow: ${glowShadows({ ...s, glow: { ...s.glow, enabled: true, strength: Math.max(60, s.glow.strength), color: 'highlight' } }, 1.9).join(', ')} } 100% { color: var(--hi); text-shadow: ${sh.active === 'none' ? glowShadows({ ...s, glow: { ...s.glow, enabled: true, color: 'highlight' } }, 1.1).join(', ') : sh.active} } }`
    : `@keyframes sm-act-in { to { ${act.join('; ')} } }`
  const lines = [
    `.segment { --hi: ${s.highlight}; --base: ${s.color}; white-space: nowrap; font-family: '${s.font.family}', 'Poppins', system-ui, sans-serif; font-weight: ${s.font.weight}; font-size: ${cqh(s.sizePx)}; line-height: ${s.lineHeight}; color: ${s.color}; text-align: center; ${s.upper ? 'text-transform: uppercase; ' : ''}${strokeEm ? `-webkit-text-stroke: ${strokeEm.toFixed(3)}em ${s.outline.color}; paint-order: stroke fill; ` : ''}text-shadow: ${sh.base}; }`,
    `.line { display: block; text-align: center; ${a.disappear === 'fade' ? `animation: sm-out ${Math.max(1, a.disappearMs)}ms linear both; animation-delay: calc(var(--on-segment-ends, 999s) - ${Math.max(1, a.disappearMs)}ms); ` : ''}}`,
    `.word { display: inline-block; margin: 0 0.18em; ${s.box.enabled ? `background: ${rgba(s.box.color, s.box.opacity)}; padding: ${(pad / 2).toFixed(3)}em ${pad}em; border-radius: ${s.box.radiusEm}em; ` : ''}animation: sm-in ${dur}ms ${ease} both, sm-act-in ${actMs}ms ease-out both, sm-act-out ${actMs}ms ease-in both; animation-delay: ${inDelay}, var(--on-word-being-narrated-starts, 0s), var(--on-word-being-narrated-ends, 0s); }`,
    ...(hi ? ['.word.emphasis, .word.entity, .word.hook { color: var(--hi); --base: var(--hi); }'] : []),
    `@keyframes sm-in { from { ${from[a.appear] ?? from.fade} } }`,
    pulse,
    `@keyframes sm-act-out { to { color: var(--base); scale: 1; text-shadow: ${sh.base}; } }`,
    '@keyframes sm-out { to { opacity: 0 } }'
  ]
  if (s.template === 'kinetic') {
    lines.push('.line { display: flex; align-items: baseline; justify-content: center; }', '.word { font-size: 0.66em; margin: 0 0.1em; }', '.word.emphasis, .word.entity, .word.hook { font-size: 1.6em; }', '.word.filler { font-size: 0.5em; opacity: 0.5; }')
  }
  if (s.template === 'glass') {
    lines.push('.line { display: inline-block; padding: 0.22em 0.62em; border-radius: 0.72em; background: linear-gradient(180deg, rgba(255,255,255,0.28), rgba(255,255,255,0.12)); border: 0.05em solid rgba(255,255,255,0.4); box-shadow: 0 0.2em 0.9em rgba(0,0,0,0.38), inset 0 0.05em 0 rgba(255,255,255,0.55); }', '.word { opacity: 0.8; }', '.word.emphasis, .word.entity, .word.hook { font-weight: 800; }')
  }
  if (o.css) lines.push(o.css)
  return lines.join('\n')
}

/** Tscaps friert Animationen ein (Pause + Füllung); die Vorschau setzt dieselbe Regel in ihrem Bereich. */
export const FROZEN_CSS = '*, *::before, *::after { animation-play-state: paused !important; animation-fill-mode: both !important; }'

/**
 * Zeit-Variablen wie in tscaps (Sekunden relativ zur aktuellen Zeit `t`; negativ = vergangen) für Vorschau-Elemente.
 * Segment = eine Wortgruppe (eine Zeile).
 */
export function segmentVars(cue: { start: number; end: number }, t: number): Record<string, string> {
  return { '--on-segment-starts': `${(cue.start - t).toFixed(3)}s`, '--on-segment-ends': `${(cue.end - t).toFixed(3)}s` }
}
export function wordVars(w: { start: number; end: number }, t: number): Record<string, string> {
  return { '--on-word-being-narrated-starts': `${(w.start - t).toFixed(3)}s`, '--on-word-being-narrated-ends': `${(w.end - t).toFixed(3)}s` }
}

const normWord = (w: string): string => w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')

/** Füllwörter (DE/EN): in „Kinetisch“ klein und blass, damit das Hauptwort wirkt. */
const FILLERS = new Set(['und', 'oder', 'aber', 'also', 'ja', 'äh', 'ähm', 'halt', 'eben', 'dann', 'so', 'ne', 'na', 'ok', 'okay', 'mal', 'nur', 'ich', 'du', 'er', 'sie', 'es', 'wir', 'ihr', 'der', 'die', 'das', 'ein', 'eine', 'ist', 'sind', 'war', 'hab', 'habe', 'zu', 'in', 'an', 'auf', 'mit', 'von', 'für', 'and', 'but', 'uh', 'um', 'like', 'the', 'a', 'of', 'to', 'is', 'it', 'i', 'you', 'we', 'that'])
export const isFiller = (w: string): boolean => FILLERS.has(normWord(w))

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
const CHAR_EM: Record<string, number> = { Anton: 0.4, Poppins: 0.58, 'Poppins Medium': 0.56, Montserrat: 0.62, Inter: 0.58, 'TikTok Sans': 0.58 }
const UPPER_FACTOR = 1.14
const SENTENCE_END = /[.!?…]["”')]*$/
const CLAUSE_END = /[,;:]["”')]*$/

/** Wie viele Zeichen (einschließlich Wortabstand/Box-Polster) passen bei dieser Schrift auf EINE Zeile des 1080-px-Bildes? */
export function lineBudget(s: CaptionStyle): { usablePx: number; fontPx: number; charEm: number } {
  const charEm = (CHAR_EM[s.font.family] ?? 0.6) * (s.upper ? UPPER_FACTOR : 1)
  return { usablePx: FRAME_W * 0.86, fontPx: s.sizePx, charEm }
}

/**
 * Wörter → Untertitel-Zeilen, immer EINZEILIG: eine Zeile endet, wenn das Zeichenbudget voll ist, nach Satzende,
 * bei einer Sprechpause (> 0,45 s) oder bei `maxWords` (2–4) Wörtern; Kommas sind bevorzugte Umbruchstellen ab 60 % Füllung.
 * Kurze Reste (1 kurzes Wort) werden an die Vorzeile gehängt, wenn sie noch passen.
 */
export function groupWords<T extends CaptionWord>(words: T[], s: CaptionStyle): T[][] {
  const { usablePx, fontPx, charEm } = lineBudget(s)
  const gapEm = 0.36 + 0.22 + (s.box.enabled ? s.box.paddingEm * 2 : 0)
  // Kinetisch: Hauptwörter ≈ 1,6×, Nebenwörter ≈ 0,66×, Füllwörter 0,5× – sonst läuft die Zeile über
  const factor = (w: T): number => (s.template === 'kinetic' ? (w.tag ? 1.6 : isFiller(w.w) ? 0.5 : 0.66) : 1)
  const widthEm = (g: T[]): number => g.reduce((n, w) => n + w.w.length * charEm * factor(w), 0) + Math.max(0, g.length - 1) * gapEm + (s.box.enabled ? s.box.paddingEm * 2 : 0) + (s.template === 'glass' ? 1.4 : 0)
  const fits = (g: T[]): boolean => widthEm(g) * fontPx <= usablePx
  const maxWords = Math.max(1, s.maxWords)
  const groups: T[][] = []
  let cur: T[] = []
  for (const w of words) {
    const prev = cur[cur.length - 1]
    const pause = prev && w.start - prev.end > 0.45
    if (cur.length && (!fits([...cur, w]) || cur.length >= maxWords || pause)) { groups.push(cur); cur = [] }
    cur.push(w)
    const full = (widthEm(cur) * fontPx) / usablePx
    if (SENTENCE_END.test(w.w) || (CLAUSE_END.test(w.w) && full >= 0.6)) { groups.push(cur); cur = [] }
  }
  if (cur.length) groups.push(cur)
  // einzelnes kurzes Restwort an die Vorzeile hängen (wenn es noch passt, die Wortzahl nicht sprengt und nicht über einen Satzschluss hinweg)
  for (let i = groups.length - 1; i > 0; i--) {
    const g = groups[i]
    const before = groups[i - 1]
    if (g.length === 1 && g[0].w.length <= 4 && before.length < maxWords && !SENTENCE_END.test(before[before.length - 1].w) && g[0].start - before[before.length - 1].end < 0.3 && fits([...before, g[0]])) { before.push(g[0]); groups.splice(i, 1) }
  }
  return groups
}

/** Anzeigezeitraum je Zeile: endet spätestens, wenn die nächste beginnt (keine überlappenden Zeilen), Nachlauf des letzten Wortes ≤ 0,25 s. */
export function cueTimes(groups: CaptionWord[][]): Array<{ start: number; end: number }> {
  return groups.map((g, gi) => {
    const nextStart = groups[gi + 1]?.[0].start
    const start = g[0].start
    const end = Math.max(g[g.length - 1].end, start + 0.05)
    const limit = nextStart !== undefined ? nextStart - 0.02 : Infinity
    return { start, end: Math.max(start + 0.05, Math.min(end + 0.25, limit)) }
  })
}

/** WebVTT mit Wortzeiten (`<hh:mm:ss.mmm>`-Marken). Eine Zeile = eine Gruppe aus `groupWords`. */
export function buildVtt(groups: CaptionWord[][]): string {
  const cues = cueTimes(groups)
  let out = 'WEBVTT\n\n'
  groups.forEach((g, gi) => {
    const text = g.map((w, k) => (k === 0 ? w.w : `<${vttTime(w.start)}>${w.w}`)).join(' ')
    out += `${vttTime(g[0].start)} --> ${vttTime(cues[gi].end)}\n${text}\n\n`
  })
  return out
}

/** Selektoren eines CSS-Textes mit einem Gültigkeitsbereich versehen (z. B. `.sm-cap`) – für die Editor-Vorschau mit demselben CSS. */
export function scopeCss(css: string, scope: string): string {
  // @keyframes-Blöcke unverändert lassen, Regeln mit Gültigkeitsbereich versehen
  const out: string[] = []
  let i = 0
  while (i < css.length) {
    const open = css.indexOf('{', i)
    if (open < 0) break
    const head = css.slice(i, open).trim()
    let depth = 1, j = open + 1
    while (j < css.length && depth > 0) { if (css[j] === '{') depth++; else if (css[j] === '}') depth--; j++ }
    const body = css.slice(open, j)
    if (head.startsWith('@')) out.push(`${head} ${body}`)
    else out.push(`${head.split(',').map((x) => `${scope} ${x.trim()}`).join(', ')} ${body}`)
    i = j
  }
  return out.join('\n')
}
