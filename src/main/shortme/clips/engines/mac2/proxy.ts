// Engine Mac 2 – Analyse-Proxy für AV1-Quellen: M1/M2 dekodieren AV1 nur per Software (libaom); jeder Bildschritt (Keyframes, Bildsuche,
// Beobachtung) würde die Quelle erneut teuer dekodieren (gemessen: Keyframe-Scan > 10 min). Deshalb einmal je Projekt eine 720p-H.264-Kopie über
// VideoToolbox (gemessen 1,8× Echtzeit auf M1 Pro), gleiche Zeitachse (Zeitstempel durchgereicht), Keyframe je Sekunde. Gerendert wird weiter aus dem Original.
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, rename, rm } from 'node:fs/promises'
import { dirname } from 'node:path'
import { FFMPEG_PATH } from '../../../../pipeline/ffmpeg'
import { projectFile } from '../../../project'

export const PROXY_REVISION = 'proxy-720p-vt-1'
export const needsProxy = (videoCodec: string | undefined): boolean => /^(av1|av01|vp9)$/i.test(videoCodec ?? '')
export const proxyPath = (hash: string): string => projectFile(hash, `analysis/shared/${PROXY_REVISION}.mp4`)

/** Proxy anlegen (oder vorhandenen verwenden). Fortschritt aus ffmpeg `-progress` (echte Position, kein Heartbeat); 2 min ohne Fortschritt = Abbruch. */
export async function ensureProxy(hash: string, source: string, durationSec: number, onProgress: (f: number) => void, signal?: AbortSignal): Promise<string> {
  const out = proxyPath(hash)
  if (existsSync(out)) return out
  await mkdir(dirname(out), { recursive: true })
  const tmp = `${out}.part.mp4`
  await new Promise<void>((resolve, reject) => {
    const p = spawn(FFMPEG_PATH, ['-hide_banner', '-loglevel', 'error', '-y', '-i', source, '-an', '-vf', 'scale=-2:720', '-c:v', 'h264_videotoolbox', '-b:v', '4M', '-force_key_frames', 'expr:gte(t,n_forced*1)', '-fps_mode', 'passthrough', '-progress', 'pipe:1', '-nostats', tmp], { stdio: ['ignore', 'pipe', 'pipe'] })
    let last = Date.now(), err = ''
    const stall = setInterval(() => { if (Date.now() - last > 120_000) { p.kill('SIGKILL'); reject(new Error('Analyse-Proxy: 2 min kein Fortschritt – abgebrochen')) } }, 5000)
    const onAbort = (): void => { p.kill('SIGKILL') }
    signal?.addEventListener('abort', onAbort, { once: true })
    p.stdout.on('data', (d: Buffer) => { const m = d.toString().match(/out_time_us=(\d+)/g); if (m) { last = Date.now(); onProgress(Math.min(1, Number(m[m.length - 1].split('=')[1]) / 1e6 / Math.max(1, durationSec))) } })
    p.stderr.on('data', (d: Buffer) => { err = (err + d.toString()).slice(-600) })
    p.on('error', reject)
    p.on('close', (code) => { clearInterval(stall); signal?.removeEventListener('abort', onAbort); if (signal?.aborted) reject(signal.reason ?? new Error('abgebrochen')); else if (code === 0) resolve(); else reject(new Error(`Analyse-Proxy fehlgeschlagen (ffmpeg ${code}): ${err}`)) })
  }).catch(async (e) => { await rm(tmp, { force: true }).catch(() => undefined); throw e })
  await rename(tmp, out)
  return out
}
