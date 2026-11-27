import { rangeFilters, type PlacedAudio, type VoiceRange } from '../../../shared/audioMix'
import type { Piece } from './timeline'

import { cropBox, OUT_H, OUT_W, type SourceDims } from '@shared/framing'
import { planStream } from '@shared/streamLayout'

export { cropBox, OUT_H, OUT_W, type SourceDims }

/** Video-Kette eines Stücks → Label `[vK]`. Quelle ist Eingang 0 und beginnt bei `base` Sekunden. */
export function videoChain(p: Piece, k: number, src: SourceDims, base: number): string {
  const trim = `[0:v]trim=start=${(p.src0 - base).toFixed(3)}:end=${(p.src1 - base).toFixed(3)},setpts=PTS-STARTPTS`
  const sh = p.shot
  if (sh.layout === 'fit') {
    // 16:9 mittig, oben/unten unscharfe vergrößerte Kopie
    return `${trim},fps=30,split=2[bs${k}][fs${k}];[bs${k}]scale=${OUT_W}:${OUT_H}:force_original_aspect_ratio=increase,crop=${OUT_W}:${OUT_H},gblur=sigma=36[bg${k}];[fs${k}]scale=${OUT_W}:-2[fg${k}];[bg${k}][fg${k}]overlay=(W-w)/2:(H-h)/2,setsar=1[v${k}]`
  }
  if (sh.layout === 'stream' && sh.stream) {
    // Facecam + Gameplay: zwei Ausschnitte der Quelle, untereinander (oder Facecam als kleines Fenster darüber)
    const p = planStream(src, sh.stream)
    const g = p.game.crop, c = p.cam.crop, dg = p.game.dest, dc = p.cam.dest
    const head = `${trim},fps=30,split=2[sc${k}][sg${k}];[sg${k}]crop=${g.w}:${g.h}:${g.x}:${g.y},scale=${dg.w}:${dg.h}:flags=lanczos[tg${k}];[sc${k}]crop=${c.w}:${c.h}:${c.x}:${c.y},scale=${dc.w}:${dc.h}:flags=lanczos[tc${k}]`
    if (p.pip) return `${head};[tg${k}][tc${k}]overlay=${dc.x}:${dc.y},setsar=1[v${k}]`
    const gap = OUT_H - dg.h - dc.h
    if (dc.y === 0) return `${head};[tc${k}]pad=${OUT_W}:${dc.h + gap}:0:0:color=black[pc${k}];[pc${k}][tg${k}]vstack=inputs=2,setsar=1[v${k}]`
    return `${head};[tg${k}]pad=${OUT_W}:${dg.h + gap}:0:0:color=black[pg${k}];[pg${k}][tc${k}]vstack=inputs=2,setsar=1[v${k}]`
  }
  if (sh.layout === 'split' && sh.cx2 !== undefined) {
    const a = cropBox(src, sh.cx, OUT_W / (OUT_H / 2), p.zoom * sh.zoom)
    const b = cropBox(src, sh.cx2, OUT_W / (OUT_H / 2), p.zoom * sh.zoom)
    return `${trim},fps=30,split=2[sa${k}][sb${k}];[sa${k}]crop=${a.w}:${a.h}:${a.x}:${a.y},scale=${OUT_W}:${OUT_H / 2}:flags=lanczos[ta${k}];[sb${k}]crop=${b.w}:${b.h}:${b.x}:${b.y},scale=${OUT_W}:${OUT_H / 2}:flags=lanczos[tb${k}];[ta${k}][tb${k}]vstack,setsar=1[v${k}]`
  }
  const c = cropBox(src, sh.cx, OUT_W / OUT_H, p.zoom)
  return `${trim},fps=30,crop=${c.w}:${c.h}:${c.x}:${c.y},scale=${OUT_W}:${OUT_H}:flags=lanczos,setsar=1[v${k}]`
}

export function audioChain(p: Piece, k: number, base: number): string {
  const len = p.src1 - p.src0
  const f = Math.min(0.012, len / 4)
  return `[0:a]atrim=start=${(p.src0 - base).toFixed(3)}:end=${(p.src1 - base).toFixed(3)},asetpts=PTS-STARTPTS,afade=t=in:d=${f.toFixed(3)},afade=t=out:st=${(len - f).toFixed(3)}:d=${f.toFixed(3)}[a${k}]`
}

