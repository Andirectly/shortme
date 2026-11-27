import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { modKey } from './Commands'
import { blocks, needsConfirm, preflight, type PreflightIssue } from '@shared/preflight'
import { clipRevision, qualityOf } from '@shared/review'
import { LogReportButton } from './LogReport'
import { ArrowLeft, Undo2, Redo2, Check, ChevronLeft, ChevronRight } from 'lucide-react'
import { ReviewBadge } from './ReviewScreen'
import { baseState, canRedo, canUndo, editWindow, isAudioDeleted, liveAudio, emptyLog, push, redo as redoLog, sanitizeLog, stateOf, undo as undoLog, type CaptionPatch, type EditLog, type Op } from '@shared/edits'
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
import { RatingBar, useRatingKeys } from './RatingBar'
import { Timeline, FPS } from './Timeline'
import { LyricsTranscript } from './LyricsTranscript'
import { setLevel, startBoost } from './audioBoost'
import { dbToGain, outTimeOf, rangeDbAt } from '@shared/audioMix'

const ZONES: Record<string, { top: number; bottom: number; right: number }> = { TikTok: { top: 0.12, bottom: 0.2, right: 0.14 }, Reels: { top: 0.1, bottom: 0.18, right: 0.1 }, Shorts: { top: 0.1, bottom: 0.22, right: 0.12 } }
const LAYOUTS: Record<string, ShortmeShot['layout']> = { Smart: 'smart', Fest: 'fixed', Vollbild: 'fit', Split: 'split', 'Facecam + Gameplay': 'stream' }
const LAYOUT_LABEL: Record<ShortmeShot['layout'], string> = { smart: 'Smart', fit: 'Vollbild', split: 'Split', fixed: 'Fest', stream: 'Facecam + Gameplay' }
const CANVAS_W = 540
const CANVAS_H = 960

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
  useRatingKeys(() => clipId)
  const { base } = useSprings()

  // ---------- Nicht-destruktive Bearbeitung: Operationslog, Autosave ----------
  // Zeitleiste = Clip samt Puffer davor/danach (Ursprung `origStart`); der Clip selbst liegt bei clipStart…clipEnd
  const clipStart = real?.start ?? 0
  // Quelldauer: aus der Clipliste, sonst Projektliste, sonst letztes Wort (ohne Angabe gäbe es keinen Puffer hinter dem Clip)
  const projectSec = useProject((s) => s.projects.find((p) => p.hash === hash)?.durationSec ?? 0)
  const sourceSec = source?.durationSec || projectSec || (transcript?.words.at(-1)?.end ?? 0)
  const [origStart, winEnd] = real ? editWindow(real.start, real.end, sourceSec) : [0, clip.duration]
  const D = winEnd - origStart
  const baseSt = useMemo(() => baseState({ start: clipStart, end: real?.end ?? clip.duration, hookText: clip.hook, corrections: real?.corrections, autoCuts: real?.autoCuts }, useStore.getState().presetId, styleDefaults), [clipStart, real?.end, clip.duration, clip.hook, real?.corrections, real?.autoCuts, styleDefaults])
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
    ? transcript.words.map((w, g) => ({ w, g })).filter(({ w }) => w.start >= origStart && w.end <= winEnd).map(({ w, g }) => ({ w: w.w, t: w.start - origStart, e: w.end - origStart, g, hi: real.tags.some((x) => x.word === g) }))
    : real ? [] : TRANSCRIPT.map((w, i) => ({ ...w, g: i, t: (i * clip.duration) / TRANSCRIPT.length, e: ((i + 0.8) * clip.duration) / TRANSCRIPT.length }))), [clip.duration, real, transcript, origStart, winEnd])
  const words = useMemo(() => rawWords.map((w) => ({ ...w, w: st.wordEdits[w.g] ?? w.w, edited: st.wordEdits[w.g] !== undefined })), [rawWords, st.wordEdits])
  const [t, setT] = useState(0)
  const [playing, setPlaying] = useState(false)
  // Wiedergabedauer für das Korrektur-Protokoll (Lernen): beim Verlassen des Clips melden
  const playedRef = useRef(0)
  useEffect(() => { if (!playing) return; const t0 = performance.now(); return () => { playedRef.current += (performance.now() - t0) / 1000 } }, [playing])
  useEffect(() => () => { const sec = playedRef.current; playedRef.current = 0; if (hash && sec >= 1) void window.cutawan?.shortme?.played(hash, clipId, sec) }, [hash, clipId])
  const [muted, setMuted] = useState(false)
  /** Lautstärke nur für die Wiedergabe im Editor – wirkt nicht auf den Export. */
  const [volume, setVolume] = useState(1)
  const [tab, setTab] = useState('Untertitel')
  /** Höhe der Zeitleiste in % der Fensterhöhe (gemerkt je Rechner); wächst mit dem Fenster. */
  const [tlVh, setTlVh] = useState<number>(() => { try { const v = Number(localStorage.getItem('sm.timelineVh')); return v >= 20 && v <= 72 ? v : 32 } catch { return 32 } })
  const tlDrag = useRef<{ y: number; vh: number } | null>(null)
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
  // Facecam + Gameplay: Titel und Untertitel liegen an der Naht zwischen Facecam und Gameplay (außer der Nutzer hat die Position selbst gesetzt).
  // Ist der Titel an, rutschen die Untertitel knapp darunter, damit sich beide nicht überdecken.
  const seamY = useMemo(() => (source && plan ? streamSeamY(plan.pieces.map((p) => ({ start: p.src0, end: p.src1, layout: p.shot.layout, stream: p.shot.stream })), { width: source.width, height: source.height }) : null), [source, plan])
  const capFree = st.caption.style.caption?.y === undefined && live?.caption?.y === undefined
  const titleFree = st.caption.style.title?.y === undefined && live?.title?.y === undefined
  const seam = seamY !== null && capFree ? (st.hook.enabled && titleFree ? Math.min(0.92, seamY + 0.1) : seamY) : null
  const preset = useMemo(() => { let p = presetBase; if (seam !== null) p = { ...p, caption: { ...p.caption, y: seam } }; if (seamY !== null && titleFree) p = { ...p, title: { ...p.title, y: seamY } }; return p }, [presetBase, seam, seamY, titleFree])
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
  /** Stück (Index in plan.pieces), das die Vorschau gerade abspielt. */
  const pieceRef = useRef(0)
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
  // Abspielkopf beim Öffnen auf den Clipbeginn (die Zeitleiste beginnt beim Puffer davor; ohne Video käme sonst kein Startwert)
  useEffect(() => { if (loaded) setT(trimRef.current[0]) }, [clipId, loaded])
  type ShotView = { shot: Pick<ShortmeShot, 'layout' | 'cx' | 'cx2' | 'stream'>; zoom: number }
  const [shotNow, setShotNow] = useState<ShotView | null>(null)
  /** Facecam-Layout während des Ziehens (Vorschau), bis der neue Plan da ist. */
  const [streamLive, setStreamLive] = useState<Partial<StreamLayout> | null>(null)
  const streamLiveRef = useRef<Partial<StreamLayout> | null>(null)
  streamLiveRef.current = streamLive
  const [scope, setScope] = useState('Diese Szene')
  const [kindNext, setKindNext] = useState<ContentType | null>(null)
  const shotKey = useRef('')
  /** Zeit des Bildes, das der Player wirklich gerade zeigt (nicht currentTime, das dem Bild vorauseilt) – sonst bekommt das letzte Bild einer Szene schon den Ausschnitt der nächsten. */
  const frameTimeRef = useRef<number | null>(null)

  const currentShot = useCallback((abs: number): ShotView => {
    const p = planRef.current
    // Liegt die Zeit in einer entfernten Lücke, gilt der Ausschnitt des Stücks davor (nie des letzten Stücks des Clips)
    const piece = p?.pieces.find((x) => abs >= x.src0 && abs < x.src1) ?? [...(p?.pieces ?? [])].reverse().find((x) => x.src1 <= abs) ?? p?.pieces[0]
    if (piece) return { shot: piece.shot, zoom: piece.zoom }
    return { shot: { layout: 'fixed', cx: 0.5 }, zoom: 1 }
  }, [])

  const draw = useCallback((): void => {
    const v = videoRef.current
    const c = canvasRef.current
    if (!v || !c || !v.videoWidth) return
    const ctx = c.getContext('2d')
    if (!ctx) return
    const cur0 = currentShot(frameTimeRef.current ?? v.currentTime)
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

  // ---------- Tonspuren: Vorschau auf derselben Ausgabe-Zeitachse wie der Export ----------
  const [audioUrls, setAudioUrls] = useState<Record<string, string>>({})
  const audioFilesKey = st.audio.map((a) => a.file).join('|')
  useEffect(() => {
    if (!hasApi || !hash || !audioFilesKey) return
    let alive = true
    void window.cutawan.shortme.audioPaths(hash, audioFilesKey.split('|')).then((p) => { if (alive) setAudioUrls(Object.fromEntries(Object.entries(p).map(([k, v]) => [k, window.cutawan.mediaUrl(v)]))) }).catch(() => undefined)
    return () => { alive = false }
  }, [hasApi, hash, audioFilesKey])
  const audioEls = useRef(new Map<string, HTMLAudioElement>())
  useEffect(() => () => { for (const el of audioEls.current.values()) el.pause(); audioEls.current.clear() }, [clipId])
  const audioRef = useRef(liveAudio(st))
  audioRef.current = liveAudio(st)
  const urlsRef = useRef(audioUrls)
  urlsRef.current = audioUrls
  const mixRef = useRef({ muted, volume, voiceDb: st.voiceDb, ranges: st.voiceRanges })
  mixRef.current = { muted, volume, voiceDb: st.voiceDb, ranges: st.voiceRanges }
  const syncAudio = useCallback((abs: number, play: boolean): void => {
    const p = planRef.current
    const keeps = p?.pieces ?? []
    const els = audioEls.current
    // Originalton: Gesamtpegel + Bereichspegel an dieser Stelle (über WebAudio auch verstärkt, wie im Export)
    const v = videoRef.current
    if (v) setLevel(v, mixRef.current.volume * dbToGain(mixRef.current.voiceDb + rangeDbAt(mixRef.current.ranges, abs)))
    for (const a of audioRef.current) {
      const url = urlsRef.current[a.file]
      if (!url) continue
      let el = els.get(a.id)
      if (!el || el.dataset.src !== url) { el?.pause(); el = new Audio(); el.crossOrigin = 'anonymous'; el.src = url; el.dataset.src = url; el.preload = 'auto'; els.set(a.id, el) }
      setLevel(el, mixRef.current.muted ? 0 : mixRef.current.volume * dbToGain(a.gainDb))
      const start = p?.start ?? a.at
      const pos = keeps.length ? outTimeOf(abs, keeps) - outTimeOf(Math.max(a.at, start), keeps) + Math.max(0, start - a.at) : abs - a.at
      if (play && pos >= 0 && pos < a.dur) { const f = (a.in ?? 0) + pos; if (Math.abs(el.currentTime - f) > 0.15) el.currentTime = f; if (el.paused) void el.play().catch(() => undefined) } else if (!el.paused) el.pause()
    }
    for (const [id, el] of els) if (!audioRef.current.some((a) => a.id === id)) { el.pause(); els.delete(id) }
  }, [])
  const addAudio = async (files: File[], at: number): Promise<void> => {
    if (!hasApi || !hash) return
    for (const f of files) {
      const { path: _p, ...clip } = await window.cutawan.shortme.audioImport(hash, window.cutawan.pathForFile(f), origStart + at)
      commit({ t: 'audio', id: clip.id, clip })
    }
  }

  useEffect(() => {
    const v = videoRef.current
    if (!v || !srcUrl) return
    let raf = 0
    let last = 0
    let vfc = 0
    // Beim Abspielen wird NUR hier gezeichnet: das Bild und seine Zeit (mediaTime) gehören sicher zusammen. Zeichnete die rAF-Schleife vor diesem Rückruf, bekäme das erste Bild einer neuen Szene noch den Ausschnitt der alten.
    const onFrame = (_now: number, meta: { mediaTime: number }): void => { frameTimeRef.current = meta.mediaTime; draw(); vfc = v.requestVideoFrameCallback(onFrame) }
    vfc = v.requestVideoFrameCallback(onFrame)
    const tick = (now: number): void => {
      const abs = v.currentTime
      const ps = planRef.current?.pieces
      if (!v.paused && ps?.length) {
        // Stücke in Export-Reihenfolge abspielen: Lücken (Schnitte) überspringen, verschobene Stücke anspringen – wie im Export
        let i = pieceRef.current
        if (!(ps[i] && abs >= ps[i].src0 - 0.05 && abs < ps[i].src1 + 0.05)) { i = ps.findIndex((p) => abs >= p.src0 - 0.01 && abs < p.src1); pieceRef.current = i }
        const p = ps[i]
        if (!p) { const nx = ps.find((x) => x.src0 > abs); if (nx) { pieceRef.current = ps.indexOf(nx); v.currentTime = nx.src0 } else { v.pause(); setPlaying(false) } }
        else if (abs >= p.src1 - 0.03) {
          const nx = ps[i + 1]
          if (!nx) { v.pause(); setPlaying(false) }
          else { pieceRef.current = i + 1; if (Math.abs(nx.src0 - p.src1) > 0.02) v.currentTime = nx.src0 }
        }
      } else if (!v.paused && abs - origStart >= trimRef.current[1] - 0.02) { v.pause(); setPlaying(false) }
      // ohne geladenes Video (Quelle fehlt) bleibt die Zeit, wo sie ist – sonst springt der Kopf an den Pufferbeginn
      if (v.readyState > 0) {
        tRef.current = abs - origStart
        if (now - last > 66 || v.paused) { last = now; setT(tRef.current) }
      }
      syncAudio(abs, !v.paused)
      if (v.paused) draw() // im Stand (Springen, Ziehen, Stiländerung) zeichnet die Schleife; beim Abspielen der Bild-Rückruf
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => { cancelAnimationFrame(raf); v.cancelVideoFrameCallback(vfc) }
  }, [srcUrl, origStart, draw, syncAudio])

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
      const ps = planRef.current?.pieces
      // am Ende (letztes Stück in Export-Reihenfolge) oder außerhalb: von vorn
      const last = ps?.[ps.length - 1]
      if (ps?.length && last) { if (rel < trimRef.current[0] || rel > trimRef.current[1] || (v.currentTime >= last.src1 - 0.05 && v.currentTime < last.src1 + 0.05)) { v.currentTime = ps[0].src0; pieceRef.current = 0 } }
      else if (rel < trimRef.current[0] || rel >= trimRef.current[1] - 0.05) v.currentTime = origStart + trimRef.current[0]
      startBoost()
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
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); undo() }
      else if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) { e.preventDefault(); redo() }
      else if (e.key === ' ') { e.preventDefault(); togglePlay() }
      else if ((e.key === 'Delete' || e.key === 'Backspace') && selRef.current !== null) { e.preventDefault(); toggleCutRef.current(selRef.current) }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); seek(tRef.current - (e.shiftKey ? 1 : 1 / FPS)) }
      else if (e.key === 'ArrowRight') { e.preventDefault(); seek(tRef.current + (e.shiftKey ? 1 : 1 / FPS)) }
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
  // Beim Öffnen zum Clipbeginn scrollen (das Transkript zeigt auch den Puffer davor)
  useEffect(() => { const id = setTimeout(() => wordRef.current?.scrollIntoView({ block: 'center' }), 400); return () => clearTimeout(id) }, [clipId])

  // ---------- Review-Kontext: Rücksprung, Nachbar-Clips ----------
  const returnTo = useStore((s) => s.returnTo)
  const openClipById = useStore((s) => s.openClip)
  const review = useProject((s) => s.review)
  const order = useMemo(() => (allReal ?? []).filter((c) => !c.pending).sort((a, b) => b.score - a.score).map((c) => c.id), [allReal])
  /** Nachbar in Listenreihenfolge; `openOnly` = nur noch nicht entschiedene (offen / zur Prüfung). */
  const neighbour = (dir: 1 | -1, openOnly: boolean): string | null => {
    const i = order.indexOf(clipId)
    for (let k = 1; k < order.length; k++) {
      const id = order[(i + dir * k + order.length * k) % order.length]
      const st = review[id]?.status ?? 'offen'
      if (id !== clipId && (!openOnly || st === 'offen' || st === 'zur_pruefung')) return id
    }
    return null
  }
  const switchTo = async (id: string | null): Promise<void> => { if (!id) return; videoRef.current?.pause(); await persist(logRef.current); if (hash) void useProject.getState().loadReview(hash); openClipById(id) }
  const exportNow = async (): Promise<void> => { setPreIssues(null); await persist(logRef.current); await exportClips([clipId], st.caption.presetId, false) }
  // Vorabprüfung: nur messbare Befunde; Warnungen/Fehler zeigen eine kurze Liste, Hinweise exportieren direkt
  const [preIssues, setPreIssues] = useState<PreflightIssue[] | null>(null)
  const [srcBroken, setSrcBroken] = useState(false)
  const checkAndExport = (): void => {
    const v = review[clipId]
    const issues = preflight({ hasSource: !!srcUrl && !srcBroken, plan, captions: true, words: words.filter((w) => w.t >= trim[0] - 0.01 && w.e <= trim[1] + 0.05 && !cut.includes(w.g)).length,
      quality: real ? qualityOf(real, !!v?.revision && v.revision !== clipRevision(real, null)) : undefined, review: v ? { status: v.status, changedSinceApproval: v.changedSinceApproval } : undefined })
    setPreIssues(issues) // immer bestätigen: ein Fehlklick erzeugte sonst sofort eine Datei
  }
  const applyAll = async (): Promise<void> => {
    const others = (allReal ?? []).map((c) => c.id).filter((id) => id !== clipId)
    if (hasApi && hash) await window.cutawan.shortme.applyAll(hash, others, { presetId: st.caption.presetId, style: st.caption.style, resetStyle: true, highlight: st.caption.highlight, enabled: st.caption.enabled !== false })
  }
  const streamShot = shotNow?.shot.layout === 'stream' && shotNow.shot.stream ? { ...shotNow.shot.stream, ...(streamLive ?? {}) } : null
  const contentKind: ContentType = contentFromFile ?? 'podcast'
  const canStream = !!real?.stream
  const canFind = !canStream && hasApi && !!hash && (contentKind === 'stream' || contentKind === 'talk' || true)
  const channel = useProject((s) => s.clipsFile?.channel)
  const [channelSaved, setChannelSaved] = useState(false)
  const recompute = async (k: ContentType): Promise<void> => { if (!hash) return; await persist(logRef.current); await window.cutawan.shortme.reanalyze(hash, k); go('processing') }
  const saveChannel = async (l: StreamLayout): Promise<void> => { if (channel) { await window.cutawan.shortme.channelLayoutSave(channel, l); setChannelSaved(true) } }
  const [camBusy, setCamBusy] = useState(false)
  const [camMsg, setCamMsg] = useState('')
  /** Facecams in allen Szenen dieses Clips neu erkennen (andere Person/Kamera an anderer Stelle) und die Vorschau neu laden. */
  const redetect = async (): Promise<void> => {
    if (!hash || camBusy) return
    setCamBusy(true); setCamMsg('')
    try {
      const r = await window.cutawan.shortme.redetectCams(hash, clipId)
      await useProject.getState().refreshClips(hash)
      setCamMsg(r.changed ? `${r.scenes} Szenen geprüft, ${r.others} weitere Facecam${r.others === 1 ? '' : 's'} gefunden` : 'Keine Facecam gefunden')
    } catch (e) { setCamMsg(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e)) }
    setCamBusy(false)
  }
  const findCam = async (): Promise<void> => { if (!hash) return; const l = await window.cutawan.shortme.findStream(hash); if (l) { commit({ t: 'stream', patch: l }); commit({ t: 'layoutClip', layout: 'stream' }) } }
  const defaultGameFor = (l: StreamLayout): StreamLayout['game'] => ({ ...l.game, x: Math.max(0, Math.min(1 - l.game.w, 0.5 - l.game.w / 2)), y: Math.max(0, Math.min(1 - l.game.h, 0.5 - l.game.h / 2)) })
  const rects = shotNow && source && !streamShot ? sourceRects({ width: source.width, height: source.height }, shotNow.shot, shotNow.zoom) : []
  const commitStream = (patch: Partial<StreamLayout>): void => { setStreamLive((l) => ({ ...(l ?? {}), ...patch })); commit({ t: 'stream', patch, at: scope === 'Diese Szene' ? absT : undefined }) }
  const outDuration = plan ? plan.duration : trim[1] - trim[0]

  // Zeitleiste: Höhe als Anteil der Fensterhöhe (wächst mit dem Fenster), am Griff verstellbar, mindestens so hoch, dass jede Tonspur eine Zeile hat
  const audioLanes = new Set(st.audio.map((a) => a.id.split('.')[0])).size
  const tlNeed = 292 + Math.max(0, audioLanes - 1) * 24
  const tlH = `clamp(240px, max(${tlNeed}px, ${tlVh}vh), 72vh)`
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gridTemplateRows: `auto minmax(0, 1fr) 8px ${tlH}`, rowGap: 6, columnGap: 12, height: 'calc(100vh - 60px)', paddingTop: 4, ['--tl-h' as string]: tlH }}>
      {preIssues && (
        <div role="dialog" aria-label="Clip exportieren" onClick={() => setPreIssues(null)} style={{ position: 'fixed', inset: 0, zIndex: 90, background: 'rgba(0,0,0,0.55)', display: 'grid', placeItems: 'center', padding: 16 }}>
          <div className="sm-glass" onClick={(e) => e.stopPropagation()} style={{ width: 'min(520px, 100%)', padding: 20, display: 'grid', gap: 12, background: 'rgba(22,22,28,0.97)' }}>
            <h3>Clip exportieren</h3>
            {!preIssues.length && <small style={{ color: 'var(--text-1)' }}>Keine Auffälligkeiten gefunden.</small>}
            <small style={{ color: 'var(--text-2)' }}>Format, Qualität und Zielordner kommen aus Einstellungen → Export.</small>
            {preIssues.map((x) => (
              <div key={x.id} style={{ display: 'grid', gridTemplateColumns: '78px 1fr auto', gap: 10, alignItems: 'center' }}>
                <span className="sm-badge">{x.level === 'fehler' ? 'Fehler' : x.level === 'warnung' ? 'Warnung' : 'Hinweis'}</span>
                <small style={{ color: 'var(--text-1)' }}>{x.text}</small>
                {x.at !== undefined ? <Button variant="secondary" onClick={() => { seek(x.at! - origStart); setPreIssues(null) }}>Zur Stelle</Button> : <span />}
              </div>
            ))}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <Button variant="secondary" onClick={() => setPreIssues(null)}>Abbrechen</Button>
              <Button variant="primary" disabled={blocks(preIssues)} autoFocus onClick={() => void exportNow()}>{needsConfirm(preIssues) ? 'Trotzdem exportieren' : 'Exportieren'}</Button>
            </div>
          </div>
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <Button variant="ghost" aria-label={returnTo === 'review' ? 'Zurück zum Review' : 'Zurück'} title={returnTo === 'review' ? 'Zurück zum Review' : 'Zurück zur Clipliste'} onClick={() => { videoRef.current?.pause(); void persist(logRef.current).then(() => { if (hash) void useProject.getState().loadReview(hash) }); go(returnTo === 'review' ? 'review' : 'clips') }}><ArrowLeft size={18} /></Button>
        <Button variant="ghost" aria-label="Vorheriger Clip" title="Vorheriger Clip" disabled={!neighbour(-1, false)} onClick={() => void switchTo(neighbour(-1, false))}><ChevronLeft size={16} /></Button>
        <Button variant="ghost" aria-label="Nächster offener Clip" title="Nächster offener Clip (noch nicht entschieden)" disabled={!neighbour(1, true)} onClick={() => void switchTo(neighbour(1, true))}><ChevronRight size={16} /></Button>
        <h2 title={clip.title} style={{ flex: 1, minWidth: 80, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{clip.title}</h2>
        {review[clipId] && <ReviewBadge view={review[clipId]} />}
        {/* Schnellwahl: Ausschnitt der aktuellen Einstellung (Szene) sofort ändern – derselbe Operationsweg wie im Reiter „Bildausschnitt“ */}
        <div className="sm-wide-only" style={{ flexShrink: 0, whiteSpace: 'nowrap' }}><Segmented options={Object.keys(LAYOUTS).filter((k) => k !== 'Facecam + Gameplay' || canStream)} value={shotNow ? LAYOUT_LABEL[shotNow.shot.layout] : ''} onChange={(n) => commit({ t: 'layout', at: absT, layout: LAYOUTS[n] })} /></div>
        <RatingBar clipId={clipId} chips="dropdown" />
        <small style={{ display: 'flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}>{saved ? <><Check size={13} /><span className="sm-wide-only">Gespeichert</span></> : 'Speichert …'}</small>
        <Button variant="ghost" aria-label={`Rückgängig (${modKey()}Z)`} title={`Rückgängig (${modKey()}Z)`} disabled={!canUndo(log)} onClick={undo}><Undo2 size={16} /></Button>
        <Button variant="ghost" aria-label={`Wiederholen (${window.cutawan?.platform === 'darwin' ? '⌘⇧Z' : 'Strg+Y'})`} title={`Wiederholen (${window.cutawan?.platform === 'darwin' ? '⌘⇧Z' : 'Strg+Y'})`} disabled={!canRedo(log)} onClick={redo}><Redo2 size={16} /></Button>
        {exportJob?.state === 'done' && exportJob.message.includes('exportiert nach') && <small role="status" title={exportJob.message} style={{ maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{exportJob.message}</small>}
        {exportJob?.state === 'error' && <small role="alert" style={{ color: 'var(--warn)', maxWidth: 260 }} title={exportJob.error}>Export fehlgeschlagen: {exportJob.error}</small>}
        {exportJob?.state === 'error' && <LogReportButton label="Fehlerbericht senden" />}
        <Button variant="primary" disabled={exportJob?.state === 'running'} onClick={checkAndExport}>{exportJob?.state === 'running' ? `${Math.round(exportJob.progress * 100)} %` : 'Exportieren'}</Button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'clamp(240px, 22vw, 440px) minmax(0, 1fr) clamp(280px, 24vw, 480px)', gap: 14, minHeight: 0 }}>
        {/* Transkript */}
        {/* Transkript ohne Rahmen direkt auf dem App-Hintergrund (wie Apple-Music-Lyrics) */}
        <div style={{ padding: '4px 4px 0', display: 'grid', gridTemplateRows: 'auto minmax(0, 1fr) auto', gap: 8, minHeight: 0 }}>
          <h3 style={{ padding: '2px 0' }}>Transkript</h3>
          <LyricsTranscript words={words} t={t} playing={playing} cut={cut} trim={trim} sel={sel} editing={editing} draft={draft}
            onDraft={setDraft} onFinish={finishEdit} onWord={(w, alt) => { setSel(w.g); if (alt) toggleCut(w.g); else seek(w.t) }} onEdit={(w) => startEdit(w.g, w.w)} />
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Pill onClick={() => { const w = words.find((x) => x.g === sel); if (w) startEdit(w.g, w.w) }}>Text ändern</Pill>
            <Pill onClick={() => { if (sel !== null) toggleCut(sel) }}>{sel !== null && cut.includes(sel) ? 'Wieder einfügen' : 'Herausschneiden'}</Pill>
            {!!real?.autoCuts?.length && <Pill onClick={() => commit({ t: 'autoCuts', ranges: real.autoCuts ?? [], cut: st.autoCuts.length === 0 })}>{st.autoCuts.length ? `Automatische Kürzung zurücknehmen (${st.autoCuts.length})` : 'Automatische Kürzung anwenden'}</Pill>}
          </div>
        </div>

        {/* Bühne: Quellmonitor + vertikale Vorschau */}
        <div style={{ display: 'flex', gap: 20, justifyContent: 'center', alignItems: 'center', minHeight: 0, minWidth: 0 }}>
          <div style={{ display: showSource ? 'grid' : 'none', gap: 8, flex: '1 1 0', minWidth: 0, maxWidth: `min(820px, calc((100vh - 98px - var(--tl-h)) * ${srcAspect}))`, alignSelf: 'center' }}>
            <div title="Klick auf eine Person: Kamera folgt ihr ab hier" onClick={(e) => { if (streamShot) return; const r = e.currentTarget.getBoundingClientRect(); commit({ t: 'follow', at: absT, cx: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) }) }}
              style={{ position: 'relative', aspectRatio: `${srcAspect}`, borderRadius: 12, overflow: 'hidden', boxShadow: '0 0 0 1px var(--edge)', background: '#000', cursor: streamShot ? 'default' : 'crosshair' }}>
              {srcUrl
                ? <video ref={videoRef} src={srcUrl} crossOrigin="anonymous" onError={() => setSrcBroken(true)} preload="auto" playsInline style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                : <div style={{ width: '100%', height: '100%', backgroundImage: `url(${IMG.source})`, backgroundSize: 'cover' }} />}
              {streamShot && source && <StreamFrames layout={streamShot} src={{ width: source.width, height: source.height }} onLive={(p) => setStreamLive((l) => ({ ...(l ?? {}), ...p }))} onCommit={commitStream} />}
              {rects.map((r, i) => <div key={i} style={{ position: 'absolute', top: 0, bottom: 0, left: `${r.x * 100}%`, width: `${r.w * 100}%`, border: '2px solid var(--accent)', background: 'rgba(255,255,255,0.12)', pointerEvents: 'none', boxShadow: 'var(--accent-glow)' }} />)}
              {!streamShot && <span className="sm-tag" title="Quelle · Person anklicken" style={{ position: 'absolute', top: 8, left: 8, maxWidth: 'calc(100% - 16px)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'block', background: 'rgba(0,0,0,0.55)' }}>Quelle · Person anklicken</span>}
            </div>
          </div>
          <div style={{ position: 'relative', flex: 'none', height: '100%', maxHeight: '100%', aspectRatio: '9/16', borderRadius: 16, overflow: 'hidden', background: '#000', boxShadow: '0 20px 60px rgba(0,0,0,0.5), 0 0 0 1px var(--edge-highlight)', containerType: 'size' }}>
            {srcUrl
              ? <canvas ref={canvasRef} width={CANVAS_W} height={CANVAS_H} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} />
              : <div style={{ position: 'absolute', inset: 0, backgroundImage: `url(${clip.thumb})`, backgroundSize: 'cover' }} />}
            {remotionOn
              ? <RemotionPreview preset={preset} words={st.caption.enabled === false ? [] : words.filter((w) => !cut.includes(w.g)).map((w) => ({ w: w.w, start: w.t, end: w.e, tag: w.hi ? ('emphasis' as const) : undefined }))} t={t} highlight={st.caption.highlight} titleText={st.hook.enabled ? hook : ''} titleSeconds={st.hook.seconds} duration={D} />
              : st.caption.enabled !== false && <CaptionLayer preset={preset} groups={groups} t={t} highlight={st.caption.highlight} fontCss={fontCss} onMove={(y) => setLive({ caption: { y } })} onCommit={(y) => styleCommit({ caption: { y } })} />}
            {!remotionOn && st.hook.enabled && hook && <TitleLayer preset={preset} text={hook} t={t} seconds={st.hook.seconds} onMove={(y) => setLive({ title: { y } })} onCommit={(y) => styleCommit({ title: { y } })} />}
            {zn && <div aria-hidden style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}><div style={{ position: 'absolute', left: 0, right: 0, top: 0, height: `${zn.top * 100}%`, background: 'rgba(255,255,255,0.16)' }} /><div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: `${zn.bottom * 100}%`, background: 'rgba(255,255,255,0.16)' }} /><div style={{ position: 'absolute', right: 0, top: `${zn.top * 100}%`, bottom: `${zn.bottom * 100}%`, width: `${zn.right * 100}%`, background: 'rgba(255,255,255,0.16)' }} /></div>}
          </div>
        </div>

        {/* Inspector */}
        <div className="sm-glass" style={{ padding: 16, overflowY: 'auto', display: 'grid', alignContent: 'start', gap: 12 }}>
          <Segmented options={['Untertitel', 'Animation', 'Titel', 'Bildausschnitt']} value={tab} onChange={setTab} />
          {tab === 'Untertitel' && (
            <div>
              <Row label="Untertitel anzeigen" toggle={<Switch on={st.caption.enabled !== false} onChange={(b) => caption({ enabled: b })} label="Untertitel anzeigen" />} />
              <Row label="Vorlage"><PresetPicker presetId={st.caption.presetId} onPick={(id, p) => { setLive(null); caption({ presetId: id, resetStyle: true, style: {} }); if (!isBuiltin(id)) commit({ t: 'hook', enabled: p.title.enabled }) }} /></Row>
              <PresetBar preset={preset} presetId={st.caption.presetId} patch={st.caption.style} titleEnabled={st.hook.enabled} hasApi={hasApi} canApplyAll={(allReal?.length ?? 0) > 1} onApplyAll={() => void applyAll()} />
              <CaptionControls compact value={preset} onLive={(p) => setLive(p)} onCommit={styleCommit} fonts={fonts} onImportFonts={() => void importFonts()} hasApi={hasApi} />
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
              <Row label="Ganzer Clip"><Segmented options={['Smart', 'Fest', 'Vollbild', ...(canStream ? ['Facecam + Gameplay'] : [])]} value={clipLayout} onChange={(n) => commit({ t: 'layoutClip', layout: LAYOUTS[n] })} /></Row>
              <Row label="Diese Einstellung"><Segmented options={Object.keys(LAYOUTS)} value={shotNow ? LAYOUT_LABEL[shotNow.shot.layout] : ''} onChange={(n) => commit({ t: 'layout', at: absT, layout: LAYOUTS[n] })} /></Row>
              {streamShot && (
                <>
                  <Row label="Layout"><Segmented options={STREAM_PRESETS.map((p) => p.label)} value={STREAM_PRESETS.find((p) => p.id === streamShot.preset)!.label} onChange={(n) => commitStream({ preset: STREAM_PRESETS.find((p) => p.label === n)!.id })} /></Row>
                  <Row label="Abstand"><Slider label="px" value={streamShot.gap} min={0} max={40} onChange={() => undefined} onCommit={(v) => commitStream({ gap: v })} /></Row>
                  <Row label="Gilt für"><Segmented options={['Ganzer Clip', 'Diese Szene']} value={scope} onChange={setScope} /></Row>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', paddingTop: 4 }}>
                    <Pill onClick={() => commitStream({ game: defaultGameFor(streamShot) })}>Gameplay zentrieren</Pill>
                    <Pill onClick={() => void redetect()}>{camBusy ? 'Erkenne …' : 'Facecams pro Szene erkennen'}</Pill>
                    {camMsg && <small role="status">{camMsg}</small>}
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

      {/* Griff: Zeitleiste höher/niedriger ziehen (Doppelklick = Standard) */}
      <div role="separator" aria-orientation="horizontal" aria-label="Höhe der Zeitleiste" title="Ziehen: Zeitleiste größer/kleiner · Doppelklick: Standard" tabIndex={0}
        onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); tlDrag.current = { y: e.clientY, vh: tlVh } }}
        onPointerMove={(e) => { const d = tlDrag.current; if (d) setTlVh(Math.min(72, Math.max(20, d.vh + ((d.y - e.clientY) / window.innerHeight) * 100))) }}
        onPointerUp={() => { tlDrag.current = null; try { localStorage.setItem('sm.timelineVh', String(Math.round(tlVh * 10) / 10)) } catch { /* ignore */ } }}
        onDoubleClick={() => { setTlVh(32); try { localStorage.removeItem('sm.timelineVh') } catch { /* ignore */ } }}
        onKeyDown={(e) => { if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); e.stopPropagation(); setTlVh((v) => Math.min(72, Math.max(20, v + (e.key === 'ArrowUp' ? 2 : -2)))) } }}
        style={{ cursor: 'row-resize', display: 'grid', placeItems: 'center', touchAction: 'none' }}>
        <span style={{ width: 44, height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.28)' }} />
      </div>
      <Timeline duration={D} trim={trim} t={t} onSeek={seek} words={words} playing={playing} onToggle={togglePlay} muted={muted} onMute={() => setMuted(!muted)} volume={volume} onVolume={setVolume}
        peaks={assets?.peaks} strip={assets?.strip}
        cuts={(plan?.cuts ?? []).map((c) => [c[0] - origStart, c[1] - origStart] as [number, number])}
        shots={(plan?.shots ?? []).map((s) => ({ ...s, start: s.start + (plan ? plan.start - origStart : 0), end: s.end + (plan ? plan.start - origStart : 0) }))}
        outDuration={outDuration}
        ranges={st.autoCuts.filter((c) => c.end > origStart && c.start < origStart + D).map((c) => [c.start - origStart, c.end - origStart] as [number, number])}
        onCutRange={(r) => commit({ t: 'autoCuts', ranges: [{ start: origStart + r[0], end: origStart + r[1] }], cut: true })}
        onRestoreRange={(r) => commit({ t: 'autoCuts', ranges: [{ start: origStart + r[0], end: origStart + r[1] }], cut: false })}
        onTrim={(next) => { setLiveTrim(null); if (next[0] !== committed[0] || next[1] !== committed[1]) commit({ t: 'trim', start: origStart + next[0], end: origStart + next[1] }) }} onPreview={setLiveTrim} base={base}
        origin={origStart} audio={st.audio.map((a) => ({ ...a, at: a.at - origStart, ...(isAudioDeleted(a, st) ? { deleted: true } : {}) }))} voiceDb={st.voiceDb} onVoiceDb={(db) => commit({ t: 'voice', gainDb: db })}
        onAudioFiles={hasApi && hash ? addAudio : undefined}
        gainRanges={st.voiceRanges.map((r) => ({ ...r, start: r.start - origStart, end: r.end - origStart }))}
        onRange={(id, r, create) => { const abs = r && { ...r, ...(r.start !== undefined ? { start: r.start + origStart } : {}), ...(r.end !== undefined ? { end: r.end + origStart } : {}) }; commit(!abs ? { t: 'voiceRange', id, remove: true } : create ? { t: 'voiceRange', id, range: { id, start: abs.start ?? 0, end: abs.end ?? 0, gainDb: abs.gainDb ?? 0 } } : { t: 'voiceRange', id, patch: abs }) }}
        onAudio={(id, patch) => commit(patch ? { t: 'audio', id, patch: patch.at !== undefined ? { ...patch, at: patch.at + origStart } : patch } : { t: 'audio', id, remove: true })}
        splits={st.splits.map((x) => x - origStart)} order={(plan?.pieces ?? []).map((p) => [p.src0 - origStart, p.src1 - origStart] as [number, number])}
        onSplit={(at) => commit({ t: 'split', at: at + origStart })}
        onSegDelete={(g) => commit({ t: 'autoCuts', ranges: [{ start: g[0] + origStart, end: g[1] + origStart }], cut: true })}
        onSegMove={(g, b) => commit({ t: 'moveSeg', move: { start: g[0] + origStart, end: g[1] + origStart, before: b === null ? null : b + origStart } })}
        onCheckEnd={() => { seek(Math.max(trim[0], trim[1] - 2.5)); const v = videoRef.current; if (v) void v.play().then(() => setPlaying(true)).catch(() => undefined); else setPlaying(true) }} />
    </div>
  )
}
