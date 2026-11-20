import { AnimatePresence, motion } from 'motion/react'
import { Logo } from './Logo'
import { Home, FolderOpen, Palette, Settings, Radio, Upload, LayoutGrid, Loader2 } from 'lucide-react'
import { useProject } from './projectStore'
import { fmtElapsed } from '@shared/estimate'
import type { ReactNode } from 'react'
import { useStore, type NavId, type Screen } from './store'
import { IMG } from './data'
import { useSprings } from './motion'
import { useTwitch } from './twitchStore'
import { useEffect, useState } from 'react'

// Hauptstruktur (UX-Upgrade): seltene Bereiche unter „Werkzeuge“; Live erscheint zusätzlich direkt, solange eine Aufnahme läuft
const NAV: { id: NavId; label: string; icon: ReactNode }[] = [
  { id: 'start', label: 'Start', icon: <Home size={20} /> },
  { id: 'projects', label: 'Projekte', icon: <FolderOpen size={20} /> },
  { id: 'upload', label: 'Exporte & Upload', icon: <Upload size={20} /> },
  { id: 'studio', label: 'Vorlagen', icon: <Palette size={20} /> },
  { id: 'live', label: 'Live', icon: <Radio size={20} /> },
  { id: 'tools', label: 'Werkzeuge', icon: <LayoutGrid size={20} /> },
  { id: 'settings', label: 'Einstellungen', icon: <Settings size={20} /> }
]
const TOOL_SCREENS: Screen[] = ['live', 'workbench', 'learn', 'models', 'testlab', 'tools']

/** Laufender Analyse-Job, dezent auf jedem Bildschirm (außer der Verarbeitung selbst); Klick führt zum Fortschritt. */
function JobPill(): React.JSX.Element | null {
  const job = useProject((s) => s.job)
  const screen = useStore((s) => s.screen)
  const go = useStore((s) => s.go)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => { const i = setInterval(() => setNow(Date.now()), 10_000); return () => clearInterval(i) }, [])
  if (!job || !['running', 'queued', 'paused'].includes(job.state) || screen === 'processing') return null
  const msg = job.message.replace(/ · noch .*$/, '').replace(/\s*…$/, '')
  return (
    <button className="sm-jobpill sm-glass" onClick={() => go('processing')} title={`${job.title} – zum Fortschritt`} aria-label={`Analyse läuft: ${job.title}. Zum Fortschritt`}>
      {job.state === 'paused' ? <span aria-hidden>‖</span> : <Loader2 size={13} className="sm-spin" aria-hidden />}
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{job.state === 'paused' ? 'Pausiert' : msg || 'Clips werden erstellt'}</span>
      {job.startedAt && job.state === 'running' ? <span style={{ color: 'var(--text-3)' }}>{fmtElapsed((now - job.startedAt) / 1000)}</span> : null}
    </button>
  )
}

const parentNav = (s: Screen): NavId => (s === 'processing' || s === 'clips' || s === 'editor' || s === 'compare' || s === 'review' ? 'projects' : TOOL_SCREENS.includes(s) && s !== 'live' ? 'tools' : (s as NavId))

export function Shell({ children }: { children: ReactNode }): React.JSX.Element {
  const screen = useStore((s) => s.screen)
  const go = useStore((s) => s.go)
  const theme = useStore((s) => s.theme)
  const { base } = useSprings()
  const active = parentNav(screen)
  const liveOn = useTwitch((s) => s.live.running)
  const refreshLive = useTwitch((s) => s.refreshLive)
  // Der Puffer läuft im Hintergrund weiter; der Status wird alle 3 s abgefragt (Badge am Live-Tab)
  useEffect(() => { void refreshLive(); const t = setInterval(() => void refreshLive(), 3000); return () => clearInterval(t) }, [refreshLive])
  return (
    <div className="sm-root" data-theme={theme} data-platform={window.cutawan?.platform}>
      {/* Festes Stimmungsbild nur in der Browser-Vorschau; in der App scheint der echte Desktop durch (Windows-Acrylic) */}
      {!window.cutawan && <div className="sm-ambient" style={{ backgroundImage: `url(${IMG.ambient})` }} />}
      <div className="sm-titlebar">
        <span className="sm-logo"><Logo size={16} /></span>
        <strong style={{ color: 'var(--text-1)', fontWeight: 600 }}>Shortme</strong>
        <small className="sm-build" aria-label="Version">{__BUILD__}</small>
      <JobPill />
      </div>
      <nav className="sm-nav sm-glass" aria-label="Hauptnavigation">
        {NAV.filter((n) => n.id !== 'live' || liveOn || active === 'live').map((n) => (
          <button key={n.id} className={`sm-nav-item${n.id === 'live' && liveOn ? ' sm-nav-live' : ''}`} aria-current={active === n.id ? 'page' : undefined} aria-label={n.id === 'live' && liveOn ? `${n.label} – Aufnahme läuft` : n.label} title={n.id === 'live' && liveOn ? `${n.label} – Aufnahme läuft` : n.label} onClick={() => go(n.id)}>
            {active === n.id && <motion.span layoutId="nav-glow" className="sm-nav-glow" transition={base} />}
            {n.icon}
          </button>
        ))}
      </nav>
      <AnimatePresence mode="wait" initial={false}>
        <motion.main key={screen} className="sm-page sm-scroll-mask" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={base}>
          {children}
        </motion.main>
      </AnimatePresence>
    </div>
  )
}
