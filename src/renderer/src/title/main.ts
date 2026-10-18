// Verstecktes Renderfenster (offscreen, transparent): zeichnet den Titel mit derselben Funktion wie die Editor-Vorschau
// (shared/title.ts) und lässt sich auf eine Zeit „spulen“ (eingefrorene Animation). Das Hauptfenster holt Bild für Bild ab.
import { FROZEN_CSS } from '@shared/captions'
import type { TitleStyle } from '@shared/preset'
import { layoutTitle, titleCss, titleSvg } from '@shared/title'
import './title.css'

interface Api {
  set: (style: TitleStyle, text: string, seconds: number) => Promise<{ w: number; h: number }>
  at: (t: number) => Promise<void>
}

let seconds = 3
const root = document.getElementById('root')!
const css = document.createElement('style')
document.head.append(css)

const api: Api = {
  async set(style, text, secs) {
    seconds = secs
    await document.fonts.load(`${style.font.weight} ${style.sizePx}px "${style.font.family}"`)
    const ctx = document.createElement('canvas').getContext('2d')!
    ctx.font = `${style.font.weight} ${style.sizePx}px "${style.font.family}"`
    const l = layoutTitle(text, style, (s) => ctx.measureText(s).width)
    css.textContent = `${FROZEN_CSS}\n${titleCss(style)}`
    root.innerHTML = titleSvg(l, style)
    return { w: Math.ceil(l.w), h: Math.ceil(l.h) }
  },
  async at(t) {
    root.style.setProperty('--on-title-starts', `${(0 - t).toFixed(4)}s`)
    root.style.setProperty('--on-title-ends', `${(seconds - t).toFixed(4)}s`)
    await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())))
  }
}
;(window as unknown as { __title: Api }).__title = api
