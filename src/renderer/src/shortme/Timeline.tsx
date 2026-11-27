// Editor-Zeitleiste als Sequenz (x = Export-Zeit, Gelöschtes verschwindet, Stücke schließen lückenlos an): Filmstreifen, Wellenform, Einstellungen, Tonspuren. Bildgenau: Griffe und Spuren rasten auf Bilder (30 fps) ein,
// nahe Wortgrenzen/Abspielkopf magnetisch (Alt hält das Einrasten aus), Pfeiltasten auf einem Griff = 1 Bild (Umschalt = 10), Zoom bis ~12 px je Bild.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'motion/react'
import { Play, Pause, Scissors, Rewind, SkipBack, SkipForward, Volume2, VolumeX, ZoomIn, ZoomOut, Music, Plus, Trash2, SplitSquareHorizontal } from 'lucide-react'
import { segmentsOf } from '@shared/segments'
import { seqView } from '@shared/seqView'
import type { ShortmeShot } from '@shared/shortme'
import { GAIN_MAX_DB, GAIN_MIN_DB, type AudioClip, type VoiceRange } from '@shared/audioMix'
import { Button, Pill } from './ui'

export const FPS = 30
const FRAME = 1 / FPS
/** Zeitcode m:ss:ff (Bilder bei 30 fps). */
export const timecode = (s: number): string => {
  const f = Math.max(0, Math.round(s * FPS))
  return `${Math.floor(f / (FPS * 60))}:${String(Math.floor(f / FPS) % 60).padStart(2, '0')}:${String(f % FPS).padStart(2, '0')}`
}
const fmt = (s: number): string => `${Math.floor(Math.max(0, s) / 60)}:${(Math.max(0, s) % 60).toFixed(1).padStart(4, '0')}`
const LAYOUT_LABEL: Record<ShortmeShot['layout'], string> = { smart: 'Smart', fit: 'Vollbild', split: 'Split', fixed: 'Fest', stream: 'Facecam + Gameplay' }
const LAYOUT_COLOR: Record<ShortmeShot['layout'], string> = { smart: 'rgba(255,255,255,0.55)', fit: 'rgba(255,255,255,0.32)', split: 'rgba(255,255,255,0.62)', fixed: 'rgba(255,255,255,0.18)', stream: 'rgba(255,214,10,0.55)' }
const MAGNET_PX = 8
const ROW = 24

interface TimelineProps {
  duration: number; trim: [number, number]; t: number; onSeek: (n: number) => void; words: { t: number; e: number }[]; playing: boolean; onToggle: () => void; muted: boolean; onMute: () => void; volume: number; onVolume: (v: number) => void
  peaks?: number[]; strip?: string[]; cuts: Array<[number, number]>; shots: ShortmeShot[]; outDuration: number
  onTrim: (t: [number, number]) => void; onPreview: (t: [number, number]) => void; onCheckEnd: () => void; base: object
  /** Von Hand (oder automatisch) herausgeschnittene Zeitbereiche, relativ zum Clip; Klick stellt wieder her. */
  ranges: Array<[number, number]>; onCutRange: (r: [number, number]) => void; onRestoreRange: (r: [number, number]) => void
  /** Quellzeit am linken Rand (für das Bildraster der Quelle). */
  origin: number
  /** Tonspuren mit `at` relativ zur Zeitleiste. */
  /** `deleted` = beginnt in einem gelöschten Stück (stumm, wie das Video dort). */
  audio: Array<AudioClip & { deleted?: boolean }>; voiceDb: number
  onAudioFiles?: (files: File[], at: number) => Promise<void>
  onAudio: (id: string, patch: { at?: number; gainDb?: number; in?: number; dur?: number } | null) => void
  /** Videostücke: Schnittpunkte und Stücke in Export-Reihenfolge (relativ zur Zeitleiste). */
  splits?: number[]; order?: Array<[number, number]>
  onSplit?: (at: number) => void
  onSegDelete?: (seg: [number, number]) => void
  onSegMove?: (seg: [number, number], before: number | null) => void
  onVoiceDb: (db: number) => void
  /** Pegel einzelner Bereiche des Originaltons (Zeiten relativ zur Zeitleiste); in der Wellenform ziehen = Bereich wählen. */
  gainRanges?: VoiceRange[]
  onRange?: (id: string, r: Partial<Omit<VoiceRange, 'id'>> | null, create?: boolean) => void
}

