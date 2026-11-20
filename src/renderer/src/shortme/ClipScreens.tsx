import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { RatingBar, setHoveredClip, useListRatingKeys } from './RatingBar'
import { Pause, Play, Square, Trash2, Check, Loader2, AlertTriangle, LayoutGrid, List, Download, Wand2, ListChecks } from 'lucide-react'
import { FILTER_LABEL, clipRevision, matchesFilter, qualityOf, type QualityStatus, type ReviewFilter, type ReviewView } from '@shared/review'
import { QualityBadge, ReviewBadge } from './ReviewScreen'
import { useStore } from './store'
import { useProject } from './projectStore'
import { CLIPS, PROJECTS, type Clip } from './data'
import { useClipList } from './clipData'
import { ProjectGrid } from './ProjectGrid'
import { Button, Pill, Score } from './ui'
import { useSprings } from './motion'
import { EngineBadge, EngineBar } from './EngineSwitch'
import { V4ProvenancePanel } from './V4Provenance'
import { estimateStages, etaRange, fmtElapsed, fractionOf, measuredStep, remainingSec, ROW_OF, spans, totalSec } from '@shared/estimate'
import { getSpeed, saveSpeed } from './speed'

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

/** Gemessene Laufzeit je Stufe (Tooltip an „Laufzeit“). */
const STAGE_TIME_LABEL: Record<string, string> = { audio: 'Ton/Video vorbereiten', asr: 'Transkription', gaps: 'Transkription (Lücken)', speakers: 'Sprecher', finalize: 'Transkript abschließen', signals: 'Signale', shots: 'Kamerawechsel', topics: 'Themen (LLM)', llm: 'Themen (LLM)', candidates: 'Suche (alle Spuren)', rate: 'Nachuntersuchung (Bild+Ton)', snap: 'Schnitte prüfen', compare: 'Rendern und prüfen', proofread: 'Korrektur', layout: 'Bildausschnitt', thumbs: 'Vorschaubilder' }
const fmtDur = (s: number): string => (s >= 3600 ? `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min` : s >= 60 ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')} min` : `${Math.round(s)} s`)

/** Je Clip aus den echten Clipdaten: Quellzeit, KI-Prüfung (mit Befunden) und Nutzerfreigabe – drei getrennte Angaben. */
interface CardInfo { start: number; end: number; q: { status: QualityStatus; findings: string[]; stale: boolean }; view?: ReviewView }
const mmss = (s: number): string => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`

function ClipCard({ c, selected, onSelect, onOpen, pct, info }: { c: Clip; selected: boolean; onSelect: () => void; onOpen: () => void; pct: number; info?: CardInfo }): React.JSX.Element {
  const { base, reduced } = useSprings()
  const deleteClip = useProject((s) => s.deleteClip)
  const [hover, setHover] = useState(false)
  const [pop, setPop] = useState(false)
  const [prov, setProv] = useState(false)
  return (
    <>
    {prov && c.v4RunId && <V4ProvenancePanel runId={c.v4RunId} clipId={c.id} onClose={() => setProv(false)} />}
    <motion.div className="sm-card" style={{ position: 'relative', overflow: 'visible', contentVisibility: 'auto', containIntrinsicSize: '260px 520px', outline: selected ? '2px solid var(--accent)' : 'none', ...(c.pending ? { opacity: 0.45, pointerEvents: 'none', filter: 'grayscale(0.8)' } : {}) }} whileTap={reduced ? undefined : { scale: 0.97 }} transition={base} onHoverStart={() => { setHover(true); setHoveredClip(c.id) }} onHoverEnd={() => { setHover(false); setPop(false); setHoveredClip(null) }}>
      <div onClick={onOpen} style={{ aspectRatio: '9/16', borderRadius: 'var(--r-card) var(--r-card) 0 0', overflow: 'hidden', position: 'relative' }}>
        <div style={{ position: 'absolute', inset: 0, backgroundImage: `url(${c.thumb})`, backgroundSize: 'cover', transform: hover && !reduced ? 'scale(1.08)' : 'scale(1)', transition: 'transform 2.4s linear' }} />
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(0,0,0,0.3), transparent 30%, transparent 60%, rgba(0,0,0,0.7))' }} />
        {c.pending && <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', fontSize: 15, background: 'rgba(0,0,0,0.35)' }}>{pct}&nbsp;%</div>}
      </div>
      <button className="sm-score" style={{ position: 'absolute', top: 10, left: 10, border: 0 }} aria-label={`Score ${c.score}, Details`} onClick={(e) => { e.stopPropagation(); setPop(!pop) }}>{c.score}</button>
      <button aria-label="Auswählen" aria-pressed={selected} onClick={onSelect} style={{ position: 'absolute', top: 10, right: 10, width: 24, height: 24, borderRadius: '50%', border: '1.5px solid #fff', background: selected ? 'var(--accent)' : 'rgba(0,0,0,0.35)', display: 'grid', placeItems: 'center' }}>{selected && <Check size={14} />}</button>
      <div style={{ padding: '10px 12px 12px', display: 'grid', gap: 4 }}>
        <h3 style={{ fontSize: 14, lineHeight: 1.25 }}>{c.title}</h3>
        <small>{c.duration} s{info ? ` · Quelle ${mmss(info.start)}–${mmss(info.end)}` : ''}{c.v4RunId ? ` · ${c.v4Label ?? 'Engine 4'}` : c.notes ? ' · Neue Engine' : ''} {c.faceRatio < 0.6 && <span title={`Gesichtsquote ${Math.round(c.faceRatio * 100)} %`} style={{ color: 'var(--warn)', marginLeft: 6 }}><AlertTriangle size={12} style={{ verticalAlign: -2 }} /> wenig Gesicht</span>}</small>
        {info && !c.pending && <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}><QualityBadge status={info.q.status} stale={info.q.stale} /><ReviewBadge view={info.view} /></div>}
        {info?.q.findings[0] && <small style={{ color: 'var(--text-2)', fontSize: 11.5, lineHeight: 1.35 }} title={info.q.findings.join('\n')}>{info.q.findings[0]}</small>}
        {/* eigene Zeile (vorher absolut über Titel/Dauer gelegt → überlappte) */}
        <div style={{ display: 'flex', gap: 4, alignItems: 'flex-start', justifyContent: 'flex-end', marginTop: 2 }}><RatingBar clipId={c.id} chips="popover" /><button aria-label="Clip löschen" title="Clip löschen" onClick={(e) => { e.stopPropagation(); void deleteClip(c.id) }} style={{ width: 28, height: 28, borderRadius: 14, border: '1px solid var(--edge)', background: 'rgba(0,0,0,0.35)', color: '#fff', display: 'grid', placeItems: 'center', cursor: 'pointer' }}><Trash2 size={14} /></button></div>
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
            {c.notes?.map((n, i) => <small key={i} style={{ color: 'var(--text-2)' }}>{n}</small>)}
            <small style={{ color: 'var(--text-1)' }}>{c.reason}</small>
            {c.v4RunId && <Button variant="secondary" onClick={(e) => { e.stopPropagation(); setProv(true); setPop(false) }}>Herkunft (Engine 4)</Button>}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
    </>
  )
}

export function ClipsScreen(): React.JSX.Element {
  useListRatingKeys()
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
  const sorted = [...list].sort((a, b) => Number(!!a.pending) - Number(!!b.pending) || b.score - a.score)
  const job = useProject((s) => s.job)
  const pending = list.filter((c) => c.pending).length
  const pct = job && job.stage === 'layout' ? Math.round(job.progress * 100) : 0
  const timing = useProject((s) => s.clipsFile?.timing)
  const realClips = useProject((s) => s.clipsFile?.clips)
  const review = useProject((s) => s.review)
  const go = useStore((s) => s.go)
  const [filter, setFilter] = useState<ReviewFilter>('alle')
  const infos = new Map<string, CardInfo>((realClips ?? []).map((rc) => { const v = review[rc.id]; return [rc.id, { start: rc.start, end: rc.end, view: v, q: qualityOf(rc, !!v?.revision && v.revision !== clipRevision(rc, null)) }] }))
  const shown = sorted.filter((c) => { const i = infos.get(c.id); return !i || matchesFilter(i.view ?? { status: 'offen' }, i.q.status, filter) })
  const approved = (realClips ?? []).filter((rc) => review[rc.id]?.status === 'freigegeben').map((rc) => rc.id)
  const FILTERS: ReviewFilter[] = ['alle', 'offen', 'ki_pruefen', 'freigegeben', 'verworfen']
  return (
    <div style={{ display: 'grid', gap: 18, paddingTop: 12, paddingBottom: 90 }}>
      <div style={{ display: 'flex', alignItems: 'end', justifyContent: 'space-between', gap: 16 }}>
        <div><h1>{title ?? PROJECTS[0].name}</h1><small>{pending ? `${list.length - pending} von ${list.length} fertig · Analyse läuft` : `${list.length} Clips · nach Score sortiert`}
          {!pending && timing && <span title={timing.stages.map((s) => `${STAGE_TIME_LABEL[s.stage] ?? s.stage}: ${fmtDur(s.sec)}`).join('\n')}> · Laufzeit {fmtDur(timing.totalSec)}</span>}</small></div>
        <div style={{ display: 'grid', gap: 8, justifyItems: 'end' }}>
          <EngineBar />
          <div style={{ display: 'flex', gap: 8 }}>
            {persons && persons.persons.length > 0 && <Pill onClick={openPersons}>Wer ist wer?{persons.needsReview ? ' ·  prüfen' : ''}</Pill>}
            {realClips && realClips.length > 0 && <Button variant="primary" onClick={() => go('review')} title="Clips nacheinander ansehen und freigeben (Tasten 1/2/3, N/P)"><ListChecks size={15} /> Review starten</Button>}
            {approved.length > 0 && <Button variant="secondary" disabled={exportJob?.state === 'running'} onClick={() => void exportClips(approved, presetId, false)} title="Nur freigegebene Clips exportieren"><Download size={15} /> Freigegebene exportieren ({approved.length})</Button>}
            <Pill pressed={view === 'grid'} onClick={() => setView('grid')}><LayoutGrid size={14} /> Raster</Pill>
            <Pill pressed={view === 'list'} onClick={() => setView('list')}><List size={14} /> Liste</Pill>
          </div>
        </div>
      </div>
      {realClips && realClips.length > 0 && (
        <div role="group" aria-label="Filter" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {FILTERS.map((f) => { const n = sorted.filter((c) => { const i = infos.get(c.id); return !i || matchesFilter(i.view ?? { status: 'offen' }, i.q.status, f) }).length; return <Pill key={f} pressed={filter === f} onClick={() => setFilter(f)}>{FILTER_LABEL[f]} ({n})</Pill> })}
        </div>
      )}
      {view === 'grid' ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 16 }}>
          {shown.map((c) => <ClipCard key={c.id} c={c} selected={selected.includes(c.id)} onSelect={() => toggle(c.id)} onOpen={() => !c.pending && openClip(c.id)} pct={pct} info={infos.get(c.id)} />)}
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 8 }}>
          {shown.map((c) => (
            <motion.div key={c.id} className="sm-card" whileTap={{ scale: 0.99 }} transition={base} onClick={() => !c.pending && openClip(c.id)} style={{ ...(c.pending ? { opacity: 0.45, pointerEvents: 'none' as const } : {}), display: 'grid', gridTemplateColumns: '24px 54px 1fr auto auto', alignItems: 'center', gap: 14, padding: 10 }}>
              <input type="checkbox" checked={selected.includes(c.id)} onClick={(e) => e.stopPropagation()} onChange={() => toggle(c.id)} aria-label="Auswählen" />
              <div style={{ width: 54, aspectRatio: '9/16', borderRadius: 8, backgroundImage: `url(${c.thumb})`, backgroundSize: 'cover' }} />
              <div style={{ display: 'grid', gap: 4 }}><h3>{c.title}</h3><small>{c.reason}</small>{infos.get(c.id) && !c.pending && <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}><QualityBadge status={infos.get(c.id)!.q.status} stale={infos.get(c.id)!.q.stale} /><ReviewBadge view={infos.get(c.id)!.view} /><small style={{ color: 'var(--text-2)' }}>Quelle {mmss(infos.get(c.id)!.start)}–{mmss(infos.get(c.id)!.end)}</small></div>}</div>
              <small>{c.duration} s</small>
              <Score v={c.score} />
            </motion.div>
          ))}
        </div>
      )}
      <AnimatePresence>
        {selected.length > 0 && (
          <motion.div initial={{ y: 80, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 80, opacity: 0 }} transition={base} className="sm-glass" style={{ position: 'fixed', bottom: 20, left: '50%', translate: '-50% 0', padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10, borderRadius: 999, zIndex: 30, background: 'rgba(24,24,32,0.9)' }}>
            <small style={{ color: 'var(--text-1)', paddingLeft: 8, maxWidth: 420, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={exportJob?.state === 'done' ? exportJob.message : undefined}>{exportJob?.state === 'done' && exportJob.message.includes('exportiert nach') ? exportJob.message : `${selected.length} ausgewählt`}</small>
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
    <div className="sm-wrap" style={{ display: 'grid', gap: 18, paddingTop: 12 }}>
      <ProjectGrid selectable title="Projekte" />
    </div>
  )
}

const ROWS = ['Transkribieren', 'Analysieren', 'Clips finden']
// shortcut: Restzeit der Engine Mac steckt als Text in der Jobmeldung („ · noch ca. 1 Std 5 Min“); als eigenes Jobfeld führen, wenn weitere Engines sie liefern
const ETA_RE = / · noch (?:ca\. (?:(\d+) Std )?(\d+) Min|unter 1 Min)$/
function engineEtaOf(msg: string | undefined): number | null {
  const m = msg ? ETA_RE.exec(msg) : null
  if (!m) return null
  return m[2] === undefined ? 30 : (Number(m[1] ?? 0) * 60 + Number(m[2])) * 60
}
const ROW_OF_STAGE = (stage: string | undefined): number => (stage && stage in ROW_OF ? ROW_OF[stage as keyof typeof ROW_OF] : -1)
/** Start und letzter Stand je Job (außerhalb von React, damit Neuzeichnen nichts zurücksetzt). */
const runs = new Map<string, { at: number; f0: number; last: number; saved: boolean }>()

function trackRun(id: string, total: number, done: boolean, refSec: number): void {
  const r = runs.get(id) ?? { at: Date.now(), f0: total, last: total, saved: false }
  r.last = Math.max(r.last, total)
  // ganzer Lauf von Anfang an gemessen → Tempo dieses Rechners merken (nächste Schätzung)
  if (done && !r.saved && r.f0 < 0.05 && refSec > 0) { r.saved = true; saveSpeed((Date.now() - r.at) / 1000 / refSec) }
  runs.set(id, r)
}

/** Echte Verarbeitung (M3/M4): Balken zeitgewichtet nach der Schätzung (shared/estimate.ts), dazu die Restzeit. */
function RealProcessing(): React.JSX.Element {
  const job = useProject((s) => s.job)!
  const engineSel = useProject((s) => (s.engine.hash === s.job?.hash ? s.engine.state?.selected : undefined))
  const loadEngine = useProject((s) => s.loadEngine)
  const pause = useProject((s) => s.pause)
  const resume = useProject((s) => s.resume)
  const stop = useProject((s) => s.stop)
  const discard = useProject((s) => s.discard)
  const imported = useProject((s) => s.imported)
  const projects = useProject((s) => s.projects)
  const count = useStore((s) => s.opts.count)
  const go = useStore((s) => s.go)
  // Engine-Kennzeichen immer frisch für DIESEN Job holen (der Hauptprozess legt die Wahl vor dem Jobstart fest)
  useEffect(() => { void loadEngine(job.hash) }, [job.id, job.hash, loadEngine])
  const dur = imported?.meta.hash === job.hash ? imported.meta.durationSec : projects.find((p) => p.hash === job.hash)?.durationSec ?? 3600
  const wanted = count && count !== 'Auto' ? Number(count) : undefined
  const est = estimateStages(dur, wanted, 1, engineSel ?? 'legacy')
  const sp = spans(est)
  const run = runs.get(job.id)
  const f = fractionOf(job.stage, job.progress, sp.stage)
  const total = job.state === 'done' ? 1 : f ?? run?.last ?? 0
  const [now, setNow] = useState(0)
  useEffect(() => { const tick = (): void => setNow(Date.now()); tick(); const i = setInterval(tick, 5000); return () => clearInterval(i) }, [])
  const refSec = totalSec(est)
  useEffect(() => trackRun(job.id, total, job.state === 'done', engineSel && engineSel !== 'legacy' ? 0 : refSec), [job.id, job.state, total, refSec])
  const eta0 = remainingSec(est, total, run?.f0 ?? total, run ? (now - run.at) / 1000 : 0, engineSel && engineSel !== 'legacy' ? 1 : getSpeed())
  // Engine Mac rechnet ihre Restzeit selbst aus gemessenen Aufgaben (Ledger) und hängt sie an die Meldung: während „Clips finden“ gilt diese, plus Rest (Bildausschnitt)
  const engineEta = engineEtaOf(job.message)
  const eta = engineEta !== null && ROW_OF_STAGE(job.stage) === 2 ? engineEta + est.layout : eta0
  const message = engineEta !== null ? job.message.replace(ETA_RE, '') : job.message
  const busy = job.state === 'running' || job.state === 'queued'
  // nur Clips, die DIESER Lauf gerade veröffentlicht (noch mit ausstehendem Bildausschnitt) – nicht die Anzeige eines früheren Laufs
  const provisional = useProject((s) => (s.clipsFile?.hash === job.hash && s.clipsFile.clips.some((c) => c.pending) ? s.clipsFile.clips.length : 0))
  const projDur = dur
  const title = job.state === 'done' ? 'Clips gefunden' : job.state === 'paused' ? 'Pausiert' : job.state === 'stopped' ? 'Gestoppt' : job.state === 'error' ? 'Fehler' : job.state === 'queued' ? 'Wartet …' : 'Clips werden erstellt …'
  return (
    <div className="sm-wrap" style={{ display: 'grid', gap: 24, paddingTop: 12 }}>
      <div><h1>{title}</h1>{engineSel && <div style={{ margin: '6px 0' }}><EngineBadge engine={engineSel} prefix="Engine: " /></div>}<small>{job.title}{projDur ? ` · ${fmtElapsed(projDur)} Video` : ''}</small>
        {busy && <small style={{ display: 'block', marginTop: 4, fontVariantNumeric: 'tabular-nums' }}>{job.startedAt ? `Läuft seit ${fmtElapsed((now - job.startedAt) / 1000)} · ` : ''}Restzeit {total < 0.05 && engineEta === null ? 'wird ermittelt' : etaRange(eta)}</small>}</div>
      <div className="sm-glass" style={{ padding: 22, display: 'grid', gap: 18 }}>
        {ROWS.map((label, i) => {
          // Phase aus der echten Stufe des Jobs (nicht aus der Zeitschätzung): erledigt / läuft / ausstehend
          const row = ROW_OF_STAGE(job.stage)
          const done = job.state === 'done' || (row >= 0 && i < row)
          const active = !done && i === row
          const step = active ? measuredStep(message) : null
          return (
            <div key={label} style={{ display: 'grid', gridTemplateColumns: '28px 170px 1fr auto', alignItems: 'center', gap: 12, opacity: done || active ? 1 : 0.5 }}>
              {done ? <Check size={18} aria-label="erledigt" /> : active && busy ? <Loader2 size={18} className="sm-spin" aria-label="läuft" /> : <span aria-label="ausstehend" style={{ width: 10, height: 10, borderRadius: 5, border: '1.5px solid var(--text-3)', justifySelf: 'center' }} />}
              <span>{label}</span>
              {step ? <div className="sm-bar" title="gemessener Teilschritt"><i style={{ width: `${(step.done / step.total) * 100}%` }} /></div> : <small style={{ color: 'var(--text-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{active ? message.replace(/\s*…$/, '') : ''}</small>}
              <small style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{done ? 'erledigt' : step ? `${step.done} von ${step.total}` : active ? 'läuft' : 'ausstehend'}</small>
            </div>
          )
        })}
        {/* Zwischenstände – nur aus echten Daten: Transkript fertig, von der Analyse schon veröffentlichte (vorläufige) Clips */}
        {(ROW_OF_STAGE(job.stage) > 0 || job.state === 'done' || provisional > 0) && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            {(ROW_OF_STAGE(job.stage) > 0 || job.state === 'done') && <span className="sm-badge"><Check size={12} aria-hidden /> Transkript bereit</span>}
            {provisional > 0 && job.state !== 'done' && <Button variant="secondary" onClick={() => go('clips')} title="Die Clips stehen fest, der Bildausschnitt wird noch berechnet">{provisional} Clips vorläufig ansehen</Button>}
          </div>
        )}
        {job.error && <small style={{ color: 'var(--warn)' }}>{job.error}</small>}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          {job.state === 'running' && <Button variant="secondary" onClick={() => void pause()}><Pause size={15} /> Pausieren</Button>}
          {['paused', 'stopped', 'error'].includes(job.state) && <Button variant="secondary" onClick={() => void resume()}><Play size={15} /> Fortsetzen</Button>}
          {busy && <Button variant="secondary" onClick={() => void stop()} title="Lauf beenden; bereits fertige Ergebnisse bleiben im Projekt"><Square size={14} /> Beenden, Ergebnisse behalten</Button>}
          <Button variant="secondary" onClick={() => { if (window.confirm('Lauf abbrechen und alle Ergebnisse dieses Projekts verwerfen?')) { void discard(); go('start') } }} title="Abbrechen und Ergebnisse verwerfen"><Trash2 size={15} /> Verwerfen</Button>
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
