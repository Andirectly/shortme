// Transkript im Stil von Apple-Music-Lyrics (Vorbild: amll-dev/applemusic-like-lyrics, eigene Umsetzung ohne dessen Pixi-Abhängigkeiten):
// große Zeilen, aktive Zeile hell und scharf, andere je nach Abstand gedimmt und weichgezeichnet, Wort-für-Wort-Füllung per Verlauf,
// weiches Mitscrollen (pausiert, solange man selbst scrollt). Bearbeiten bleibt: Klick = springen/auswählen, Doppelklick = Text ändern, Alt+Klick = schneiden.
import { useEffect, useMemo, useRef } from 'react'

import { lyricLines, type LyricWord } from '@shared/lyricLines'

interface Props {
  words: LyricWord[]
  t: number
  playing: boolean
  cut: number[]
  trim: [number, number]
  sel: number | null
  editing: number | null
  draft: string
  onDraft: (s: string) => void
  onFinish: (save: boolean) => void
  onWord: (w: LyricWord, alt: boolean) => void
  onEdit: (w: LyricWord) => void
}

const reduced = (): boolean => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

export function LyricsTranscript({ words, t, playing, cut, trim, sel, editing, draft, onDraft, onFinish, onWord, onEdit }: Props): React.JSX.Element {
  const lines = useMemo(() => lyricLines(words), [words])
  const box = useRef<HTMLDivElement>(null)
  const lineEls = useRef<Array<HTMLDivElement | null>>([])
  const userUntil = useRef(0)
  // aktive Zeile: letzte, die begonnen hat
  let active = 0
  for (let i = 0; i < lines.length; i++) if (lines[i][0].t <= t + 0.05) active = i
  const opened = useRef(false)

  // Mitscrollen: aktive Zeile bei ~30 % der Höhe; beim Öffnen sofort, danach weich – nicht, solange man selbst scrollt oder ein Wort bearbeitet
  useEffect(() => {
    const el = box.current, line = lineEls.current[active]
    if (!el || !line || editing !== null || performance.now() < userUntil.current) return
    const top = line.offsetTop - el.clientHeight * 0.3
    if (Math.abs(el.scrollTop - top) < 2) return
    el.scrollTo({ top, behavior: opened.current && !reduced() ? 'smooth' : 'auto' })
    opened.current = true
  }, [active, editing, lines.length])
  useEffect(() => { opened.current = false }, [words.length])

  const pauseFollow = (): void => { userUntil.current = performance.now() + (playing ? 2500 : 600) }

  return (
    <div style={{ position: 'relative', minHeight: 0, height: '100%', overflow: 'hidden' }}>
      <div ref={box} onWheel={pauseFollow} onPointerDown={pauseFollow} onTouchMove={pauseFollow}
        style={{ height: '100%', overflowY: 'auto', padding: '30% 18px 60%', scrollbarWidth: 'none', maskImage: 'linear-gradient(180deg, transparent 0, #000 12%, #000 80%, transparent 100%)' }}>
        {lines.map((line, li) => {
          const d = Math.abs(li - active)
          const outside = line[line.length - 1].e < trim[0] - 0.01 || line[0].t > trim[1] + 0.05
          const isActive = li === active && !outside
          const blur = reduced() || isActive ? 0 : Math.min(3, d * 0.9)
          return (
            <div key={line[0].g} ref={(n) => { lineEls.current[li] = n }} className="sm-lyric-line"
              style={{ padding: '7px 10px', margin: '0 -10px', borderRadius: 12, fontSize: 'clamp(18px, 1.55vw, 26px)', fontWeight: 700, lineHeight: 1.22, letterSpacing: '-0.012em', textAlign: 'left',
                opacity: outside ? 0.16 : isActive ? 1 : Math.max(0.28, 0.55 - d * 0.06), filter: blur ? `blur(${blur}px)` : 'none',
                transform: `scale(${isActive ? 1 : 0.965})`, transformOrigin: 'left center',
                transition: 'opacity 420ms cubic-bezier(.2,.8,.2,1), filter 420ms cubic-bezier(.2,.8,.2,1), transform 520ms cubic-bezier(.2,.8,.2,1)' }}>
              {line.map((w) => {
                const isCut = cut.includes(w.g)
                if (editing === w.g) {
                  return <input key={w.g} autoFocus value={draft} size={Math.max(3, draft.length + 1)} onChange={(ev) => onDraft(ev.target.value)} onBlur={() => onFinish(true)}
                    onKeyDown={(ev) => { if (ev.key === 'Enter') onFinish(true); else if (ev.key === 'Escape') onFinish(false) }}
                    style={{ font: 'inherit', letterSpacing: 'inherit', background: 'rgba(255,255,255,0.14)', border: '1px solid rgba(255,255,255,0.5)', borderRadius: 8, color: '#fff', padding: '0 4px', outline: 'none', marginRight: '0.28em' }} />
                }
                // Füllung des Wortes: 0 % vor dem Wort, 100 % danach, dazwischen linear (nur in der aktiven Zeile)
                const fillOn = isActive && !isCut
                const p = isActive ? Math.min(1, Math.max(0, (t - w.t) / Math.max(0.05, w.e - w.t))) : li < active ? 1 : 0
                const fill = fillOn ? `linear-gradient(90deg, #fff ${p * 100 - 8}%, rgba(255,255,255,0.38) ${p * 100 + 8}%)` : undefined
                return (
                  <span key={w.g} onClick={(ev) => { ev.stopPropagation(); onWord(w, ev.altKey) }} onDoubleClick={(ev) => { ev.stopPropagation(); onEdit(w) }}
                    title="Klick: springen/auswählen · Doppelklick: Text ändern · Alt+Klick oder Entf: herausschneiden"
                    style={{ display: 'inline-block', marginRight: '0.28em', cursor: 'pointer', borderRadius: 6, padding: '0 1px',
                      color: fillOn ? 'transparent' : '#fff', backgroundImage: fill, backgroundClip: fillOn ? 'text' : undefined, WebkitBackgroundClip: fillOn ? 'text' : undefined,
                      transform: isActive && p > 0 && p < 1 ? 'translateY(-1.5px)' : 'none', transition: 'transform 260ms cubic-bezier(.2,.8,.2,1)',
                      textShadow: isActive && w.hi && p > 0 ? '0 0 18px rgba(255,255,255,0.45)' : undefined,
                      textDecoration: isCut ? 'line-through' : w.edited ? 'underline dotted rgba(255,255,255,0.6)' : 'none', textDecorationThickness: isCut ? 2 : undefined,
                      opacity: isCut ? 0.35 : 1, outline: sel === w.g ? '2px solid rgba(255,255,255,0.7)' : 'none', outlineOffset: 2 }}>{w.w}</span>
                )
              })}
            </div>
          )
        })}
        {!lines.length && <div style={{ color: 'var(--text-2)', fontSize: 14 }}>Kein Transkript</div>}
      </div>
    </div>
  )
}
