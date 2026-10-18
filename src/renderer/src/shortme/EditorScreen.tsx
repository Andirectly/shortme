import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'motion/react'
import { ArrowLeft, Play, Pause, Undo2, Redo2, Scissors, Rewind, Check, SkipBack, SkipForward, Volume2, VolumeX } from 'lucide-react'
import { baseState, canRedo, canUndo, emptyLog, push, redo as redoLog, sanitizeLog, stateOf, undo as undoLog, type CaptionPatch, type EditLog, type Op } from '@shared/edits'
import type { PreviewPlan, ShortmeShot } from '@shared/shortme'
import { groupWords } from '@shared/captions'
import type { PresetPatch } from '@shared/preset'
import { CaptionLayer, TitleLayer } from './CaptionLayers'
import { RemotionPreview } from './RemotionPreview'
import { effective, isBuiltin, usePresets } from './presets'
import { AnimControls, CaptionControls, TitleControls } from './StyleControls'
import { PresetBar, PresetPicker } from './PresetUI'
import { useStore } from './store'
import { IMG, TRANSCRIPT } from './data'
import { useClipList } from './clipData'
import { useProject } from './projectStore'
import { Button, Pill, Segmented, Slider, Switch, Row } from './ui'
import { useSprings } from './motion'
import { drawLayout, sourceRects } from '@shared/previewDraw'
import { STREAM_PRESETS, streamSeamY, type StreamLayout } from '@shared/streamLayout'
import { CONTENT_TYPES, contentLabel, type ContentType } from '@shared/videoKind'
import { StreamFrames } from './StreamFrames'

