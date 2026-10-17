import type { Piece } from './timeline'

export const OUT_W = 1080
export const OUT_H = 1920

const even = (n: number): number => Math.max(2, Math.round(n / 2) * 2)

export interface SourceDims { width: number; height: number }

/** Zuschnitt eines festen Ausschnitts (Breite/Höhe/x/y in Quellpixeln) für ein Seitenverhältnis `aspect` (= Breite/Höhe des Ausschnitts). */
export function cropBox(src: SourceDims, cx: number, aspect: number, zoom: number): { w: number; h: number; x: number; y: number } {
  let h = src.height / zoom
  let w = h * aspect
  if (w > src.width) { w = src.width / zoom; h = w / aspect } // Quelle schmaler als Ziel: Breite begrenzt
  w = even(w); h = even(h)
  const x = Math.round(Math.min(src.width - w, Math.max(0, cx * src.width - w / 2)) / 2) * 2
  const y = Math.round(((src.height - h) / 2) / 2) * 2
  return { w, h, x, y }
}

/** Video-Kette eines Stücks → Label `[vK]`. Quelle ist Eingang 0 und beginnt bei `base` Sekunden. */
export function videoChain(p: Piece, k: number, src: SourceDims, base: number): string {
  const trim = `[0:v]trim=start=${(p.src0 - base).toFixed(3)}:end=${(p.src1 - base).toFixed(3)},setpts=PTS-STARTPTS`
  const sh = p.shot
  if (sh.layout === 'fit') {
    // 16:9 mittig, oben/unten unscharfe vergrößerte Kopie
    return `${trim},fps=30,split=2[bs${k}][fs${k}];[bs${k}]scale=${OUT_W}:${OUT_H}:force_original_aspect_ratio=increase,crop=${OUT_W}:${OUT_H},gblur=sigma=36[bg${k}];[fs${k}]scale=${OUT_W}:-2[fg${k}];[bg${k}][fg${k}]overlay=(W-w)/2:(H-h)/2,setsar=1[v${k}]`
  }
  if (sh.layout === 'split' && sh.cx2 !== undefined) {
    const a = cropBox(src, sh.cx, OUT_W / (OUT_H / 2), p.zoom)
    const b = cropBox(src, sh.cx2, OUT_W / (OUT_H / 2), p.zoom)
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
  /** Dauer nach dem Kürzen (für die Ausblendung). */
  duration: number
}

/** Kompletter filter_complex: Stücke zuschneiden/skalieren, aneinanderhängen, Audio normalisieren. Ausgänge `[v]` und `[a]`. */
export function buildFilterGraph(pieces: Piece[], o: GraphOptions): string {
  const parts: string[] = []
  pieces.forEach((p, k) => { parts.push(videoChain(p, k, o.src, o.base)); parts.push(audioChain(p, k, o.base)) })
  const n = pieces.length
  const labels = pieces.map((_, k) => `[v${k}][a${k}]`).join('')
  const post = [o.audioFilter, o.fadeOutSec ? `afade=t=out:st=${Math.max(0, o.duration - o.fadeOutSec).toFixed(3)}:d=${o.fadeOutSec}` : ''].filter(Boolean).join(',')
  parts.push(`${labels}concat=n=${n}:v=1:a=1[${o.videoPost ? 'vc' : 'v'}][${post ? 'ac' : 'a'}]`)
  if (o.videoPost) parts.push(`[vc]${o.videoPost}[v]`)
  if (post) parts.push(`[ac]${post}[a]`)
  return parts.join(';\n')
}
