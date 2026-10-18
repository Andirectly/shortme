import { copyFile, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { BrowserWindow, type NativeImage } from 'electron'
import type { TitleStyle } from '@shared/preset'
import { FRAME_H, FRAME_W } from '@shared/captions'

export interface TitleOverlay {
  /** FFmpeg-Eingabemuster der Bildfolge (PNG mit Alpha) */
  pattern: string
  fps: number
  frames: number
  x: number
  y: number
  w: number
  h: number
}

const FPS = 30

/**
 * Titel als Overlay-Bildfolge: dieselbe Funktion wie die Editor-Vorschau (shared/title.ts) in einem versteckten, transparenten
 * Offscreen-Fenster; Animation „eingefroren“ und je Bild gespult → Bildfolge mit Alpha, die FFmpeg über das Video legt.
 */
export async function renderTitleOverlay(text: string, style: TitleStyle, seconds: number, dir: string, signal?: AbortSignal): Promise<TitleOverlay | null> {
  if (!text.trim()) return null
  await mkdir(dir, { recursive: true })
  const win = new BrowserWindow({ show: false, width: 100, height: 100, transparent: true, frame: false, useContentSize: true, webPreferences: { offscreen: true, sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } })
  try {
    win.webContents.setFrameRate(60)
    const url = process.env.ELECTRON_RENDERER_URL ? `${process.env.ELECTRON_RENDERER_URL}/title.html` : null
    await (url ? win.loadURL(url) : win.loadFile(join(__dirname, '../renderer/title.html')))
    const size = (await win.webContents.executeJavaScript(`window.__title.set(${JSON.stringify(style)}, ${JSON.stringify(text)}, ${seconds})`)) as { w: number; h: number }
    const w = Math.max(8, size.w), h = Math.max(8, size.h)
    win.setContentSize(w, h)
    win.webContents.setZoomFactor(1)
    const paint = (): Promise<NativeImage> => new Promise((resolve, reject) => {
      const timer = setTimeout(() => { win.webContents.off('paint', on); reject(new Error('Titel-Renderer: keine Zeichnung')) }, 8000)
      const on = (_e: unknown, _d: unknown, image: NativeImage): void => { clearTimeout(timer); win.webContents.off('paint', on); resolve(image) }
      win.webContents.on('paint', on)
      win.webContents.invalidate()
    })
    const n = Math.ceil(seconds * FPS) + 1
    const inMs = style.anim.appear === 'none' ? 0 : style.anim.appearMs
    const outMs = style.anim.disappear === 'fade' ? style.anim.disappearMs : 0
    let prev = ''
    let isStatic = false
    for (let i = 0; i < n; i++) {
      signal?.throwIfAborted()
      const t = Math.min(seconds, i / FPS)
      const file = join(dir, `title_${String(i + 1).padStart(4, '0')}.png`)
      const animating = t <= inMs / 1000 + 0.12 || t >= seconds - outMs / 1000 - 0.05
      if (!animating && isStatic && prev) { await copyFile(prev, file); continue }
      await win.webContents.executeJavaScript(`window.__title.at(${t})`)
      let img = await paint()
      img = await paint() // zweite Zeichnung nach dem Spulen (die erste kann noch den alten Stand enthalten)
      const sz = img.getSize()
      if (sz.width !== w || sz.height !== h) img = img.resize({ width: w, height: h, quality: 'best' })
      await writeFile(file, img.toPNG())
      prev = file
      isStatic = !animating
    }
    return { pattern: join(dir, 'title_%04d.png'), fps: FPS, frames: n, x: Math.round((FRAME_W - w) / 2), y: Math.round(style.y * FRAME_H - h / 2), w, h }
  } finally {
    if (!win.isDestroyed()) win.destroy()
  }
}
