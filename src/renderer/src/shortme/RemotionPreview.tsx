import { useEffect, useMemo, useRef } from 'react'
import { Player, type PlayerRef } from '@remotion/player'
import type { CaptionWord } from '@shared/captions'
import type { StylePreset } from '@shared/preset'
import { Captions, FPS, type CaptionsProps } from '../../../../captions-remotion/Captions'

/**
 * Vorschau mit dem Remotion-Player (nur wenn Remotion der aktive Untertitel-Renderer ist): dieselbe Komposition wie im Export,
 * auf die Abspielposition `t` gespult. Container braucht `container-type: size` (9:16-Fläche) und `position: relative`.
 */
export function RemotionPreview({ preset, words, t, highlight, titleText, titleSeconds, duration }: { preset: StylePreset; words: CaptionWord[]; t: number; highlight: boolean; titleText: string; titleSeconds: number; duration: number }): React.JSX.Element {
  const ref = useRef<PlayerRef>(null)
  const frames = Math.max(1, Math.ceil(duration * FPS))
  const inputProps = useMemo<CaptionsProps>(() => ({ preset, words, highlight, titleText, titleSeconds, durationInFrames: frames }), [preset, words, highlight, titleText, titleSeconds, frames])
  useEffect(() => { ref.current?.seekTo(Math.min(frames - 1, Math.max(0, Math.round(t * FPS)))) }, [t, frames])
  return (
    <Player
      ref={ref}
      component={Captions as unknown as React.ComponentType<Record<string, unknown>>}
      inputProps={inputProps as unknown as Record<string, unknown>}
      durationInFrames={frames}
      compositionWidth={1080}
      compositionHeight={1920}
      fps={FPS}
      controls={false}
      clickToPlay={false}
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', background: 'transparent', pointerEvents: 'none' }}
    />
  )
}
