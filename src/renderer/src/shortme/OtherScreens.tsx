import { useState } from 'react'
import { motion } from 'motion/react'
import { Download, CheckCircle2, XCircle, Upload, RefreshCw } from 'lucide-react'
import { useStore } from './store'
import { CLIPS, PRESETS } from './data'
import { useEngines } from './engines'
import { Button, Pill, Row, Segmented, Slider, Switch } from './ui'
import { useSprings } from './motion'

export function StudioScreen(): React.JSX.Element {
  const presetId = useStore((s) => s.presetId)
  const setPreset = useStore((s) => s.setPreset)
  const [css, setCss] = useState(false)
  const [size, setSize] = useState(60)
  const [stroke, setStroke] = useState(40)
  const [words, setWords] = useState(3)
  const [upper, setUpper] = useState(true)
  const [logoOp, setLogoOp] = useState(80)
  const preset = PRESETS.find((p) => p.id === presetId)!
  const { base } = useSprings()
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '230px minmax(0, 1fr) 320px', gap: 16, height: 'calc(100vh - 60px)', paddingTop: 4 }}>
      <div className="sm-glass" style={{ padding: 14, overflowY: 'auto', display: 'grid', gap: 10, alignContent: 'start' }}>
        <h3>Presets</h3>
        {PRESETS.map((p) => (
          <motion.button key={p.id} className="sm-tile" aria-pressed={p.id === presetId} whileTap={{ scale: 0.97 }} transition={base} onClick={() => setPreset(p.id)}>
            <div style={{ fontFamily: p.font, fontWeight: p.weight, textTransform: p.upper ? 'uppercase' : 'none', fontSize: 20, background: p.box ? 'rgba(0,0,0,0.7)' : 'none', display: 'inline-block', padding: p.box ? '0 6px' : 0, WebkitTextStroke: '0.6px #000' }}>
              Das <span style={{ color: p.hi }}>Wort</span>
            </div>
            <small style={{ display: 'block', marginTop: 4 }}>{p.name}</small>
          </motion.button>
        ))}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Pill onClick={() => void window.cutawan?.shortme?.presetImport().catch(() => undefined)}><Upload size={13} /> Import</Pill><Pill onClick={() => void window.cutawan?.shortme?.presetExport(presetId)}><Download size={13} /> Export</Pill>
        </div>
      </div>
      <div className="sm-glass" style={{ display: 'grid', placeItems: 'center', padding: 16 }}>
        <div style={{ height: '100%', maxHeight: 640, aspectRatio: '9/16', borderRadius: 16, backgroundImage: `url(${CLIPS[1].thumb})`, backgroundSize: 'cover', position: 'relative', overflow: 'hidden', border: '1px solid var(--edge-highlight)' }}>
          <motion.div key={preset.id} initial={{ opacity: 0, scale: 0.9, y: 8 }} animate={{ opacity: 1, scale: 1, y: 0 }} transition={base} style={{ position: 'absolute', left: 0, right: 0, top: '66%', textAlign: 'center', fontFamily: preset.font, fontWeight: preset.weight, fontSize: size / 3, textTransform: upper ? 'uppercase' : 'none', WebkitTextStroke: `${stroke / 60}px #000`, textShadow: '0 2px 8px rgba(0,0,0,0.6)', color: preset.color }}>
            {Array.from({ length: words }, (_, i) => <span key={i} style={{ marginRight: 6, color: i === 1 ? preset.hi : preset.color, background: preset.box ? 'rgba(0,0,0,0.6)' : 'none' }}>{['Das', 'sieht', 'crazy', 'aus', 'finde', 'ich'][i]}</span>)}
          </motion.div>
          <div style={{ position: 'absolute', top: 14, right: 14, width: 34, height: 34, borderRadius: 10, background: 'linear-gradient(135deg,#ffffff,#8a8a8a)', opacity: logoOp / 100 }} />
        </div>
      </div>
      <div className="sm-glass" style={{ padding: 16, overflowY: 'auto' }}>
        <h3 style={{ marginBottom: 6 }}>Stil</h3>
        <Row label="Schrift"><Segmented options={['Anton', 'Poppins', 'Poppins Medium']} value={preset.font} onChange={() => undefined} /></Row>
        <Row label="Maße"><div style={{ display: 'grid', gap: 12 }}><Slider label="Größe" value={size} onChange={setSize} /><Slider label="Umriss" value={stroke} onChange={setStroke} /><Slider label="Wörter/Zeile" value={words} min={1} max={6} onChange={setWords} /></div></Row>
        <Row label="Großbuchstaben"><Switch on={upper} onChange={setUpper} label="Großbuchstaben" /></Row>
        <Row label="Erscheinen"><Segmented options={['Pop', 'Einblenden', 'Gleiten', 'Keine']} value="Pop" onChange={() => undefined} /></Row>
        <Row label="Marken-Kit" hint="Logo, Farben, Schriften"><div style={{ display: 'grid', gap: 10 }}><Slider label="Logo Deckkraft" value={logoOp} onChange={setLogoOp} /><Segmented options={['Oben rechts', 'Oben links', 'Unten rechts']} value="Oben rechts" onChange={() => undefined} /></div></Row>
        <Row label="Erweitert"><Pill pressed={css} onClick={() => setCss(!css)}>CSS-Reiter</Pill>{css && <textarea className="sm-input" rows={6} defaultValue={'.word.word-being-narrated {\n  color: #ffd400;\n}'} style={{ fontFamily: 'Consolas, monospace', fontSize: 12 }} />}</Row>
        <Button variant="primary" style={{ width: '100%', marginTop: 8 }}>Als Standard setzen</Button>
      </div>
    </div>
  )
}

