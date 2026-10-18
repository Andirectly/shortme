import type { ShortmeShot } from './shortme'
import { cropBox } from './framing'
import { planStream } from './streamLayout'

/** Minimale Canvas-Schnittstelle (ohne DOM-Typen, damit die Geometrie in Node getestet werden kann). */
export interface Ctx2D {
  filter: string
  clearRect(x: number, y: number, w: number, h: number): void
  save(): void
  restore(): void
  drawImage(image: unknown, ...args: number[]): void
}

/**
 * Zeichnet ein Vorschaubild exakt wie der Export (gleiche Geometrie aus shared/framing.ts):
 * smart/fixed = fester 9:16-Ausschnitt, fit = 16:9 mittig auf unscharfer Kopie, split = zwei Personen übereinander.
 */
export function drawLayout(ctx: Ctx2D, video: unknown, src: { width: number; height: number }, shot: Pick<ShortmeShot, 'layout' | 'cx' | 'cx2' | 'stream'> & { zoom?: number }, zoom: number, W: number, H: number): void {
  ctx.clearRect(0, 0, W, H)
  if (shot.layout === 'stream' && shot.stream) {
    // Facecam + Gameplay: dieselbe Geometrie wie im Export (planStream); Gameplay zuerst, damit das kleine Fenster darüber liegt
    const p = planStream(src, shot.stream)
    const k = W / 1080
    for (const part of [p.game, p.cam]) ctx.drawImage(video, part.crop.x, part.crop.y, part.crop.w, part.crop.h, part.dest.x * k, part.dest.y * k, part.dest.w * k, part.dest.h * k)
    return
  }
  if (shot.layout === 'fit') {
    const cover = Math.max(W / src.width, H / src.height)
    const bw = src.width * cover
    const bh = src.height * cover
    ctx.save()
    ctx.filter = 'blur(26px) brightness(0.8)'
    ctx.drawImage(video, (W - bw) / 2, (H - bh) / 2, bw, bh)
    ctx.restore()
    const fh = (W * src.height) / src.width
    ctx.drawImage(video, 0, (H - fh) / 2, W, fh)
    return
  }
  if (shot.layout === 'split' && shot.cx2 !== undefined) {
    const half = H / 2
    for (const [cx, y] of [[shot.cx, 0], [shot.cx2, half]] as const) {
      const c = cropBox(src, cx, W / half, zoom * (shot.zoom ?? 1))
      ctx.drawImage(video, c.x, c.y, c.w, c.h, 0, y, W, half)
    }
    return
  }
  const c = cropBox(src, shot.cx, W / H, zoom * (shot.zoom ?? 1))
  ctx.drawImage(video, c.x, c.y, c.w, c.h, 0, 0, W, H)
}

/** Rechteck des aktuellen Ausschnitts in der Quelle (0..1), für die Markierung im Quellmonitor. */
export function sourceRects(src: { width: number; height: number }, shot: Pick<ShortmeShot, 'layout' | 'cx' | 'cx2' | 'stream'> & { zoom?: number }, zoom: number): Array<{ x: number; w: number; y?: number; h?: number; kind?: 'cam' | 'game' }> {
  if (shot.layout === 'stream' && shot.stream) {
    const p = planStream(src, shot.stream)
    return ([['game', p.game.crop], ['cam', p.cam.crop]] as const).map(([kind, c]) => ({ kind, x: c.x / src.width, w: c.w / src.width, y: c.y / src.height, h: c.h / src.height }))
  }
  if (shot.layout === 'fit') return [{ x: 0, w: 1 }]
  const aspect = shot.layout === 'split' ? 1080 / 960 : 1080 / 1920
  return [shot.cx, ...(shot.layout === 'split' && shot.cx2 !== undefined ? [shot.cx2] : [])].map((cx) => {
    const c = cropBox(src, cx, aspect, zoom * (shot.zoom ?? 1))
    return { x: c.x / src.width, w: c.w / src.width }
  })
}
