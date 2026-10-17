import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'motion/react'
import { ArrowLeft, Play, Pause, Undo2, Redo2, Scissors, Rewind, Check, Wand2, SkipBack, SkipForward, Volume2, VolumeX } from 'lucide-react'
import { baseState, canRedo, canUndo, emptyLog, push, redo as redoLog, sanitizeLog, stateOf, undo as undoLog, type CaptionPatch, type EditLog, type Op } from '@shared/edits'
import type { PreviewPlan, ShortmeShot } from '@shared/shortme'
import { PRESETS, captionCss, scopeCss } from '@shared/captions'
import { useStore } from './store'
import { IMG, TRANSCRIPT } from './data'
import { useClipList } from './clipData'
import { useProject } from './projectStore'
import { Button, Pill, Segmented, Slider, Switch, Row } from './ui'
import { useSprings } from './motion'
import { drawLayout, sourceRects } from '@shared/previewDraw'

const ZONES: Record<string, { top: number; bottom: number; right: number }> = { TikTok: { top: 0.12, bottom: 0.2, right: 0.14 }, Reels: { top: 0.1, bottom: 0.18, right: 0.1 }, Shorts: { top: 0.1, bottom: 0.22, right: 0.12 } }
const LAYOUTS: Record<string, ShortmeShot['layout']> = { Smart: 'smart', 'Ganzes Bild': 'fit', Split: 'split', Fest: 'fixed' }
const LAYOUT_LABEL: Record<ShortmeShot['layout'], string> = { smart: 'Smart', fit: 'Ganzes Bild', split: 'Split', fixed: 'Fest' }
const LAYOUT_COLOR: Record<ShortmeShot['layout'], string> = { smart: 'rgba(255,255,255,0.55)', fit: 'rgba(255,255,255,0.32)', split: 'rgba(255,255,255,0.62)', fixed: 'rgba(255,255,255,0.18)' }
const CANVAS_W = 540
const CANVAS_H = 960
const fmt = (s: number): string => `${Math.floor(Math.max(0, s) / 60)}:${(Math.max(0, s) % 60).toFixed(1).padStart(4, '0')}`

