import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { BUILTIN_PRESETS, type StylePreset } from '../../../shared/preset'
import { basename, dirname, join } from 'node:path'
import type { ShortmeClip, ShortmeShot } from '@shared/shortme'
import { FFMPEG_PATH, runBinary } from '../../pipeline/ffmpeg'
import { fontsDir } from '../../pipeline/captions'
import { renderFontsDir } from '../../fonts'
import { encoderArgs, audioArgs, resolveEncoder } from '../../pipeline/encoders'
import { loudnormFilter, measureLoudness } from '../../pipeline/loudness'
import type { ProjectMeta } from '../project'
import type { Transcript } from '../transcription'
import type { Signals } from '../clips/signals'
import { buildFilterGraph, OUT_H, OUT_W } from './graph'
import { captionPass } from './captionPass'
import { buildAss, type CapWord } from './ass'
import { renderTitleOverlay } from './titleOverlay'
import { buildPieces, keepsFromCuts, planPauseCuts, TimeMap, type Interval } from './timeline'
import { safeFileName, uniquePath, type QualityTier } from './profiles'

export interface ExportOptions {
  outDir: string
  /** Wirksames Preset (Preset + Änderungen aus Stil-Studio/Editor), renderer-unabhängig; Standard: erstes eingebautes. */
  style?: StylePreset
  /** Untertitel eingebrannt; false = ohne. */
  captions?: boolean
  srt?: boolean
  /** Titel (TikTok-Stil) einblenden und Text (LLM-Vorschlag, editierbar). */
  hook?: boolean
  hookText?: string
  removePauses?: boolean
  /** Geänderte Untertitel-Texte (globaler Wortindex → Text). */
  wordEdits?: Record<number, string>
  /** Untertitel-Renderer: tscaps (Standard in der App, versteckte Fenster) oder ASS/libass (Fallback, Skripte). */
  engine?: 'tscaps' | 'ass'
  /** Herausgeschnittene Wörter (Quellzeit), aus den Editor-Operationen. */
  extraCuts?: Interval[]
  /** KI-Hervorhebung (betonte Wörter) an/aus. */
  caption?: { highlight?: boolean }
  hookSeconds?: number
  quality?: QualityTier
  encoder?: 'auto' | 'cpu' | 'gpu'
  signal?: AbortSignal
  onProgress?: (fraction: number, message: string) => void
}

export interface ExportResult { path: string; durationSec: number; srtPath?: string; ass: string; wordsOut: CapWord[]; pieces: number; captionEngine: 'tscaps' | 'ass' | 'none' }

/** Reine Planung eines Clips: Pausenschnitte, Zeitachse, Stücke, Wörter auf der gekürzten Zeitleiste. */
export function planExport(clip: ShortmeClip, t: Transcript, signals: Pick<Signals, 'silences'>, removePauses: boolean, extraCuts: Interval[] = [], wordEdits: Record<number, string> = {}) {
  const range: Interval = [clip.start, clip.end]
  const words = t.words.slice(clip.firstWord, clip.lastWord + 1)
  const cuts = mergeIntervals([...(removePauses ? planPauseCuts(range, words, signals.silences, t.speech) : []), ...extraCuts.filter((c) => c[1] > range[0] && c[0] < range[1])])
  const map = new TimeMap(keepsFromCuts(range, cuts))
  const fallback: ShortmeShot = { start: 0, end: clip.end - clip.start, layout: 'fixed', cx: 0.5, zoom: 1 }
  const pieces = buildPieces(map, clip.shots?.length ? clip.shots : [fallback], clip.start)
  const tagByWord = new Map(clip.tags.map((g) => [g.word, g.kind]))
  const capWords: CapWord[] = map.words(words.map((w, i) => ({ w: wordEdits[clip.firstWord + i] ?? w.w, start: w.start, end: w.end, tag: tagByWord.get(clip.firstWord + i) })))
  return { map, pieces, cuts, words: capWords, duration: map.duration }
}

/** Überlappende/angrenzende Schnitte zusammenfassen (sortiert). */
export function mergeIntervals(iv: Interval[]): Interval[] {
  const out: Interval[] = []
  for (const c of [...iv].sort((a, b) => a[0] - b[0])) {
    const p = out[out.length - 1]
    if (p && c[0] <= p[1] + 1e-6) p[1] = Math.max(p[1], c[1])
    else out.push([c[0], c[1]])
  }
  return out
}

