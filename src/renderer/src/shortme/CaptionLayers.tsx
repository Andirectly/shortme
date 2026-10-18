import { useEffect, useMemo, useRef, useState } from 'react'
import { FROZEN_CSS, captionCss, cueTimes, isFiller, scopeCss, segmentVars, wordVars, type CaptionWord } from '@shared/captions'
import type { StylePreset } from '@shared/preset'
import { layoutTitle, titleCss, titleSvg, type TitleLayout } from '@shared/title'

export interface PWord extends CaptionWord { g: number; hi?: boolean }

const clamp = (n: number, a: number, b: number): number => Math.min(b, Math.max(a, n))

/**
 * Untertitel in der Vorschau – dasselbe CSS und dieselben Zeit-Variablen wie in tscaps (eingefrorene Animationen, auf die
 * Abspielposition `t` gespult). Container muss `container-type: size` haben (9:16-Fläche).
 */
export function CaptionLayer({ preset, groups, t, highlight = true, fontCss = '', scope = 'sm-cap' }: { preset: StylePreset; groups: PWord[][]; t: number; highlight?: boolean; fontCss?: string; scope?: string }): React.JSX.Element | null {
  const s = preset.caption
  const css = useMemo(() => `${fontCss}\n${scopeCss(`${FROZEN_CSS}\n${captionCss(s, { highlight, css: preset.css })}`, `.${scope}`)}`, [s, highlight, preset.css, fontCss, scope])
  const cues = useMemo(() => cueTimes(groups), [groups])
  let gi = -1
  for (let i = 0; i < groups.length; i++) if (cues[i].start <= t + 1e-6) gi = i
  const g = gi >= 0 ? groups[gi] : null
  const cue = gi >= 0 ? cues[gi] : null
  const alive = !!g && !!cue && t <= cue.end + (s.anim.disappear === 'fade' ? s.anim.disappearMs / 1000 : 0)
  return (
    <>
      <style>{css}</style>
      {alive && g && cue && (
        <div className={scope} style={{ position: 'absolute', left: 0, right: 0, top: `${s.y * 100}%`, transform: 'translateY(-50%)', padding: '0 4%' }}>
          <div className="segment" style={segmentVars(cue, t) as React.CSSProperties}>
            <div className="line">
              {g.map((w) => {
                const active = t >= w.start && t < w.end
                return <span key={w.g} className={`word${active ? ' word-being-narrated' : ''}${w.hi ? ' emphasis' : isFiller(w.w) ? ' filler' : ''}`} style={wordVars(w, t) as React.CSSProperties}>{w.w}</span>
              })}
            </div>
          </div>
        </div>
      )}
    </>
  )
}

/** Titel-Layout messen (mit der geladenen Schrift) – dieselbe Funktion wie im Export-Fenster. */
export function useTitleLayout(text: string, preset: StylePreset): TitleLayout | null {
  const [layout, setLayout] = useState<TitleLayout | null>(null)
  const t = preset.title
  useEffect(() => {
    let alive = true
    const font = `${t.font.weight} ${t.sizePx}px "${t.font.family}"`
    void document.fonts.load(font).catch(() => undefined).then(() => {
      if (!alive) return
      const ctx = document.createElement('canvas').getContext('2d')!
      ctx.font = font
      setLayout(text.trim() ? layoutTitle(text, t, (s) => ctx.measureText(s).width) : null)
    })
    return () => { alive = false }
  }, [text, t.font.family, t.font.weight, t.sizePx, t.maxChars, t])
  return layout
}

/** Titel (TikTok-Stil) in der Vorschau; per Ziehen vertikal verschiebbar (`onMove` live, `onCommit` beim Loslassen). */
export function TitleLayer({ preset, text, t, seconds, onMove, onCommit, scope = 'sm-title-scope' }: { preset: StylePreset; text: string; t: number; seconds: number; onMove?: (y: number) => void; onCommit?: (y: number) => void; scope?: string }): React.JSX.Element | null {
  const layout = useTitleLayout(text, preset)
  const wrap = useRef<HTMLDivElement>(null)
  const drag = useRef<{ active: boolean; y: number }>({ active: false, y: preset.title.y })
  if (!layout) return null
  const ts = preset.title
  const css = scopeCss(`${FROZEN_CSS}\n${titleCss(ts)}`, `.${scope}`)
  const svg = titleSvg(layout, ts).replace('width="' + layout.w + '" height="' + layout.h + '"', `style="width:${(layout.w / 10.8).toFixed(3)}cqw;height:auto;display:block;overflow:visible"`)
  const moveTo = (clientY: number): number => {
    const parent = wrap.current?.parentElement
    if (!parent) return ts.y
    const r = parent.getBoundingClientRect()
    return clamp((clientY - r.top) / r.height, 0.04, 0.5)
  }
  return (
    <>
      <style>{css}</style>
      <div ref={wrap} className={scope} title="Ziehen: Titel verschieben"
        onPointerDown={(e) => { if (!onMove) return; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); drag.current = { active: true, y: ts.y } }}
        onPointerMove={(e) => { if (!drag.current.active) return; drag.current.y = moveTo(e.clientY); onMove?.(drag.current.y) }}
        onPointerUp={() => { if (drag.current.active) { drag.current.active = false; onCommit?.(drag.current.y) } }}
        style={{ position: 'absolute', left: 0, right: 0, top: `${ts.y * 100}%`, transform: 'translateY(-50%)', display: 'flex', justifyContent: 'center', cursor: onMove ? 'grab' : 'default', touchAction: 'none', ['--on-title-starts' as string]: `${(0 - t).toFixed(3)}s`, ['--on-title-ends' as string]: `${(seconds - t).toFixed(3)}s` } as React.CSSProperties}
        dangerouslySetInnerHTML={{ __html: svg }} />
    </>
  )
}
