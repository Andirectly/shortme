// „Werkzeuge“: seltener genutzte Bereiche gesammelt (UX-Upgrade) – alle bisherigen Ziele bleiben erreichbar, nichts entfällt.
import { Cpu, FlaskConical, GraduationCap, Layers, Radio } from 'lucide-react'
import type { ReactNode } from 'react'
import { useStore, type Screen } from './store'
import { useTwitch } from './twitchStore'

const TOOLS: Array<{ id: Screen; label: string; text: string; icon: ReactNode; testlabOnly?: boolean }> = [
  { id: 'live', label: 'Live', text: 'Twitch-Stream mitschneiden und die letzten Minuten sichern', icon: <Radio size={22} /> },
  { id: 'workbench', label: 'Werkbank', text: 'Videos eines Kanals mit den echten Shorts des Creators vergleichen', icon: <Layers size={22} /> },
  { id: 'learn', label: 'Lernen', text: 'Bewertungen, Lerndaten und Regeln für bessere Clip-Auswahl', icon: <GraduationCap size={22} /> },
  { id: 'models', label: 'Modelle', text: 'Modelle und Laufzeiten installieren, Speicher und Systemcheck', icon: <Cpu size={22} /> },
  { id: 'testlab', label: 'Testlab', text: 'Modelle und Renderer gegeneinander testen', icon: <FlaskConical size={22} />, testlabOnly: true }
]

export function ToolsScreen(): React.JSX.Element {
  const go = useStore((s) => s.go)
  const testlab = useStore((s) => s.testlab)
  const liveOn = useTwitch((s) => s.live.running)
  return (
    <div className="sm-wrap" style={{ display: 'grid', gap: 18, paddingTop: 12 }}>
      <h1>Werkzeuge</h1>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 14 }}>
        {TOOLS.filter((t) => !t.testlabOnly || testlab).map((t) => (
          <button key={t.id} className={`sm-card${t.id === 'live' && liveOn ? ' sm-nav-live' : ''}`} onClick={() => go(t.id)} style={{ padding: 18, textAlign: 'left', display: 'grid', gap: 8, cursor: 'pointer' }} aria-label={`${t.label}${t.id === 'live' && liveOn ? ' – Aufnahme läuft' : ''}`}>
            <span style={{ display: 'flex', gap: 10, alignItems: 'center' }}>{t.icon}<b style={{ fontSize: 16 }}>{t.label}</b>{t.id === 'live' && liveOn && <small>Aufnahme läuft</small>}</span>
            <small style={{ color: 'var(--text-2)' }}>{t.text}</small>
          </button>
        ))}
      </div>
    </div>
  )
}