const srtTime = (t: number): string => { const ms = Math.round(t * 1000); const p = (n: number, l = 2): string => String(n).padStart(l, '0'); return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}` }
export function buildSrt(words: CapWord[], perLine = 4): string {
  let out = ''
  for (let i = 0, n = 1; i < words.length; i += perLine, n++) {
    const g = words.slice(i, i + perLine)
    out += `${n}\n${srtTime(g[0].start)} --> ${srtTime(g[g.length - 1].end + 0.1)}\n${g.map((w) => w.w).join(' ')}\n\n`
  }
  return out
}

/** FFmpeg-Pfad in Filter-Optionen (Windows: Laufwerksdoppelpunkt und Backslashes escapen). */
export const filterPath = (p: string): string => p.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'")

export async function exportClip(meta: ProjectMeta, clip: ShortmeClip, t: Transcript, signals: Signals, opts: ExportOptions): Promise<ExportResult> {
  const report = opts.onProgress ?? (() => undefined)
  const plan = planExport(clip, t, signals, opts.removePauses ?? true, opts.extraCuts ?? [], opts.wordEdits ?? {})
  if (plan.pieces.length === 0) throw new Error('Clip enthält nichts zu exportieren')
  await mkdir(opts.outDir, { recursive: true })
  const style: StylePreset = opts.style ?? BUILTIN_PRESETS[0]
  const capStyle = opts.caption?.highlight === false ? { ...style.caption, highlight: style.caption.color } : style.caption

  // libass: gebündelte + eigene Schriften in einem Ordner (ohne Electron, z. B. in Skripten: nur gebündelte)
  const fontsDirForRender = await renderFontsDir().catch(() => fontsDir())

  report(0.02, 'Lautheit messen …')
  const stats = await measureLoudness(meta.sourcePath, clip.start, clip.end - clip.start, opts.signal)

  const name = safeFileName(clip.title)
  const finalPath = uniquePath(opts.outDir, name)
  const work = join(opts.outDir, `.${name}.work`)
  await mkdir(work, { recursive: true })
  try {
    const capWords = opts.caption?.highlight === false ? plan.words.map((w) => ({ ...w, tag: undefined })) : plan.words
    const hook = opts.hook ? { text: opts.hookText ?? clip.hookText, seconds: opts.hookSeconds ?? style.title.seconds } : null
    // Titel (TikTok-Stil): Overlay-Bildfolge aus demselben Layout wie die Editor-Vorschau (nur in der App, braucht Electron)
    const title = hook && process.versions.electron ? await renderTitleOverlay(hook.text, style.title, hook.seconds, join(work, 'title'), opts.signal).catch((e) => { console.error('Titel-Overlay fehlgeschlagen:', e); return null }) : null
    const enc = await resolveEncoder(opts.encoder ?? 'auto')
    const quality = opts.quality ?? 'standard'
    const src = { width: meta.width, height: meta.height }
    const audioFilter = loudnormFilter(stats)

    /** Ein FFmpeg-Lauf: Stücke → Zusammenschnitt (+ optional eingebrannte ASS-Datei). */
    const render = async (dest: string, assText: string | null, q: typeof quality): Promise<void> => {
      let post: string | undefined
      if (assText) {
        const assPath = join(work, `${basename(dest)}.ass`)
        await writeFile(assPath, assText, 'utf8')
        post = `ass='${filterPath(assPath)}':fontsdir='${filterPath(fontsDirForRender)}'`
      }
      const filter = buildFilterGraph(plan.pieces, { src, base: clip.start, audioFilter, fadeOutSec: 0.25, duration: plan.duration, videoPost: post, overlay: title ? { x: title.x, y: title.y } : undefined })
      const scriptPath = join(work, `${basename(dest)}.graph.txt`)
      await writeFile(scriptPath, filter, 'utf8')
      await runBinary(enc.bin, [
        '-hide_banner', '-nostats', '-y',
        '-ss', clip.start.toFixed(3), '-t', (clip.end - clip.start).toFixed(3), '-i', meta.sourcePath,
        ...(title ? ['-framerate', String(title.fps), '-i', title.pattern] : []),
        '-/filter_complex', scriptPath, '-map', '[v]', '-map', '[a]',
        ...encoderArgs(enc.kind, q), '-r', '30', ...audioArgs(q), '-ar', '48000',
        '-movflags', '+faststart', '-t', plan.duration.toFixed(3), dest
      ], { signal: opts.signal })
    }

    const fullAss = buildAss(capWords, { width: OUT_W, height: OUT_H, style: capStyle })
    const tmp = join(work, 'out.mp4')
    const engine: 'tscaps' | 'ass' = opts.captions === false ? 'ass' : opts.engine ?? (process.versions.electron ? 'tscaps' : 'ass')
    let used: 'tscaps' | 'ass' | 'none' = opts.captions === false ? 'none' : 'ass'
    report(0.1, 'Rendert …')
    if (engine === 'tscaps') {
      try {
        // 1) Zwischenergebnis in hoher Qualität (Hook als ASS, ohne Untertitel), 2) @tscaps/engine brennt die Untertitel ein
        const mid = join(work, 'mid.mp4')
        await render(mid, null, 'high')
        report(0.5, 'Untertitel …')
        await captionPass({ input: mid, output: tmp, words: capWords, style: capStyle, css: style.css, highlight: opts.caption?.highlight, width: OUT_W, height: OUT_H },
          { signal: opts.signal, onProgress: (f) => report(0.5 + f * 0.5, 'Untertitel …') })
        used = 'tscaps'
      } catch (e) {
        if (opts.signal?.aborted) throw e
        console.error('tscaps-Untertitel fehlgeschlagen, Fallback ASS/libass:', e)
        await rm(tmp, { force: true })
      }
    }
    if (used !== 'tscaps') await render(tmp, opts.captions === false ? null : fullAss, quality)
    await mkdir(dirname(finalPath), { recursive: true })
    await rm(finalPath, { force: true })
    await rename(tmp, finalPath)
    let srtPath: string | undefined
    if (opts.srt) { srtPath = finalPath.replace(/\.mp4$/, '.srt'); await writeFile(srtPath, buildSrt(plan.words), 'utf8') }
    report(1, 'Fertig')
    return { path: finalPath, durationSec: plan.duration, srtPath, ass: fullAss, wordsOut: plan.words, pieces: plan.pieces.length, captionEngine: used }
  } finally {
    await rm(work, { recursive: true, force: true })
  }
}

export { FFMPEG_PATH }
