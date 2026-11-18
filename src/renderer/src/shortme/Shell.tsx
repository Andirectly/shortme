import { AnimatePresence, motion } from 'motion/react'
import { Logo } from './Logo'
import { Home, FolderOpen, Palette, Cpu, Settings, FlaskConical, Radio, Upload, Layers, GraduationCap } from 'lucide-react'
import type { ReactNode } from 'react'
import { useStore, type NavId, type Screen } from './store'
import { IMG } from './data'
import { useSprings } from './motion'
import { useTwitch } from './twitchStore'
import { useEffect } from 'react'

const NAV: { id: NavId; label: string; icon: ReactNode }[] = [
  { id: 'start', label: 'Start', icon: <Home size={20} /> },
  { id: 'projects', label: 'Projekte', icon: <FolderOpen size={20} /> },
  { id: 'studio', label: 'Stil-Studio', icon: <Palette size={20} /> },
  { id: 'live', label: 'Live', icon: <Radio size={20} /> },
  { id: 'upload', label: 'Upload', icon: <Upload size={20} /> },
  { id: 'workbench', label: 'Werkbank', icon: <Layers size={20} /> },
  { id: 'learn', label: 'Lernen', icon: <GraduationCap size={20} /> },
  { id: 'models', label: 'Modelle', icon: <Cpu size={20} /> },
  { id: 'testlab', label: 'Testlab', icon: <FlaskConical size={20} /> },
  { id: 'settings', label: 'Einstellungen', icon: <Settings size={20} /> }
]

const parentNav = (s: Screen): NavId => (s === 'processing' || s === 'clips' || s === 'editor' || s === 'compare' ? 'projects' : (s as NavId))

export function Shell({ children }: { children: ReactNode }): React.JSX.Element {
  const screen = useStore((s) => s.screen)
  const go = useStore((s) => s.go)
  const testlab = useStore((s) => s.testlab)
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
      </div>
      <nav className="sm-nav sm-glass" aria-label="Hauptnavigation">
        {NAV.filter((n) => n.id !== 'testlab' || testlab).map((n) => (
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