export function EditorScreen(): React.JSX.Element {
  const clipId = useStore((s) => s.activeClip)
  const list = useClipList()
  const clip = list.find((c) => c.id === clipId) ?? list[0]
  const real = useProject((s) => s.clipsFile?.clips.find((c) => c.id === clipId))
  const hash = useProject((s) => s.clipsFile?.hash)
  const source = useProject((s) => s.clipsFile?.source)
  const allReal = useProject((s) => s.clipsFile?.clips)
  const transcript = useProject((s) => s.transcript)
  const hasApi = useProject((s) => s.hasApi)
  const exportClips = useProject((s) => s.exportClips)
  const exportJob = useProject((s) => s.exportJob)
  const go = useStore((s) => s.go)
  const { base } = useSprings()

  // ---------- Nicht-destruktive Bearbeitung: Operationslog, Autosave ----------
  const origStart = real?.start ?? 0
  const D = real ? real.end - real.start : clip.duration
  const baseSt = useMemo(() => baseState({ start: origStart, end: real?.end ?? clip.duration, hookText: clip.hook }, useStore.getState().presetId), [origStart, real?.end, clip.duration, clip.hook])
  const [log, setLog] = useState<EditLog>(emptyLog(clipId))
  const [loaded, setLoaded] = useState(false)
  const [saved, setSaved] = useState(true)
  const st = useMemo(() => stateOf(baseSt, log), [baseSt, log])
  const logRef = useRef(log)
  logRef.current = log

  useEffect(() => {
    let alive = true
    setLoaded(false)
    const done = (l: EditLog): void => { if (alive) { setLog(l); setLoaded(true) } }
    if (hasApi && hash) void window.cutawan.shortme.editsLoad(hash, clipId).then(done).catch(() => done(emptyLog(clipId)))
    else { try { done(sanitizeLog(JSON.parse(localStorage.getItem(`sm.log.${clipId}`) ?? 'null'), clipId)) } catch { done(emptyLog(clipId)) } }
    return () => { alive = false }
  }, [clipId, hash, hasApi])

  const persist = useCallback(async (l: EditLog): Promise<void> => {
    if (hasApi && hash) await window.cutawan.shortme.editsSave(hash, l)
    else { try { localStorage.setItem(`sm.log.${l.clipId}`, JSON.stringify(l)) } catch { /* ignore */ } }
  }, [hasApi, hash])
  useEffect(() => {
    if (!loaded) return
    setSaved(false)
    const id = setTimeout(() => { void persist(log).then(() => setSaved(true)) }, 400)
    return () => clearTimeout(id)
  }, [log, loaded, persist])

  const commit = useCallback((op: Op): void => setLog((l) => push(l, op)), [])
  const undo = useCallback((): void => setLog((l) => undoLog(l)), [])
  const redo = useCallback((): void => setLog((l) => redoLog(l)), [])

  // ---------- Wörter, Zustand ----------
  const rawWords = useMemo(() => (real && transcript
    ? transcript.words.slice(real.firstWord, real.lastWord + 1).map((w, i) => ({ w: w.w, t: Math.max(0, w.start - real.start), e: Math.max(0, w.end - real.start), g: real.firstWord + i, hi: real.tags.some((x) => x.word === real.firstWord + i) }))
    : TRANSCRIPT.map((w, i) => ({ ...w, g: i, t: (i * clip.duration) / TRANSCRIPT.length, e: ((i + 0.8) * clip.duration) / TRANSCRIPT.length }))), [clip.duration, real, transcript])
  const words = useMemo(() => rawWords.map((w) => ({ ...w, w: st.wordEdits[w.g] ?? w.w, edited: st.wordEdits[w.g] !== undefined })), [rawWords, st.wordEdits])
  const [t, setT] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [muted, setMuted] = useState(false)
  const [tab, setTab] = useState('Untertitel')
  const [showSource, setShowSource] = useState(true)
  const [zone, setZone] = useState('Aus')
  const [sel, setSel] = useState<number | null>(null)
  const [editing, setEditing] = useState<number | null>(null)
  const [draft, setDraft] = useState('')
  const [liveTrim, setLiveTrim] = useState<[number, number] | null>(null)
  const [hookDraft, setHookDraft] = useState<string | null>(null)
  const [sizeDraft, setSizeDraft] = useState<number | null>(null)
  const [posDraft, setPosDraft] = useState<number | null>(null)
  const preset = PRESETS.find((p) => p.id === st.caption.presetId) ?? PRESETS[0]
  const committed: [number, number] = [st.start - origStart, st.end - origStart]
  const trim = liveTrim ?? committed
  const size = sizeDraft ?? Math.round(st.caption.scale * 60)
  const pos = posDraft ?? Math.round(st.caption.y * 100)
  const hook = hookDraft ?? st.hook.text
  const cut = st.cutWords

  // ---------- Vorschau-Plan (derselbe wie im Export) ----------
  const [plan, setPlan] = useState<PreviewPlan | null>(null)
  useEffect(() => {
    if (!loaded || !hasApi || !hash) return
    let alive = true
    const id = setTimeout(() => { void window.cutawan.shortme.previewPlan(hash, clipId, log, st.caption.presetId).then((p) => { if (alive) setPlan(p) }).catch(() => undefined) }, 250)
    return () => { alive = false; clearTimeout(id) }
  }, [log, loaded, hasApi, hash, clipId, st.caption.presetId])
  const planRef = useRef<PreviewPlan | null>(null)
  planRef.current = plan

  // ---------- Wellenform, Filmstreifen ----------
  const [assets, setAssets] = useState<{ peaks: number[]; step: number; strip: string[] } | null>(null)
  useEffect(() => {
    setAssets(null)
    if (!hasApi || !hash || !real) return
    let alive = true
    void window.cutawan.shortme.editorAssets(hash, clipId).then((a) => { if (alive) setAssets(a) }).catch(() => undefined)
    return () => { alive = false }
  }, [hasApi, hash, clipId, real])

  // ---------- Player: echtes Video (Bild + Ton) ----------
  const srcUrl = source ? window.cutawan.mediaUrl(source.path) : null
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const tRef = useRef(0)
  const trimRef = useRef(trim)
  trimRef.current = trim
  const [shotNow, setShotNow] = useState<{ shot: Pick<ShortmeShot, 'layout' | 'cx' | 'cx2'>; zoom: number } | null>(null)
  const shotKey = useRef('')

  const currentShot = useCallback((abs: number): { shot: Pick<ShortmeShot, 'layout' | 'cx' | 'cx2'>; zoom: number } => {
    const p = planRef.current
    const piece = p?.pieces.find((x) => abs >= x.src0 && abs < x.src1) ?? p?.pieces[p.pieces.length - 1]
    if (piece) return { shot: piece.shot, zoom: piece.zoom }
    return { shot: { layout: 'fixed', cx: 0.5 }, zoom: 1 }
  }, [])

  const draw = useCallback((): void => {
    const v = videoRef.current
    const c = canvasRef.current
    if (!v || !c || !v.videoWidth) return
    const ctx = c.getContext('2d')
    if (!ctx) return
    const cur = currentShot(v.currentTime)
    drawLayout(ctx, v, { width: v.videoWidth, height: v.videoHeight }, cur.shot, cur.zoom, CANVAS_W, CANVAS_H)
    const key = `${cur.shot.layout}|${cur.shot.cx.toFixed(3)}|${cur.shot.cx2?.toFixed(3)}|${cur.zoom}`
    if (key !== shotKey.current) { shotKey.current = key; setShotNow(cur) }
  }, [currentShot])

  const seek = useCallback((rel: number): void => {
    const v = videoRef.current
    const r = Math.min(D, Math.max(0, rel))
    tRef.current = r
    setT(r)
    if (v && srcUrl) v.currentTime = origStart + r
  }, [D, origStart, srcUrl])

  useEffect(() => {
    const v = videoRef.current
    if (!v || !srcUrl) return
    let raf = 0
    let last = 0
    const tick = (now: number): void => {
      const abs = v.currentTime
      if (!v.paused) {
        // Pausenschnitte und herausgeschnittene Wörter überspringen – wie im Export
        const cutHit = planRef.current?.cuts.find((c) => abs >= c[0] - 0.01 && abs < c[1] - 0.03)
        if (cutHit) v.currentTime = cutHit[1]
        const rel = abs - origStart
        if (rel >= trimRef.current[1] - 0.02) { v.pause(); setPlaying(false) }
      }
      tRef.current = abs - origStart
      if (now - last > 66 || v.paused) { last = now; setT(tRef.current) }
      draw()
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [srcUrl, origStart, draw])

  useEffect(() => {
    const v = videoRef.current
    if (!v || !srcUrl) return
    const onLoaded = (): void => { v.currentTime = origStart + trimRef.current[0]; setT(trimRef.current[0]) }
    v.addEventListener('loadedmetadata', onLoaded)
    if (v.readyState >= 1) onLoaded()
    return () => { v.removeEventListener('loadedmetadata', onLoaded) }
  }, [srcUrl, origStart, clipId])
  useEffect(() => { if (videoRef.current) videoRef.current.muted = muted }, [muted])

  const selRef = useRef<number | null>(null)
  selRef.current = sel
  const toggleCutRef = useRef<(g: number) => void>(() => undefined)
  const togglePlay = useCallback((): void => {
    const v = videoRef.current
    if (!v || !srcUrl) { setPlaying((p) => !p); return }
    if (v.paused) {
      const rel = v.currentTime - origStart
      if (rel < trimRef.current[0] || rel >= trimRef.current[1] - 0.05) v.currentTime = origStart + trimRef.current[0]
      void v.play().then(() => setPlaying(true)).catch(() => setPlaying(false))
    } else { v.pause(); setPlaying(false) }
  }, [srcUrl, origStart])

  // Demo ohne Video: simulierte Zeit
  useEffect(() => {
    if (srcUrl || !playing) return
    let last = performance.now(); let raf = 0
    const step = (n: number): void => { const dt = (n - last) / 1000; last = n; setT((x) => { const nx = x + dt; if (nx >= trimRef.current[1]) { setPlaying(false); return trimRef.current[1] } return nx }); raf = requestAnimationFrame(step) }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [playing, srcUrl])

  useEffect(() => {
    const k = (e: KeyboardEvent): void => {
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      if (e.ctrlKey && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); undo() }
      else if (e.ctrlKey && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) { e.preventDefault(); redo() }
      else if (e.key === ' ') { e.preventDefault(); togglePlay() }
      else if ((e.key === 'Delete' || e.key === 'Backspace') && selRef.current !== null) { e.preventDefault(); toggleCutRef.current(selRef.current) }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); seek(tRef.current - (e.shiftKey ? 5 : 1)) }
      else if (e.key === 'ArrowRight') { e.preventDefault(); seek(tRef.current + (e.shiftKey ? 5 : 1)) }
    }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [undo, redo, togglePlay, seek])

  const toggleCut = (g: number): void => commit({ t: 'cutWords', words: [g], cut: !cut.includes(g) })
  toggleCutRef.current = toggleCut
  const startEdit = (g: number, text: string): void => { setSel(g); setEditing(g); setDraft(text) }
  const finishEdit = (save: boolean): void => {
    const g = editing
    setEditing(null)
    if (g === null || !save) return
    const orig = rawWords.find((w) => w.g === g)?.w ?? ''
    const next = draft.trim()
    const current = st.wordEdits[g] ?? orig
    if (next === current) return
    commit({ t: 'editWord', word: g, text: next === orig ? '' : next }) // leer = Änderung zurücknehmen
  }
  const caption = (patch: CaptionPatch): void => commit({ t: 'caption', patch })
  const curIdx = Math.max(0, words.findLastIndex((w) => w.t <= t))
  const cap = words.slice(Math.floor(curIdx / preset.wordsPerLine) * preset.wordsPerLine, Math.floor(curIdx / preset.wordsPerLine) * preset.wordsPerLine + preset.wordsPerLine)
  const zn = ZONES[zone]
  const absT = origStart + t
  const wordRef = useRef<HTMLSpanElement>(null)
  useEffect(() => { if (playing) wordRef.current?.scrollIntoView({ block: 'nearest' }) }, [curIdx, playing])

  const exportNow = async (): Promise<void> => { await persist(logRef.current); await exportClips([clipId], st.caption.presetId, false) }
  const applyAll = async (): Promise<void> => {
    const others = (allReal ?? []).map((c) => c.id).filter((id) => id !== clipId)
    if (hasApi && hash) await window.cutawan.shortme.applyAll(hash, others, { presetId: st.caption.presetId, scale: st.caption.scale, y: st.caption.y, highlight: st.caption.highlight })
  }
  const rects = shotNow && source ? sourceRects({ width: source.width, height: source.height }, shotNow.shot, shotNow.zoom) : []
  const outDuration = plan ? plan.duration : trim[1] - trim[0]

  return (
    <div style={{ display: 'grid', gridTemplateRows: 'auto minmax(0, 1fr) 262px', gap: 12, height: 'calc(100vh - 60px)', paddingTop: 4 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <Button variant="ghost" aria-label="Zurück" onClick={() => { videoRef.current?.pause(); go('clips') }}><ArrowLeft size={18} /></Button>
        <h2 style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{clip.title}</h2>
        <small style={{ display: 'flex', alignItems: 'center', gap: 4 }}>{saved ? <><Check size={13} /> Gespeichert</> : 'Speichert …'}</small>
        <Button variant="ghost" aria-label="Rückgängig (Strg+Z)" disabled={!canUndo(log)} onClick={undo}><Undo2 size={16} /></Button>
        <Button variant="ghost" aria-label="Wiederholen (Strg+Y)" disabled={!canRedo(log)} onClick={redo}><Redo2 size={16} /></Button>
        <Button variant="primary" disabled={exportJob?.state === 'running'} onClick={() => void exportNow()}>{exportJob?.state === 'running' ? `${Math.round(exportJob.progress * 100)} %` : 'Exportieren'}</Button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '280px minmax(0, 1fr) 310px', gap: 14, minHeight: 0 }}>
        {/* Transkript */}
        <div className="sm-glass" style={{ padding: 16, overflowY: 'auto' }}>
          <h3 style={{ marginBottom: 10 }}>Transkript</h3>
          <div style={{ lineHeight: 1.9, fontSize: 14 }}>
            {words.map((w, i) => (
              <Fragment key={w.g}>
                {editing === w.g
                  ? <input autoFocus value={draft} size={Math.max(3, draft.length + 1)} onChange={(ev) => setDraft(ev.target.value)} onBlur={() => finishEdit(true)} onKeyDown={(ev) => { if (ev.key === 'Enter') finishEdit(true); else if (ev.key === 'Escape') finishEdit(false) }}
                      style={{ font: 'inherit', background: 'rgba(255,255,255,0.14)', border: '1px solid rgba(255,255,255,0.5)', borderRadius: 4, color: '#fff', padding: '0 3px', outline: 'none' }} />
                  : <span ref={i === curIdx ? wordRef : undefined} onClick={(ev) => { setSel(w.g); if (ev.altKey) toggleCut(w.g); else seek(w.t) }} onDoubleClick={() => startEdit(w.g, w.w)} title="Klick: springen/auswählen · Doppelklick: Text ändern · Entf: herausschneiden"
                      style={{ cursor: 'pointer', padding: '1px 2px', borderRadius: 4, marginRight: 3, textDecoration: cut.includes(w.g) ? 'line-through' : w.edited ? 'underline dotted rgba(255,255,255,0.6)' : 'none', opacity: cut.includes(w.g) ? 0.35 : w.t < trim[0] - 0.01 || w.e > trim[1] + 0.05 ? 0.4 : 1, background: i === curIdx ? 'rgba(255,255,255,0.22)' : 'transparent', outline: sel === w.g ? '1px solid rgba(255,255,255,0.55)' : 'none', color: cut.includes(w.g) ? 'rgba(255,255,255,0.45)' : undefined }}>{w.w}</span>}{' '}
              </Fragment>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
            <Pill onClick={() => { const w = words.find((x) => x.g === sel); if (w) startEdit(w.g, w.w) }}>Text ändern</Pill>
            <Pill onClick={() => { if (sel !== null) toggleCut(sel) }}>{sel !== null && cut.includes(sel) ? 'Wieder einfügen' : 'Herausschneiden'}</Pill>
          </div>
          <small style={{ display: 'block', marginTop: 10 }}>Wort anklicken = auswählen und springen · Doppelklick oder „Text ändern“ = Untertitel-Text korrigieren (Enter bestätigt) · Entf = herausschneiden (im Export entfernt, beim Abspielen übersprungen).</small>
        </div>

        {/* Bühne: Quellmonitor + vertikale Vorschau */}
        <div style={{ display: 'flex', gap: 16, justifyContent: 'center', alignItems: 'center', minHeight: 0, minWidth: 0 }}>
          <div style={{ display: showSource ? 'grid' : 'none', gap: 8, width: '40%', maxWidth: 420, alignSelf: 'center' }}>
            <div title="Klick auf eine Person: Kamera folgt ihr ab hier" onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); commit({ t: 'follow', at: absT, cx: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) }) }}
              style={{ position: 'relative', aspectRatio: '16/9', borderRadius: 12, overflow: 'hidden', border: '1px solid var(--edge)', background: '#000', cursor: 'crosshair' }}>
              {srcUrl
                ? <video ref={videoRef} src={srcUrl} preload="auto" playsInline style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }} />
                : <div style={{ width: '100%', height: '100%', backgroundImage: `url(${IMG.source})`, backgroundSize: 'cover' }} />}
              {rects.map((r, i) => <div key={i} style={{ position: 'absolute', top: 0, bottom: 0, left: `${r.x * 100}%`, width: `${r.w * 100}%`, border: '2px solid var(--accent)', background: 'rgba(255,255,255,0.12)', pointerEvents: 'none', boxShadow: 'var(--accent-glow)' }} />)}
              <span className="sm-tag" style={{ position: 'absolute', top: 8, left: 8, background: 'rgba(0,0,0,0.55)' }}>Quelle · Person anklicken</span>
            </div>
            <small>Heller Rahmen = aktueller Ausschnitt im Export</small>
          </div>
          <div style={{ position: 'relative', height: '100%', maxHeight: '100%', aspectRatio: '9/16', borderRadius: 16, overflow: 'hidden', border: '1px solid var(--edge-highlight)', background: '#000', boxShadow: '0 20px 60px rgba(0,0,0,0.5)', containerType: 'size' }}>
            {srcUrl
              ? <canvas ref={canvasRef} width={CANVAS_W} height={CANVAS_H} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} />
              : <div style={{ position: 'absolute', inset: 0, backgroundImage: `url(${clip.thumb})`, backgroundSize: 'cover' }} />}
            {st.hook.enabled && t < st.hook.seconds && hook && <div style={{ position: 'absolute', top: '8%', left: 0, right: 0, textAlign: 'center', fontFamily: 'Poppins', fontWeight: 700, fontSize: '3.4cqh', padding: '0 7%', textShadow: '0 2px 10px #000' }}><span style={{ background: 'rgba(0,0,0,0.5)', padding: '0.2em 0.5em', borderRadius: '0.4em', boxDecorationBreak: 'clone', WebkitBoxDecorationBreak: 'clone' }}>{hook}</span></div>}
            <style>{scopeCss(captionCss(preset, { scale: size / 60, highlight: st.caption.highlight }), '.sm-cap')}</style>
            <div className="sm-cap" style={{ position: 'absolute', left: 0, right: 0, top: `${pos}%`, transform: 'translateY(-50%)', padding: '0 4%' }}>
              <div className="segment"><div className="line">
                {cap.filter((w) => !cut.includes(w.g)).map((w) => <span key={w.g} className={`word${w.g === words[curIdx]?.g ? ' word-being-narrated' : ''}${w.hi ? ' emphasis' : ''}`}>{w.w}</span>)}
              </div></div>
            </div>
            {zn && <div aria-hidden style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}><div style={{ position: 'absolute', left: 0, right: 0, top: 0, height: `${zn.top * 100}%`, background: 'rgba(255,255,255,0.16)' }} /><div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: `${zn.bottom * 100}%`, background: 'rgba(255,255,255,0.16)' }} /><div style={{ position: 'absolute', right: 0, top: `${zn.top * 100}%`, bottom: `${zn.bottom * 100}%`, width: `${zn.right * 100}%`, background: 'rgba(255,255,255,0.16)' }} /></div>}
          </div>
        </div>

        {/* Inspector */}
        <div className="sm-glass" style={{ padding: 16, overflowY: 'auto', display: 'grid', alignContent: 'start', gap: 12 }}>
          <Segmented options={['Untertitel', 'Bildausschnitt', 'Hook']} value={tab} onChange={setTab} />
          {tab === 'Untertitel' && (
            <div>
              <Row label="Stil"><Segmented options={PRESETS.map((p) => p.name)} value={preset.name} onChange={(n) => caption({ presetId: PRESETS.find((p) => p.name === n)!.id })} /></Row>
              <Row label="Größe"><Slider label="Schrift" value={size} onChange={setSizeDraft} onCommit={(v) => { setSizeDraft(null); caption({ scale: v / 60 }) }} /></Row>
              <Row label="Position" hint="Drag-Regler"><Slider label="Vertikal" value={pos} min={10} max={90} onChange={setPosDraft} onCommit={(v) => { setPosDraft(null); caption({ y: v / 100 }) }} /></Row>
              <Row label="Hervorhebung (KI-Tags)"><Switch on={st.caption.highlight} onChange={(b) => caption({ highlight: b })} label="Hervorhebung" /></Row>
              <Row label="Sicherheitszonen"><Segmented options={['Aus', 'TikTok', 'Reels', 'Shorts']} value={zone} onChange={setZone} /></Row>
              <Row label="Alle Clips"><Button variant="secondary" disabled={!hasApi || (allReal?.length ?? 0) < 2} onClick={() => void applyAll()}><Wand2 size={15} /> Stil auf alle anwenden</Button></Row>
            </div>
          )}
          {tab === 'Bildausschnitt' && (
            <div>
              <Row label="Aktueller Ausschnitt" hint={shotNow ? LAYOUT_LABEL[shotNow.shot.layout] : ''}><small>Layout ändern gilt ab der Abspielposition bis zum Ende der Einstellung.</small></Row>
              <Row label="Layout"><Segmented options={Object.keys(LAYOUTS)} value={shotNow ? LAYOUT_LABEL[shotNow.shot.layout] : ''} onChange={(n) => commit({ t: 'layout', at: absT, layout: LAYOUTS[n] })} /></Row>
              <Row label="Kamera folgt" hint="ab hier"><small>Im Quellmonitor auf eine Person klicken – der Ausschnitt springt als fester Schnitt dorthin.</small></Row>
              <Row label="Quelle anzeigen"><Switch on={showSource} onChange={setShowSource} label="Quelle anzeigen" /></Row>
              <small>Gesichtsquote {Math.round(clip.faceRatio * 100)} % · {st.layoutOps.length} Änderung(en) am Ausschnitt</small>
            </div>
          )}
          {tab === 'Hook' && (
            <div>
              <Row label="Hook-Titel einblenden" hint="standardmäßig aus"><Switch on={st.hook.enabled} onChange={(b) => commit({ t: 'hook', enabled: b })} label="Hook-Titel einblenden" /></Row>
              <Row label="Text"><input className="sm-input" value={hook} onChange={(e) => setHookDraft(e.target.value)} onBlur={() => { if (hookDraft !== null && hookDraft !== st.hook.text) commit({ t: 'hook', text: hookDraft }); setHookDraft(null) }} /></Row>
              <Row label="Dauer"><Slider label="Sekunden" value={st.hook.seconds} min={1} max={6} onChange={() => undefined} onCommit={(v) => commit({ t: 'hook', text: st.hook.text, seconds: v })} /></Row>
            </div>
          )}
        </div>
      </div>

      <Timeline duration={D} trim={trim} t={t} onSeek={seek} words={words} playing={playing} onToggle={togglePlay} muted={muted} onMute={() => setMuted(!muted)}
        peaks={assets?.peaks} strip={assets?.strip}
        cuts={(plan?.cuts ?? []).map((c) => [c[0] - origStart, c[1] - origStart] as [number, number])}
        shots={(plan?.shots ?? []).map((s) => ({ ...s, start: s.start + (plan ? plan.start - origStart : 0), end: s.end + (plan ? plan.start - origStart : 0) }))}
        outDuration={outDuration}
        onTrim={(next) => { setLiveTrim(null); if (next[0] !== committed[0] || next[1] !== committed[1]) commit({ t: 'trim', start: origStart + next[0], end: origStart + next[1] }) }} onPreview={setLiveTrim} base={base}
        onCheckEnd={() => { seek(Math.max(trim[0], trim[1] - 2.5)); const v = videoRef.current; if (v) void v.play().then(() => setPlaying(true)).catch(() => undefined); else setPlaying(true) }} />
    </div>
  )
}

