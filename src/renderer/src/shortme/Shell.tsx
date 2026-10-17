import { AnimatePresence, motion } from 'motion/react'
import { Home, FolderOpen, Palette, Cpu, Settings } from 'lucide-react'
import type { ReactNode } from 'react'
import { useStore, type NavId, type Screen } from './store'
import { IMG } from './data'
import { useSprings } from './motion'

const NAV: { id: NavId; label: string; icon: ReactNode }[] = [
  { id: 'start', label: 'Start', icon: <Home size={20} /> },
  { id: 'projects', label: 'Projekte', icon: <FolderOpen size={20} /> },
  { id: 'studio', label: 'Stil-Studio', icon: <Palette size={20} /> },
  { id: 'models', label: 'Modelle', icon: <Cpu size={20} /> },
  { id: 'settings', label: 'Einstellungen', icon: <Settings size={20} /> }
]

const parentNav = (s: Screen): NavId => (s === 'processing' || s === 'clips' || s === 'editor' ? 'projects' : (s as NavId))

export function Shell({ children }: { children: ReactNode }): React.JSX.Element {
  const screen = useStore((s) => s.screen)
  const go = useStore((s) => s.go)
  const { base } = useSprings()
  const active = parentNav(screen)
  return (
    <div className="sm-root">
      <div className="sm-ambient" style={{ backgroundImage: `url(${IMG.ambient})` }} />
      <div className="sm-titlebar">
        <span className="sm-logo" />
        <strong style={{ color: 'var(--text-1)', fontWeight: 600 }}>Shortme</strong>
      </div>
      <nav className="sm-nav sm-glass" aria-label="Hauptnavigation">
        {NAV.map((n) => (
          <button key={n.id} className="sm-nav-item" aria-current={active === n.id ? 'page' : undefined} aria-label={n.label} title={n.label} onClick={() => go(n.id)}>
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
