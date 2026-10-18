import { useState } from 'react'
import { CheckCircle2, XCircle, RefreshCw } from 'lucide-react'
import { useEngines } from './engines'
import { Button, Pill, Row, Segmented, Switch } from './ui'

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
