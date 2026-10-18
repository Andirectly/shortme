import { readFile, writeFile } from 'node:fs/promises'
import { DEFAULT_CAPTION_SCALE } from '../../../shared/edits'
import { fontsDir } from '../../pipeline/captions'
import { listCustomFonts } from '../../fonts'
import { join } from 'node:path'
import { BrowserWindow, ipcMain } from 'electron'
import { buildVtt, captionCss, groupWords, tagWordlists, type CaptionPreset, type CaptionStyleOptions, type CaptionWord } from '@shared/captions'

const FONT_FILES: Record<string, [string, number]> = { Anton: ['Anton-Regular.ttf', 400], Poppins: ['Poppins-Bold.ttf', 700], 'Poppins Medium': ['Poppins-Medium.ttf', 500] }

/** @font-face mit eingebetteten Daten: die Engine rastert über SVG-foreignObject und sieht Seiten-Schriften nicht. */
export async function embeddedFontCss(preset: CaptionPreset): Promise<string> {
  const out: string[] = []
  const custom = await listCustomFonts().catch(() => [])
  for (const family of new Set([preset.font, 'Poppins'])) {
    const own = custom.find((c) => c.family === family)
    if (own) {
      const data = (await readFile(own.path)).toString('base64')
      out.push(`@font-face { font-family: '${family}'; font-weight: 400 900; src: url(data:font/${own.fileName.toLowerCase().endsWith('.otf') ? 'otf' : 'ttf'};base64,${data}) format('${own.fileName.toLowerCase().endsWith('.otf') ? 'opentype' : 'truetype'}'); }`)
      continue
    }
    const f = FONT_FILES[family]
    if (!f) continue
    const data = (await readFile(join(fontsDir(), f[0]))).toString('base64')
    out.push(`@font-face { font-family: '${family}'; font-weight: ${f[1]}; src: url(data:font/ttf;base64,${data}) format('truetype'); }`)
  }
  return out.join('\n')
}

export interface CaptionJob {
  input: string
  output: string
  words: CaptionWord[]
  preset: CaptionPreset
  style: CaptionStyleOptions
  width: number
  height: number
}

interface Active { win: BrowserWindow; input: string; output: string; onProgress?: (f: number) => void; resolve: () => void; reject: (e: Error) => void; ready: () => void }
let active: Active | null = null
let registered = false

/** IPC des versteckten Renderfensters; liest/schreibt nur die Pfade des laufenden Auftrags. */
export function registerCaptionIpc(): void {
  if (registered) return
  registered = true
  ipcMain.on('captions:ready', () => active?.ready())
  ipcMain.on('captions:progress', (_e, f: number) => active?.onProgress?.(f))
  ipcMain.on('captions:done', (_e, error: string | null) => { if (error) active?.reject(new Error(error)); else active?.resolve() })
  ipcMain.handle('captions:read', async (_e, path: string) => {
    if (!active || path !== active.input) throw new Error('Zugriff verweigert')
    const b = await readFile(path)
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)
  })
  ipcMain.handle('captions:write', async (_e, path: string, data: ArrayBuffer) => {
    if (!active || path !== active.output) throw new Error('Zugriff verweigert')
    await writeFile(path, Buffer.from(data))
  })
}

/** Brennt die Untertitel mit @tscaps/engine in `input` → `output`. Wirft bei jedem Fehler (Aufrufer fällt auf ASS zurück). */
export async function captionPass(job: CaptionJob, opts: { onProgress?: (f: number) => void; signal?: AbortSignal; timeoutMs?: number } = {}): Promise<void> {
  registerCaptionIpc()
  const preset = job.style.font ? { ...job.preset, font: job.style.font } : job.preset
  const fontCss = await embeddedFontCss(preset)
  if (active) throw new Error('Untertitel-Renderer ist belegt')
  const win = new BrowserWindow({ show: false, width: 1080, height: 1920, webPreferences: { preload: join(__dirname, '../preload/index.js'), sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } })
  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Untertitel-Renderer: Zeitüberschreitung')), opts.timeoutMs ?? 20 * 60_000)
      const abort = (): void => reject(new Error('Abgebrochen'))
      opts.signal?.addEventListener('abort', abort, { once: true })
      const fail = (e: Error): void => reject(e)
      win.webContents.once('render-process-gone', (_e, d) => fail(new Error(`Untertitel-Renderer abgestürzt (${d.reason})`)))
      active = {
        win, input: job.input, output: job.output, onProgress: opts.onProgress,
        resolve: () => { clearTimeout(timeout); resolve() }, reject: (e) => { clearTimeout(timeout); reject(e) },
        ready: () => {
          win.webContents.send('captions:run', {
            input: job.input, output: job.output, vtt: buildVtt(groupWords(job.words, preset, job.style.scale ?? DEFAULT_CAPTION_SCALE)), css: `${fontCss}
${captionCss(preset, job.style)}`,
            y: job.style.y ?? job.preset.y, perLine: 12, width: job.width, height: job.height, taggers: tagWordlists(job.words)
          })
        }
      }
      const url = process.env.ELECTRON_RENDERER_URL ? `${process.env.ELECTRON_RENDERER_URL}/captions.html` : null
      void (url ? win.loadURL(url) : win.loadFile(join(__dirname, '../renderer/captions.html'))).catch(fail)
    })
  } finally {
    active = null
    if (!win.isDestroyed()) win.destroy()
  }
}
