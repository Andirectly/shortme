import { motion } from 'motion/react'
import type { ReactNode, ButtonHTMLAttributes } from 'react'
import { press, useSprings } from './motion'

type Variant = 'primary' | 'secondary' | 'ghost' | 'ai'

export function Button({ variant = 'secondary', children, className = '', ...rest }: { variant?: Variant; children: ReactNode } & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onDrag' | 'onDragStart' | 'onDragEnd' | 'onAnimationStart'>): React.JSX.Element {
  const { base, reduced } = useSprings()
  return (
    <motion.button whileTap={reduced ? undefined : press} transition={base} className={`sm-btn sm-btn-${variant} ${className}`} {...rest}>
      {children}
    </motion.button>
  )
}

export function Pill({ pressed, onClick, children, role }: { pressed?: boolean; onClick?: () => void; children: ReactNode; role?: string }): React.JSX.Element {
  const { base, reduced } = useSprings()
  return (
    <motion.button role={role} aria-pressed={role ? undefined : pressed} aria-checked={role ? pressed : undefined} whileTap={reduced ? undefined : press} transition={base} className="sm-pill" onClick={onClick}>
      {children}
    </motion.button>
  )
}

export function Segmented({ options, value, onChange }: { options: string[]; value: string; onChange: (v: string) => void }): React.JSX.Element {
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }} role="radiogroup">
      {options.map((o) => <Pill key={o} role="radio" pressed={value === o} onClick={() => onChange(o)}>{o}</Pill>)}
    </div>
  )
}

export function Switch({ on, onChange, label }: { on: boolean; onChange: (b: boolean) => void; label: string }): React.JSX.Element {
  const { base } = useSprings()
  return (
    <button className="sm-switch" role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)}>
      <motion.i layout transition={base} />
    </button>
  )
}

export const Score = ({ v }: { v: number }): React.JSX.Element => <span className="sm-score">{v}</span>

export function Row({ label, children, hint }: { label: string; children: ReactNode; hint?: string }): React.JSX.Element {
  return (
    <div style={{ display: 'grid', gap: 8, padding: '14px 0', borderTop: '1px solid var(--edge)' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}><h3>{label}</h3>{hint && <small>{hint}</small>}</div>
      {children}
    </div>
  )
}

export function Slider({ label, value, min = 0, max = 100, onChange, onCommit }: { label: string; value: number; min?: number; max?: number; onChange: (n: number) => void; /** Beim Loslassen/Tastatur: genau ein Wert → ein Undo-Schritt. */ onCommit?: (n: number) => void }): React.JSX.Element {
  return (
    <label style={{ display: 'grid', gridTemplateColumns: '110px 1fr 34px', alignItems: 'center', gap: 12, fontSize: 13, color: 'var(--text-2)' }}>
      {label}
      <input className="sm-range" type="range" min={min} max={max} value={value} onChange={(e) => onChange(Number(e.target.value))}
        onPointerUp={(e) => onCommit?.(Number(e.currentTarget.value))} onKeyUp={(e) => onCommit?.(Number(e.currentTarget.value))} />
      <span style={{ textAlign: 'right' }}>{value}</span>
    </label>
  )
}
