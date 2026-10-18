import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { Pause, Play, Square, Trash2, Check, Loader2, AlertTriangle, LayoutGrid, List, Download, Wand2, ThumbsUp, ThumbsDown } from 'lucide-react'
import { useStore } from './store'
import { useProject } from './projectStore'
import { CLIPS, PROJECTS, type Clip } from './data'
import { useClipList } from './clipData'
import { ProjectGrid } from './ProjectGrid'
import { Button, Pill, Score } from './ui'
import { useSprings } from './motion'

const STAGES = [
  { id: 'transcribe', label: 'Transkribieren', from: 0, to: 0.3 },
  { id: 'analyze', label: 'Analysieren', from: 0.3, to: 0.5 },
  { id: 'find', label: 'Clips finden', from: 0.5, to: 0.75 },
  { id: 'render', label: 'Rendern', from: 0.75, to: 1 }
]

function DemoProcessing(): React.JSX.Element {
  const progress = useStore((s) => s.progress)
  const paused = useStore((s) => s.paused)
  const setProgress = useStore((s) => s.setProgress)
  const setPaused = useStore((s) => s.setPaused)
  const go = useStore((s) => s.go)
  const ref = useRef(progress)
  ref.current = progress

  useEffect(() => {
    setProgress(0)
    setPaused(false)
  }, [setProgress, setPaused])
  useEffect(() => {
    if (paused) return
    const id = setInterval(() => setProgress(Math.min(1, ref.current + 0.01)), 250)
    return () => clearInterval(id)
  }, [paused, setProgress])

  const remaining = Math.max(0, Math.round((1 - progress) * 140))
  const ready = progress > 0.8 ? CLIPS.slice(0, Math.min(CLIPS.length, Math.floor((progress - 0.75) * 40))) : []
  return (
    <div style={{ maxWidth: 900, margin: '0 auto', display: 'grid', gap: 24, paddingTop: 12 }}>
      <div>
        <h1>{progress >= 1 ? 'Fertig' : paused ? 'Pausiert' : 'Clips werden erstellt …'}</h1>
        <small>Tattoo-Folge (Sidequests) · {progress >= 1 ? 'alle Clips bereit' : `noch ca. ${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')} min`}</small>
      </div>
      <div className="sm-glass" style={{ padding: 22, display: 'grid', gap: 18 }}>
        {STAGES.map((s) => {
          const p = Math.max(0, Math.min(1, (progress - s.from) / (s.to - s.from)))
          const done = p >= 1
          return (
            <div key={s.id} style={{ display: 'grid', gridTemplateColumns: '28px 160px 1fr 48px', alignItems: 'center', gap: 12, opacity: p === 0 ? 0.5 : 1 }}>
              {done ? <Check size={18} color="var(--ok)" /> : p > 0 && !paused ? <Loader2 size={18} className="sm-spin" /> : <span />}
              <span>{s.label}</span>
              <div className="sm-bar"><i style={{ width: `${p * 100}%` }} /></div>
              <small style={{ textAlign: 'right' }}>{Math.round(p * 100)} %</small>
            </div>
          )
        })}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          {progress < 1 && (
            <Button variant="secondary" onClick={() => setPaused(!paused)}>{paused ? <Play size={15} /> : <Pause size={15} />} {paused ? 'Fortsetzen' : 'Pausieren'}</Button>
          )}
          {progress < 1 && <Button variant="secondary" onClick={() => go('clips')}><Square size={14} /> Stoppen &amp; behalten</Button>}
          <Button variant="secondary" onClick={() => go('start')}><Trash2 size={15} /> Verwerfen</Button>
          {progress >= 1 && <Button variant="primary" onClick={() => go('clips')}>Clips ansehen</Button>}
        </div>
      </div>
      {ready.length > 0 && (
        <section>
          <h3 style={{ marginBottom: 12 }}>Bereits fertig</h3>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <AnimatePresence>
              {ready.map((c) => (
                <motion.div key={c.id} initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} style={{ width: 96, aspectRatio: '9/16', borderRadius: 10, backgroundImage: `url(${c.thumb})`, backgroundSize: 'cover', position: 'relative', border: '1px solid var(--edge)' }}>
                  <span style={{ position: 'absolute', top: 6, left: 6 }}><Score v={c.score} /></span>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </section>
      )}
    </div>
  )
}

function ClipCard({ c, selected, onSelect, onOpen }: { c: Clip; selected: boolean; onSelect: () => void; onOpen: () => void }): React.JSX.Element {
  const { base, reduced } = useSprings()
  const [hover, setHover] = useState(false)
  const [pop, setPop] = useState(false)
  const vote = useProject((s) => s.feedback[c.id] ?? 0)
  const setFeedback = useProject((s) => s.setFeedback)
  return (
    <motion.div className="sm-card" style={{ position: 'relative', overflow: 'visible', contentVisibility: 'auto', containIntrinsicSize: '260px 520px', outline: selected ? '2px solid var(--accent)' : 'none' }} whileTap={reduced ? undefined : { scale: 0.97 }} transition={base} onHoverStart={() => setHover(true)} onHoverEnd={() => { setHover(false); setPop(false) }}>
      <div onClick={onOpen} style={{ aspectRatio: '9/16', borderRadius: 'var(--r-card) var(--r-card) 0 0', overflow: 'hidden', position: 'relative' }}>
        <div style={{ position: 'absolute', inset: 0, backgroundImage: `url(${c.thumb})`, backgroundSize: 'cover', transform: hover && !reduced ? 'scale(1.08)' : 'scale(1)', transition: 'transform 2.4s linear' }} />
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(0,0,0,0.3), transparent 30%, transparent 60%, rgba(0,0,0,0.7))' }} />
      </div>
      <button className="sm-score" style={{ position: 'absolute', top: 10, left: 10, border: 0 }} aria-label={`Score ${c.score}, Details`} onClick={(e) => { e.stopPropagation(); setPop(!pop) }}>{c.score}</button>
      <button aria-label="Auswählen" aria-pressed={selected} onClick={onSelect} style={{ position: 'absolute', top: 10, right: 10, width: 24, height: 24, borderRadius: '50%', border: '1.5px solid #fff', background: selected ? 'var(--accent)' : 'rgba(0,0,0,0.35)', display: 'grid', placeItems: 'center' }}>{selected && <Check size={14} />}</button>
      <div style={{ padding: '10px 12px 12px', display: 'grid', gap: 4 }}>
        <h3 style={{ fontSize: 14, lineHeight: 1.25 }}>{c.title}</h3>
        <div style={{ display: 'flex', gap: 4, position: 'absolute', right: 10, bottom: 10 }}>
          <button aria-label="Guter Clip" aria-pressed={vote === 1} title="Guter Clip (fließt in spätere Feinabstimmung ein)" onClick={() => void setFeedback(c.id, vote === 1 ? 0 : 1)} style={{ width: 28, height: 28, borderRadius: 14, border: '1px solid var(--edge)', background: vote === 1 ? '#fff' : 'rgba(0,0,0,0.35)', color: vote === 1 ? '#000' : '#fff', display: 'grid', placeItems: 'center', cursor: 'pointer' }}><ThumbsUp size={14} /></button>
          <button aria-label="Schlechter Clip" aria-pressed={vote === -1} title="Schlechter Clip" onClick={() => void setFeedback(c.id, vote === -1 ? 0 : -1)} style={{ width: 28, height: 28, borderRadius: 14, border: '1px solid var(--edge)', background: vote === -1 ? '#fff' : 'rgba(0,0,0,0.35)', color: vote === -1 ? '#000' : '#fff', display: 'grid', placeItems: 'center', cursor: 'pointer' }}><ThumbsDown size={14} /></button>
        </div>
        <small>{c.duration} s {c.faceRatio < 0.6 && <span title={`Gesichtsquote ${Math.round(c.faceRatio * 100)} %`} style={{ color: 'var(--warn)', marginLeft: 6 }}><AlertTriangle size={12} style={{ verticalAlign: -2 }} /> wenig Gesicht</span>}</small>
      </div>
      <AnimatePresence>
        {pop && (
          <motion.div initial={{ opacity: 0, scale: 0.92, filter: 'blur(6px)' }} animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }} exit={{ opacity: 0, scale: 0.92 }} transition={base} className="sm-glass" style={{ position: 'absolute', top: 40, left: 8, zIndex: 20, width: 240, padding: 14, transformOrigin: 'top left', background: 'rgba(24,24,32,0.95)', borderRadius: 16, display: 'grid', gap: 8 }}>
            {c.criteria.map((k) => (
              <div key={k.label} style={{ display: 'grid', gridTemplateColumns: '1fr 28px', gap: 8, alignItems: 'center', fontSize: 12 }}>
                <div style={{ display: 'grid', gap: 3 }}>{k.label}<div className="sm-bar" style={{ height: 4 }}><i style={{ width: `${(k.value / 20) * 100}%` }} /></div></div>
                <span style={{ textAlign: 'right' }}>{k.value}</span>
              </div>
            ))}
            <small style={{ color: 'var(--text-1)' }}>{c.reason}</small>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

export function ClipsScreen(): React.JSX.Element {
  const view = useStore((s) => s.view)
  const setView = useStore((s) => s.setView)
  const selected = useStore((s) => s.selected)
  const toggle = useStore((s) => s.toggleSelect)
  const openClip = useStore((s) => s.openClip)
  const { base } = useSprings()
  const list = useClipList()
  const exportClips = useProject((s) => s.exportClips)
  const exportJob = useProject((s) => s.exportJob)
  const persons = useProject((s) => s.persons)
  const openPersons = useProject((s) => s.openPersons)
  const presetId = useStore((s) => s.presetId)
  const title = useProject((s) => s.currentTitle ?? s.imported?.meta.title ?? s.job?.title)
  const sorted = [...list].sort((a, b) => b.score - a.score)
  return (
    <div style={{ display: 'grid', gap: 18, paddingTop: 12, paddingBottom: 90 }}>
      <div style={{ display: 'flex', alignItems: 'end', justifyContent: 'space-between', gap: 16 }}>
        <div><h1>{title ?? PROJECTS[0].name}</h1><small>{list.length} Clips · nach Score sortiert</small></div>
        <div style={{ display: 'flex', gap: 8 }}>
          {persons && persons.persons.length > 0 && <Pill onClick={openPersons}>Wer ist wer?{persons.needsReview ? ' ·  prüfen' : ''}</Pill>}
          <Pill pressed={view === 'grid'} onClick={() => setView('grid')}><LayoutGrid size={14} /> Raster</Pill>
          <Pill pressed={view === 'list'} onClick={() => setView('list')}><List size={14} /> Liste</Pill>
        </div>
      </div>
      {view === 'grid' ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 16 }}>
          {sorted.map((c) => <ClipCard key={c.id} c={c} selected={selected.includes(c.id)} onSelect={() => toggle(c.id)} onOpen={() => openClip(c.id)} />)}
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 8 }}>
          {sorted.map((c) => (
            <motion.div key={c.id} className="sm-card" whileTap={{ scale: 0.99 }} transition={base} onClick={() => openClip(c.id)} style={{ display: 'grid', gridTemplateColumns: '24px 54px 1fr auto auto', alignItems: 'center', gap: 14, padding: 10 }}>
              <input type="checkbox" checked={selected.includes(c.id)} onClick={(e) => e.stopPropagation()} onChange={() => toggle(c.id)} aria-label="Auswählen" />
              <div style={{ width: 54, aspectRatio: '9/16', borderRadius: 8, backgroundImage: `url(${c.thumb})`, backgroundSize: 'cover' }} />
              <div><h3>{c.title}</h3><small>{c.reason}</small></div>
              <small>{c.duration} s</small>
              <Score v={c.score} />
            </motion.div>
          ))}
        </div>
      )}
      <AnimatePresence>
        {selected.length > 0 && (
          <motion.div initial={{ y: 80, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 80, opacity: 0 }} transition={base} className="sm-glass" style={{ position: 'fixed', bottom: 20, left: '50%', translate: '-50% 0', padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10, borderRadius: 999, zIndex: 30, background: 'rgba(24,24,32,0.9)' }}>
            <small style={{ color: 'var(--text-1)', paddingLeft: 8 }}>{selected.length} ausgewählt</small>
            <Button variant="secondary"><Wand2 size={15} /> Auf alle anwenden</Button>
            <Button variant="primary" disabled={exportJob?.state === 'running'} onClick={() => void exportClips(selected, presetId, false)}><Download size={15} /> {exportJob?.state === 'running' ? `${Math.round(exportJob.progress * 100)} %` : 'Exportieren'}</Button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

export function ProjectsScreen(): React.JSX.Element {
  return (
    <div style={{ maxWidth: 980, margin: '0 auto', display: 'grid', gap: 18, paddingTop: 12 }}>
      <h1>Projekte</h1>
      <ProjectGrid />
    </div>
  )
}

const STAGE_RANGE: Record<string, [number, number, number]> = {
  // [Zeile, von, bis] – Anteil an der Gesamtanzeige
  audio: [0, 0, 0.03], asr: [0, 0.03, 0.45], speakers: [0, 0.45, 0.52], finalize: [0, 0.52, 0.55],
  signals: [1, 0.55, 0.6], shots: [1, 0.6, 0.8], layout: [2, 0.95, 0.97], llm: [2, 0.8, 0.8], texttiling: [2, 0.8, 0.95], candidates: [2, 0.8, 0.85], rate: [2, 0.85, 0.93], compare: [2, 0.93, 0.95], snap: [2, 0.95, 0.97], thumbs: [2, 0.97, 1], done: [2, 1, 1]
}
const ROWS = ['Transkribieren', 'Analysieren', 'Clips finden']
const ROW_SPAN: Array<[number, number]> = [[0, 0.55], [0.55, 0.8], [0.8, 1]]

/** Echte Verarbeitung (M3/M4): Fortschritt aus dem Job; Rendern folgt in M6. */
function RealProcessing(): React.JSX.Element {
  const job = useProject((s) => s.job)!
  const pause = useProject((s) => s.pause)
  const resume = useProject((s) => s.resume)
  const stop = useProject((s) => s.stop)
  const discard = useProject((s) => s.discard)
  const go = useStore((s) => s.go)
  const r = STAGE_RANGE[job.stage] ?? [0, 0, 0.03]
  const total = job.state === 'done' ? 1 : r[1] + (r[2] - r[1]) * job.progress
  const busy = job.state === 'running' || job.state === 'queued'
  const title = job.state === 'done' ? 'Clips gefunden' : job.state === 'paused' ? 'Pausiert' : job.state === 'stopped' ? 'Gestoppt' : job.state === 'error' ? 'Fehler' : 'Transkribiert …'
  const later = ['Rendern']
  return (
    <div style={{ maxWidth: 900, margin: '0 auto', display: 'grid', gap: 24, paddingTop: 12 }}>
      <div><h1>{title}</h1><small>{job.title} · {job.message}</small></div>
      <div className="sm-glass" style={{ padding: 22, display: 'grid', gap: 18 }}>
        {ROWS.map((label, i) => {
          const [a, b] = ROW_SPAN[i]
          const p = Math.max(0, Math.min(1, (total - a) / (b - a)))
          const done = p >= 1 || job.state === 'done'
          return (
            <div key={label} style={{ display: 'grid', gridTemplateColumns: '28px 160px 1fr 48px', alignItems: 'center', gap: 12, opacity: p === 0 ? 0.5 : 1 }}>
              {done ? <Check size={18} color="var(--ok)" /> : busy && p > 0 ? <Loader2 size={18} className="sm-spin" /> : <span />}
              <span>{label}</span>
              <div className="sm-bar"><i style={{ width: `${(done ? 1 : p) * 100}%` }} /></div>
              <small style={{ textAlign: 'right' }}>{Math.round((done ? 1 : p) * 100)} %</small>
            </div>
          )
        })}
        {later.map((l) => (
          <div key={l} style={{ display: 'grid', gridTemplateColumns: '28px 160px 1fr', alignItems: 'center', gap: 12, opacity: 0.4 }}>
            <span /><span>{l}</span><small>folgt in einem späteren Meilenstein</small>
          </div>
        ))}
        {job.error && <small style={{ color: 'var(--warn)' }}>{job.error}</small>}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          {job.state === 'running' && <Button variant="secondary" onClick={() => void pause()}><Pause size={15} /> Pausieren</Button>}
          {['paused', 'stopped', 'error'].includes(job.state) && <Button variant="secondary" onClick={() => void resume()}><Play size={15} /> Fortsetzen</Button>}
          {busy && <Button variant="secondary" onClick={() => void stop()}><Square size={14} /> Stoppen &amp; behalten</Button>}
          <Button variant="secondary" onClick={() => { void discard(); go('start') }}><Trash2 size={15} /> Verwerfen</Button>
          {job.state === 'done' && <Button variant="primary" onClick={() => go('clips')}>Weiter</Button>}
        </div>
      </div>
    </div>
  )
}

export function ProcessingScreen(): React.JSX.Element {
  const job = useProject((s) => s.job)
  return job ? <RealProcessing /> : <DemoProcessing />
}