export interface GraphOptions {
  src: SourceDims
  /** Zeit (Quelle), bei der Eingang 0 beginnt (`-ss`). */
  base: number
  /** Optionaler Lautheits-Filter (loudnorm …) und Ausblendzeit am Ende. */
  audioFilter?: string
  fadeOutSec?: number
  /** Filterkette nach dem Zusammenfügen (z. B. eingebrannte Untertitel). */
  videoPost?: string
  /** Titel-Overlay (Bildfolge mit Alpha als Eingang 1): wird vor `videoPost` aufs Video gelegt. */
  overlay?: { x: number; y: number }
  /** Dauer nach dem Kürzen (für die Ausblendung). */
  duration: number
  /** false: Quelle ohne Tonspur → nur `[v]` (keine erfundene Stille). Standard: true. */
  audio?: boolean
  /** Zusätzliche Tonspuren (Eingänge ab `first`) und Pegel des Originaltons; ohne Spuren und mit 0 dB bleibt der Graph unverändert. */
  mix?: { first: number; tracks: PlacedAudio[]; voiceDb: number; ranges?: VoiceRange[] }
}

/** Eine Tonspur: zuschneiden, pegeln, klickfrei ein-/ausblenden, auf ihre Ausgabezeit verschieben. */
export function mixChain(p: PlacedAudio, input: number, k: number): string {
  const f = Math.min(0.02, p.len / 4)
  const ms = Math.round(p.delay * 1000)
  return `[${input}:a]atrim=start=${p.offset.toFixed(3)}:duration=${p.len.toFixed(3)},asetpts=PTS-STARTPTS,volume=${p.gainDb.toFixed(1)}dB,afade=t=in:d=${f.toFixed(3)},afade=t=out:st=${(p.len - f).toFixed(3)}:d=${f.toFixed(3)},adelay=${ms}:all=1[x${k}]`
}

/** Kompletter filter_complex: Stücke zuschneiden/skalieren, aneinanderhängen, Audio normalisieren. Ausgänge `[v]` und `[a]`. */
export function buildFilterGraph(pieces: Piece[], o: GraphOptions): string {
  const parts: string[] = []
  const audio = o.audio !== false
  pieces.forEach((p, k) => { parts.push(videoChain(p, k, o.src, o.base)); if (audio) parts.push(audioChain(p, k, o.base)) })
  const n = pieces.length
  const labels = pieces.map((_, k) => (audio ? `[v${k}][a${k}]` : `[v${k}]`)).join('')
  const tracks = audio ? o.mix?.tracks ?? [] : []
  // Originalton-Pegel (gesamt + Bereiche) NACH der Normalisierung, sonst gleicht diese ihn aus; Bereiche mit Limiter gegen Übersteuern
  const rv = audio ? rangeFilters(o.mix?.ranges ?? [], pieces) : []
  const voice = [audio && o.mix?.voiceDb ? `volume=${o.mix.voiceDb.toFixed(1)}dB` : '', ...rv, rv.length && !tracks.length ? 'alimiter=limit=0.95:level=0' : ''].filter(Boolean).join(',')
  const fade = audio && o.fadeOutSec ? `afade=t=out:st=${Math.max(0, o.duration - o.fadeOutSec).toFixed(3)}:d=${o.fadeOutSec}` : ''
  const post = !audio ? '' : tracks.length
    ? [o.audioFilter, voice].filter(Boolean).join(',') || 'anull'
    : [o.audioFilter, voice, fade].filter(Boolean).join(',')
  const vOut = o.overlay || o.videoPost ? 'vc' : 'v'
  parts.push(audio ? `${labels}concat=n=${n}:v=1:a=1[${vOut}][${post ? 'ac' : 'a'}]` : `${labels}concat=n=${n}:v=1:a=0[${vOut}]`)
  let cur = 'vc'
  if (o.overlay) { parts.push(`[${cur}][1:v]overlay=${o.overlay.x}:${o.overlay.y}:eof_action=pass:format=auto[${o.videoPost ? 'vo' : 'v'}]`); cur = 'vo' }
  if (o.videoPost) parts.push(`[${cur}]${o.videoPost}[v]`)
  if (tracks.length) {
    // Originalton (normalisiert, gepegelt) + Spuren ohne Gesamtnormalisierung mischen; Limiter gegen Übersteuern, dann die Ausblendung am Ende
    parts.push(`[ac]${post}[av]`)
    tracks.forEach((p, k) => parts.push(mixChain(p, o.mix!.first + k, k)))
    parts.push(`[av]${tracks.map((_, k) => `[x${k}]`).join('')}amix=inputs=${tracks.length + 1}:duration=first:dropout_transition=0:normalize=0,alimiter=limit=0.95:level=0${fade ? `,${fade}` : ''}[a]`)
  } else if (post) parts.push(`[ac]${post}[a]`)
  return parts.join(';\n')
}
