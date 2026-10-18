import { useEffect, useMemo, useState } from 'react'
import { groupWords } from '@shared/captions'
import type { PresetPatch } from '@shared/preset'
import { deepMerge } from '@shared/preset'
import { useStore } from './store'
import { CLIPS } from './data'
import { useClipList } from './clipData'
import { useProject } from './projectStore'
import { CaptionLayer, TitleLayer } from './CaptionLayers'
import { PresetBar, PresetTile } from './PresetUI'
import { effective, isBuiltin, usePresets } from './presets'
import { AnimControls, CaptionControls, TitleControls } from './StyleControls'
import { Button, Row, Segmented, Switch } from './ui'

const SAMPLE = [['Das', 0, 0.4], ['sieht', 0.4, 0.85], ['richtig', 0.85, 1.4], ['crazy', 1.4, 2.0], ['aus', 2.3, 2.7], ['finde', 2.7, 3.1], ['ich', 3.1, 3.4]] as const
const TITLE = 'So wurde ich fast gefeuert'

/** Stil-Studio: dieselben Funktionen wie Editor und Export (Preset-JSON → CSS/ASS) → Vorschau = Export. „Als Standard festlegen“ gilt für Clips ohne eigene Änderung. */
export function StudioScreen(): React.JSX.Element {
  const presetId = useStore((s) => s.presetId)
  const setPreset = useStore((s) => s.setPreset)
  const hasApi = useProject((s) => s.hasApi)
  const defaults = useProject((s) => s.style)
  const clipsFile = useProject((s) => s.clipsFile)
  const all = usePresets((s) => s.all)
  const loadPresets = usePresets((s) => s.load)
  const remove = usePresets((s) => s.remove)
  const list = useClipList()
  const [tab, setTab] = useState('Untertitel')
  const [patch, setPatch] = useState<PresetPatch>({})
  const [live, setLive] = useState<PresetPatch | null>(null)
  const [titleOn, setTitleOn] = useState(false)
  const [fonts, setFonts] = useState<string[]>([])
  const [fontCss, setFontCss] = useState('')
  const [t, setT] = useState(0)
  useEffect(() => { void loadPresets() }, [loadPresets])
  // Standard laden (einmal, wenn vorhanden)
  useEffect(() => { if (defaults.presetId) { setPreset(defaults.presetId); setPatch(defaults.style ?? {}); setTitleOn(!!defaults.titleEnabled) } }, [defaults, setPreset])
  useEffect(() => { if (hasApi) void window.cutawan.listFonts().then((l) => setFonts(l.map((f) => f.family))).catch(() => undefined) }, [hasApi])
  useEffect(() => { const id = setInterval(() => setT((n) => (n + 0.05) % 5.2), 50); return () => clearInterval(id) }, [])
  const preset = useMemo(() => effective(all, presetId, patch, live), [all, presetId, patch, live])
  useEffect(() => { const f = preset.caption.font.family; if (!hasApi || !fonts.includes(f)) { setFontCss(''); return } void window.cutawan.shortme.fontCss(f).then(setFontCss).catch(() => setFontCss('')) }, [hasApi, preset.caption.font.family, fonts])
  const groups = useMemo(() => groupWords(SAMPLE.map(([w, a, b], i) => ({ w, start: a, end: b, g: i, hi: i === 3, tag: i === 3 ? ('emphasis' as const) : undefined })), preset.caption), [preset.caption])
  const bg = list[0]?.thumb ?? CLIPS[1].thumb
  const commit = (p: PresetPatch): void => { setLive(null); setPatch((cur) => deepMerge(cur, p)) }
  const pick = (id: string): void => { setPreset(id); setPatch({}); setLive(null); const p = all.find((x) => x.id === id); if (p && !isBuiltin(id)) setTitleOn(p.title.enabled) }
  const importFonts = async (): Promise<void> => { const l = await window.cutawan.addFonts(); setFonts(l.map((f) => f.family)) }
  const applyAll = async (): Promise<void> => {
    if (!hasApi || !clipsFile) return
    await window.cutawan.shortme.applyAll(clipsFile.hash, clipsFile.clips.map((c) => c.id), { presetId, style: patch, resetStyle: true })
  }
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '300px minmax(0, 1fr) 340px', gap: 16, height: 'calc(100vh - 60px)', paddingTop: 4 }}>
      <div className="sm-glass" style={{ padding: 14, overflowY: 'auto', display: 'grid', gap: 10, alignContent: 'start' }}>
        <h3>Vorlagen</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
          {all.map((p) => <PresetTile key={p.id} preset={p.id === presetId ? preset : p} selected={p.id === presetId} onClick={() => pick(p.id)} />)}
        </div>
        {!isBuiltin(presetId) && <Button variant="ghost" onClick={() => void remove(presetId).then(() => pick('glow-karaoke'))}>Dieses Preset löschen</Button>}
      </div>
      <div className="sm-glass" style={{ display: 'grid', placeItems: 'center', padding: 16 }}>
        <div style={{ height: '100%', maxHeight: 700, aspectRatio: '9/16', borderRadius: 16, backgroundImage: `url(${bg})`, backgroundSize: 'cover', backgroundPosition: 'center', position: 'relative', overflow: 'hidden', boxShadow: '0 0 0 1px var(--edge-highlight)', containerType: 'size' }}>
          <CaptionLayer preset={preset} groups={groups} t={t} fontCss={fontCss} scope="sm-cap-studio" />
          {titleOn && <TitleLayer preset={preset} text={TITLE} t={t % 4.2} seconds={3} onMove={(y) => setLive({ title: { y } })} onCommit={(y) => commit({ title: { y } })} scope="sm-title-studio" />}
        </div>
      </div>
      <div className="sm-glass" style={{ padding: 16, overflowY: 'auto', display: 'grid', alignContent: 'start', gap: 12 }}>
        <Segmented options={['Untertitel', 'Animation', 'Titel']} value={tab} onChange={setTab} />
        <PresetBar preset={preset} presetId={presetId} patch={patch} titleEnabled={titleOn} hasApi={hasApi} canApplyAll={!!clipsFile} onApplyAll={() => void applyAll()} />
        {tab === 'Untertitel' && <CaptionControls value={preset} onLive={setLive} onCommit={commit} fonts={fonts} onImportFonts={() => void importFonts()} hasApi={hasApi} />}
        {tab === 'Animation' && (
          <div>
            <h3>Untertitel</h3>
            <AnimControls kind="caption" anim={preset.caption.anim} onLive={setLive} onCommit={commit} />
            <h3 style={{ marginTop: 18 }}>Titel</h3>
            <AnimControls kind="title" anim={preset.title.anim} onLive={setLive} onCommit={commit} />
          </div>
        )}
        {tab === 'Titel' && (
          <div>
            <Row label="Titel standardmäßig einblenden" hint="auch im Erstellen-Dialog und pro Clip im Editor"><Switch on={titleOn} onChange={setTitleOn} label="Titel einblenden" /></Row>
            <TitleControls value={preset} onLive={setLive} onCommit={commit} />
          </div>
        )}
        <small>„Als Standard festlegen“ gilt für alle Clips, bei denen du im Editor nichts anderes eingestellt hast – in Vorschau und Export.</small>
      </div>
    </div>
  )
}