const ZONES: Record<string, { top: number; bottom: number; right: number }> = { TikTok: { top: 0.12, bottom: 0.2, right: 0.14 }, Reels: { top: 0.1, bottom: 0.18, right: 0.1 }, Shorts: { top: 0.1, bottom: 0.22, right: 0.12 } }
const LAYOUTS: Record<string, ShortmeShot['layout']> = { Smart: 'smart', Vollbild: 'fixed', 'Ganzes Bild': 'fit', Split: 'split', 'Facecam + Gameplay': 'stream' }
const LAYOUT_LABEL: Record<ShortmeShot['layout'], string> = { smart: 'Smart', fit: 'Ganzes Bild', split: 'Split', fixed: 'Vollbild', stream: 'Facecam + Gameplay' }
const LAYOUT_COLOR: Record<ShortmeShot['layout'], string> = { smart: 'rgba(255,255,255,0.55)', fit: 'rgba(255,255,255,0.32)', split: 'rgba(255,255,255,0.62)', fixed: 'rgba(255,255,255,0.18)', stream: 'rgba(255,214,10,0.55)' }
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
  const contentFromFile = useProject((s) => s.clipsFile?.contentType) ?? undefined
  const allReal = useProject((s) => s.clipsFile?.clips)
  const transcript = useProject((s) => s.transcript)
  const hasApi = useProject((s) => s.hasApi)
  const styleDefaults = useProject((s) => s.style)
  const exportClips = useProject((s) => s.exportClips)
  const exportJob = useProject((s) => s.exportJob)
  const go = useStore((s) => s.go)
  const { base } = useSprings()

  // ---------- Nicht-destruktive Bearbeitung: Operationslog, Autosave ----------
  const origStart = real?.start ?? 0
  const D = real ? real.end - real.start : clip.duration
  const baseSt = useMemo(() => baseState({ start: origStart, end: real?.end ?? clip.duration, hookText: clip.hook, corrections: real?.corrections }, useStore.getState().presetId, styleDefaults), [origStart, real?.end, clip.duration, clip.hook, real?.corrections, styleDefaults])
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
  const allPresets = usePresets((s) => s.all)
  const loadPresets = usePresets((s) => s.load)
  useEffect(() => { void loadPresets() }, [loadPresets])
  /** vorläufige Änderungen während eines Regler-Zugs (Vorschau live; erst beim Loslassen als Operation gespeichert) */
  const [live, setLive] = useState<PresetPatch | null>(null)
  /** Testlab-Entscheidung: ist Remotion der aktive Untertitel-Renderer? Dann zeigt die Vorschau den Remotion-Player. */
  const [remotionOn, setRemotionOn] = useState(false)
  useEffect(() => { if (hasApi) void window.cutawan.shortme.testlab.models().then((v) => setRemotionOn(v.active.renderer === 'remotion_renderer')).catch(() => undefined) }, [hasApi])
  const [plan, setPlan] = useState<PreviewPlan | null>(null)
  const presetBase = useMemo(() => effective(allPresets, st.caption.presetId, st.caption.style, live), [allPresets, st.caption.presetId, st.caption.style, live])
  const seam = useMemo(() => (source && plan && st.caption.style.caption?.y === undefined && live?.caption?.y === undefined ? streamSeamY(plan.pieces.map((p) => ({ start: p.src0, end: p.src1, layout: p.shot.layout, stream: p.shot.stream })), { width: source.width, height: source.height }) : null), [source, plan, st.caption.style.caption?.y, live])
  const preset = useMemo(() => (seam === null ? presetBase : { ...presetBase, caption: { ...presetBase.caption, y: seam } }), [presetBase, seam])
  const [fonts, setFonts] = useState<string[]>([])
  const [fontCss, setFontCss] = useState('')
  useEffect(() => { if (hasApi) void window.cutawan.listFonts().then((l) => setFonts(l.map((f) => f.family))).catch(() => undefined) }, [hasApi])
  useEffect(() => { const f = preset.caption.font.family; if (!hasApi || !fonts.includes(f)) { setFontCss(''); return } void window.cutawan.shortme.fontCss(f).then(setFontCss).catch(() => setFontCss('')) }, [hasApi, preset.caption.font.family, fonts])
  const importFonts = async (): Promise<void> => { const l = await window.cutawan.addFonts(); setFonts(l.map((f) => f.family)) }
  const committed: [number, number] = [st.start - origStart, st.end - origStart]
  const trim = liveTrim ?? committed
  const lastClipOp = [...st.layoutOps].reverse().find((o) => o.t === 'layoutClip')
  const planAllStream = !!plan && plan.pieces.length > 0 && plan.pieces.every((p) => p.shot.layout === 'stream')
  const clipLayout = lastClipOp && st.layoutOps[st.layoutOps.length - 1] === lastClipOp ? LAYOUT_LABEL[lastClipOp.layout] : planAllStream ? 'Facecam + Gameplay' : 'Smart'
  const hook = hookDraft ?? st.hook.text
  const cut = st.cutWords

  // ---------- Vorschau-Plan (derselbe wie im Export) ----------
  useEffect(() => {
    if (!loaded || !hasApi || !hash) return
    let alive = true
    const id = setTimeout(() => { void window.cutawan.shortme.previewPlan(hash, clipId, log, st.caption.presetId).then((p) => { if (alive) setPlan(p) }).catch(() => undefined) }, 250)
    return () => { alive = false; clearTimeout(id) }
  }, [log, loaded, hasApi, hash, clipId, st.caption.presetId])
  const planRef = useRef<PreviewPlan | null>(null)
  planRef.current = plan
  useEffect(() => { setStreamLive(null) }, [plan])

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
  // Seitenverhältnis der Quelle: der Monitor hat genau dieses Verhältnis → keine schwarzen Ränder, Markierungen liegen exakt auf dem Bild
  const srcAspect = source && source.width > 0 && source.height > 0 ? Math.max(0.5, Math.min(3, source.width / source.height)) : 16 / 9
  const srcUrl = source ? window.cutawan.mediaUrl(source.path) : null
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const tRef = useRef(0)
  const trimRef = useRef(trim)
  trimRef.current = trim
  type ShotView = { shot: Pick<ShortmeShot, 'layout' | 'cx' | 'cx2' | 'stream'>; zoom: number }
  const [shotNow, setShotNow] = useState<ShotView | null>(null)
  /** Facecam-Layout während des Ziehens (Vorschau), bis der neue Plan da ist. */
  const [streamLive, setStreamLive] = useState<Partial<StreamLayout> | null>(null)
  const streamLiveRef = useRef<Partial<StreamLayout> | null>(null)
  streamLiveRef.current = streamLive
  const [scope, setScope] = useState('Ganzer Clip')
  const [kindNext, setKindNext] = useState<ContentType | null>(null)
  const shotKey = useRef('')

  const currentShot = useCallback((abs: number): ShotView => {
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
    const cur0 = currentShot(v.currentTime)
    const live = streamLiveRef.current
    const cur: ShotView = live && cur0.shot.layout === 'stream' && cur0.shot.stream ? { ...cur0, shot: { ...cur0.shot, stream: { ...cur0.shot.stream, ...live } } } : cur0
    drawLayout(ctx, v, { width: v.videoWidth, height: v.videoHeight }, cur.shot, cur.zoom, CANVAS_W, CANVAS_H)
    const key = `${cur.shot.layout}|${cur.shot.cx.toFixed(3)}|${cur.shot.cx2?.toFixed(3)}|${cur.zoom}|${cur.shot.stream ? JSON.stringify(cur.shot.stream) : ''}`
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
  /** Stiländerung (Preset-Patch) als Operation; beendet die vorläufige Anzeige */
  const styleCommit = (p: PresetPatch): void => { setLive(null); caption({ style: p }) }
  const curIdx = Math.max(0, words.findLastIndex((w) => w.t <= t))
  const groups = useMemo(() => groupWords(words.filter((w) => !cut.includes(w.g)).map((w) => ({ w: w.w, start: w.t, end: w.e, g: w.g, hi: w.hi, tag: w.hi ? ('emphasis' as const) : undefined })), preset.caption), [words, cut, preset.caption])
  const zn = ZONES[zone]
  const absT = origStart + t
  const wordRef = useRef<HTMLSpanElement>(null)
  useEffect(() => { if (playing) wordRef.current?.scrollIntoView({ block: 'nearest' }) }, [curIdx, playing])

  const exportNow = async (): Promise<void> => { await persist(logRef.current); await exportClips([clipId], st.caption.presetId, false) }
  const applyAll = async (): Promise<void> => {
    const others = (allReal ?? []).map((c) => c.id).filter((id) => id !== clipId)
    if (hasApi && hash) await window.cutawan.shortme.applyAll(hash, others, { presetId: st.caption.presetId, style: st.caption.style, resetStyle: true, highlight: st.caption.highlight })
  }
  const streamShot = shotNow?.shot.layout === 'stream' && shotNow.shot.stream ? { ...shotNow.shot.stream, ...(streamLive ?? {}) } : null
  const contentKind: ContentType = contentFromFile ?? 'podcast'
  const canStream = !!real?.stream
  const canFind = !canStream && hasApi && !!hash && (contentKind === 'stream' || contentKind === 'talk' || true)
  const channel = useProject((s) => s.clipsFile?.channel)
  const [channelSaved, setChannelSaved] = useState(false)
  const recompute = async (k: ContentType): Promise<void> => { if (!hash) return; await persist(logRef.current); await window.cutawan.shortme.reanalyze(hash, k); go('processing') }
  const saveChannel = async (l: StreamLayout): Promise<void> => { if (channel) { await window.cutawan.shortme.channelLayoutSave(channel, l); setChannelSaved(true) } }
  const findCam = async (): Promise<void> => { if (!hash) return; const l = await window.cutawan.shortme.findStream(hash); if (l) { commit({ t: 'stream', patch: l }); commit({ t: 'layoutClip', layout: 'stream' }) } }
  const defaultGameFor = (l: StreamLayout): StreamLayout['game'] => ({ ...l.game, x: Math.max(0, Math.min(1 - l.game.w, 0.5 - l.game.w / 2)), y: Math.max(0, Math.min(1 - l.game.h, 0.5 - l.game.h / 2)) })
  const rects = shotNow && source && !streamShot ? sourceRects({ width: source.width, height: source.height }, shotNow.shot, shotNow.zoom) : []
  const commitStream = (patch: Partial<StreamLayout>): void => { setStreamLive((l) => ({ ...(l ?? {}), ...patch })); commit({ t: 'stream', patch, at: scope === 'Diese Szene' ? absT : undefined }) }
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

      <div style={{ display: 'grid', gridTemplateColumns: 'clamp(230px, 14vw, 320px) minmax(0, 1fr) clamp(360px, 26vw, 500px)', gap: 14, minHeight: 0 }}>
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
        </div>

        {/* Bühne: Quellmonitor + vertikale Vorschau */}
        <div style={{ display: 'flex', gap: 20, justifyContent: 'center', alignItems: 'center', minHeight: 0, minWidth: 0 }}>
          <div style={{ display: showSource ? 'grid' : 'none', gap: 8, flex: '1 1 0', minWidth: 0, maxWidth: `min(820px, calc((100vh - 360px) * ${srcAspect}))`, alignSelf: 'center' }}>
            <div title="Klick auf eine Person: Kamera folgt ihr ab hier" onClick={(e) => { if (streamShot) return; const r = e.currentTarget.getBoundingClientRect(); commit({ t: 'follow', at: absT, cx: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) }) }}
              style={{ position: 'relative', aspectRatio: `${srcAspect}`, borderRadius: 12, overflow: 'hidden', boxShadow: '0 0 0 1px var(--edge)', background: '#000', cursor: streamShot ? 'default' : 'crosshair' }}>
              {srcUrl
                ? <video ref={videoRef} src={srcUrl} preload="auto" playsInline style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                : <div style={{ width: '100%', height: '100%', backgroundImage: `url(${IMG.source})`, backgroundSize: 'cover' }} />}
              {streamShot && source && <StreamFrames layout={streamShot} src={{ width: source.width, height: source.height }} onLive={(p) => setStreamLive((l) => ({ ...(l ?? {}), ...p }))} onCommit={commitStream} />}
              {rects.map((r, i) => <div key={i} style={{ position: 'absolute', top: 0, bottom: 0, left: `${r.x * 100}%`, width: `${r.w * 100}%`, border: '2px solid var(--accent)', background: 'rgba(255,255,255,0.12)', pointerEvents: 'none', boxShadow: 'var(--accent-glow)' }} />)}
              {!streamShot && <span className="sm-tag" style={{ position: 'absolute', top: 8, left: 8, background: 'rgba(0,0,0,0.55)' }}>Quelle · Person anklicken</span>}
            </div>
          </div>
          <div style={{ position: 'relative', flex: 'none', height: '100%', maxHeight: '100%', aspectRatio: '9/16', borderRadius: 16, overflow: 'hidden', background: '#000', boxShadow: '0 20px 60px rgba(0,0,0,0.5), 0 0 0 1px var(--edge-highlight)', containerType: 'size' }}>
            {srcUrl
              ? <canvas ref={canvasRef} width={CANVAS_W} height={CANVAS_H} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} />
              : <div style={{ position: 'absolute', inset: 0, backgroundImage: `url(${clip.thumb})`, backgroundSize: 'cover' }} />}
            {remotionOn
              ? <RemotionPreview preset={preset} words={words.filter((w) => !cut.includes(w.g)).map((w) => ({ w: w.w, start: w.t, end: w.e, tag: w.hi ? ('emphasis' as const) : undefined }))} t={t} highlight={st.caption.highlight} titleText={st.hook.enabled ? hook : ''} titleSeconds={st.hook.seconds} duration={D} />
              : <CaptionLayer preset={preset} groups={groups} t={t} highlight={st.caption.highlight} fontCss={fontCss} />}
            {!remotionOn && st.hook.enabled && hook && <TitleLayer preset={preset} text={hook} t={t} seconds={st.hook.seconds} onMove={(y) => setLive({ title: { y } })} onCommit={(y) => styleCommit({ title: { y } })} />}
            {zn && <div aria-hidden style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}><div style={{ position: 'absolute', left: 0, right: 0, top: 0, height: `${zn.top * 100}%`, background: 'rgba(255,255,255,0.16)' }} /><div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: `${zn.bottom * 100}%`, background: 'rgba(255,255,255,0.16)' }} /><div style={{ position: 'absolute', right: 0, top: `${zn.top * 100}%`, bottom: `${zn.bottom * 100}%`, width: `${zn.right * 100}%`, background: 'rgba(255,255,255,0.16)' }} /></div>}
          </div>
        </div>

        {/* Inspector */}
        <div className="sm-glass" style={{ padding: 16, overflowY: 'auto', display: 'grid', alignContent: 'start', gap: 12 }}>
          <Segmented options={['Untertitel', 'Animation', 'Titel', 'Bildausschnitt']} value={tab} onChange={setTab} />
          {tab === 'Untertitel' && (
            <div>
              <Row label="Vorlage"><PresetPicker presetId={st.caption.presetId} onPick={(id, p) => { setLive(null); caption({ presetId: id, resetStyle: true, style: {} }); if (!isBuiltin(id)) commit({ t: 'hook', enabled: p.title.enabled }) }} /></Row>
              <PresetBar preset={preset} presetId={st.caption.presetId} patch={st.caption.style} titleEnabled={st.hook.enabled} hasApi={hasApi} canApplyAll={(allReal?.length ?? 0) > 1} onApplyAll={() => void applyAll()} />
              <CaptionControls value={preset} onLive={(p) => setLive(p)} onCommit={styleCommit} fonts={fonts} onImportFonts={() => void importFonts()} hasApi={hasApi} />
              <Row label="Hervorhebung (KI-Tags)" toggle={<Switch on={st.caption.highlight} onChange={(b) => caption({ highlight: b })} label="Hervorhebung" />} />
              <Row label="Sicherheitszonen"><Segmented options={['Aus', 'TikTok', 'Reels', 'Shorts']} value={zone} onChange={setZone} /></Row>
            </div>
          )}
          {tab === 'Animation' && (
            <div>
              <h3>Untertitel</h3>
              <AnimControls kind="caption" anim={preset.caption.anim} onLive={setLive} onCommit={styleCommit} />
              <h3 style={{ marginTop: 18 }}>Titel</h3>
              <AnimControls kind="title" anim={preset.title.anim} onLive={setLive} onCommit={styleCommit} />
            </div>
          )}
          {tab === 'Titel' && (
            <div>
              <Row label="Titel einblenden" toggle={<Switch on={st.hook.enabled} onChange={(b) => commit({ t: 'hook', enabled: b })} label="Titel einblenden" />} />
              <Row label="Text"><input className="sm-input" value={hook} onChange={(e) => setHookDraft(e.target.value)} onBlur={() => { if (hookDraft !== null && hookDraft !== st.hook.text) commit({ t: 'hook', text: hookDraft }); setHookDraft(null) }} /></Row>
              <Row label="Dauer"><Slider label="Sekunden" value={st.hook.seconds} min={1} max={8} onChange={() => undefined} onCommit={(v) => commit({ t: 'hook', text: st.hook.text, seconds: v })} /></Row>
              <TitleControls value={preset} onLive={setLive} onCommit={styleCommit} />
            </div>
          )}
          {tab === 'Bildausschnitt' && (
            <div>
              <Row label="Inhaltstyp" toggle={kindNext && kindNext !== contentKind ? <Button variant="secondary" onClick={() => void recompute(kindNext)}>Neu berechnen</Button> : undefined}>
                <Segmented options={CONTENT_TYPES.map((c) => c.label)} value={contentLabel(kindNext ?? contentKind)} onChange={(n) => setKindNext(CONTENT_TYPES.find((c) => c.label === n)!.id)} />
                {kindNext && kindNext !== contentKind && <small>Ausschnitt und Ranking werden neu berechnet (Transkript bleibt).</small>}
              </Row>
              <Row label="Ganzer Clip"><Segmented options={['Smart', 'Vollbild', 'Ganzes Bild', ...(canStream ? ['Facecam + Gameplay'] : [])]} value={clipLayout} onChange={(n) => commit({ t: 'layoutClip', layout: LAYOUTS[n] })} /></Row>
              <Row label="Diese Einstellung"><Segmented options={Object.keys(LAYOUTS)} value={shotNow ? LAYOUT_LABEL[shotNow.shot.layout] : ''} onChange={(n) => commit({ t: 'layout', at: absT, layout: LAYOUTS[n] })} /></Row>
              {streamShot && (
                <>
                  <Row label="Layout"><Segmented options={STREAM_PRESETS.map((p) => p.label)} value={STREAM_PRESETS.find((p) => p.id === streamShot.preset)!.label} onChange={(n) => commitStream({ preset: STREAM_PRESETS.find((p) => p.label === n)!.id })} /></Row>
                  <Row label="Abstand"><Slider label="px" value={streamShot.gap} min={0} max={40} onChange={() => undefined} onCommit={(v) => commitStream({ gap: v })} /></Row>
                  <Row label="Gilt für"><Segmented options={['Ganzer Clip', 'Diese Szene']} value={scope} onChange={setScope} /></Row>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', paddingTop: 4 }}>
                    <Pill onClick={() => commitStream({ game: defaultGameFor(streamShot) })}>Gameplay zentrieren</Pill>
                    {channel && <Pill onClick={() => void saveChannel(streamShot)}>{channelSaved ? 'Kanal-Layout gespeichert' : 'Als Kanal-Layout speichern'}</Pill>}
                  </div>
                </>
              )}
              {!streamShot && canFind && <Row label="Facecam"><Pill onClick={() => void findCam()}>Facecam suchen</Pill></Row>}
              <Row label="Quelle anzeigen" toggle={<Switch on={showSource} onChange={setShowSource} label="Quelle anzeigen" />} />
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
    </div>
  )
}
