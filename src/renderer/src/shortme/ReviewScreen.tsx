// Review-Modus (UX-Upgrade): Vorschläge schnell nacheinander ansehen und entscheiden, ohne für jeden Clip den Editor zu öffnen.
// Datenquelle bleibt die Clipliste des angezeigten Laufs (clipsFile) – keine zweite Quelle. Entscheidungen: review.json (Hauptprozess).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, Check, ChevronLeft, ChevronRight, CircleHelp, Pause, Pencil, Play, ShieldAlert, ShieldCheck, ShieldQuestion, Timer, X } from 'lucide-react'
import type { PreviewPlan, ShortmeClip } from '@shared/shortme'
import { FILTER_LABEL, QUALITY_LABEL, REVIEW_LABEL, clipRevision, matchesFilter, nextOpenIndex, qualityOf, type QualityStatus, type ReviewFilter, type ReviewStatus, type ReviewView } from '@shared/review'
import { drawLayout } from '@shared/previewDraw'
import { useProject } from './projectStore'
import { useStore } from './store'
import { useClipList } from './clipData'
import { RatingBar } from './RatingBar'
import { Button, Segmented } from './ui'

const W = 540, H = 960
const mmss = (s: number): string => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.floor(Math.max(0, s) % 60)).padStart(2, '0')}`
const FILTERS: ReviewFilter[] = ['alle', 'offen', 'ki_pruefen', 'freigegeben', 'verworfen']
const memKey = (hash: string): string => `sm.review.${hash}`
const loadMem = (hash: string): { filter: ReviewFilter; clipId: string | null } => { try { const v = JSON.parse(localStorage.getItem(memKey(hash)) ?? 'null') as { filter?: ReviewFilter; clipId?: string } | null; return { filter: FILTERS.includes(v?.filter as ReviewFilter) ? (v!.filter as ReviewFilter) : 'alle', clipId: v?.clipId ?? null } } catch { return { filter: 'alle', clipId: null } } }
export const saveMem = (hash: string, v: { filter: ReviewFilter; clipId: string | null }): void => { try { localStorage.setItem(memKey(hash), JSON.stringify(v)) } catch { /* nur Komfort */ } }

/** KI-Prüfung als Text + Icon (nie nur Farbe). */
export function QualityBadge({ status, stale }: { status: QualityStatus; stale?: boolean }): React.JSX.Element {
  const Icon = status === 'bestanden' ? ShieldCheck : status === 'fehlgeschlagen' ? ShieldAlert : status === 'ausstehend' ? Timer : status === 'bitte_pruefen' ? ShieldQuestion : CircleHelp
  const color = status === 'bestanden' ? 'var(--ok)' : status === 'bitte_pruefen' || status === 'fehlgeschlagen' ? 'var(--warn)' : 'var(--text-2)'
  return <span className="sm-badge" title={stale ? 'Die KI-Prüfung gilt für die Fassung vor deinen Änderungen' : undefined} style={{ color }}><Icon size={13} aria-hidden /> {QUALITY_LABEL[status]}{stale ? ' (vor Bearbeitung)' : ''}</span>
}

/** Nutzerfreigabe als Text + Icon; deutlich anders gestaltet als der KI-Status (gefüllte Pille statt Umriss). */
export function ReviewBadge({ view }: { view?: ReviewView }): React.JSX.Element {
  const s: ReviewStatus = view?.status ?? 'offen'
  const Icon = s === 'freigegeben' ? Check : s === 'verworfen' ? X : s === 'zur_pruefung' ? ShieldQuestion : CircleHelp
  return <span className={`sm-review sm-review-${s}`}><Icon size={13} aria-hidden /> {REVIEW_LABEL[s]}{view?.changedSinceApproval ? ' · seit Freigabe verändert' : ''}</span>
}

/** Ein Clip, abgespielt wie im Export (gleicher Plan und gleiche Geometrie wie der Editor); Pausenschnitte werden übersprungen. Ohne Untertitel-Ebene. */
export function ReviewPlayer({ hash, clip, srcPath, playing, onPlaying, height = 'min(72vh, 860px)' }: { hash: string; clip: ShortmeClip; srcPath: string | null; playing: boolean; onPlaying: (p: boolean) => void; height?: string }): React.JSX.Element {
  const [plan, setPlan] = useState<PreviewPlan | null>(null)
  const [t, setT] = useState(0)
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const planRef = useRef<PreviewPlan | null>(null)
  useEffect(() => { planRef.current = plan }, [plan])
  // Player ist je Clip neu (key): Plan beginnt leer
  useEffect(() => {
    let alive = true
    void window.cutawan.shortme.editsLoad(hash, clip.id).then((log) => window.cutawan.shortme.previewPlan(hash, clip.id, log)).then((p) => { if (alive) setPlan(p) }).catch(() => undefined)
    return () => { alive = false }
  }, [hash, clip.id])
  const draw = useCallback((at?: number): void => {
    const v = videoRef.current, c = canvasRef.current, p = planRef.current
    if (!v || !c || !v.videoWidth || !p) return
    const ctx = c.getContext('2d')
    if (!ctx) return
    const abs = at ?? v.currentTime
    const piece = p.pieces.find((x) => abs >= x.src0 && abs < x.src1) ?? [...p.pieces].reverse().find((x) => x.src1 <= abs) ?? p.pieces[0]
    drawLayout(ctx, v, { width: v.videoWidth, height: v.videoHeight }, piece?.shot ?? { layout: 'fixed', cx: 0.5 }, piece?.zoom ?? 1, W, H)
  }, [])
  // neuer Clip/Plan: an den Anfang
  useEffect(() => {
    const v = videoRef.current
    if (!v || !plan) return
    const go = (): void => { v.currentTime = plan.start; setT(0) }
    if (v.readyState >= 1) go(); else v.addEventListener('loadedmetadata', go, { once: true })
  }, [plan])
  useEffect(() => {
    const v = videoRef.current
    if (!v || !plan) return
    if (playing) { if (v.currentTime >= plan.end - 0.05 || v.currentTime < plan.start) v.currentTime = plan.start; void v.play().catch(() => onPlaying(false)) } else v.pause()
  }, [playing, plan, onPlaying])
  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    let raf = 0, vfc = 0
    const onFrame = (_n: number, meta: { mediaTime: number }): void => { draw(meta.mediaTime); vfc = v.requestVideoFrameCallback(onFrame) }
    vfc = v.requestVideoFrameCallback(onFrame)
    const tick = (): void => {
      const p = planRef.current
      if (p) {
        const abs = v.currentTime
        if (!v.paused) {
          const cut = p.cuts.find((c) => abs >= c[0] - 0.01 && abs < c[1] - 0.03)
          if (cut) v.currentTime = cut[1]
          if (abs >= p.end - 0.03) { v.pause(); onPlaying(false) }
        } else draw()
        setT(Math.max(0, abs - p.start))
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => { cancelAnimationFrame(raf); v.cancelVideoFrameCallback(vfc) }
  }, [draw, onPlaying])
  const total = plan ? plan.end - plan.start : clip.end - clip.start
  return (
    <div style={{ display: 'grid', gap: 8, justifyItems: 'center', minHeight: 0 }}>
      <div style={{ position: 'relative', height, aspectRatio: '9 / 16', borderRadius: 18, overflow: 'hidden', background: '#000', boxShadow: '0 20px 60px rgba(0,0,0,0.45)' }}>
        {srcPath ? <video ref={videoRef} src={window.cutawan.mediaUrl(srcPath)} preload="auto" playsInline style={{ display: 'none' }} /> : null}
        <canvas ref={canvasRef} width={W} height={H} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} aria-label={`Vorschau: ${clip.title}`} />
        {!srcPath && <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', padding: 24, textAlign: 'center', color: 'var(--text-2)' }}>Quellvideo nicht verfügbar – Vorschau nicht möglich.</div>}
        {srcPath && !plan && <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: 'var(--text-2)' }}>Lädt …</div>}
      </div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', width: 'min(100%, 480px)' }}>
        <Button variant="primary" aria-label={playing ? 'Pause (Leertaste)' : 'Abspielen (Leertaste)'} onClick={() => onPlaying(!playing)} style={{ width: 44, padding: 0 }}>{playing ? <Pause size={16} /> : <Play size={16} />}</Button>
        <div className="sm-bar" style={{ flex: 1, height: 4 }} aria-hidden><i style={{ width: `${Math.min(100, (t / Math.max(0.1, total)) * 100)}%` }} /></div>
        <small style={{ fontVariantNumeric: 'tabular-nums' }}>{mmss(t)} / {mmss(total)}</small>
      </div>
    </div>
  )
}

export function ReviewScreen(): React.JSX.Element {
  const file = useProject((s) => s.clipsFile)
  const review = useProject((s) => s.review)
  const setReview = useProject((s) => s.setReview)
  const go = useStore((s) => s.go)
  const openClip = useStore((s) => s.openClip)
  const setReturnTo = useStore((s) => s.setReturnTo)
  const ui = useClipList()
  const hash = file?.hash ?? ''
  const mem = useMemo(() => loadMem(hash), [hash])
  const [filter, setFilter] = useState<ReviewFilter>(mem.filter)
  // aus dem Editor zurück: dort zuletzt bearbeiteter Clip; sonst der gemerkte
  const [activeId, setActiveId] = useState<string | null>(() => { const a = useStore.getState().activeClip; return useStore.getState().returnTo === 'review' && (file?.clips ?? []).some((c) => c.id === a) ? a : mem.clipId })
  /** Abspielen gehört zum Clip: ein Wechsel stoppt von selbst. */
  const [playingId, setPlayingId] = useState<string | null>(null)
  /** Clips, die durch eine eigene Entscheidung aus dem Filter fallen würden, bleiben bis zum Filterwechsel sichtbar. */
  const [keep, setKeep] = useState<Set<string>>(new Set())
  const clips = useMemo(() => (file?.clips ?? []).filter((c) => !c.pending), [file])
  const rows = useMemo(() => clips.map((c) => {
    const v = review[c.id]
    // bearbeitet = aktueller Stand ≠ unbearbeiteter Clip → KI-Befund gilt für die ältere Fassung
    const edited = !!v?.revision && v.revision !== clipRevision(c, null)
    return { clip: c, view: v, q: qualityOf(c, edited), thumb: ui.find((u) => u.id === c.id)?.thumb ?? '' }
  }), [clips, review, ui])
  const list = useMemo(() => rows.filter((r) => keep.has(r.clip.id) || matchesFilter(r.view ?? { status: 'offen' }, r.q.status, filter)), [rows, filter, keep])
  const idx = Math.max(0, list.findIndex((r) => r.clip.id === activeId))
  const cur = list[idx] ?? null
  useEffect(() => { if (hash) saveMem(hash, { filter, clipId: cur?.clip.id ?? null }) }, [hash, filter, cur])
  const playing = !!cur && playingId === cur.clip.id
  const curId = cur?.clip.id ?? null
  const setPlaying = useCallback((p: boolean | ((x: boolean) => boolean)): void => setPlayingId((old) => { const now = old === curId; const next = typeof p === 'function' ? p(now) : p; return next ? curId : null }), [curId])

  const move = useCallback((d: number): void => { if (list.length) setActiveId(list[(idx + d + list.length) % list.length].clip.id) }, [list, idx])
  const decideNow = useCallback((status: ReviewStatus): void => {
    if (!cur) return
    void setReview(cur.clip.id, status)
    setKeep((k) => new Set(k).add(cur.clip.id))
    // danach zum nächsten offenen Vorschlag (in der aktuellen Liste); sonst stehen bleiben
    const statuses = list.map((r) => (r.clip.id === cur.clip.id ? status : (r.view?.status ?? 'offen')))
    const n = nextOpenIndex(statuses, idx)
    if (n !== null) setActiveId(list[n].clip.id)
  }, [cur, list, idx, setReview])
  const edit = useCallback((): void => { if (!cur) return; setReturnTo('review'); openClip(cur.clip.id) }, [cur, openClip, setReturnTo])

  useEffect(() => {
    const k = (e: KeyboardEvent): void => {
      const el = e.target as HTMLElement
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable || e.ctrlKey || e.metaKey || e.altKey) return
      const key = e.key.toLowerCase()
      if (key === ' ') { e.preventDefault(); setPlaying((p) => !p) }
      else if (key === 'n' || e.key === 'ArrowDown' || e.key === 'ArrowRight') { e.preventDefault(); move(1) }
      else if (key === 'p' || e.key === 'ArrowUp' || e.key === 'ArrowLeft') { e.preventDefault(); move(-1) }
      else if (key === 'e') { e.preventDefault(); edit() }
      else if (key === '1') { e.preventDefault(); decideNow('freigegeben') }
      else if (key === '2') { e.preventDefault(); decideNow('zur_pruefung') }
      else if (key === '3') { e.preventDefault(); decideNow('verworfen') }
    }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [move, edit, decideNow])

  const counts = useMemo(() => Object.fromEntries(FILTERS.map((f) => [f, rows.filter((r) => matchesFilter(r.view ?? { status: 'offen' }, r.q.status, f)).length])) as Record<ReviewFilter, number>, [rows])
  if (!file) return <div className="sm-wrap" style={{ paddingTop: 12 }}><small>Kein Projekt geöffnet.</small></div>
  const c = cur?.clip
  const src = file.source?.path ?? null

  return (
    <div className="sm-wrap" style={{ display: 'grid', gap: 14, paddingTop: 8, gridTemplateRows: 'auto auto 1fr auto', minHeight: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <Button variant="ghost" aria-label="Zurück zur Clipliste" onClick={() => go('clips')}><ArrowLeft size={16} /></Button>
        <h1 style={{ fontSize: 26 }}>Review</h1>
        <small style={{ color: 'var(--text-2)' }}>{counts.freigegeben} freigegeben · {counts.offen} offen · {counts.verworfen} verworfen</small>
        <div style={{ flex: 1 }} />
        <Segmented options={FILTERS.map((f) => `${FILTER_LABEL[f]} (${counts[f]})`)} value={`${FILTER_LABEL[filter]} (${counts[filter]})`} onChange={(v) => { const f = FILTERS.find((x) => v.startsWith(FILTER_LABEL[x])) ?? 'alle'; setFilter(f); setKeep(new Set()) }} />
      </div>

      {!c ? <div className="sm-glass" style={{ padding: 24 }}><small>Keine Clips in diesem Filter.</small></div> : (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, auto) minmax(300px, 420px)', gap: 20, alignItems: 'start', justifyContent: 'center', minHeight: 0 }}>
          <ReviewPlayer key={c.id} hash={hash} clip={c} srcPath={src} playing={playing} onPlaying={setPlaying} />
          <div className="sm-glass" style={{ padding: 18, display: 'grid', gap: 12, alignContent: 'start' }}>
            <small style={{ color: 'var(--text-2)' }}>Clip {idx + 1} von {list.length}</small>
            <h2 style={{ fontSize: 20, lineHeight: 1.25 }}>{c.title}</h2>
            <small style={{ fontVariantNumeric: 'tabular-nums' }}>Länge {Math.round(c.end - c.start)} s · Quelle {mmss(c.start)}–{mmss(c.end)}{typeof c.score === 'number' ? ` · Score ${c.score}` : ''}</small>
            {c.reason && <small style={{ color: 'var(--text-1)' }} title="Begründung der Auswahl – keine Qualitätsgarantie">{c.reason}</small>}
            <div style={{ display: 'grid', gap: 6, justifyItems: 'start' }}>
              <QualityBadge status={cur!.q.status} stale={cur!.q.stale} />
              {cur!.q.findings.map((f, i) => <small key={i} style={{ color: 'var(--text-2)' }}>• {f}</small>)}
            </div>
            <div style={{ display: 'grid', gap: 6 }}>
              <small style={{ color: 'var(--text-2)' }}>Deine Entscheidung</small>
              <div><ReviewBadge view={cur!.view} /></div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                <Button variant={cur!.view?.status === 'freigegeben' ? 'primary' : 'secondary'} onClick={() => decideNow('freigegeben')} title="Taste 1"><Check size={14} /> Freigeben <kbd>1</kbd></Button>
                <Button variant={cur!.view?.status === 'zur_pruefung' ? 'primary' : 'secondary'} onClick={() => decideNow('zur_pruefung')} title="Taste 2"><ShieldQuestion size={14} /> Prüfen <kbd>2</kbd></Button>
                <Button variant={cur!.view?.status === 'verworfen' ? 'primary' : 'secondary'} onClick={() => decideNow('verworfen')} title="Taste 3 – verwerfen löscht nichts"><X size={14} /> Verwerfen <kbd>3</kbd></Button>
              </div>
            </div>
            <div style={{ display: 'grid', gap: 6 }}>
              <small style={{ color: 'var(--text-2)' }}>Lernbewertung (unabhängig von der Freigabe)</small>
              <RatingBar clipId={c.id} chips="dropdown" />
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <Button variant="secondary" onClick={() => move(-1)} title="Taste P"><ChevronLeft size={14} /> Zurück <kbd>P</kbd></Button>
              <Button variant="secondary" onClick={() => move(1)} title="Taste N">Weiter <kbd>N</kbd> <ChevronRight size={14} /></Button>
              <Button variant="secondary" onClick={edit} title="Taste E"><Pencil size={14} /> Im Editor <kbd>E</kbd></Button>
            </div>
            <small style={{ color: 'var(--text-3)' }}>Leertaste Abspielen · N/P Wechseln · 1/2/3 Entscheiden · E Editor</small>
          </div>
        </div>
      )}

      <div role="listbox" aria-label="Clips im Review" style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 6 }}>
        {list.map((r) => (
          <button key={r.clip.id} role="option" aria-selected={r.clip.id === c?.id} onClick={() => setActiveId(r.clip.id)} title={`${r.clip.title} · ${REVIEW_LABEL[r.view?.status ?? 'offen']} · ${QUALITY_LABEL[r.q.status]}`}
            className="sm-review-thumb" style={{ outline: r.clip.id === c?.id ? '2px solid var(--accent)' : undefined }}>
            {r.thumb ? <img src={r.thumb} alt="" /> : <span />}
            <span className={`sm-review-dot sm-review-${r.view?.status ?? 'offen'}`} aria-hidden>{r.view?.status === 'freigegeben' ? <Check size={11} /> : r.view?.status === 'verworfen' ? <X size={11} /> : null}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
