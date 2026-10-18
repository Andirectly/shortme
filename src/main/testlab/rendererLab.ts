// Testlab-Verfahren für den Platz „Untertitel-Renderer“: derselbe Clip mit demselben Preset – links tscaps, rechts Remotion.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { dataRoot } from '../engines/paths'
import { FFMPEG_PATH, runBinary } from '../pipeline/ffmpeg'
import { encoderArgs, resolveEncoder } from '../pipeline/encoders'
import { importFile } from '../shortme/importer'
import { loadTranscript } from '../shortme/transcription'
import { allPresets, effectivePreset } from '../shortme/presets'
import { captionPass } from '../shortme/render/captionPass'
import { renderTitleOverlay } from '../shortme/render/titleOverlay'
import { compositeOverlay, remotionFootprint, renderRemotionOverlay } from '../remotion/render'
import { allowMediaPath } from '../mediaAccess'
import { recordMeasured } from './registry'
import type { LabResult } from '../../shared/models'

const SAMPLE_TITLE = 'So wurde ich fast gefeuert'
const vramMb = (): number => { try { return Number(execFileSync('nvidia-smi', ['--query-gpu=memory.used', '--format=csv,noheader,nounits'], { encoding: 'utf8', windowsHide: true }).split('\n')[0]) } catch { return -1 } }

function dirSize(p: string): number {
  try {
    const st = statSync(p)
    return st.isDirectory() ? readdirSync(p).reduce((n, f) => n + dirSize(join(p, f)), 0) : st.size
  } catch { return 0 }
}

export const RENDERER_MODELS: Record<string, 'tscaps' | 'remotion'> = { tscaps_renderer: 'tscaps', remotion_renderer: 'remotion' }

/** Mitte 9:16 aus der Quelle (ohne Tracking) – gleiche Grundlage für beide Renderer. */
async function baseVideo(path: string, start: number, dur: number, dir: string): Promise<string> {
  const out = join(dir, 'base.mp4')
  if (existsSync(out)) return out
  await runBinary(FFMPEG_PATH, ['-hide_banner', '-nostats', '-y', '-ss', String(start), '-t', String(dur), '-i', path, '-vf', 'crop=ih*9/16:ih,scale=1080:1920,setsar=1', '-r', '30', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '17', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k', out])
  return out
}

export async function runRendererSide(model: string, path: string, start: number, dur: number, presetId: string, onProgress: (m: string) => void): Promise<LabResult> {
  const which = RENDERER_MODELS[model]
  if (!which) throw new Error('Unbekannter Renderer')
  const imp = await importFile(path)
  const tr = await loadTranscript(imp.meta.hash)
  const end = Math.min(imp.meta.durationSec, start + dur)
  const words = (tr?.words ?? []).filter((w) => w.start >= start && w.end <= end).map((w) => ({ w: w.w, start: w.start - start, end: w.end - start }))
  const style = effectivePreset(await allPresets(), { presetId, highlight: true, zone: 'Aus', style: {} })
  const seconds = end - start
  const key = createHash('sha1').update(`${path}|${statSync(path).size}|${start}|${dur}|${presetId}|${JSON.stringify(style)}|${words.length}|renderer-v1`).digest('hex').slice(0, 16)
  const dir = join(dataRoot(), 'testlab', `renderer-${key}`)
  await mkdir(dir, { recursive: true })
  const out = join(dir, `${which}.mp4`)
  const meta = join(dir, `${which}.json`)
  if (existsSync(out) && existsSync(meta)) { onProgress('aus dem Zwischenspeicher'); allowMediaPath(out); return JSON.parse(readFileSync(meta, 'utf8')) as LabResult }
  onProgress('Basisvideo …')
  const base = await baseVideo(path, start, dur, dir)
  const enc = await resolveEncoder('auto')
  const encArgs = [...encoderArgs(enc.kind, 'standard'), '-r', '30']
  const baseVram = vramMb()
  let peak = baseVram
  const poll = setInterval(() => { peak = Math.max(peak, vramMb()) }, 400)
  const t0 = Date.now()
  try {
    if (which === 'tscaps') {
      onProgress('Titel …')
      const title = await renderTitleOverlay(SAMPLE_TITLE, style.title, 3, join(dir, 'title-frames'))
      let mid = base
      if (title) {
        mid = join(dir, 'mid-tscaps.mp4')
        await runBinary(FFMPEG_PATH, ['-hide_banner', '-nostats', '-y', '-i', base, '-framerate', String(title.fps), '-i', title.pattern, '-filter_complex', `[0:v][1:v]overlay=${title.x}:${title.y}:eof_action=pass:format=auto[v]`, '-map', '[v]', '-map', '0:a?', ...encArgs, '-c:a', 'copy', mid])
      }
      onProgress('Untertitel (tscaps) …')
      await captionPass({ input: mid, output: out, words, style: style.caption, css: style.css, highlight: true, width: 1080, height: 1920 }, { onProgress: (f) => onProgress(`Untertitel (tscaps) … ${Math.round(f * 100)} %`) })
    } else {
      const overlay = await renderRemotionOverlay({ preset: style, words, highlight: true, titleText: SAMPLE_TITLE, titleSeconds: 3, durationSec: seconds, workDir: join(dir, 'remotion-frames'), onProgress: (f, m) => onProgress(m.startsWith('Remotion rendert') ? `Remotion rendert … ${Math.round(f * 100)} %` : m) })
      onProgress('Zusammenfügen …')
      await compositeOverlay(base, overlay, out, encArgs, enc.bin)
    }
  } finally { clearInterval(poll) }
  const runtimeSec = (Date.now() - t0) / 1000
  await rm(join(dir, 'remotion-frames'), { recursive: true, force: true })
  await rm(join(dir, 'title-frames'), { recursive: true, force: true })
  const extraBytes = which === 'remotion' ? remotionFootprint().bytes : dirSize(join(process.cwd(), 'node_modules', '@tscaps'))
  const res: LabResult = {
    version: 1, model, slot: 'renderer', source: out, start: 0, dur: seconds, runtimeSec: +runtimeSec.toFixed(1), vramPeakMb: baseVram >= 0 ? Math.max(0, peak - baseVram) : -1,
    speechFaceShare: null, speechSec: 0, idSwitches: 0, context: `Preset: ${style.name}`, hz: 12.5, tracks: [], active: [], shots: [],
    video: out, per60Sec: +((runtimeSec * 60) / Math.max(1, seconds)).toFixed(1), extraMb: Math.round(extraBytes / 1e6)
  }
  writeFileSync(meta, JSON.stringify(res))
  allowMediaPath(out)
  await recordMeasured(model, { runtimeSec: res.runtimeSec, vramPeakMb: res.vramPeakMb, speechFaceShare: null, clip: `Renderer-Test ${Math.round(seconds)} s · 60 s ≈ ${res.per60Sec} s · +${res.extraMb} MB`, at: new Date().toISOString() })
  return res
}
