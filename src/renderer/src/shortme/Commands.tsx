// Befehlssuche (⌘K / Strg+K) und Tastenkürzel-Übersicht (?): jede Seite und die wichtigsten Aktionen per Tastatur erreichbar,
// alles bleibt zusätzlich über sichtbare Knöpfe bedienbar (Designpaket 2026-11-20, UI-005/UI-015).
import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Search } from 'lucide-react'
import { useStore, type Screen } from './store'
import { useProject } from './projectStore'
import { useSprings } from './motion'

const MAC = (): boolean => window.cutawan?.platform === 'darwin'
export const modKey = (): string => (MAC() ? '⌘' : 'Strg+')

interface Command { id: string; label: string; group: string; hint?: string; run: () => void | Promise<void> }

const PAGES: Array<{ screen: Screen; label: string }> = [
  { screen: 'start', label: 'Start' }, { screen: 'projects', label: 'Projekte' }, { screen: 'upload', label: 'Exporte & Upload' },
  { screen: 'studio', label: 'Vorlagen' }, { screen: 'live', label: 'Live' }, { screen: 'tools', label: 'Werkzeuge' },
  { screen: 'workbench', label: 'Werkbank' }, { screen: 'learn', label: 'Lernen' }, { screen: 'models', label: 'Modelle' }, { screen: 'settings', label: 'Einstellungen' }
]

/** Treffer: alle Wörter der Eingabe kommen vor (Groß/klein egal). */
export const matches = (label: string, q: string): boolean => q.trim().toLowerCase().split(/\s+/).every((w) => label.toLowerCase().includes(w))

export const SHORTCUTS: Array<{ area: string; keys: Array<[string, string]> }> = [
  { area: 'Überall', keys: [['⌘K / Strg+K', 'Befehle und Projekte suchen'], ['?', 'Diese Übersicht'], ['Esc', 'Dialog schließen']] },
  { area: 'Clipliste', keys: [['Klick', 'Details rechts im Inspector'], ['Doppelklick', 'Im Editor öffnen'], ['1 / 2 / 3', 'Lernbewertung (Maus über der Karte)']] },
  { area: 'Review', keys: [['Leertaste', 'Abspielen / Pause'], ['N / P  oder Pfeile', 'Nächster / vorheriger Clip'], ['1 / 2 / 3', 'Freigeben / Prüfen / Verwerfen'], ['E', 'Im Editor öffnen']] },
  { area: 'Editor', keys: [['Leertaste', 'Abspielen / Pause'], ['← / →', '1 s zurück / vor (mit ⇧ 5 s)'], ['Entf', 'Markiertes Wort herausschneiden'], ['⌘Z / Strg+Z', 'Rückgängig'], ['⌘⇧Z / Strg+Y', 'Wiederholen']] }
]

const typing = (e: KeyboardEvent): boolean => { const t = e.target as HTMLElement; return t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable }

export function CommandLayer({ onToggleLabels }: { onToggleLabels: () => void }): React.JSX.Element {
  const [mode, setMode] = useState<'none' | 'palette' | 'help'>('none')
  useEffect(() => {
    const k = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 'k') { e.preventDefault(); setMode((m) => (m === 'palette' ? 'none' : 'palette')) }
      else if (e.key === '?' && !typing(e)) { e.preventDefault(); setMode((m) => (m === 'help' ? 'none' : 'help')) }
      else if (e.key === 'Escape') setMode('none')
    }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [])
  return (
    <AnimatePresence>
      {mode === 'palette' && <Palette key="p" onClose={() => setMode('none')} onHelp={() => setMode('help')} onToggleLabels={onToggleLabels} />}
      {mode === 'help' && <Help key="h" onClose={() => setMode('none')} />}
    </AnimatePresence>
  )
}

function Overlay({ children, onClose, label }: { children: React.ReactNode; onClose: () => void; label: string }): React.JSX.Element {
  const { base } = useSprings()
  return (
    <motion.div role="dialog" aria-modal="true" aria-label={label} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={base} onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 300, background: 'rgba(0,0,0,0.5)', display: 'grid', justifyItems: 'center', alignItems: 'start', paddingTop: '14vh' }}>
      <motion.div initial={{ y: -8, scale: 0.98 }} animate={{ y: 0, scale: 1 }} exit={{ y: -8, scale: 0.98 }} transition={base} className="sm-glass" onClick={(e) => e.stopPropagation()} style={{ width: 'min(620px, calc(100vw - 32px))', maxHeight: '68vh', display: 'grid', gridTemplateRows: 'auto minmax(0, 1fr)', background: 'rgba(22,22,28,0.97)', overflow: 'hidden' }}>
        {children}
      </motion.div>
    </motion.div>
  )
}

