import { useEffect, useMemo, useState } from 'react'
import { motion } from 'motion/react'
import { Check, Download, Upload } from 'lucide-react'
import { ANIM_LABEL, PRESETS, captionCss, groupWords, isFiller, resolvePreset, scopeCss, type CaptionAnim } from '@shared/captions'
import { DEFAULT_CAPTION_SCALE } from '@shared/edits'
import { useStore } from './store'
import { CLIPS } from './data'
import { useClipList } from './clipData'
import { useProject } from './projectStore'
import { Button, Pill, Row, Segmented, Slider, Switch } from './ui'
import { useSprings } from './motion'

const SAMPLE = [['Das', 0], ['sieht', 0], ['richtig', 0], ['crazy', 1], ['aus', 0], ['finde', 0], ['ich', 0]] as const

/** Stil-Studio: dieselben Funktionen wie Editor und Export (resolvePreset, captionCss, groupWords) → Vorschau = Export. „Als Standard setzen“ gilt für alle Clips ohne eigene Änderung. */
export function StudioScreen(): React.JSX.Element {
  const presetId = useStore((s) => s.presetId)
  const setPreset = useStore((s) => s.setPreset)
  const hasApi = useProject((s) => s.hasApi)
  const saved = useProject((s) => s.style)
  const saveStyle = useProject((s) => s.saveStyle)
  const list = useClipList()
  const { base } = useSprings()
  const [font, setFont] = useState('')
  const [scale, setScale] = useState(DEFAULT_CAPTION_SCALE)
  const [outline, setOutline] = useState(1)
  const [maxWords, setMaxWords] = useState<number | null>(null)
  const [upper, setUpper] = useState<boolean | null>(null)
  const [anim, setAnim] = useState<CaptionAnim | null>(null)
  const [fonts, setFonts] = useState<string[]>([])
  const [fontCss, setFontCss] = useState('')
  const [tick, setTick] = useState(0)
  const [done, setDone] = useState(false)
  useEffect(() => {
    setFont(saved.font ?? ''); setScale(saved.scale ?? DEFAULT_CAPTION_SCALE); setOutline(saved.outline ?? 1)
    setMaxWords(saved.maxWords ?? null); setUpper(saved.upper ?? null); setAnim(saved.anim ?? null)
    if (saved.presetId) setPreset(saved.presetId)
  }, [saved, setPreset])
  useEffect(() => { if (hasApi) void window.cutawan.listFonts().then((l) => setFonts(l.map((f) => f.family))).catch(() => undefined) }, [hasApi])
  useEffect(() => { if (!hasApi || !font || !fonts.includes(font)) { setFontCss(''); return } void window.cutawan.shortme.fontCss(font).then(setFontCss).catch(() => setFontCss('')) }, [hasApi, font, fonts])
  useEffect(() => { const t = setInterval(() => setTick((n) => n + 1), 650); return () => clearInterval(t) }, [])
  const basePreset = PRESETS.find((p) => p.id === presetId) ?? PRESETS[0]
  const preset = resolvePreset(basePreset, { font, outline, upper: upper ?? undefined, maxWords: maxWords ?? undefined, anim: anim ?? undefined })
  const words = useMemo(() => SAMPLE.map(([w, hi], i) => ({ w, start: i * 0.4, end: i * 0.4 + 0.35, hi: !!hi, g: i, tag: hi ? ('emphasis' as const) : undefined })), [])
  const groups = useMemo(() => groupWords(words, preset, scale), [words, preset, scale])
  const gi = Math.floor(tick / 3) % groups.length
  const group = groups[gi] ?? []
  const cur = group[tick % Math.max(1, group.length)]
  const bg = list[0]?.thumb ?? CLIPS[1].thumb
  const importFonts = async (): Promise<void> => { const l = await window.cutawan.addFonts(); setFonts(l.map((f) => f.family)) }
  const apply = async (): Promise<void> => {
    await saveStyle({ presetId, scale, outline: outline === 1 ? undefined : outline, font: font || undefined, maxWords: maxWords ?? undefined, upper: upper ?? undefined, anim: anim ?? undefined })
    setDone(true); setTimeout(() => setDone(false), 1800)
  }
  const reset = (): void => { setFont(''); setScale(DEFAULT_CAPTION_SCALE); setOutline(1); setMaxWords(null); setUpper(null); setAnim(null) }
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '230px minmax(0, 1fr) 320px', gap: 16, height: 'calc(100vh - 60px)', paddingTop: 4 }}>
      <div className="sm-glass" style={{ padding: 14, overflowY: 'auto', display: 'grid', gap: 10, alignContent: 'start' }}>
        <h3>Vorlagen</h3>
        {PRESETS.map((p) => (
          <motion.button key={p.id} className="sm-tile" aria-pressed={p.id === presetId} whileTap={{ scale: 0.97 }} transition={base} onClick={() => setPreset(p.id)}>
            <div style={{ fontFamily: p.font, fontWeight: p.weight, textTransform: p.upper ? 'uppercase' : 'none', fontSize: 20, background: p.box ? 'rgba(0,0,0,0.7)' : p.anim === 'glass' ? 'rgba(255,255,255,0.18)' : 'none', borderRadius: p.anim === 'glass' ? 10 : 0, display: 'inline-block', padding: p.box || p.anim === 'glass' ? '0 8px' : 0, WebkitTextStroke: p.outlineWidth ? '0.6px #000' : undefined }}>
              Das <span style={{ color: p.highlight }}>Wort</span>
            </div>
            <small style={{ display: 'block', marginTop: 4 }}>{p.name}</small>
          </motion.button>
        ))}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Pill onClick={() => void window.cutawan?.shortme?.presetImport().catch(() => undefined)}><Upload size={13} /> Import</Pill><Pill onClick={() => void window.cutawan?.shortme?.presetExport(presetId)}><Download size={13} /> Export</Pill>
        </div>
      </div>
      <div className="sm-glass" style={{ display: 'grid', placeItems: 'center', padding: 16 }}>
        <div style={{ height: '100%', maxHeight: 640, aspectRatio: '9/16', borderRadius: 16, backgroundImage: `url(${bg})`, backgroundSize: 'cover', backgroundPosition: 'center', position: 'relative', overflow: 'hidden', border: '1px solid var(--edge-highlight)', containerType: 'size' }}>
          <style>{fontCss}</style>
          <style>{scopeCss(captionCss(preset, { scale }), '.sm-cap-studio')}</style>
          <div className="sm-cap-studio" style={{ position: 'absolute', left: 0, right: 0, top: `${preset.y * 100}%`, transform: 'translateY(-50%)', padding: '0 4%' }}>
            <div className="segment" key={`${gi}-${preset.id}-${preset.anim}`}><div className="line">
              {group.map((x) => <span key={x.g} className={`word${x === cur ? ' word-being-narrated' : ''}${x.hi ? ' emphasis' : isFiller(x.w) ? ' filler' : ''}`}>{x.w}</span>)}
            </div></div>
          </div>
        </div>
      </div>
      <div className="sm-glass" style={{ padding: 16, overflowY: 'auto' }}>
        <h3 style={{ marginBottom: 6 }}>Stil</h3>
        <Row label="Schrift" hint="Eigene Schriften (.ttf / .otf)">
          <div style={{ display: 'grid', gap: 8 }}>
            <select aria-label="Schrift" value={font} onChange={(e) => setFont(e.target.value)} style={{ width: '100%', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 8, padding: '6px 10px', color: 'inherit' }}>
              <option value="">Standard der Vorlage ({basePreset.font})</option>
              <option value="Anton">Anton</option><option value="Poppins">Poppins</option>
              {fonts.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
            <Button variant="secondary" disabled={!hasApi} onClick={() => void importFonts()}>Schrift importieren …</Button>
          </div>
        </Row>
        <Row label="Maße"><div style={{ display: 'grid', gap: 12 }}>
          <Slider label="Größe" value={Math.round(scale * 60)} onChange={(v) => setScale(v / 60)} />
          <Slider label="Umriss" value={Math.round(outline * 50)} max={100} onChange={(v) => setOutline(v / 50)} />
          <Slider label="Wörter/Zeile" value={maxWords ?? 6} min={1} max={6} onChange={setMaxWords} />
        </div></Row>
        <Row label="Großbuchstaben" hint={upper === null ? 'wie Vorlage' : ''}><Switch on={upper ?? basePreset.upper} onChange={setUpper} label="Großbuchstaben" /></Row>
        <Row label="Erscheinen"><Segmented options={Object.values(ANIM_LABEL)} value={ANIM_LABEL[anim ?? basePreset.anim ?? 'none']} onChange={(n) => setAnim((Object.keys(ANIM_LABEL) as CaptionAnim[]).find((k) => ANIM_LABEL[k] === n) ?? null)} /></Row>
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <Button variant="secondary" onClick={reset}>Zurücksetzen</Button>
          <Button variant="primary" style={{ flex: 1 }} disabled={!hasApi} onClick={() => void apply()}>{done ? <><Check size={15} /> Gespeichert</> : 'Als Standard setzen'}</Button>
        </div>
        <small style={{ display: 'block', marginTop: 10 }}>Gilt für alle Clips, bei denen du im Editor nichts anderes eingestellt hast – in Vorschau und Export.</small>
      </div>
    </div>
  )
}
