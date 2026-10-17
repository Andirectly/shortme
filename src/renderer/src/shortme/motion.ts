import { useReducedMotion, type Transition } from 'motion/react'

/** Apple-style spring: damping 1.0 = no overshoot, response = seconds to reach target. */
export const spring = (response = 0.35, damping = 1): Transition => ({
  type: 'spring',
  duration: response,
  bounce: Math.max(0, 1 - damping)
})
export const SPRING = spring(0.35, 1)
/** Only after drag/flick gestures and for sheets (docs/DESIGN.md). */
export const SPRING_BOUNCE = spring(0.3, 0.8)
const FADE: Transition = { duration: 0.18, ease: 'easeOut' }

/** Returns springs, or plain cross-fades when prefers-reduced-motion is set. */
export function useSprings(): { base: Transition; bounce: Transition; reduced: boolean } {
  const reduced = !!useReducedMotion()
  return { base: reduced ? FADE : SPRING, bounce: reduced ? FADE : SPRING_BOUNCE, reduced }
}

/** Press feedback on pointer-down (scale 0.97), never only on release. */
export const press = { scale: 0.97 }
