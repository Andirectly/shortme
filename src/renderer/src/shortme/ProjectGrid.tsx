import { useEffect, useState } from 'react'
import { motion } from 'motion/react'
import { Check, CheckCircle2, Circle, Clock, Film, Link2, Loader2, RefreshCw, Trash2 } from 'lucide-react'
import { Button } from './ui'
import { PROJECTS } from './data'
import { useProject } from './projectStore'
import { useStore } from './store'
import { useSprings } from './motion'

const ITEM: React.CSSProperties = { display: 'flex', gap: 8, alignItems: 'center', width: '100%', padding: '8px 10px', background: 'none', border: 0, borderRadius: 8, cursor: 'pointer', color: 'inherit', textAlign: 'left' }
const fmt = (sec: number): string => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`
const withinDays = (iso: string, days: number): boolean => Date.now() - new Date(iso).getTime() <= days * 86400000
const ago = (iso: string): string => {
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)
  return d <= 0 ? 'Heute' : d === 1 ? 'Gestern' : `Vor ${d} Tagen`
}

/** Projektkarten mit 16:9-Vorschaubild (nicht zugeschnitten): YouTube-Thumbnail bei Links, sonst Screenshot des Videos. */
export function ProjectGrid({ limit, selectable, title }: { limit?: number; /** Mehrfachauswahl + Massen-Löschen (nur in „Projekte“). */ selectable?: boolean; /** Überschrift; die Auswahl-Knöpfe stehen dann rechts daneben. */ title?: string }): React.JSX.Element {
  const hasApi = useProject((s) => s.hasApi)
  const projects = useProject((s) => s.projects)
  const loadProjects = useProject((s) => s.loadProjects)
  const openProject = useProject((s) => s.openProject)
  const go = useStore((s) => s.go)
  const deleteProject = useProject((s) => s.deleteProject)
  const reanalyze = useProject((s) => s.reanalyze)
  const [menu, setMenu] = useState<{ x: number; y: number; hash: string; source: string; isUrl: boolean; title: string } | null>(null)
  const [copied, setCopied] = useState(false)
  const deleteProjects = useProject((s) => s.deleteProjects)
  const [picking, setPicking] = useState(false)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [note, setNote] = useState('')
  const toggle = (h: string): void => setPicked((s) => { const n = new Set(s); if (n.has(h)) n.delete(h); else n.add(h); return n })
  const removePicked = async (): Promise<void> => {
    const r = await deleteProjects([...picked])
    setNote(r.deleted || r.skipped ? `${r.deleted} gelöscht${r.skipped ? ` · ${r.skipped} übersprungen (wird gerade verarbeitet)` : ''}` : '')
    if (r.deleted) { setPicked(new Set()); setPicking(false) }
  }
  useEffect(() => { if (!menu) return; const close = (): void => setMenu(null); window.addEventListener('click', close); window.addEventListener('blur', close); window.addEventListener('keydown', close); return () => { window.removeEventListener('click', close); window.removeEventListener('blur', close); window.removeEventListener('keydown', close) } }, [menu])
  const { base } = useSprings()
  useEffect(() => { void loadProjects() }, [loadProjects, hasApi])

  const cards = hasApi
    ? projects.map((p) => ({ hash: p.hash, key: p.hash, source: p.source, isUrl: p.isUrl, title: p.title, dur: fmt(p.durationSec), clips: p.clips, status: p.status, date: ago(p.created), img: p.poster, open: async () => { const to = await openProject(p.hash); if (to) go(to) } }))
    : PROJECTS.map((p) => ({ hash: '', key: p.id, source: '', isUrl: false, title: p.name, dur: p.duration, clips: p.clips, status: 'done' as const, date: p.date, img: p.thumb, open: async () => go('clips') }))
  const shown = limit ? cards.slice(0, limit) : cards

  const heading = title ? <h1>{title}</h1> : null
  if (shown.length === 0) return <>{heading}<small>Noch keine Projekte – ziehe oben ein Video hinein.</small></>
  const recent = projects.filter((p) => withinDays(p.created, 30)).map((p) => p.hash)
  return (
    <>
    {(heading || (selectable && hasApi)) && (
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'space-between' }}>
      {heading}
      {selectable && hasApi && (
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end', marginLeft: 'auto' }}>
        {!picking ? <Button variant="secondary" onClick={() => { setPicking(true); setNote('') }}>Auswählen</Button> : (
          <>
            <small style={{ minWidth: 92 }}>{picked.size} ausgewählt</small>
            <Button variant="secondary" onClick={() => setPicked(new Set(projects.map((p) => p.hash)))}>Alle</Button>
            <Button variant="secondary" onClick={() => setPicked(new Set(recent))}>Letzte 30 Tage ({recent.length})</Button>
            <Button variant="secondary" onClick={() => setPicked(new Set())}>Keine</Button>
            <Button variant="secondary" disabled={!picked.size} onClick={() => void removePicked()} style={{ color: 'var(--warn)' }}><Trash2 size={14} /> Löschen …</Button>
            <Button variant="secondary" onClick={() => { setPicking(false); setPicked(new Set()) }}>Fertig</Button>
          </>
        )}
        {note && <small role="status">{note}</small>}
      </div>
      )}
      </div>
    )}
    {menu && (
      <div role="menu" className="sm-glass" style={{ position: 'fixed', left: Math.min(menu.x, window.innerWidth - 190), top: Math.min(menu.y, window.innerHeight - 130), zIndex: 90, padding: 6, background: 'rgba(24,24,24,0.97)', minWidth: 170 }}>
        <button role="menuitem" onClick={() => { void navigator.clipboard.writeText(menu.source); setCopied(true); setTimeout(() => setCopied(false), 1500) }} style={ITEM}>{copied ? <Check size={15} /> : <Link2 size={15} />} {menu.isUrl ? 'Link kopieren' : 'Dateipfad kopieren'}</button>
        <button role="menuitem" onClick={() => { if (window.confirm(`„${menu.title}“ neu analysieren? Die bisherigen Clips dieses Projekts werden durch ein neues Ergebnis ersetzt.`)) void reanalyze(menu.hash).then((ok) => ok && go('processing')) }} style={ITEM}><RefreshCw size={15} /> Neu analysieren</button>
        <button role="menuitem" onClick={() => void deleteProject(menu.hash)} style={{ ...ITEM, color: 'var(--warn)' }}><Trash2 size={15} /> Projekt löschen …</button>
      </div>
    )}
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 14 }}>
      {shown.map((p) => (
        <motion.button key={p.key} className="sm-card" onContextMenu={(e) => { if (!p.hash) return; e.preventDefault(); setCopied(false); setMenu({ x: e.clientX, y: e.clientY, hash: p.hash, source: p.source, isUrl: p.isUrl, title: p.title }) }} whileTap={{ scale: 0.97 }} transition={base} onClick={() => (picking && p.hash ? toggle(p.hash) : void p.open())} aria-pressed={picking ? picked.has(p.hash) : undefined} style={{ padding: 0, overflow: 'hidden', textAlign: 'left', position: 'relative', outline: picking && picked.has(p.hash) ? '2px solid var(--accent, #fff)' : undefined }}>
          {picking && <span aria-hidden style={{ position: 'absolute', top: 8, left: 8, zIndex: 1, display: 'grid', placeItems: 'center', borderRadius: 999, background: 'rgba(0,0,0,0.55)', padding: 2 }}>{picked.has(p.hash) ? <CheckCircle2 size={22} /> : <Circle size={22} />}</span>}
          <div style={{ aspectRatio: '16 / 9', background: 'rgba(255,255,255,0.05)', display: 'grid', placeItems: 'center', position: 'relative' }}>
            {p.status === 'none' && <span className="sm-tag" style={{ position: 'absolute', left: 10, bottom: 10, background: 'rgba(0,0,0,0.65)', color: '#fff' }}>Noch nicht analysiert</span>}
            {p.status === 'running' && <span className="sm-tag" style={{ position: 'absolute', left: 10, bottom: 10, background: 'rgba(0,0,0,0.65)', color: '#fff', display: 'inline-flex', alignItems: 'center', gap: 6 }}><Loader2 size={12} className="sm-spin" /> Wird analysiert …</span>}
            {p.img ? <img src={p.img} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} /> : <Film size={28} color="var(--text-3)" />}
          </div>
          <div style={{ padding: 14, display: 'grid', gap: 4 }}>
            <h3 style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.title}</h3>
            <small><Clock size={11} style={{ display: 'inline', verticalAlign: -1 }} /> {p.dur} · {p.status === 'none' ? 'nur geladen' : p.status === 'running' ? 'Analyse läuft' : `${p.clips} Clips`} · {p.date}</small>
          </div>
        </motion.button>
      ))}
    </div>
    </>
  )
}