function Palette({ onClose, onHelp, onToggleLabels }: { onClose: () => void; onHelp: () => void; onToggleLabels: () => void }): React.JSX.Element {
  const go = useStore((s) => s.go)
  const projects = useProject((s) => s.projects)
  const openProject = useProject((s) => s.openProject)
  const clipsFile = useProject((s) => s.clipsFile)
  const job = useProject((s) => s.job)
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)
  const all = useMemo<Command[]>(() => [
    { id: 'new', label: 'Neues Video laden', group: 'Aktionen', run: () => go('start') },
    ...(clipsFile?.clips.length ? [{ id: 'clips', label: 'Clipliste öffnen', group: 'Aktionen', run: () => go('clips') }, { id: 'review', label: 'Review starten', group: 'Aktionen', run: () => go('review') }] : []),
    ...(job && ['running', 'queued', 'paused'].includes(job.state) ? [{ id: 'job', label: 'Zum Fortschritt', group: 'Aktionen', hint: job.title, run: () => go('processing') }] : []),
    { id: 'help', label: 'Tastenkürzel anzeigen', group: 'Aktionen', hint: '?', run: onHelp },
    { id: 'labels', label: 'Seitenleiste: Beschriftungen ein/aus', group: 'Aktionen', run: onToggleLabels },
    ...PAGES.map((p) => ({ id: `page-${p.screen}`, label: p.label, group: 'Seiten', run: () => go(p.screen) })),
    ...projects.map((p) => ({ id: `proj-${p.hash}`, label: p.title, group: 'Projekte', hint: p.clips ? `${p.clips} Clips` : 'noch nicht analysiert', run: async () => { const to = await openProject(p.hash); if (to) go(to) } }))
  ], [go, projects, openProject, clipsFile, job, onHelp, onToggleLabels])
  const list = all.filter((c) => !q.trim() || matches(`${c.label} ${c.group}`, q)).slice(0, 40)
  const cur = Math.min(sel, Math.max(0, list.length - 1))
  useEffect(() => { listRef.current?.querySelector(`[data-i="${cur}"]`)?.scrollIntoView({ block: 'nearest' }) }, [cur])
  const run = (c: Command | undefined): void => { if (!c) return; onClose(); void c.run() }
  return (
    <Overlay onClose={onClose} label="Befehle">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', borderBottom: '1px solid var(--edge)' }}>
        <Search size={16} aria-hidden style={{ color: 'var(--text-2)' }} />
        <input autoFocus value={q} placeholder="Seite, Projekt oder Aktion suchen …" aria-label="Befehl suchen" onChange={(e) => { setQ(e.target.value); setSel(0) }}
          onKeyDown={(e) => { if (e.key === 'ArrowDown') { e.preventDefault(); setSel(cur + 1 < list.length ? cur + 1 : 0) } else if (e.key === 'ArrowUp') { e.preventDefault(); setSel(cur > 0 ? cur - 1 : list.length - 1) } else if (e.key === 'Enter') { e.preventDefault(); run(list[cur]) } }}
          style={{ flex: 1, background: 'transparent', border: 0, outline: 'none', color: 'var(--text-1)', fontSize: 16 }} />
        <kbd>Esc</kbd>
      </div>
      <div ref={listRef} role="listbox" aria-label="Treffer" style={{ overflowY: 'auto', padding: 6 }}>
        {list.length === 0 && <small style={{ display: 'block', padding: 14, color: 'var(--text-2)' }}>Nichts gefunden.</small>}
        {list.map((c, i) => (
          <div key={c.id}>
            {(i === 0 || list[i - 1].group !== c.group) && <small style={{ display: 'block', padding: '8px 10px 4px', color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: 0.6, fontSize: 10.5 }}>{c.group}</small>}
            <div data-i={i} role="option" aria-selected={i === cur} onMouseMove={() => setSel(i)} onClick={() => run(c)} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '8px 10px', borderRadius: 10, cursor: 'pointer', background: i === cur ? 'rgba(255,255,255,0.09)' : 'transparent' }}>
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.label}</span>
              {c.hint && <small style={{ color: 'var(--text-3)', flexShrink: 0 }}>{c.hint}</small>}
            </div>
          </div>
        ))}
      </div>
    </Overlay>
  )
}

function Help({ onClose }: { onClose: () => void }): React.JSX.Element {
  return (
    <Overlay onClose={onClose} label="Tastenkürzel">
      <div style={{ display: 'flex', alignItems: 'center', padding: '14px 18px', borderBottom: '1px solid var(--edge)' }}><h2 style={{ flex: 1, fontSize: 18 }}>Tastenkürzel</h2><kbd>Esc</kbd></div>
      <div style={{ overflowY: 'auto', padding: '6px 18px 16px', display: 'grid', gap: 14 }}>
        {SHORTCUTS.map((g) => (
          <section key={g.area} style={{ display: 'grid', gap: 6 }}>
            <small style={{ color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: 0.6, fontSize: 10.5, marginTop: 8 }}>{g.area}</small>
            {g.keys.map(([k, d]) => <div key={k + d} style={{ display: 'grid', gridTemplateColumns: '170px 1fr', gap: 12, alignItems: 'center' }}><kbd style={{ justifySelf: 'start' }}>{k}</kbd><small style={{ color: 'var(--text-1)' }}>{d}</small></div>)}
          </section>
        ))}
      </div>
    </Overlay>
  )
}
