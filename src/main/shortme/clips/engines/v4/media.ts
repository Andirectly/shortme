// Engine 4 – Medien: ffprobe (Streams, Timebase, PTS, VFR), Quell-SHA-256, AV-Ausschnitte, Messungen am gerenderten Clip. Kein shell=true; Pfade als Argumente.
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { createReadStream, existsSync } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { FFMPEG_PATH, FFPROBE_PATH } from '../../../../pipeline/ffmpeg'
import { projectDir } from '../../../project'
import { writeFileAtomic } from '../../../atomic'

const run = (bin: string, args: string[], signal?: AbortSignal, maxBuffer = 64 * 1024 * 1024): Promise<{ stdout: string; stderr: string }> =>
  new Promise((resolve, reject) => execFile(bin, args, { windowsHide: true, signal, maxBuffer }, (err, stdout, stderr) => (err ? reject(Object.assign(err, { stderr })) : resolve({ stdout, stderr }))))

export interface StreamInfo { index: number; type: 'video' | 'audio'; codec: string; timeBase: string; startPts: number | null; startTime: number; durationTs: number | null; width?: number; height?: number; rFrameRate?: string; avgFrameRate?: string; sampleRate?: number; channels?: number }
export interface SourceInfo {
  path: string; sha256: string; sizeBytes: number; durationSec: number; formatStartTime: number
  /** Dauer als ganzzahlige PTS in der Timebase des ersten Videostreams (sonst Audio); Zeichenkette wie im Vertrag. */
  durationPts: string; timebaseNum: number; timebaseDen: number
  video: StreamInfo | null; audio: StreamInfo | null; streams: StreamInfo[]
  /** Variable Bildrate: r_frame_rate ≠ avg_frame_rate (ffprobe-Kriterium), Audio-Versatz = Start Audio − Start Video. */
  vfr: boolean; audioOffsetSec: number
  probedAt: string; ffprobe: string
}

const frac = (s?: string): number => { if (!s) return 0; const [a, b] = s.split('/').map(Number); return b ? a / b : a }

export function parseProbe(json: string, path: string): Omit<SourceInfo, 'sha256' | 'sizeBytes' | 'probedAt' | 'ffprobe'> {
  const raw = JSON.parse(json) as { format?: { duration?: string; start_time?: string }; streams?: Array<Record<string, unknown>> }
  const streams: StreamInfo[] = (raw.streams ?? []).filter((s) => s.codec_type === 'video' || s.codec_type === 'audio').map((s) => ({
    index: Number(s.index), type: s.codec_type as 'video' | 'audio', codec: String(s.codec_name ?? '?'), timeBase: String(s.time_base ?? '1/1000'),
    startPts: s.start_pts != null ? Number(s.start_pts) : null, startTime: Number(s.start_time ?? 0) || 0, durationTs: s.duration_ts != null ? Number(s.duration_ts) : null,
    ...(s.codec_type === 'video' ? { width: Number(s.width), height: Number(s.height), rFrameRate: String(s.r_frame_rate ?? ''), avgFrameRate: String(s.avg_frame_rate ?? '') } : { sampleRate: Number(s.sample_rate), channels: Number(s.channels) })
  }))
  const video = streams.find((s) => s.type === 'video' && s.codec !== 'mjpeg' && s.codec !== 'png') ?? null
  const audio = streams.find((s) => s.type === 'audio') ?? null
  const durationSec = Number(raw.format?.duration)
  if (!Number.isFinite(durationSec) || durationSec <= 0) throw new Error('ffprobe: keine gültige Dauer (Datei beschädigt?)')
  if (!video && !audio) throw new Error('ffprobe: weder Video- noch Tonspur')
  const tb = (video ?? audio)!.timeBase.split('/').map(Number)
  const [num, den] = tb.length === 2 && tb[0] > 0 && tb[1] > 0 ? tb : [1, 1000]
  const vfr = !!video && Math.abs(frac(video.rFrameRate) - frac(video.avgFrameRate)) > 0.01
  return {
    path, durationSec, formatStartTime: Number(raw.format?.start_time ?? 0) || 0, durationPts: String(Math.round((durationSec * den) / num)), timebaseNum: num, timebaseDen: den,
    video, audio, streams, vfr, audioOffsetSec: video && audio ? Math.round((audio.startTime - video.startTime) * 1e6) / 1e6 : 0
  }
}

export async function sha256File(path: string): Promise<string> {
  const h = createHash('sha256')
  await new Promise<void>((resolve, reject) => createReadStream(path).on('data', (d) => h.update(d)).on('end', () => resolve()).on('error', reject))
  return h.digest('hex')
}