export function Timeline({ duration, trim, t, onSeek, words, playing, onToggle, muted, onMute, volume, onVolume, peaks, strip, shots, outDuration, onTrim, onPreview, onCheckEnd, base, ranges, onCutRange, onRestoreRange, origin, audio, voiceDb, onAudioFiles, onAudio, onVoiceDb, gainRanges: vr = [], onRange, splits = [], order = [], onSplit, onSegDelete, onSegMove }: TimelineProps): React.JSX.Element {
  const scroller = useRef<HTMLDivElement>(null)
  const track = useRef<HTMLDivElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  /** Anfang eines Bereichs, der gelöscht werden soll (Abspielposition beim Markieren); Ende = aktuelle Position. */
  const [mark, setMark] = useState<number | null>(null)
  const [grab, setGrab] = useState<'in' | 'out' | 'head' | 'audio' | 'range' | null>(null)
  /** Bereich im Originalton: neu gezogen (noch ohne Pegel) bzw. gewählter vorhandener Bereich. */
  const [pending, setPending] = useState<[number, number] | null>(null)
  const [selRange, setSelRange] = useState<string | null>(null)
  const rangeFrom = useRef(0)
  const live = useRef<[number, number]>(trim)
  const offset = useRef(0)
  const [zoom, setZoom] = useState(1)
  const [viewW, setViewW] = useState(1000)
  const anchor = useRef<{ time: number; x: number } | null>(null)
  const [selAudio, setSelAudio] = useState<string | null>(null)
  const [dragAt, setDragAt] = useState<{ id: string; at: number } | null>(null)
  const [busy, setBusy] = useState('')
  const [dropOver, setDropOver] = useState(false)
  /** Kurze Rückmeldung nach dem Schneiden. */
  const [flash, setFlash] = useState('')
  useEffect(() => { if (!flash) return; const id = setTimeout(() => setFlash(''), 2800); return () => clearTimeout(id) }, [flash])
  /** Gewähltes Videostück; Ziehen verschiebt es (Ziel = Einfügemarke vor einem anderen Stück). */
  const [selSeg, setSelSeg] = useState<[number, number] | null>(null)
  const segDrag = useRef<{ seg: [number, number]; x0: number; moved: boolean } | null>(null)
  const [segTarget, setSegTarget] = useState<number | null | undefined>(undefined)
  /** Rand einer Tonspur ziehen (kürzen/verlängern), Vorschau bis zum Loslassen. */
  const edge = useRef<{ id: string; side: 'l' | 'r' } | null>(null)
  const [edgeLive, setEdgeLive] = useState<{ id: string; at: number; in: number; dur: number } | null>(null)

  const bounds = useMemo(() => words.flatMap((w, i) => [w.t, words[i + 1]?.t ?? duration]), [words, duration])
  /** Nächste Wortgrenze (für „Satz verlängern/kürzen“ und „Bis hier löschen“). */
  const snapWord = useCallback((x: number) => bounds.reduce((b, c) => (Math.abs(c - x) < Math.abs(b - x) ? c : b), bounds[0] ?? x), [bounds])
  // Sequenz: Quellzeit (wie alle Daten) → Export-Zeit (x-Achse) und zurück
  const V = useMemo(() => seqView(order, duration), [order, duration])
  const A = Math.max(0.001, V.a1 - V.a0)
  const pxPerSec = (viewW * zoom) / A
  /** Bildraster der Quelle; nahe einer Wortgrenze (oder `extra`, z. B. Abspielkopf) magnetisch, mit Alt frei aufs Bild. */
  const snapFrame = useCallback((x: number, free: boolean, extra: number[] = []): number => {
    const frame = Math.round((x + origin) / FRAME) * FRAME - origin
    if (free) return frame
    const near = [...extra, snapWord(x)].reduce((b, c) => (Math.abs(c - x) < Math.abs(b - x) ? c : b))
    return Math.abs(near - x) * pxPerSec <= MAGNET_PX ? near : frame
  }, [origin, snapWord, pxPerSec])
  const toOut = (clientX: number): number => { const r = track.current!.getBoundingClientRect(); return V.a0 + ((clientX - r.left) / r.width) * A }
  const toTime = (clientX: number): number => V.inv(toOut(clientX))
  const fracO = (o: number): number => (Math.min(V.a1, Math.max(V.a0, o)) - V.a0) / A
  const pctO = (o: number): string => `${fracO(o) * 100}%`
  const pct = (x: number): string => pctO(V.fwd(x))
  /** Breite eines Quellbereichs in der Sequenz (innerhalb eines Stücks). */
  const wid = (a: number, b: number): string => `${Math.max(0, fracO(V.fwd(b)) - fracO(V.fwd(a))) * 100}%`
  const wave = useMemo(() => {
    const p = peaks && peaks.length ? peaks : Array.from({ length: Math.max(10, Math.round(duration / 0.1)) }, (_, i) => 0.2 + 0.5 * Math.abs(Math.sin(i * 0.37) * Math.cos(i * 0.113 + 1.3)))
    const n = p.length
    const up = p.map((v, i) => `${i},${(50 - Math.min(1, v * 1.15) * 48).toFixed(1)}`)
    const dn = p.map((v, i) => `${i},${(50 + Math.min(1, v * 1.15) * 48).toFixed(1)}`).reverse()
    return { n, d: `M${up.join(' L')} L${dn.join(' L')} Z` }
  }, [peaks, duration])

  // ---------- Zoom ----------
  useEffect(() => {
    const el = scroller.current
    if (!el) return
    const ro = new ResizeObserver(() => setViewW(el.clientWidth || 1000))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const maxZoom = Math.max(1, (A * FPS * 12) / Math.max(200, viewW))
  const zoomTo = (z: number, at: { time: number; x: number }): void => { anchor.current = at; setZoom(Math.min(maxZoom, Math.max(1, z))) }
  // Nach dem Zoomen bleibt die Zeit unter dem Mauszeiger (bzw. der Abspielkopf) an derselben Stelle
  useLayoutEffect(() => {
    const el = scroller.current, a = anchor.current
    if (!el || !a) return
    anchor.current = null
    el.scrollLeft = fracO(a.time) * el.scrollWidth - a.x
  }, [zoom, A]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const el = scroller.current
    if (!el) return
    const wheel = (e: WheelEvent): void => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault()
        const r = el.getBoundingClientRect()
        const x = e.clientX - r.left
        zoomTo(zoom * Math.exp(-e.deltaY * 0.0025), { time: V.a0 + ((el.scrollLeft + x) / el.scrollWidth) * A, x })
      } else if (zoom > 1 && Math.abs(e.deltaY) > Math.abs(e.deltaX)) { e.preventDefault(); el.scrollLeft += e.deltaY }
    }
    el.addEventListener('wheel', wheel, { passive: false })
    return () => el.removeEventListener('wheel', wheel)
  })
  const zoomAtHead = (f: number): void => { const el = scroller.current; if (!el) return; const x = fracO(V.fwd(t)) * el.scrollWidth - el.scrollLeft; zoomTo(zoom * f, { time: V.fwd(t), x: Math.min(el.clientWidth, Math.max(0, x)) }) }
  // Beim Abspielen bleibt der Kopf sichtbar
  useEffect(() => {
    const el = scroller.current
    if (!el || zoom <= 1 || grab) return
    const x = fracO(V.fwd(t)) * el.scrollWidth
    if (x < el.scrollLeft + 20 || x > el.scrollLeft + el.clientWidth - 20) el.scrollLeft = x - (playing ? el.clientWidth * 0.1 : el.clientWidth / 2)
  }, [t, zoom, V, playing, grab]) // eslint-disable-line react-hooks/exhaustive-deps

  // ---------- Ziehen ----------
  const down = (which: 'in' | 'out') => (e: React.PointerEvent): void => {
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    live.current = trim
    origTrim.current = trim
    offset.current = toOut(e.clientX) // Griffe sitzen an Sequenzanfang/-ende; Ziehen kürzt/verlängert das Stück, an dem der Griff sitzt
    // Stück am Griff: liegt dort der Clipbeginn/-ende (Normalfall), ändert sich der Beschnitt (auch verlängern);
    // nach dem Verschieben sitzt dort ggf. ein Schnittpunkt → nur kürzen, als gelöschter Bereich (schließt lückenlos)
    const b = which === 'in' ? blocks[0] : blocks[blocks.length - 1]
    edgeBlock.current = b ? { g: b.g, trimEdge: which === 'in' ? Math.abs(b.g[0] - trim[0]) < 1e-3 : Math.abs(b.g[1] - trim[1]) < 1e-3 } : null
    setDragO(0)
    setGrab(which)
  }
  const edgeBlock = useRef<{ g: [number, number]; trimEdge: boolean } | null>(null)
  /** Griff-Verschiebung in Sequenzzeit während des Ziehens (Plan aktualisiert sich erst nach dem Loslassen). */
  const [dragO, setDragO] = useState(0)
  const origTrim = useRef<[number, number]>(trim)
  const inO = grab === 'in' ? dragO : 0
  const outO = V.len + (grab === 'out' ? dragO : 0)
  const setTrim = (which: 'in' | 'out', v: number): [number, number] => {
    const c = Math.min(duration, Math.max(0, v))
    return which === 'in' ? [Math.min(c, live.current[1] - 1), live.current[1]] : [live.current[0], Math.max(c, live.current[0] + 1)]
  }
  const move = (e: React.PointerEvent): void => {
    if (grab === 'head') { onSeek(snapFrame(toTime(e.clientX), true)); return }
    if (grab === 'range') {
      const x = snapFrame(toTime(e.clientX), e.altKey, [t, trim[0], trim[1]])
      if (Math.abs(x - rangeFrom.current) * pxPerSec >= 4) setPending([Math.min(x, rangeFrom.current), Math.max(x, rangeFrom.current)])
      return
    }
    if (grab !== 'in' && grab !== 'out') return
    const eb = edgeBlock.current
    if (eb && !eb.trimEdge) {
      const edgeT = grab === 'in' ? eb.g[0] : eb.g[1], max = eb.g[1] - eb.g[0] - 0.1
      const d = snapFrame(edgeT + (toOut(e.clientX) - offset.current), e.altKey, [t]) - edgeT
      setDragO(grab === 'in' ? Math.min(max, Math.max(0, d)) : Math.max(-max, Math.min(0, d)))
      return
    }
    const base = origTrim.current[grab === 'in' ? 0 : 1]
    const next = setTrim(grab, snapFrame(base + (toOut(e.clientX) - offset.current), e.altKey, [t]))
    live.current = next
    setDragO(next[grab === 'in' ? 0 : 1] - base)
    onPreview(next)
  }
  const up = (): void => {
    if (!grab) return
    const was = grab
    setGrab(null)
    // kein Ziehen in der Wellenform = wie bisher springen
    if (was === 'range') { if (!pending || pending[1] - pending[0] < 2 * FRAME) { setPending(null); onSeek(rangeFrom.current) } return }
    const eb = edgeBlock.current
    if ((was === 'in' || was === 'out') && eb && !eb.trimEdge) {
      if (Math.abs(dragO) >= FRAME) onCutRange(was === 'in' ? [eb.g[0], eb.g[0] + dragO] : [eb.g[1] + dragO, eb.g[1]])
      return
    }
    if (was === 'in' || was === 'out') onTrim(live.current) // genau ein Undo-Schritt je Ziehen
  }
  /** Pfeiltasten auf einem Griff: 1 Bild (Umschalt: 10 Bilder); jeder Schritt ist ein Undo-Schritt. */
  const nudge = (which: 'in' | 'out') => (e: React.KeyboardEvent): void => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    e.preventDefault(); e.stopPropagation()
    live.current = trim
    const cur = trim[which === 'in' ? 0 : 1]
    const next = setTrim(which, snapFrame(cur, true) + (e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 10 : 1) * FRAME)
    onTrim(next)
    onSeek(next[which === 'in' ? 0 : 1])
  }

  // ---------- Tonspuren ----------
  const audioDown = (a: AudioClip) => (e: React.PointerEvent): void => {
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    setSelAudio(a.id)
    offset.current = toTime(e.clientX) - a.at
    setDragAt({ id: a.id, at: a.at })
    setGrab('audio')
  }
  const audioMove = (a: AudioClip) => (e: React.PointerEvent): void => {
    if (grab !== 'audio' || dragAt?.id !== a.id) return
    // Anfang rastet auf Bild, Abspielkopf, Wortgrenzen; Ende auf den Abspielkopf
    const raw = toTime(e.clientX) - offset.current
    const head = Math.abs(raw + a.dur - t) * pxPerSec <= MAGNET_PX ? t - a.dur : null
    setDragAt({ id: a.id, at: head ?? snapFrame(raw, e.altKey, [t, trim[0]]) })
  }
  const audioUp = (a: AudioClip) => (): void => {
    if (grab !== 'audio') return
    setGrab(null)
    if (dragAt && Math.abs(dragAt.at - a.at) > 1e-4) onAudio(a.id, { at: dragAt.at })
    setDragAt(null)
  }
  const audioKey = (a: AudioClip) => (e: React.KeyboardEvent): void => {
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); e.stopPropagation(); onAudio(a.id, null); setSelAudio(null) }
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); onAudio(a.id, { at: snapFrame(a.at, true) + (e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 10 : 1) * FRAME }) }
  }
  const addFiles = async (files: File[], at: number): Promise<void> => {
    if (!onAudioFiles || !files.length) return
    setBusy(files.length > 1 ? `${files.length} Dateien werden übernommen …` : `„${files[0].name}“ wird übernommen …`)
    try { await onAudioFiles(files, at); setBusy('') } catch (err) { setBusy(err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(err)) }
  }
  const sel = audio.find((a) => a.id === selAudio)
  /** Blöcke = Stücke zwischen den Schnittpunkten, in Export-Reihenfolge; gelöschte (Länge 0) fehlen – die Nachbarn schließen an. */
  const blocks = (splits.length ? segmentsOf(trim[0], trim[1], splits) : [trim])
    .map((g) => ({ g, o0: V.fwd(g[0]), o1: V.fwd(g[1] - 1e-4) + 1e-4 }))
    .filter((b) => b.o1 - b.o0 > 0.01)
    .sort((a, b) => a.o0 - b.o0)
  const movable = blocks.length > 1
  /** Schnitt am Abspielkopf durch alle Ebenen: Video (im Clip) und jede Tonspur, die dort läuft. */
  const split = (): void => {
    const at = snapFrame(t, true)
    const inVideo = at > trim[0] + 0.05 && at < trim[1] - 0.05 && !splits.some((x) => Math.abs(x - at) < 1e-3)
    const tracks = audio.filter((a) => !a.deleted && at > a.at + 0.02 && at < a.at + a.dur - 0.02).length
    if (!onSplit || (!inVideo && !tracks)) { setFlash(inVideo || tracks ? '' : 'Hier gibt es nichts zu schneiden (außerhalb des Clips oder schon geschnitten)'); return }
    onSplit(at)
    setFlash(`✂ Geschnitten bei ${timecode(Math.max(0, V.fwd(at)))} – ${[inVideo ? 'Video' : '', tracks ? `${tracks} Tonspur${tracks === 1 ? '' : 'en'}` : ''].filter(Boolean).join(' + ')}`)
  }
  const splitRef = useRef(split)
  useEffect(() => { splitRef.current = split })
  useEffect(() => {
    const k = (e: KeyboardEvent): void => {
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || e.altKey) return
      if ((e.key.toLowerCase() === 's' && !e.ctrlKey && !e.metaKey) || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b')) { e.preventDefault(); splitRef.current() }
    }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [])
  // ---------- Videostück ziehen ----------
  const segDown = (sg: [number, number]) => (e: React.PointerEvent): void => {
    if (blocks.length < 2) return // ein einziges Stück: Klick springt wie überall
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    segDrag.current = { seg: sg, x0: e.clientX, moved: false }
  }
  const segMoveEv = (e: React.PointerEvent): void => {
    const d = segDrag.current
    if (!d) return
    if (!d.moved && Math.abs(e.clientX - d.x0) < 5) return
    d.moved = true
    // Einfügemarke: nächster Blockanfang oder das Sequenzende (= ans Ende)
    const o = toOut(e.clientX)
    const marks = [...blocks.map((b) => ({ o: b.o0, src: b.g[0] as number | null })), { o: V.len, src: null }]
    const m = marks.reduce((b, c) => (Math.abs(c.o - o) < Math.abs(b.o - o) ? c : b))
    setSegTarget(m.src)
  }
  const segUp = (e: React.PointerEvent): void => {
    const d = segDrag.current
    segDrag.current = null
    if (!d) return
    const target = segTarget
    setSegTarget(undefined)
    if (!d.moved) { setSelSeg(d.seg); setSelAudio(null); onSeek(snapFrame(toTime(e.clientX), true)); return }
    if (target === undefined) return
    // vor sich selbst oder vor den direkten Nachfolger = keine Änderung
    const i = blocks.findIndex((b) => b.g[0] === d.seg[0])
    const next = blocks[i + 1]
    if (target === d.seg[0] || (next ? target === next.g[0] : target === null)) return
    onSegMove?.(d.seg, target)
  }
  // ---------- Rand einer Tonspur ----------
  const edgeDown = (a: AudioClip, side: 'l' | 'r') => (e: React.PointerEvent): void => {
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    setSelAudio(a.id)
    edge.current = { id: a.id, side }
    setEdgeLive({ id: a.id, at: a.at, in: a.in ?? 0, dur: a.dur })
  }
  const edgeMove = (a: AudioClip) => (e: React.PointerEvent): void => {
    const g = edge.current
    if (!g || g.id !== a.id) return
    const x = snapFrame(toTime(e.clientX), e.altKey, [t, trim[0], trim[1]])
    const inn = a.in ?? 0, file = a.fileDur ?? inn + a.dur
    if (g.side === 'l') { const at = Math.min(a.at + a.dur - 0.05, Math.max(a.at - inn, x)); setEdgeLive({ id: a.id, at, in: inn + (at - a.at), dur: a.dur - (at - a.at) }) }
    else { const end = Math.max(a.at + 0.05, Math.min(a.at + file - inn, x)); setEdgeLive({ id: a.id, at: a.at, in: inn, dur: end - a.at }) }
  }
  const edgeUp = (a: AudioClip) => (): void => {
    const g = edge.current, l = edgeLive
    edge.current = null
    setEdgeLive(null)
    if (!g || !l || l.id !== a.id) return
    if (Math.abs(l.at - a.at) > 1e-4 || Math.abs(l.dur - a.dur) > 1e-4) onAudio(a.id, { at: l.at, in: l.in, dur: l.dur })
  }
  const curRange = vr.find((r) => r.id === selRange)
  // Spur = ursprüngliche Datei: Teile einer geteilten Tonspur (id „a.10000“) bleiben in derselben Zeile
  const lanes = [...new Set(audio.map((a) => a.id.split('.')[0]))]
  const laneOf = (a: AudioClip): number => lanes.indexOf(a.id.split('.')[0])
  const rows = Math.max(1, lanes.length) // jede Spur eine Zeile; reicht die Höhe nicht, scrollt der Spurbereich (Zeitleiste oben am Griff größer ziehen)
  const isFileDrag = (e: React.DragEvent): boolean => Array.from(e.dataTransfer.types).includes('Files')

  return (
    <div className="sm-glass" style={{ padding: 14, display: 'grid', gridTemplateRows: 'auto minmax(0, 1fr) auto', gap: 8, minHeight: 0, outline: dropOver ? '2px dashed var(--accent)' : 'none', outlineOffset: -4 }}
      onDragOver={(e) => { if (!isFileDrag(e) || !onAudioFiles) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; setDropOver(true) }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropOver(false) }}
      onDrop={(e) => { if (!isFileDrag(e)) return; e.preventDefault(); setDropOver(false); const r = track.current?.getBoundingClientRect(); const inTrack = !!r && e.clientX >= r.left && e.clientX <= r.right; void addFiles(Array.from(e.dataTransfer.files), inTrack ? snapFrame(toTime(e.clientX), true) : t) }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
        <Button variant="ghost" aria-label="5 Sekunden zurück" onClick={() => onSeek(t - 5)}><SkipBack size={15} /></Button>
        <Button variant="primary" aria-label={playing ? 'Pause' : 'Abspielen'} onClick={onToggle} style={{ width: 44, padding: 0 }}>{playing ? <Pause size={16} /> : <Play size={16} />}</Button>
        <Button variant="ghost" aria-label="5 Sekunden vor" onClick={() => onSeek(t + 5)}><SkipForward size={15} /></Button>
        <Button variant="ghost" aria-label={muted ? 'Ton an' : 'Ton aus'} onClick={onMute}>{muted ? <VolumeX size={15} /> : <Volume2 size={15} />}</Button>
        <input className="sm-range" type="range" aria-label="Lautstärke (nur Vorschau)" title="Lautstärke nur im Editor, nicht im Export" min={0} max={100} value={Math.round(volume * 100)} onChange={(e) => onVolume(Number(e.target.value) / 100)} style={{ width: 80 }} />
        <small title="Position im Clip (Minuten:Sekunden:Bilder) · ←/→ ein Bild, Umschalt ±1 s" style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--text-1)', minWidth: 120 }}>{timecode(Math.max(0, V.fwd(t)))} / {timecode(V.len)}</small>
        <small>Export: <b style={{ color: 'var(--text-1)' }}>{outDuration.toFixed(1)} s</b></small>
        <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <Button variant="ghost" aria-label="Herauszoomen" title="Herauszoomen (Strg + Mausrad)" disabled={zoom <= 1} onClick={() => zoomAtHead(1 / 1.6)}><ZoomOut size={15} /></Button>
          <Button variant="ghost" aria-label="Hineinzoomen" title="Hineinzoomen bis auf einzelne Bilder (Strg + Mausrad)" disabled={zoom >= maxZoom} onClick={() => zoomAtHead(1.6)}><ZoomIn size={15} /></Button>
        </div>
        {/* eigene Gruppe: rutscht geschlossen in die nächste Zeile, statt einzeln umzubrechen */}
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 8, marginLeft: 'auto' }}>
        {onAudioFiles && <Pill onClick={() => fileInput.current?.click()}><Plus size={13} /> Ton</Pill>}
        {onSplit && <Pill onClick={split} title="Am Abspielkopf teilen (S oder Strg+B): Video und alle Tonspuren"><SplitSquareHorizontal size={13} /> Teilen</Pill>}
        {mark === null
          ? <Pill onClick={() => setMark(t)}><Scissors size={13} /> Ab hier markieren</Pill>
          : <>
              <Pill onClick={() => { const a = snapWord(Math.min(mark, t)), b = snapWord(Math.max(mark, t)); if (b - a >= 0.2) onCutRange([a, b]); setMark(null) }}><Scissors size={13} /> Bis hier löschen ({Math.abs(t - mark).toFixed(1)} s)</Pill>
              <Pill onClick={() => setMark(null)}>Abbrechen</Pill>
            </>}
        <Pill onClick={onCheckEnd}><Rewind size={13} /> Ende prüfen</Pill>
        <Pill onClick={() => onTrim([trim[0], Math.min(duration, snapWord(trim[1] + 4))])}><Scissors size={13} /> Satz verlängern</Pill>
        <Pill onClick={() => onTrim([trim[0], Math.max(trim[0] + 1, snapWord(trim[1] - 4))])}><Scissors size={13} /> Satz kürzen</Pill>
        </div>
        <input ref={fileInput} type="file" accept="audio/*,video/*" multiple hidden onChange={(e) => { const f = Array.from(e.target.files ?? []); e.target.value = ''; void addFiles(f, t) }} />
      </div>

      <div ref={scroller} style={{ overflowX: zoom > 1 ? 'auto' : 'hidden', overflowY: 'hidden', minHeight: 0, scrollbarWidth: 'thin' }}>
        <div ref={track} style={{ position: 'relative', width: `${zoom * 100}%`, height: '100%', minHeight: 0, touchAction: 'none', display: 'grid', gridTemplateRows: `minmax(24px, 52px) minmax(24px, 1fr) 22px minmax(${ROW}px, ${rows * ROW}px)`, gap: 4, cursor: 'pointer' }}
          onPointerDown={(e) => { if (grab) return; e.currentTarget.setPointerCapture(e.pointerId); setGrab('head'); setSelAudio(null); setSelSeg(null); onSeek(snapFrame(toTime(e.clientX), true)) }} onPointerMove={move} onPointerUp={up}>
          {/* Filmstreifen: je Stück der passende Ausschnitt; Blöcke mit sichtbarer Fuge, gewählter Block hell umrandet */}
          <div style={{ position: 'relative', borderRadius: 8, overflow: 'hidden' }}>
            {V.spans.map((sp) => {
              const k = strip?.length ?? 0, step = k ? duration / k : 0, L = sp.s1 - sp.s0
              return (
                <div key={`f${sp.s0}`} style={{ position: 'absolute', top: 0, bottom: 0, left: pctO(sp.o0), width: `${(L / A) * 100}%`, overflow: 'hidden', opacity: sp.pad ? 0.3 : 1 }}>
                  {k > 0 && strip!.map((src, i) => (i + 1) * step > sp.s0 && i * step < sp.s1 && <img key={i} src={src} alt="" draggable={false} style={{ position: 'absolute', top: 0, height: '100%', left: `${((i * step - sp.s0) / L) * 100}%`, width: `${(step / L) * 100}%`, objectFit: 'cover' }} />)}
                </div>
              )
            })}
            {blocks.map((b) => {
              const on = !!selSeg && Math.abs(selSeg[0] - b.g[0]) < 1e-6
              return (
                <div key={b.g[0]} role={movable ? 'button' : undefined} tabIndex={movable ? 0 : undefined} aria-label={`Videostück ${timecode(b.o0)} bis ${timecode(b.o1)}`} title={movable ? 'Klick: auswählen · Ziehen: verschieben · Entf: löschen' : undefined}
                  onPointerDown={(e) => segDown(b.g)(e)} onPointerMove={(e) => segMoveEv(e)} onPointerUp={(e) => segUp(e)} onFocus={movable ? () => setSelSeg(b.g) : undefined}
                  onKeyDown={(e) => { if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); e.stopPropagation(); onSegDelete?.(b.g); setSelSeg(null) } }}
                  style={{ position: 'absolute', top: 0, bottom: 0, left: `calc(${pctO(b.o0)} + 1.5px)`, width: `calc(${((b.o1 - b.o0) / A) * 100}% - 3px)`, borderRadius: 6, zIndex: 1, cursor: movable ? 'grab' : undefined,
                    boxShadow: on ? 'inset 0 0 0 2px #fff, 0 0 0 1px rgba(0,0,0,0.6)' : 'inset 0 0 0 1px rgba(255,255,255,0.28)', background: on ? 'rgba(255,255,255,0.12)' : 'transparent' }} />
              )
            })}
            {/* Fugen zwischen den Stücken (Hintergrundfarbe = sichtbare Trennung) */}
            {blocks.slice(1).map((b) => <div key={`j${b.g[0]}`} aria-hidden style={{ position: 'absolute', top: 0, bottom: 0, left: `calc(${pctO(b.o0)} - 1.5px)`, width: 3, background: 'var(--bg, #0a0a0c)', zIndex: 2, pointerEvents: 'none' }} />)}
            {segTarget !== undefined && <div aria-hidden style={{ position: 'absolute', top: -2, bottom: -2, left: `calc(${pctO(segTarget === null ? V.len : V.fwd(segTarget))} - 2px)`, width: 4, background: 'var(--accent)', borderRadius: 2, zIndex: 3, pointerEvents: 'none', boxShadow: '0 0 8px var(--accent)' }} />}
          </div>
          {/* Wellenform je Stück: ziehen = Bereich wählen und pegeln, klicken = springen */}
          <div title={onRange ? 'Ziehen: Bereich im Originalton wählen und lauter/leiser machen' : undefined} style={{ position: 'relative', borderRadius: 8, overflow: 'hidden', cursor: onRange ? 'text' : undefined }}
            onPointerDown={onRange ? (e) => { if (grab) return; e.stopPropagation(); track.current?.setPointerCapture(e.pointerId); rangeFrom.current = snapFrame(toTime(e.clientX), e.altKey, [t, trim[0], trim[1]]); setPending(null); setSelRange(null); setSelAudio(null); setSelSeg(null); setGrab('range') } : undefined}>
            {V.spans.map((sp) => (
              <svg key={`w${sp.s0}`} viewBox={`${(sp.s0 / duration) * wave.n} 0 ${((sp.s1 - sp.s0) / duration) * wave.n} 100`} preserveAspectRatio="none"
                style={{ position: 'absolute', top: 0, height: '100%', left: pctO(sp.o0), width: `${((sp.s1 - sp.s0) / A) * 100}%`, background: 'rgba(0,0,0,0.25)', opacity: sp.pad ? 0.35 : 1 }}>
                <path d={wave.d} fill="rgba(255,255,255,0.55)" />
              </svg>
            ))}
            {blocks.slice(1).map((b) => <div key={`wj${b.g[0]}`} aria-hidden style={{ position: 'absolute', top: 0, bottom: 0, left: `calc(${pctO(b.o0)} - 1.5px)`, width: 3, background: 'var(--bg, #0a0a0c)', zIndex: 2, pointerEvents: 'none' }} />)}
            {vr.map((r) => <div key={r.id} role="button" tabIndex={0} aria-label={`Pegelbereich ${timecode(V.fwd(r.start))} bis ${timecode(V.fwd(r.end))}, ${r.gainDb} dB`} title="Bereich anklicken zum Ändern · Entf: entfernen"
              onPointerDown={(e) => { e.stopPropagation(); setSelRange(r.id); setPending(null); setSelAudio(null) }} onKeyDown={(e) => { if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); e.stopPropagation(); onRange?.(r.id, null); setSelRange(null) } }}
              style={{ position: 'absolute', top: 0, bottom: 0, left: pct(r.start), width: wid(r.start, r.end), zIndex: 1, borderRadius: 4, cursor: 'pointer', background: r.gainDb >= 0 ? 'rgba(255,214,10,0.22)' : 'rgba(10,132,255,0.22)', border: `1px solid ${selRange === r.id ? '#fff' : r.gainDb >= 0 ? 'rgba(255,214,10,0.8)' : 'rgba(10,132,255,0.8)'}`, fontSize: 10, color: '#fff', padding: '1px 4px', overflow: 'hidden', whiteSpace: 'nowrap' }}>{r.gainDb > 0 ? '+' : ''}{r.gainDb} dB</div>)}
            {pending && <div aria-hidden style={{ position: 'absolute', top: 0, bottom: 0, left: pct(pending[0]), width: wid(pending[0], pending[1]), zIndex: 1, borderRadius: 4, background: 'rgba(255,255,255,0.16)', border: '1px dashed #fff', pointerEvents: 'none' }} />}
          </div>
          {/* Einstellungen (Bildausschnitt) je Stück */}
          <div style={{ position: 'relative', borderRadius: 6, overflow: 'hidden', background: 'rgba(255,255,255,0.04)' }}>
            {V.spans.filter((sp) => !sp.pad).flatMap((sp) => shots.filter((x) => x.end > sp.s0 && x.start < sp.s1).map((x) => {
              const a = Math.max(x.start, sp.s0), b = Math.min(x.end, sp.s1)
              return <div key={`${sp.s0}-${x.start}`} title={`${LAYOUT_LABEL[x.layout]}${x.auto ? ' (automatisch: keine Person im Ausschnitt → Vollbild)' : ''} · ${fmt(x.start)}–${fmt(x.end)}`} style={{ position: 'absolute', top: 2, bottom: 2, left: pctO(sp.o0 + (a - sp.s0)), width: `${((b - a) / A) * 100}%`, background: LAYOUT_COLOR[x.layout], borderRadius: 4, fontSize: 10, lineHeight: '18px', paddingLeft: 4, overflow: 'hidden', whiteSpace: 'nowrap', color: '#fff', ...(x.auto ? { outline: '1px dashed var(--warn)' } : {}) }}>{((b - a) / A) * zoom >= 0.035 && <>{LAYOUT_LABEL[x.layout]}{x.auto ? ' · auto' : ''}</>}</div>
            }))}
          </div>
          {/* Tonspuren */}
          <div style={{ position: 'relative', borderRadius: 6, background: 'rgba(255,255,255,0.03)', overflowY: 'auto', overflowX: 'hidden' }}>
            {!audio.length && <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, fontSize: 11, color: 'var(--text-2)', border: '1px dashed rgba(255,255,255,0.18)', borderRadius: 6, pointerEvents: 'none' }}><Music size={12} /> {busy || 'Soundeffekte oder Musik hierher ziehen'}</div>}
            {audio.filter((a) => !a.deleted).map((a) => { // gelöschte Tonstücke verschwinden wie ihr Videostück (↺ bringt beides zurück)
              const ed = edgeLive?.id === a.id ? edgeLive : null
              const at = ed ? ed.at : dragAt?.id === a.id ? dragAt.at : a.at
              const dur = ed ? ed.dur : a.dur
              const on = selAudio === a.id
              return (
                <div key={a.id} role="button" tabIndex={0} aria-label={`Tonspur ${a.name}, ${a.gainDb} dB`} title={`${a.name} · ${a.gainDb > 0 ? '+' : ''}${a.gainDb} dB · ziehen zum Verschieben (Alt: ohne Einrasten), Ränder ziehen zum Kürzen, S: am Abspielkopf teilen, Pfeiltasten: 1 Bild, Entf: entfernen`}
                  onPointerDown={audioDown(a)} onPointerMove={audioMove(a)} onPointerUp={audioUp(a)} onKeyDown={audioKey(a)} onFocus={() => setSelAudio(a.id)}
                  style={{ position: 'absolute', top: laneOf(a) * ROW + 2, height: ROW - 4, left: `calc(${pct(at)} + 1px)`, width: `calc(max(14px, ${(dur / A) * 100}%) - 2px)`, textDecoration: a.deleted ? 'line-through' : undefined, borderRadius: 5, cursor: grab === 'audio' && on ? 'grabbing' : 'grab', overflow: 'hidden', whiteSpace: 'nowrap', fontSize: 10.5, lineHeight: `${ROW - 4}px`, padding: '0 6px', color: '#fff', outline: on ? '2px solid #fff' : 'none', outlineOffset: -1,
                    background: a.kind === 'music' ? 'linear-gradient(180deg, rgba(175,82,222,0.75), rgba(120,50,170,0.75))' : 'linear-gradient(180deg, rgba(48,176,199,0.8), rgba(30,120,140,0.8))', opacity: a.deleted ? 0.28 : a.gainDb <= GAIN_MIN_DB ? 0.4 : 1 }}>
                  {a.kind === 'music' ? '♪ ' : ''}{a.name}{a.gainDb !== 0 ? ` · ${a.gainDb > 0 ? '+' : ''}${a.gainDb} dB` : ''}
                  {on && (['l', 'r'] as const).map((side) => <span key={side} aria-hidden title={side === 'l' ? 'Anfang kürzen/verlängern' : 'Ende kürzen/verlängern'} onPointerDown={edgeDown(a, side)} onPointerMove={edgeMove(a)} onPointerUp={edgeUp(a)}
                    style={{ position: 'absolute', top: 0, bottom: 0, [side === 'l' ? 'left' : 'right']: 0, width: 7, cursor: 'ew-resize', background: 'rgba(255,255,255,0.85)' }} />)}
                </div>
              )
            })}
          </div>
          {mark !== null && <div aria-hidden style={{ position: 'absolute', top: 0, bottom: 0, left: pct(Math.min(mark, t)), width: wid(Math.min(mark, t), Math.max(mark, t)), background: 'rgba(255,80,80,0.28)', border: '1px solid rgba(255,120,120,0.9)', borderRadius: 6, pointerEvents: 'none' }} />}
          {ranges.map((r, i) => <button key={`r${i}`} type="button" title={`Gelöscht ${fmt(r[1] - r[0])} s · Klicken zum Wiederherstellen`} aria-label={`Gelöschtes Stück (${(r[1] - r[0]).toFixed(1)} s) wiederherstellen`} onPointerDown={(e) => e.stopPropagation()} onClick={() => onRestoreRange(r)}
            style={{ position: 'absolute', top: 3, left: `calc(${pct(r[0])} - 9px)`, width: 18, height: 18, zIndex: 4, border: 'none', borderRadius: 9, background: 'rgba(0,0,0,0.75)', color: '#fff', fontSize: 11, lineHeight: '18px', padding: 0, cursor: 'pointer', boxShadow: '0 0 0 1px rgba(255,255,255,0.5)' }}>↺</button>)}
          {/* außerhalb des Beschnitts abdunkeln */}
          <div style={{ position: 'absolute', top: 0, bottom: 0, left: 0, width: pctO(inO), background: 'rgba(0,0,0,0.45)', pointerEvents: 'none' }} />
          <div style={{ position: 'absolute', top: 0, bottom: 0, right: 0, width: `calc(100% - ${pctO(outO)})`, background: 'rgba(0,0,0,0.45)', pointerEvents: 'none' }} />
          <div style={{ position: 'absolute', top: 0, bottom: 0, left: pctO(inO), width: `calc(${pctO(outO)} - ${pctO(inO)})`, border: '2px solid var(--accent)', borderRadius: 10, pointerEvents: 'none', boxShadow: 'var(--accent-glow)' }} />
          {(['in', 'out'] as const).map((w) => (
            <motion.div key={w} role="slider" aria-label={w === 'in' ? 'Start (Pfeiltasten: 1 Bild)' : 'Ende (Pfeiltasten: 1 Bild)'} aria-valuenow={trim[w === 'in' ? 0 : 1]} aria-valuetext={timecode(w === 'in' ? 0 : V.len)} tabIndex={0}
              animate={{ scale: grab === w ? 1.18 : 1, y: grab === w ? -3 : 0 }} transition={base}
              onPointerDown={down(w)} onKeyDown={nudge(w)} style={{ position: 'absolute', top: -4, bottom: 0, left: `calc(${pctO(w === 'in' ? inO : outO)} - 8px)`, width: 16, padding: '0 5px', borderRadius: 8, background: '#fff', backgroundClip: 'content-box', filter: 'drop-shadow(0 1px 4px rgba(0,0,0,0.5))', cursor: 'ew-resize', zIndex: 3 }} />
          ))}
          <div style={{ position: 'absolute', top: -6, bottom: -2, left: pct(t), width: 2, background: '#fff', pointerEvents: 'none', boxShadow: '0 0 8px rgba(255,255,255,0.8)', zIndex: 4 }}>
            <span style={{ position: 'absolute', top: -2, left: -5, width: 12, height: 12, background: '#fff', borderRadius: '3px 3px 6px 6px' }} />
          </div>
        </div>
      </div>

      {/* Pegel: gewählte Spur, gewählter/neuer Bereich im Originalton oder Originalton gesamt */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: 28, fontSize: 12 }}>
        {flash ? <span role="status" style={{ fontWeight: 700, color: '#FFD60A' }}>{flash}</span> : !sel && (curRange || pending) ? <>
          <span style={{ fontWeight: 600 }}>Originalton-Bereich</span>
          <small style={{ fontVariantNumeric: 'tabular-nums' }}>{timecode(Math.max(0, V.fwd(curRange?.start ?? pending![0])))}–{timecode(Math.max(0, V.fwd(curRange?.end ?? pending![1])))}</small>
          <GainSlider label="Pegel des Bereichs" value={curRange?.gainDb ?? 0} onCommit={(db) => { if (curRange) onRange?.(curRange.id, { gainDb: db }); else if (pending) { const id = Math.random().toString(36).slice(2, 10); onRange?.(id, { start: pending[0], end: pending[1], gainDb: db }, true); setPending(null); setSelRange(id) } }} />
          {curRange && <Button variant="ghost" aria-label="Bereich entfernen" title="Bereich entfernen (Entf)" onClick={() => { onRange?.(curRange.id, null); setSelRange(null) }}><Trash2 size={14} /></Button>}
          {!curRange && <small style={{ color: 'var(--text-2)' }}>Regler bewegen, um den Bereich lauter oder leiser zu machen</small>}
          {(curRange?.gainDb ?? 0) > 0 && <small style={{ color: 'var(--text-2)' }}>Lauter geht nur bis zur Aussteuerungsgrenze – Spitzen werden abgefangen statt zu verzerren</small>}
          <Button variant="ghost" onClick={() => { setPending(null); setSelRange(null) }}>Fertig</Button>
        </> : sel ? <>
          <span style={{ fontWeight: 600, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sel.kind === 'music' ? '♪ ' : ''}{sel.name}</span>
          <small style={{ fontVariantNumeric: 'tabular-nums' }}>ab {timecode(Math.max(0, V.fwd(sel.at)))}</small>
          <GainSlider label={`Pegel ${sel.name}`} value={sel.gainDb} onCommit={(db) => onAudio(sel.id, { gainDb: db })} />
          <Button variant="ghost" aria-label={`${sel.name} entfernen`} title="Spur entfernen (Entf)" onClick={() => { onAudio(sel.id, null); setSelAudio(null) }}><Trash2 size={14} /></Button>
        </> : <>
          <span style={{ color: 'var(--text-2)' }}>Originalton</span>
          <GainSlider label="Pegel Originalton" value={voiceDb} onCommit={onVoiceDb} />
          {busy && audio.length > 0 && <small style={{ color: 'var(--text-2)' }}>{busy}</small>}
          {!busy && <small style={{ color: 'var(--text-2)' }}>In der Wellenform ziehen: Bereich lauter/leiser · Spur anklicken zum Pegeln · Strg + Mausrad zoomt</small>}
        </>}
      </div>
    </div>
  )
}

/** dB-Regler: Vorschau beim Ziehen, eine Operation beim Loslassen (sonst Log-Flut); Doppelklick = 0 dB. */
function GainSlider({ label, value, onCommit }: { label: string; value: number; onCommit: (db: number) => void }): React.JSX.Element {
  const [draft, setDraft] = useState<number | null>(null)
  const v = draft ?? value
  const done = (): void => { if (draft !== null && draft !== value) onCommit(draft); setDraft(null) }
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      <input className="sm-range" type="range" aria-label={label} min={GAIN_MIN_DB} max={GAIN_MAX_DB} step={0.5} value={v} style={{ width: 160 }}
        onChange={(e) => setDraft(Number(e.target.value))} onPointerUp={done} onKeyUp={done} onBlur={done} onDoubleClick={() => { setDraft(null); onCommit(0) }} />
      <small style={{ fontVariantNumeric: 'tabular-nums', minWidth: 56 }}>{v <= GAIN_MIN_DB ? 'stumm' : `${v > 0 ? '+' : ''}${v.toFixed(1)} dB`}</small>
    </span>
  )
}
