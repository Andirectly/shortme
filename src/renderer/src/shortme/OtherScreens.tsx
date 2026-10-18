import { useEffect, useState } from 'react'
import { useTwitch } from './twitchStore'
import { CheckCircle2, XCircle, RefreshCw } from 'lucide-react'
import { useEngines } from './engines'
import { useStore } from './store'
import { Button, Pill, Row, Segmented, Switch } from './ui'

/** Gespeicherte Facecam-Layouts pro Twitch-Kanal ansehen und löschen. */
function ChannelLayouts(): React.JSX.Element | null {
  const api = typeof window !== 'undefined' ? window.cutawan?.shortme : undefined
  const [list, setList] = useState<Array<{ channel: string; preset: string; gap: number; updatedAt: string }>>([])
  useEffect(() => { void api?.channelLayouts().then(setList).catch(() => undefined) }, [api])
  if (!api) return null
  const PRESET: Record<string, string> = { top: 'Facecam oben', half: '50 : 50', bottom: 'Facecam unten', pip: 'Kleines Fenster' }
  return (
    <Row label="Kanal-Layouts (Facecam + Gameplay)">
      {list.length === 0 ? <small>Noch keine gespeichert.</small> : (
        <div style={{ display: 'grid', gap: 8 }}>
          {list.map((l) => (
            <div key={l.channel} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ flex: 1, fontSize: 14 }}>{l.channel}</span>
              <span className="sm-tag">{PRESET[l.preset] ?? l.preset}</span>
              <Button variant="ghost" aria-label={`Layout von ${l.channel} löschen`} onClick={() => void api.channelLayoutDelete(l.channel).then(setList)}>Löschen</Button>
            </div>
          ))}
        </div>
      )}
    </Row>
  )
}

function TwitchSettings(): React.JSX.Element {
  const status = useTwitch((s) => s.status)
  const refresh = useTwitch((s) => s.refreshStatus)
  const [token, setToken] = useState('')
  const [minutes, setMinutes] = useState(15)
  const [msg, setMsg] = useState('')
  const api = typeof window !== 'undefined' ? window.cutawan?.shortme?.twitch : undefined
  useEffect(() => { void refresh(); void api?.settings().then((s) => setMinutes(s.bufferMinutes)) }, [refresh, api])
  if (!api) return <></>
  const saveToken = async (value: string): Promise<void> => { await api.setToken(value); setToken(''); setMsg(value ? 'Token gespeichert' : 'Token entfernt'); void refresh() }
  return (
    <div className="sm-glass" style={{ padding: '4px 22px 16px' }}>
      <Row label="Twitch-Chat als Ranking-Signal nutzen" toggle={<Switch on={!!status?.chatSignal} onChange={(b) => void api.setSettings({ chatSignal: b }).then(refresh)} label="Twitch-Chat als Ranking-Signal nutzen" />} />
      <ChannelLayouts />
      <Row label="Live-Puffer (Minuten)"><Segmented options={['5', '15', '30', '60']} value={String(minutes)} onChange={(v) => { setMinutes(Number(v)); void api.setSettings({ bufferMinutes: Number(v) }) }} /></Row>
      <Row label="Twitch-Token (optional)">
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <input className="sm-input" type="password" autoComplete="off" aria-label="Twitch-Token" placeholder={status?.hasToken ? 'Token gespeichert' : 'auth-token des eigenen Kontos'} value={token} onChange={(e) => setToken(e.target.value)} />
          <Button variant="secondary" disabled={!token.trim()} onClick={() => void saveToken(token)}>Speichern</Button>
          {status?.hasToken && <Button variant="ghost" onClick={() => void saveToken('')}>Entfernen</Button>}
        </div>
        {msg && <small role="status">{msg}</small>}
      </Row>
    </div>
  )
}

export function SettingsScreen(): React.JSX.Element {
  const [profile, setProfile] = useState('TikTok')
  const [quality, setQuality] = useState('Hoch')
  const [encoder, setEncoder] = useState('Auto')
  const [subs, setSubs] = useState('Eingebrannt')
  const [names, setNames] = useState(true)
  const testlab = useStore((s) => s.testlab)
  const setTestlab = useStore((s) => s.setTestlab)
  const check = useEngines((s) => s.check)
  const checking = useEngines((s) => s.checking)
  const refreshCheck = useEngines((s) => s.refreshCheck)
  return (
    <div style={{ maxWidth: 820, margin: '0 auto', display: 'grid', gap: 8, paddingTop: 12 }}>
      <h1>Einstellungen</h1>
      <div className="sm-glass" style={{ padding: '4px 22px 16px' }}>
        <Row label="Export-Profil"><Segmented options={['TikTok', 'Reels', 'Shorts', 'Eigenes']} value={profile} onChange={setProfile} /></Row>
        <Row label="Qualität"><Segmented options={['Normal', 'Hoch', 'Maximal']} value={quality} onChange={setQuality} /></Row>
        <Row label="Encoder"><Segmented options={['Auto', 'NVENC', 'CPU']} value={encoder} onChange={setEncoder} /></Row>
        <Row label="Untertitel"><Segmented options={['Eingebrannt', 'SRT', 'Beides']} value={subs} onChange={setSubs} /></Row>
        <Row label="Testlab anzeigen" hint="Modelle nebeneinander vergleichen"><Switch on={testlab} onChange={setTestlab} label="Testlab anzeigen" /></Row>
        <Row label="Dateinamen nach KI-Titel"><Switch on={names} onChange={setNames} label="Dateinamen nach KI-Titel" /></Row>
        <Row label="Zielordner"><div style={{ display: 'flex', gap: 10 }}><input className="sm-input" defaultValue="C:\Users\Andirectly\Videos\Shortme" aria-label="Zielordner" /><Button variant="secondary">Ändern</Button></div></Row>
      </div>
      <h3 style={{ marginTop: 8 }}>Twitch</h3>
      <TwitchSettings />
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
