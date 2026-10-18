// Automatischer Vorschlag des Inhaltstyps beim Import: Facecam gefunden? Wie viele Personen sind groß im Bild? Wie oft wechselt die Kamera?
import { spawn } from 'node:child_process'
import { FFMPEG_PATH } from '../../pipeline/ffmpeg'
import { detectFacesYuNet } from '../../pipeline/yunet'
import { guessKind, type ContentType, type FrameChoice, type KindStats, type KindGuess } from '../../../shared/videoKind'
import type { ProjectMeta } from '../project'
import { grabFrame, findFacecam } from './facecam'
import { loadProfile, rememberedChoice, sourceKey } from '../profiles'

export interface KindSuggestion extends KindGuess { source: 'twitch' | 'remembered' | 'detected'; frame: FrameChoice; detected: ContentType }

/** Kamerawechsel pro Minute aus einer 60-s-Stichprobe aus der Mitte (ffmpeg scene-Filter). */
function cutsPerMinute(path: string, durationSec: number): Promise<number> {
  const len = Math.min(60, durationSec)
  const start = Math.max(0, durationSec / 2 - len / 2)
  return new Promise((resolve) => {
    const p = spawn(FFMPEG_PATH, ['-hide_banner', '-nostats', '-ss', start.toFixed(1), '-t', len.toFixed(1), '-i', path, '-an', '-vf', "scale=320:-2,select='gt(scene,0.35)',showinfo", '-f', 'null', '-'], { windowsHide: true })
    let err = ''
    p.stderr.on('data', (d: Buffer) => { err += d.toString(); if (err.length > 400000) err = err.slice(-200000) })
    p.on('error', () => resolve(0))
    p.on('close', () => resolve(((err.match(/pts_time:/g) ?? []).length / len) * 60))
  })
}

export async function suggestKind(meta: ProjectMeta, signal?: AbortSignal): Promise<KindSuggestion> {
  const twitch = !!meta.twitch
  let facecam = false
  let one = 0, two = 0, cuts = 0
  if (!twitch) {
    facecam = !!(await findFacecam(meta.sourcePath, 0, meta.durationSec, 10, signal).catch(() => null))
    if (!facecam) {
      const n = 8
      let frames = 0
      for (let i = 0; i < n; i++) {
        try {
          const f = await grabFrame(meta.sourcePath, ((i + 0.5) / n) * meta.durationSec, signal)
          const big = (await detectFacesYuNet(f.rgb, f.w, f.h, signal)).filter((b) => b.score > 0.6 && (b.x2 - b.x1) * (b.y2 - b.y1) > 0.015)
          frames++
          if (big.length === 1) one++
          else if (big.length >= 2) two++
        } catch (e) { if (signal?.aborted) throw e }
      }
      one /= Math.max(1, frames); two /= Math.max(1, frames)
      cuts = await cutsPerMinute(meta.sourcePath, meta.durationSec)
    }
  }
  const stats: KindStats = { facecam, oneFace: one, twoFaces: two, cutsPerMin: cuts, twitch }
  const g = guessKind(stats)
  const remembered = await rememberedChoice(sourceKey({ channel: meta.twitch?.channel, url: meta.sourceUrl, path: meta.sourcePath }))
  if (twitch) return { ...g, source: 'twitch', frame: (await loadProfile('stream')).frame, detected: g.kind }
  if (remembered) return { kind: remembered.kind, reason: 'zuletzt für diese Quelle gewählt', source: 'remembered', frame: remembered.frame, detected: g.kind }
  return { ...g, source: 'detected', frame: (await loadProfile(g.kind)).frame, detected: g.kind }
}
