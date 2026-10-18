import { useRef } from 'react'
import { fitGame, streamDest, type NRect, type StreamLayout } from '@shared/streamLayout'

type Which = 'cam' | 'game'
const clamp = (v: number, a: number, b: number): number => Math.min(b, Math.max(a, v))

/**
 * Zwei verschiebbare und skalierbare Rahmen über dem Original (Facecam, Gameplay). Verschieben: Rahmen ziehen; Größe: Griff unten rechts
 * (Seitenverhältnis bleibt). Das Gameplay-Fenster hat immer das Seitenverhältnis seines Zielbereichs im Hochformat.
 * `onLive` meldet während des Ziehens (Vorschau), `onCommit` beim Loslassen (ein Undo-Schritt).
 */
export function StreamFrames({ layout, src, onLive, onCommit }: {
  layout: StreamLayout; src: { width: number; height: number }
  onLive: (p: Partial<StreamLayout>) => void; onCommit: (p: Partial<StreamLayout>) => void
}): React.JSX.Element {
  const box = useRef<HTMLDivElement>(null)
  const drag = useRef<{ which: Which; mode: 'move' | 'size'; x0: number; y0: number; r0: NRect; last: NRect } | null>(null)
  const dg = streamDest(layout.preset, layout.gap)
  const game = fitGame(src, layout.game, dg.game.w / dg.game.h)
  const rects: Record<Which, NRect> = { cam: layout.cam, game }
  const px = src.width / src.height

  const patchFor = (which: Which, r: NRect): Partial<StreamLayout> => (which === 'cam' ? { cam: r } : { game: r })
  const down = (which: Which, mode: 'move' | 'size') => (e: React.PointerEvent): void => {
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { which, mode, x0: e.clientX, y0: e.clientY, r0: rects[which], last: rects[which] }
  }
  const move = (e: React.PointerEvent): void => {
    const d = drag.current
    const b = box.current?.getBoundingClientRect()
    if (!d || !b) return
    const dx = (e.clientX - d.x0) / b.width
    const dy = (e.clientY - d.y0) / b.height
    let r: NRect
    if (d.mode === 'move') r = { ...d.r0, x: clamp(d.r0.x + dx, 0, 1 - d.r0.w), y: clamp(d.r0.y + dy, 0, 1 - d.r0.h) }
    else {
      // gleichmäßig skalieren: Seitenverhältnis in Pixeln bleibt
      const asp = (d.r0.w * px) / d.r0.h
      let w = clamp(d.r0.w + dx, 0.06, 1 - d.r0.x)
      let h = (w * px) / asp
      if (d.r0.y + h > 1) { h = 1 - d.r0.y; w = (h * asp) / px }
      r = { x: d.r0.x, y: d.r0.y, w, h }
    }
    d.last = r
    onLive(patchFor(d.which, r))
  }
  const up = (): void => {
    const d = drag.current
    drag.current = null
    if (d) onCommit(patchFor(d.which, d.last))
  }

  return (
    <div ref={box} style={{ position: 'absolute', inset: 0 }}>
      {(['game', 'cam'] as const).map((which) => {
        const r = rects[which]
        const color = which === 'cam' ? '#ffd60a' : '#ffffff'
        return (
          <div key={which} role="group" aria-label={which === 'cam' ? 'Facecam-Rahmen' : 'Gameplay-Rahmen'}
            onPointerDown={down(which, 'move')} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
            style={{ position: 'absolute', left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.w * 100}%`, height: `${r.h * 100}%`, border: `2px solid ${color}`, background: which === 'cam' ? 'rgba(255,214,10,0.10)' : 'rgba(255,255,255,0.06)', boxShadow: '0 0 0 1px rgba(0,0,0,0.5)', cursor: 'move', touchAction: 'none', boxSizing: 'border-box' }}>
            <span className="sm-tag" style={{ position: 'absolute', top: 4, left: 4, background: 'rgba(0,0,0,0.6)', color }}>{which === 'cam' ? 'Facecam' : 'Gameplay'}</span>
            <span aria-label="Größe ändern" onPointerDown={down(which, 'size')} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
              style={{ position: 'absolute', right: -7, bottom: -7, width: 14, height: 14, borderRadius: 4, background: color, border: '1px solid rgba(0,0,0,0.6)', cursor: 'nwse-resize', touchAction: 'none' }} />
          </div>
        )
      })}
    </div>
  )
}
