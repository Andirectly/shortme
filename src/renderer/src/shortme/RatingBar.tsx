import { useEffect, useRef, useState } from 'react'
import { Minus, ThumbsDown, ThumbsUp } from 'lucide-react'
import { LEVELS, LEVEL_LABEL, REASONS, type Level } from '@shared/learn'
import { useProject } from './projectStore'

const ICON: Record<Level, React.JSX.Element> = { strong: <ThumbsUp size={14} />, mid: <Minus size={14} />, bad: <ThumbsDown size={14} /> }
const KEY: Record<string, Level> = { '1': 'strong', '2': 'mid', '3': 'bad' }

/** Clip unter dem Mauszeiger in der Liste (für die Tasten 1/2/3). */
let hovered: string | null = null
export const setHoveredClip = (id: string | null): void => { hovered = id }

/** Tasten 1/2/3 bewerten den Clip aus `getId()`; nochmal dieselbe Taste nimmt die Bewertung zurück. */
export function useRatingKeys(getId: () => string | null): void {
  const setFeedback = useProject((s) => s.setFeedback)
  const ref = useRef(getId)
  ref.current = getId
  useEffect(() => {
    const k = (e: KeyboardEvent): void => {
      const tag = (e.target as HTMLElement).tagName
      const level = KEY[e.key]
      if (!level || e.ctrlKey || e.metaKey || e.altKey || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      const id = ref.current()
      if (!id) return
      e.preventDefault()
      const cur = useProject.getState().feedback[id]
      void setFeedback(id, cur?.level === level ? null : { level, reasons: [] })
    }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [setFeedback])
}
export const useListRatingKeys = (): void => useRatingKeys(() => hovered)

/** Stark / Mittel / Schlecht (jederzeit änderbar, nie Pflicht) mit optionalen Gründen als Chips. */
export function RatingBar({ clipId, chips = 'below' }: { clipId: string; chips?: 'below' | 'popover' | 'dropdown' }): React.JSX.Element {
  const rating = useProject((s) => s.feedback[clipId])
  const setFeedback = useProject((s) => s.setFeedback)
  const [open, setOpen] = useState(false)
  const set = (level: Level): void => {
    if (rating?.level === level) { setOpen(false); void setFeedback(clipId, null); return }
    setOpen(true)
    // Gründe der alten Stufe bleiben nur, wenn sie auch zur neuen passen
    void setFeedback(clipId, { level, reasons: (rating?.reasons ?? []).filter((r) => REASONS[level].includes(r)) })
  }
  const toggle = (reason: string): void => {
    if (!rating) return
    const has = rating.reasons.includes(reason)
    void setFeedback(clipId, { level: rating.level, reasons: has ? rating.reasons.filter((r) => r !== reason) : [...rating.reasons, reason] })
  }
  const showChips = !!rating && (chips === 'below' || open)
  return (
    <div style={{ position: 'relative', display: 'grid', gap: 6 }} onMouseLeave={() => setOpen(false)}>
      <div role="group" aria-label="Bewertung" style={{ display: 'flex', gap: 4 }}>
        {LEVELS.map((l, i) => (
          <button key={l} aria-label={LEVEL_LABEL[l]} aria-pressed={rating?.level === l} title={`${LEVEL_LABEL[l]} (${i + 1})`} onClick={(e) => { e.stopPropagation(); set(l) }}
            style={{ width: 28, height: 28, borderRadius: 14, border: '1px solid var(--edge)', background: rating?.level === l ? '#fff' : 'rgba(0,0,0,0.35)', color: rating?.level === l ? '#000' : '#fff', display: 'grid', placeItems: 'center', cursor: 'pointer' }}>{ICON[l]}</button>
        ))}
      </div>
      {showChips && rating && (
        <div className={chips !== 'below' ? 'sm-glass' : undefined} style={{ display: 'flex', flexWrap: 'wrap', gap: 4, ...(chips !== 'below' ? { position: 'absolute', right: 0, ...(chips === 'popover' ? { bottom: 34 } : { top: 34 }), zIndex: 20, width: 220, padding: 8, justifyContent: 'flex-end' } : {}) }}>
          {REASONS[rating.level].map((r) => (
            <button key={r} aria-pressed={rating.reasons.includes(r)} onClick={(e) => { e.stopPropagation(); toggle(r) }}
              style={{ fontSize: 11, padding: '3px 8px', borderRadius: 10, border: '1px solid var(--edge)', background: rating.reasons.includes(r) ? '#fff' : 'rgba(0,0,0,0.35)', color: rating.reasons.includes(r) ? '#000' : 'var(--text-1)', cursor: 'pointer' }}>{r}</button>
          ))}
        </div>
      )}
    </div>
  )
}
