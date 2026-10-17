import { useEffect } from 'react'
import { motion } from 'motion/react'
import { Clock, Film } from 'lucide-react'
import { PROJECTS } from './data'
import { useProject } from './projectStore'
import { useStore } from './store'
import { useSprings } from './motion'

const fmt = (sec: number): string => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`
const ago = (iso: string): string => {
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)
  return d <= 0 ? 'Heute' : d === 1 ? 'Gestern' : `Vor ${d} Tagen`
}

/** Projektkarten mit 16:9-Vorschaubild (nicht zugeschnitten): YouTube-Thumbnail bei Links, sonst Screenshot des Videos. */
export function ProjectGrid({ limit }: { limit?: number }): React.JSX.Element {
  const hasApi = useProject((s) => s.hasApi)
  const projects = useProject((s) => s.projects)
  const loadProjects = useProject((s) => s.loadProjects)
  const openProject = useProject((s) => s.openProject)
  const go = useStore((s) => s.go)
  const { base } = useSprings()
  useEffect(() => { void loadProjects() }, [loadProjects, hasApi])

  const cards = hasApi
    ? projects.map((p) => ({ key: p.hash, title: p.title, dur: fmt(p.durationSec), clips: p.clips, date: ago(p.created), img: p.poster, open: async () => { if (await openProject(p.hash)) go('clips') } }))
    : PROJECTS.map((p) => ({ key: p.id, title: p.name, dur: p.duration, clips: p.clips, date: p.date, img: p.thumb, open: async () => go('clips') }))
  const shown = limit ? cards.slice(0, limit) : cards

  if (shown.length === 0) return <small>Noch keine Projekte – ziehe oben ein Video hinein.</small>
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 14 }}>
      {shown.map((p) => (
        <motion.button key={p.key} className="sm-card" whileTap={{ scale: 0.97 }} transition={base} onClick={() => void p.open()} style={{ padding: 0, overflow: 'hidden', textAlign: 'left' }}>
          <div style={{ aspectRatio: '16 / 9', background: 'rgba(255,255,255,0.05)', display: 'grid', placeItems: 'center' }}>
            {p.img ? <img src={p.img} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} /> : <Film size={28} color="var(--text-3)" />}
          </div>
          <div style={{ padding: 14, display: 'grid', gap: 4 }}>
            <h3 style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.title}</h3>
            <small><Clock size={11} style={{ display: 'inline', verticalAlign: -1 }} /> {p.dur} · {p.clips} Clips · {p.date}</small>
          </div>
        </motion.button>
      ))}
    </div>
  )
}