/** Probe + SHA der Quelle; Cache nach Größe und Änderungszeit unter analysis/shared/source.json (SHA einer 2-GB-Datei kostet Sekunden). */
export async function probeSource(hash: string, path: string, signal?: AbortSignal): Promise<SourceInfo> {
  const st = await stat(path)
  const cache = join(projectDir(hash), 'analysis', 'shared', 'source-v4.json')
  if (existsSync(cache)) {
    try { const c = JSON.parse(await readFile(cache, 'utf8')) as SourceInfo & { mtimeMs: number }; if (c.path === path && c.sizeBytes === st.size && c.mtimeMs === st.mtimeMs) return c } catch { /* neu */ }
  }
  const { stdout } = await run(FFPROBE_PATH, ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', path], signal)
  const info: SourceInfo = { ...parseProbe(stdout, path), sha256: await sha256File(path), sizeBytes: st.size, probedAt: new Date().toISOString(), ffprobe: FFPROBE_PATH.split(/[\\/]/).pop() ?? 'ffprobe' }
  await writeFileAtomic(cache, JSON.stringify({ ...info, mtimeMs: st.mtimeMs }, null, 1))
  return info
}

/** Ausgabe-Probe: tatsächliche Streams und Dauer der gerenderten Datei (unabhängig von dem, was der Renderer meldet). */
export async function probeOutput(path: string, signal?: AbortSignal): Promise<{ durationSeconds: number; streams: Array<'video' | 'audio'>; sha256: string; sizeBytes: number }> {
  const { stdout } = await run(FFPROBE_PATH, ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type', '-of', 'json', path], signal)
  const raw = JSON.parse(stdout) as { format: { duration: string }; streams: Array<{ codec_type: string }> }
  return { durationSeconds: Number(raw.format.duration), streams: raw.streams.map((s) => s.codec_type).filter((t): t is 'video' | 'audio' => t === 'video' || t === 'audio'), sha256: await sha256File(path), sizeBytes: (await stat(path)).size }
}

/** AV-Ausschnitt (Bild UND Ton) für die Modelle: klein, H.264/AAC 16 kHz mono; ohne Tonspur in der Quelle bleibt der Ausschnitt stumm (kein erfundener Ton). */
export function cutAv(video: string, start: number, dur: number, out: string, hasAudio: boolean, signal?: AbortSignal): Promise<unknown> {
  return run(FFMPEG_PATH, ['-hide_banner', '-loglevel', 'error', '-y', '-ss', start.toFixed(3), '-t', dur.toFixed(3), '-i', video, '-vf', 'scale=-2:448', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '28', ...(hasAudio ? ['-c:a', 'aac', '-ar', '16000', '-ac', '1'] : ['-an']), out], signal)
}

/** Höchstlänge einer AV-Eingabe: MiniCPM-o braucht je Sekunde Bild+Ton ca. 0,2 GB VRAM über den 18 GB des Modells (gemessen: 75 s → über 32 GB, Auslagerung). */
export const AV_MAX_SEC = 40

/** Mehrere Quellstücke zu einem AV-Ausschnitt zusammensetzen (z. B. Anfang + Mitte + Ende eines langen Kandidaten), Bild und Ton gemeinsam. */
export function cutAvMulti(video: string, spans: Array<{ start: number; end: number }>, out: string, hasAudio: boolean, signal?: AbortSignal): Promise<unknown> {
  if (spans.length === 1) return cutAv(video, spans[0].start, spans[0].end - spans[0].start, out, hasAudio, signal)
  const inputs = spans.flatMap((s) => ['-ss', s.start.toFixed(3), '-t', (s.end - s.start).toFixed(3), '-i', video])
  const parts = spans.map((_, i) => `[${i}:v]scale=-2:448,setsar=1,fps=30[v${i}]${hasAudio ? `;[${i}:a]aresample=16000,aformat=channel_layouts=mono[a${i}]` : ''}`).join(';')
  const cat = `${spans.map((_, i) => `[v${i}]${hasAudio ? `[a${i}]` : ''}`).join('')}concat=n=${spans.length}:v=1:a=${hasAudio ? 1 : 0}[v]${hasAudio ? '[a]' : ''}`
  return run(FFMPEG_PATH, ['-hide_banner', '-loglevel', 'error', '-y', ...inputs, '-filter_complex', `${parts};${cat}`, '-map', '[v]', ...(hasAudio ? ['-map', '[a]', '-c:a', 'aac', '-ar', '16000', '-ac', '1'] : []), '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '28', out], signal)
}

/** Lange Bereiche auf Anfang/Mitte/Ende (≤ AV_MAX_SEC gesamt) verdichten; kurze bleiben ganz. */
export function avParts(span: { start: number; end: number }, max = AV_MAX_SEC): Array<{ start: number; end: number }> {
  const d = span.end - span.start
  if (d <= max) return [span]
  const head = max * 0.4, mid = max * 0.2, tail = max * 0.4
  const m0 = span.start + d / 2 - mid / 2
  return [{ start: span.start, end: span.start + head }, { start: m0, end: m0 + mid }, { start: span.end - tail, end: span.end }]
}

/** Stille im fertigen Clip (ffmpeg silencedetect, −40 dB, ≥ 1,2 s): Messung für „dead-air“. */
export async function silencesIn(path: string, signal?: AbortSignal): Promise<Array<[number, number]>> {
  const { stderr } = await run(FFMPEG_PATH, ['-hide_banner', '-nostats', '-i', path, '-af', 'silencedetect=noise=-40dB:d=1.2', '-f', 'null', '-'], signal)
  const out: Array<[number, number]> = []
  let s: number | null = null
  for (const l of stderr.split(/\r?\n/)) {
    const a = /silence_start: ([\d.]+)/.exec(l); if (a) s = Number(a[1])
    const b = /silence_end: ([\d.]+)/.exec(l); if (b && s !== null) { out.push([s, Number(b[1])]); s = null }
  }
  return out
}
