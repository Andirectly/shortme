// Remotion als alternativer Untertitel-Renderer (Testlab-Platz „Untertitel-Renderer“). Aufbau nach remotion.dev/docs/electron:
// gerendert wird im Hauptprozess; das Bundle entsteht beim Paketieren (resources/remotion-bundle) bzw. in der Entwicklung bei Bedarf;
// Compositor-Binaries liegen außerhalb von app.asar (asarUnpack); Chrome Headless Shell wird im Hintergrund vorbereitet.
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { cpus } from 'node:os'
import { mkdir, readdir, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { app } from 'electron'
import { dataRoot } from '../engines/paths'
import { FFMPEG_PATH, runBinary } from '../pipeline/ffmpeg'
import type { CaptionWord } from '../../shared/captions'
import type { StylePreset } from '../../shared/preset'

const req = createRequire(__filename)
const root = (): string => (app?.isPackaged ? join(process.resourcesPath, 'app.asar.unpacked') : process.cwd())
const FPS = 30

export interface RemotionJob {
  preset: StylePreset
  words: CaptionWord[]
  highlight: boolean
  titleText: string
  titleSeconds: number
  durationSec: number
  /** Arbeitsordner (Bildfolge) */
  workDir: string
  onProgress?: (fraction: number, message: string) => void
  signal?: AbortSignal
}

/** Ordner mit dem fertigen Bundle: gepackt = Ressource; Entwicklung = bei Bedarf erzeugt (Cache nach Änderungsstand). */
export async function remotionServeUrl(onProgress?: (f: number, m: string) => void): Promise<string> {
  if (app?.isPackaged) return join(process.resourcesPath, 'remotion-bundle')
  const dir = join(dataRoot(), 'remotion-bundle')
  const stamp = join(dir, '.stamp')
  const newest = ['captions-remotion', 'src/shared', 'src/renderer/src/shortme/CaptionLayers.tsx'].reduce((m, p) => Math.max(m, mtimeDeep(resolve(p))), 0)
  const have = existsSync(stamp) ? Number(readFileNumber(stamp)) : 0
  if (have >= newest && existsSync(join(dir, 'index.html'))) return dir
  onProgress?.(0, 'Remotion-Bundle wird erzeugt …')
  const { bundleRemotion } = req(resolve('captions-remotion/bundle.cjs')) as { bundleRemotion: (out: string, p?: (f: number) => void) => Promise<string> }
  await bundleRemotion(dir, (f) => onProgress?.(f, 'Remotion-Bundle wird erzeugt …'))
  await writeNumber(stamp, newest)
  return dir
}

function mtimeDeep(p: string): number {
  try {
    const st = statSync(p)
    if (!st.isDirectory()) return st.mtimeMs
    return readdirSync(p).reduce((m, f) => Math.max(m, mtimeDeep(join(p, f))), st.mtimeMs)
  } catch { return 0 }
}
const readFileNumber = (p: string): number => { try { return Number(readFileSync(p, 'utf8')) } catch { return 0 } }
const writeNumber = async (p: string, n: number): Promise<void> => { writeFileSync(p, String(n)) }

type Renderer = typeof import('@remotion/renderer')
let rendererMod: Renderer | null = null
const renderer = (): Renderer => (rendererMod ??= req('@remotion/renderer') as Renderer)

/** Compositor-Binaries außerhalb von app.asar (gepackt: app.asar.unpacked). */
const binariesDirectory = (): string | null => {
  const d = join(root(), 'node_modules', '@remotion', 'compositor-win32-x64-msvc')
  return existsSync(d) ? d : null
}

/** Remotion legt den Browser unter `<cwd>/node_modules/.remotion` bzw. `<cwd>/.remotion` ab – in der gepackten App deshalb im Datenordner. */
async function withCwd<T>(dir: string, fn: () => Promise<T>): Promise<T> {
  if (!app?.isPackaged) return fn()
  const prev = process.cwd()
  await mkdir(dir, { recursive: true })
  process.chdir(dir)
  try { return await fn() } finally { try { process.chdir(prev) } catch { /* ignore */ } }
}

let ensuring: Promise<string> | null = null
/** Chrome Headless Shell im Hintergrund bereitstellen (lädt beim ersten Mal ≈ 100–200 MB); liefert den Pfad. */
export function prepareRemotionBrowser(onProgress?: (fraction: number, message: string) => void): Promise<string> {
  ensuring ??= (async () => {
    const r = renderer()
    const status = await withCwd(dataRoot(), () => r.ensureBrowser({
      logLevel: 'error',
      onBrowserDownload: () => ({ version: null, onProgress: ({ percent }) => onProgress?.(percent, `Chrome Headless Shell wird geladen … ${Math.round(percent * 100)} %`) })
    }))
    return status.type === 'no-browser' || status.type === 'version-mismatch' ? '' : status.path
  })().catch((e) => { ensuring = null; throw e })
  return ensuring
}

export const remotionAvailable = (): boolean => { try { req.resolve('@remotion/renderer'); return true } catch { return false } }

/** Overlay-Bildfolge (PNG mit Alpha) der Untertitel + des Titels; liefert Ordner und ffmpeg-Muster. */
export async function renderRemotionOverlay(job: RemotionJob): Promise<{ pattern: string; frames: number; fps: number }> {
  const r = renderer()
  const report = job.onProgress ?? (() => undefined)
  report(0, 'Remotion wird vorbereitet …')
  const serveUrl = await remotionServeUrl(report)
  const browserExecutable = await prepareRemotionBrowser(report).catch(() => null)
  await rm(job.workDir, { recursive: true, force: true })
  await mkdir(job.workDir, { recursive: true })
  const frames = Math.max(1, Math.ceil(job.durationSec * FPS))
  const inputProps = { preset: job.preset, words: job.words, highlight: job.highlight, titleText: job.titleText, titleSeconds: job.titleSeconds, durationInFrames: frames }
  const common = { serveUrl, inputProps, logLevel: 'error' as const, browserExecutable: browserExecutable || null, binariesDirectory: binariesDirectory() }
  const composition = await r.selectComposition({ ...common, id: 'Captions' })
  await r.renderFrames({
    ...common,
    composition: { ...composition, durationInFrames: frames },
    outputDir: job.workDir,
    imageFormat: 'png',
    imageSequencePattern: 'cap-[frame].[ext]',
    concurrency: Math.max(2, Math.min(8, Math.floor((cpus().length || 4) / 2))),
    onStart: () => report(0.05, 'Remotion rendert …'),
    onFrameUpdate: (done) => report(0.05 + 0.9 * (done / frames), `Remotion rendert … ${done}/${frames}`),
    cancelSignal: undefined
  })
  const names = (await readdir(job.workDir)).filter((n) => n.endsWith('.png')).sort()
  const digits = names[0]?.match(/cap-(\d+)\.png/)?.[1]?.length ?? 4
  return { pattern: join(job.workDir, `cap-%0${digits}d.png`), frames: names.length, fps: FPS }
}

/** Overlay auf das Video legen (FFmpeg); `args` = Encoder-Argumente des Aufrufers. */
export async function compositeOverlay(input: string, overlay: { pattern: string; fps: number }, output: string, encoderArgs: string[], bin: string = FFMPEG_PATH, signal?: AbortSignal): Promise<void> {
  await runBinary(bin, ['-hide_banner', '-nostats', '-y', '-i', input, '-framerate', String(overlay.fps), '-i', overlay.pattern, '-filter_complex', '[0:v][1:v]overlay=0:0:eof_action=pass:format=auto[v]', '-map', '[v]', '-map', '0:a?', ...encoderArgs, '-c:a', 'copy', '-movflags', '+faststart', output], { signal })
}

/** Zusätzliche App-Größe (Byte): Laufzeit-Pakete + Bundle + Chrome Headless Shell (soweit vorhanden). */
export function remotionFootprint(): { bytes: number; parts: Array<{ name: string; bytes: number }> } {
  const nm = join(root(), 'node_modules')
  const dirs: Array<[string, string]> = [
    ['remotion', join(nm, 'remotion')],
    ['@remotion/renderer', join(nm, '@remotion', 'renderer')],
    ['@remotion/compositor', join(nm, '@remotion', 'compositor-win32-x64-msvc')],
    ['@remotion/streaming', join(nm, '@remotion', 'streaming')],
    ['@remotion/player', join(nm, '@remotion', 'player')],
    ['Bundle', app?.isPackaged ? join(process.resourcesPath, 'remotion-bundle') : join(dataRoot(), 'remotion-bundle')],
    ['Chrome Headless Shell', app?.isPackaged ? join(dataRoot(), '.remotion') : join(nm, '.remotion')]
  ]
  const parts = dirs.map(([name, d]) => ({ name, bytes: dirSize(d) })).filter((p) => p.bytes > 0)
  return { bytes: parts.reduce((n, p) => n + p.bytes, 0), parts }
}

function dirSize(p: string): number {
  try {
    const st = statSync(p)
    if (!st.isDirectory()) return st.size
    return readdirSync(p).reduce((n, f) => n + dirSize(join(p, f)), 0)
  } catch { return 0 }
}
