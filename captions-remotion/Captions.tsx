// Remotion-Komposition „Captions“: liest dasselbe Preset-JSON (shared/preset.ts) und dasselbe Untertitel-Datenmodell
// (Wörter + Zeiten + Tags) wie tscaps und der ASS-Fallback. Die Darstellung nutzt dieselben Funktionen wie die Editor-Vorschau
// (shared/captions.ts, shared/title.ts): eingefrorene CSS-Animationen, gespult auf die aktuelle Bildzeit – dadurch ist jedes Bild
// deterministisch (Voraussetzung für Remotion) und sieht aus wie in der Vorschau. Hintergrund transparent (Overlay).
import { useEffect, useMemo, useState } from 'react'
import { AbsoluteFill, cancelRender, continueRender, delayRender, getRemotionEnvironment, staticFile, useCurrentFrame } from 'remotion'
import { groupWords, type CaptionWord } from '../src/shared/captions'
import type { StylePreset } from '../src/shared/preset'
import { CaptionLayer, TitleLayer, type PWord } from '../src/renderer/src/shortme/CaptionLayers'

export const FPS = 30

export interface CaptionsProps {
  preset: StylePreset
  /** Wörter auf der gekürzten Zeitleiste (Sekunden ab Clipbeginn) */
  words: Array<CaptionWord & { g?: number }>
  /** KI-Hervorhebung (betonte Wörter) an/aus */
  highlight: boolean
  /** Titeltext; leer = kein Titel */
  titleText: string
  titleSeconds: number
  durationInFrames: number
}

const FONT_FILES: Array<[string, string, number]> = [['TikTok Sans', 'TikTokSans-Bold.ttf', 700], ['Montserrat', 'Montserrat-ExtraBold.ttf', 800], ['Inter', 'Inter-Bold.ttf', 700], ['Poppins', 'Poppins-Bold.ttf', 700], ['Anton', 'Anton-Regular.ttf', 400]]

/** In der Rendering-Umgebung kommen die Schriften aus dem `public`-Ordner des Bundles (im Player gelten die Schriften der App). */
function useBundleFonts(preset: StylePreset): string {
  const rendering = getRemotionEnvironment().isRendering
  const css = useMemo(() => (rendering ? FONT_FILES.map(([family, file, weight]) => `@font-face { font-family: '${family}'; src: url('${staticFile(`fonts/${file}`)}') format('truetype'); font-weight: ${weight}; }`).join('\n') : ''), [rendering])
  const [handle] = useState(() => (rendering ? delayRender('Schriften laden') : 0))
  useEffect(() => {
    if (!rendering) return
    const wanted = [`${preset.caption.font.weight} 40px "${preset.caption.font.family}"`, `${preset.title.font.weight} 40px "${preset.title.font.family}"`]
    void Promise.all(wanted.map((f) => document.fonts.load(f))).then(() => continueRender(handle)).catch((e) => cancelRender(e))
  }, [rendering, handle, preset.caption.font.family, preset.caption.font.weight, preset.title.font.family, preset.title.font.weight])
  return css
}

export const Captions = ({ preset, words, highlight, titleText, titleSeconds }: CaptionsProps): React.JSX.Element => {
  const frame = useCurrentFrame()
  const t = frame / FPS
  const fontCss = useBundleFonts(preset)
  const groups = useMemo<PWord[][]>(() => groupWords(words.map((w, i) => ({ ...w, g: w.g ?? i, hi: !!w.tag })), preset.caption), [words, preset.caption])
  const rendering = getRemotionEnvironment().isRendering
  const [titleHandle] = useState(() => (rendering && titleText.trim() ? delayRender('Titel-Layout') : 0))
  return (
    <AbsoluteFill style={{ background: 'transparent', containerType: 'size' }}>
      <CaptionLayer preset={preset} groups={groups} t={t} highlight={highlight} fontCss={fontCss} scope="rm-cap" />
      {titleText.trim() && <TitleLayer preset={preset} text={titleText} t={t} seconds={titleSeconds} scope="rm-title" onReady={() => { if (titleHandle) continueRender(titleHandle) }} />}
    </AbsoluteFill>
  )
}
