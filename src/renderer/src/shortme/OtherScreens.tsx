import { useState } from 'react'
import { motion } from 'motion/react'
import { Download, CheckCircle2, XCircle, FolderInput, Upload, Cpu, Pause } from 'lucide-react'
import { useStore } from './store'
import { CLIPS, MODELS, PRESETS, SYSTEM_CHECK } from './data'
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
          <Pill><Upload size={13} /> Import</Pill><Pill><Download size={13} /> Export</Pill>
        </div>
      </div>
      <div className="sm-glass" style={{ display: 'grid', placeItems: 'center', padding: 16 }}>
        <div style={{ height: '100%', maxHeight: 640, aspectRatio: '9/16', borderRadius: 16, backgroundImage: `url(${CLIPS[1].thumb})`, backgroundSize: 'cover', position: 'relative', overflow: 'hidden', border: '1px solid var(--edge-highlight)' }}>
          <motion.div key={preset.id} initial={{ opacity: 0, scale: 0.9, y: 8 }} animate={{ opacity: 1, scale: 1, y: 0 }} transition={base} style={{ position: 'absolute', left: 0, right: 0, top: '66%', textAlign: 'center', fontFamily: preset.font, fontWeight: preset.weight, fontSize: size / 3, textTransform: upper ? 'uppercase' : 'none', WebkitTextStroke: `${stroke / 60}px #000`, textShadow: '0 2px 8px rgba(0,0,0,0.6)', color: preset.color }}>
            {Array.from({ length: words }, (_, i) => <span key={i} style={{ marginRight: 6, color: i === 1 ? preset.hi : preset.color, background: preset.box ? 'rgba(0,0,0,0.6)' : 'none' }}>{['Das', 'sieht', 'crazy', 'aus', 'finde', 'ich'][i]}</span>)}
          </motion.div>
          <div style={{ position: 'absolute', top: 14, right: 14, width: 34, height: 34, borderRadius: 10, background: 'linear-gradient(135deg,#a855f7,#6366f1)', opacity: logoOp / 100 }} />
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

export function ModelsScreen(): React.JSX.Element {
  const { base } = useSprings()
  return (
    <div style={{ maxWidth: 900, margin: '0 auto', display: 'grid', gap: 18, paddingTop: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'end' }}>
        <div><h1>Modelle</h1><small>Werden in der App geladen, nie ins Repo.</small></div>
        <Button variant="secondary"><FolderInput size={15} /> Ordner importieren (USB)</Button>
      </div>
      <div className="sm-card" style={{ padding: 14, display: 'flex', gap: 12, alignItems: 'center' }}>
        <Cpu size={20} color="var(--accent)" />
        <div><h3>Empfehlung für diese Hardware</h3><small>RTX 5090 · 32 GB VRAM erkannt → Parakeet v3 + Qwen3-14B (Q4_K_M)</small></div>
      </div>
      <div style={{ display: 'grid', gap: 10 }}>
        {MODELS.map((m) => (
          <div key={m.id} className="sm-card" style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 14, alignItems: 'center', padding: 14 }}>
            <div style={{ display: 'grid', gap: 4 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}><h3>{m.name}</h3><span className="sm-tag">{m.kind}</span>{m.recommended && <span className="sm-tag" style={{ color: 'var(--accent)' }}>Empfohlen</span>}</div>
              <small>{m.size} · {m.note}</small>
              {m.state === 'downloading' && <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}><div className="sm-bar" style={{ flex: 1 }}><motion.i initial={{ width: '5%' }} animate={{ width: '62%' }} transition={{ duration: 3, ease: 'easeOut' }} /></div><small>62 % · SHA-256 wird geprüft …</small></div>}
            </div>
            {m.state === 'installed' && <span style={{ color: 'var(--ok)', display: 'flex', gap: 6, alignItems: 'center', fontSize: 13 }}><CheckCircle2 size={16} /> Installiert</span>}
            {m.state === 'missing' && <Button variant="secondary"><Download size={15} /> Laden</Button>}
            {m.state === 'downloading' && <Button variant="secondary"><Pause size={15} /> Pausieren</Button>}
          </div>
        ))}
      </div>
      <motion.small transition={base}>Downloads lassen sich fortsetzen; jede Datei wird per SHA-256 geprüft.</motion.small>
    </div>
  )
}

export function SettingsScreen(): React.JSX.Element {
  const [profile, setProfile] = useState('TikTok')
  const [quality, setQuality] = useState('Hoch')
  const [encoder, setEncoder] = useState('Auto')
  const [subs, setSubs] = useState('Eingebrannt')
  const [names, setNames] = useState(true)
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
        <div style={{ display: 'flex', justifyContent: 'space-between' }}><h3>Systemcheck</h3><Pill>Logs öffnen</Pill></div>
        {SYSTEM_CHECK.map((c) => (
          <div key={c.name} style={{ display: 'grid', gridTemplateColumns: '24px 190px 1fr', alignItems: 'center', gap: 8, fontSize: 14 }}>
            {c.ok ? <CheckCircle2 size={17} color="var(--ok)" /> : <XCircle size={17} color="var(--warn)" />}<span>{c.name}</span><small>{c.detail}</small>
          </div>
        ))}
      </div>
    </div>
  )
}