interface TimelineProps {
  duration: number; trim: [number, number]; t: number; onSeek: (n: number) => void; words: { t: number; e: number }[]; playing: boolean; onToggle: () => void; muted: boolean; onMute: () => void
  peaks?: number[]; strip?: string[]; cuts: Array<[number, number]>; shots: ShortmeShot[]; outDuration: number
  onTrim: (t: [number, number]) => void; onPreview: (t: [number, number]) => void; onCheckEnd: () => void; base: object
}

function Timeline({ duration, trim, t, onSeek, words, playing, onToggle, muted, onMute, peaks, strip, cuts, shots, outDuration, onTrim, onPreview, onCheckEnd, base }: TimelineProps): React.JSX.Element {
  const track = useRef<HTMLDivElement>(null)
  const [grab, setGrab] = useState<'in' | 'out' | 'head' | null>(null)
  const live = useRef<[number, number]>(trim)
  const offset = useRef(0)
  const bounds = useMemo(() => words.flatMap((w, i) => [w.t, words[i + 1]?.t ?? duration]), [words, duration])
  const snap = useCallback((x: number) => bounds.reduce((b, c) => (Math.abs(c - x) < Math.abs(b - x) ? c : b), bounds[0] ?? x), [bounds])
  const toTime = (clientX: number): number => { const r = track.current!.getBoundingClientRect(); return ((clientX - r.left) / r.width) * duration }
  const pct = (x: number): string => `${(Math.min(duration, Math.max(0, x)) / duration) * 100}%`
  const wave = useMemo(() => {
    const p = peaks && peaks.length ? peaks : Array.from({ length: Math.max(10, Math.round(duration / 0.1)) }, (_, i) => 0.2 + 0.5 * Math.abs(Math.sin(i * 0.37) * Math.cos(i * 0.113 + 1.3)))
    const n = p.length
    const up = p.map((v, i) => `${i},${(50 - Math.min(1, v * 1.15) * 48).toFixed(1)}`)
    const dn = p.map((v, i) => `${i},${(50 + Math.min(1, v * 1.15) * 48).toFixed(1)}`).reverse()
    return { n, d: `M${up.join(' L')} L${dn.join(' L')} Z` }
  }, [peaks, duration])

  const down = (which: 'in' | 'out') => (e: React.PointerEvent): void => {
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    live.current = trim
    offset.current = toTime(e.clientX) - trim[which === 'in' ? 0 : 1] // Grab-Offset: 1:1, kein Springen zur Mitte
    setGrab(which)
  }
  const move = (e: React.PointerEvent): void => {
    if (grab === 'head') { onSeek(toTime(e.clientX)); return }
    if (!grab) return
    const x = toTime(e.clientX) - offset.current
    const v = Math.min(duration, Math.max(0, snap(x)))
    const next: [number, number] = grab === 'in' ? [Math.min(v, live.current[1] - 1), live.current[1]] : [live.current[0], Math.max(v, live.current[0] + 1)]
    live.current = next
    onPreview(next)
  }
  const up = (): void => {
    if (!grab) return
    const was = grab
    setGrab(null)
    if (was !== 'head') onTrim(live.current) // genau ein Undo-Schritt je Ziehen
  }

  return (
    <div className="sm-glass" style={{ padding: 14, display: 'grid', gridTemplateRows: 'auto 1fr auto', gap: 8, minHeight: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Button variant="ghost" aria-label="5 Sekunden zurück" onClick={() => onSeek(t - 5)}><SkipBack size={15} /></Button>
        <Button variant="primary" aria-label={playing ? 'Pause' : 'Abspielen'} onClick={onToggle} style={{ width: 44, padding: 0 }}>{playing ? <Pause size={16} /> : <Play size={16} />}</Button>
        <Button variant="ghost" aria-label="5 Sekunden vor" onClick={() => onSeek(t + 5)}><SkipForward size={15} /></Button>
        <Button variant="ghost" aria-label={muted ? 'Ton an' : 'Ton aus'} onClick={onMute}>{muted ? <VolumeX size={15} /> : <Volume2 size={15} />}</Button>
        <small style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--text-1)', minWidth: 130 }}>{fmt(t)} / {fmt(trim[1] - trim[0])}</small>
        <small>Export nach Kürzen: <b style={{ color: 'var(--text-1)' }}>{outDuration.toFixed(1)} s</b></small>
        <div style={{ flex: 1 }} />
        <Pill onClick={onCheckEnd}><Rewind size={13} /> Ende prüfen</Pill>
        <Pill onClick={() => onTrim([trim[0], Math.min(duration, snap(trim[1] + 4))])}><Scissors size={13} /> Satz verlängern</Pill>
        <Pill onClick={() => onTrim([trim[0], Math.max(trim[0] + 1, snap(trim[1] - 4))])}><Scissors size={13} /> Satz kürzen</Pill>
      </div>

      <div ref={track} style={{ position: 'relative', minHeight: 0, touchAction: 'none', display: 'grid', gridTemplateRows: '52px 1fr 24px', gap: 4, cursor: 'pointer' }}
        onPointerDown={(e) => { if (grab) return; e.currentTarget.setPointerCapture(e.pointerId); setGrab('head'); onSeek(toTime(e.clientX)) }} onPointerMove={move} onPointerUp={up}>
        {/* Filmstreifen */}
        <div style={{ display: 'flex', borderRadius: 8, overflow: 'hidden', background: 'rgba(255,255,255,0.05)' }}>
          {(strip ?? []).map((s, i) => <img key={i} src={s} alt="" draggable={false} style={{ flex: 1, minWidth: 0, height: '100%', objectFit: 'cover', display: 'block' }} />)}
        </div>
        {/* Wellenform */}
        <div style={{ position: 'relative', borderRadius: 8, background: 'rgba(0,0,0,0.25)' }}>
          <svg viewBox={`0 0 ${wave.n} 100`} preserveAspectRatio="none" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
            <path d={wave.d} fill="rgba(255,255,255,0.55)" />
          </svg>
          {cuts.map((c, i) => <div key={i} title="Wird im Export entfernt" style={{ position: 'absolute', top: 0, bottom: 0, left: pct(c[0]), width: `calc(${pct(c[1])} - ${pct(c[0])})`, background: 'repeating-linear-gradient(135deg, rgba(255,255,255,0.38) 0 4px, rgba(255,255,255,0.1) 4px 8px)', borderLeft: '1px solid rgba(255,255,255,0.8)', borderRight: '1px solid rgba(255,255,255,0.8)' }} />)}
        </div>
        {/* Shots */}
        <div style={{ position: 'relative', borderRadius: 6, background: 'rgba(255,255,255,0.04)' }}>
          {shots.map((s, i) => <div key={i} title={`${LAYOUT_LABEL[s.layout]} · ${fmt(s.start)}–${fmt(s.end)}`} style={{ position: 'absolute', top: 2, bottom: 2, left: pct(s.start), width: `calc(${pct(s.end)} - ${pct(s.start)})`, background: LAYOUT_COLOR[s.layout], borderRadius: 4, fontSize: 10, lineHeight: '20px', paddingLeft: 4, overflow: 'hidden', whiteSpace: 'nowrap', color: '#fff' }}>{LAYOUT_LABEL[s.layout]}</div>)}
        </div>
        {/* außerhalb des Beschnitts abdunkeln */}
        <div style={{ position: 'absolute', top: 0, bottom: 0, left: 0, width: pct(trim[0]), background: 'rgba(0,0,0,0.55)', pointerEvents: 'none' }} />
        <div style={{ position: 'absolute', top: 0, bottom: 0, right: 0, width: `calc(100% - ${pct(trim[1])})`, background: 'rgba(0,0,0,0.55)', pointerEvents: 'none' }} />
        <div style={{ position: 'absolute', top: 0, bottom: 0, left: pct(trim[0]), width: `calc(${pct(trim[1])} - ${pct(trim[0])})`, border: '2px solid var(--accent)', borderRadius: 10, pointerEvents: 'none', boxShadow: 'var(--accent-glow)' }} />
        {(['in', 'out'] as const).map((w) => (
          <motion.div key={w} role="slider" aria-label={w === 'in' ? 'Start' : 'Ende'} aria-valuenow={trim[w === 'in' ? 0 : 1]} tabIndex={0}
            animate={{ scale: grab === w ? 1.18 : 1, y: grab === w ? -3 : 0 }} transition={base}
            onPointerDown={down(w)} style={{ position: 'absolute', top: -4, bottom: -4, left: `calc(${pct(trim[w === 'in' ? 0 : 1])} - 7px)`, width: 14, borderRadius: 7, background: '#fff', boxShadow: '0 2px 10px rgba(0,0,0,0.5)', cursor: 'ew-resize' }} />
        ))}
        <div style={{ position: 'absolute', top: -6, bottom: -6, left: pct(t), width: 2, background: '#fff', pointerEvents: 'none', boxShadow: '0 0 8px rgba(255,255,255,0.8)' }}>
          <span style={{ position: 'absolute', top: -2, left: -5, width: 12, height: 12, background: '#fff', borderRadius: '3px 3px 6px 6px' }} />
        </div>
      </div>
      <small>Griffe rasten an Wortgrenzen ein · rot schraffiert = wird im Export entfernt · Leertaste: Abspielen · ←/→: 1 s (Shift 5 s)</small>
    </div>
  )
}