export function SettingsScreen(): React.JSX.Element {
  const [profile, setProfile] = useState('TikTok')
  const [quality, setQuality] = useState('Hoch')
  const [encoder, setEncoder] = useState('Auto')
  const [subs, setSubs] = useState('Eingebrannt')
  const [names, setNames] = useState(true)
  const check = useEngines((s) => s.check)
  const checking = useEngines((s) => s.checking)
  const refreshCheck = useEngines((s) => s.refreshCheck)
  return (
    <div style={{ maxWidth: 820, margin: '0 auto', display: 'grid', gap: 8, paddingTop: 12 }}>
      <h1>Einstellungen</h1>
      <div className="sm-glass" style={{ padding: '4px 22px 16px' }}>
        <Row label="Export-Profil"><Segmented options={['TikTok', 'Reels', 'Shorts', 'Eigenes']} value={profile} onChange={setProfile} /><small>1080×1920 · 30 fps</small></Row>
        <Row label="Qualität"><Segmented options={['Normal', 'Hoch', 'Maximal']} value={quality} onChange={setQuality} /></Row>
        <Row label="Encoder"><Segmented options={['Auto', 'NVENC', 'CPU']} value={encoder} onChange={setEncoder} /></Row>
        <Row label="Untertitel"><Segmented options={['Eingebrannt', 'SRT', 'Beides']} value={subs} onChange={setSubs} /></Row>
        <Row label="Dateinamen nach KI-Titel"><Switch on={names} onChange={setNames} label="Dateinamen nach KI-Titel" /></Row>
        <Row label="Zielordner"><div style={{ display: 'flex', gap: 10 }}><input className="sm-input" defaultValue="C:\Users\Andirectly\Videos\Shortme" aria-label="Zielordner" /><Button variant="secondary">Ändern</Button></div></Row>
      </div>
      <div className="sm-glass" style={{ padding: '14px 22px', display: 'grid', gap: 10 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}><h3>Systemcheck</h3><div style={{ display: 'flex', gap: 8 }}><Pill onClick={() => void refreshCheck()}><RefreshCw size={13} className={checking ? 'sm-spin' : ''} /> Neu prüfen</Pill><Pill onClick={() => void window.cutawan?.shortme?.openLogs()}>Logs öffnen</Pill></div></div>
        {check.map((c) => (
          <div key={c.id} style={{ display: 'grid', gridTemplateColumns: '24px 210px 1fr', alignItems: 'center', gap: 8, fontSize: 14 }}>
            {c.ok ? <CheckCircle2 size={17} color="var(--ok)" /> : <XCircle size={17} color="var(--warn)" />}<span>{c.name}</span><small>{c.detail}</small>
          </div>
        ))}
      </div>
    </div>
  )
}
