import { Composition } from 'remotion'
import { BUILTIN_PRESETS } from '../src/shared/preset'
import { Captions, FPS, type CaptionsProps } from './Captions'

const defaults: CaptionsProps = { preset: BUILTIN_PRESETS[5], words: [], highlight: true, titleText: '', titleSeconds: 3, durationInFrames: 30 }

export const Root = (): React.JSX.Element => (
  <Composition
    id="Captions"
    component={Captions as unknown as React.ComponentType<Record<string, unknown>>}
    width={1080}
    height={1920}
    fps={FPS}
    durationInFrames={defaults.durationInFrames}
    defaultProps={defaults as unknown as Record<string, unknown>}
    calculateMetadata={({ props }) => ({ durationInFrames: Math.max(1, (props as unknown as CaptionsProps).durationInFrames) })}
  />
)
