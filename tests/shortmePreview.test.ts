import { describe, expect, it } from 'vitest'
import { sourceRects, drawLayout, type Ctx2D } from '../src/shared/previewDraw'
import { cropBox } from '../src/shared/framing'

describe('Vorschau-Geometrie = Export-Geometrie', () => {
  const src = { width: 1920, height: 1080 }
  it('sourceRects liefert den 9:16-Ausschnitt in Anteilen der Quellbreite', () => {
    const [r] = sourceRects(src, { layout: 'smart', cx: 0.5 }, 1)
    expect(r.w).toBeCloseTo(608 / 1920, 4)
    expect(r.x + r.w / 2).toBeCloseTo(0.5, 2)
    expect(sourceRects(src, { layout: 'fit', cx: 0.3 }, 1)).toEqual([{ x: 0, w: 1 }])
    expect(sourceRects(src, { layout: 'split', cx: 0.2, cx2: 0.8 }, 1)).toHaveLength(2)
  })
  it('Zoom verkleinert den Ausschnitt, Rand bleibt im Bild', () => {
    const a = cropBox(src, 0.0, 9 / 16, 1.08)
    const b = cropBox(src, 1.0, 9 / 16, 1.08)
    expect(a.x).toBe(0)
    expect(b.x + b.w).toBeLessThanOrEqual(1920)
    expect(a.h).toBeLessThan(1080)
  })
  it('drawLayout ruft drawImage mit dem Export-Ausschnitt auf (smart) und zweimal bei split', () => {
    const calls: number[][] = []
    const ctx = { clearRect: () => undefined, save: () => undefined, restore: () => undefined, filter: '', drawImage: (...a: unknown[]) => calls.push(a.slice(1) as number[]) } as unknown as Ctx2D
    drawLayout(ctx, {}, src, { layout: 'smart', cx: 0.5 }, 1, 540, 960)
    expect(calls).toHaveLength(1)
    const c = cropBox(src, 0.5, 540 / 960, 1)
    expect(calls[0].slice(0, 4)).toEqual([c.x, c.y, c.w, c.h])
    calls.length = 0
    drawLayout(ctx, {}, src, { layout: 'split', cx: 0.2, cx2: 0.8 }, 1, 540, 960)
    expect(calls).toHaveLength(2)
    calls.length = 0
    drawLayout(ctx, {}, src, { layout: 'fit', cx: 0.5 }, 1, 540, 960)
    expect(calls).toHaveLength(2) // unscharfer Hintergrund + Vordergrund
  })
})
