// Editor-Zeitleiste: Filmstreifen, Wellenform, Einstellungen, Tonspuren. Bildgenau: Griffe und Spuren rasten auf Bilder (30 fps) ein,
// nahe Wortgrenzen/Abspielkopf magnetisch (Alt hält das Einrasten aus), Pfeiltasten auf einem Griff = 1 Bild (Umschalt = 10), Zoom bis ~12 px je Bild.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'motion/react'
import { Play, Pause, Scissors, Rewind, SkipBack, SkipForward, Volume2, VolumeX, ZoomIn, ZoomOut, Music, Plus, Trash2 } from 'lucide-react'
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
  audio: AudioClip[]; voiceDb: number
  onAudioFiles?: (files: File[], at: number) => Promise<void>
  onAudio: (id: string, patch: { at?: number; gainDb?: number } | null) => void
  onVoiceDb: (db: number) => void
  /** Pegel einzelner Bereiche des Originaltons (Zeiten relativ zur Zeitleiste); in der Wellenform ziehen = Bereich wählen. */
  gainRanges?: VoiceRange[]
  onRange?: (id: string, r: Partial<Omit<VoiceRange, 'id'>> | null, create?: boolean) => void
}

export function Timeline({ duration, trim, t, onSeek, words, playing, onToggle, muted, onMute, volume, onVolume, peaks, strip, cuts, shots, outDuration, onTrim, onPreview, onCheckEnd, base, ranges, onCutRange, onRestoreRange, origin, audio, voiceDb, onAudioFiles, onAudio, onVoiceDb, gainRanges: vr = [], onRange }: TimelineProps): React.JSX.Element {
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

  const bounds = useMemo(() => words.flatMap((w, i) => [w.t, words[i + 1]?.t ?? duration]), [words, duration])
  /** Nächste Wortgrenze (für „Satz verlängern/kürzen“ und „Bis hier löschen“). */
  const snapWord = useCallback((x: number) => bounds.reduce((b, c) => (Math.abs(c - x) < Math.abs(b - x) ? c : b), bounds[0] ?? x), [bounds])
  const pxPerSec = (viewW * zoom) / Math.max(0.001, duration)
  /** Bildraster der Quelle; nahe einer Wortgrenze (oder `extra`, z. B. Abspielkopf) magnetisch, mit Alt frei aufs Bild. */
  const snapFrame = useCallback((x: number, free: boolean, extra: number[] = []): number => {
    const frame = Math.round((x + origin) / FRAME) * FRAME - origin
    if (free) return frame
    const near = [...extra, snapWord(x)].reduce((b, c) => (Math.abs(c - x) < Math.abs(b - x) ? c : b))
    return Math.abs(near - x) * pxPerSec <= MAGNET_PX ? near : frame
  }, [origin, snapWord, pxPerSec])
  const toTime = (clientX: number): number => { const r = track.current!.getBoundingClientRect(); return ((clientX - r.left) / r.width) * duration }
  const pct = (x: number): string => `${(Math.min(duration, Math.max(0, x)) / duration) * 100}%`
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
  const maxZoom = Math.max(1, (duration * FPS * 12) / Math.max(200, viewW))
  const zoomTo = (z: number, at: { time: number; x: number }): void => { anchor.current = at; setZoom(Math.min(maxZoom, Math.max(1, z))) }
  // Nach dem Zoomen bleibt die Zeit unter dem Mauszeiger (bzw. der Abspielkopf) an derselben Stelle
  useLayoutEffect(() => {
    const el = scroller.current, a = anchor.current
    if (!el || !a) return
    anchor.current = null
    el.scrollLeft = (a.time / duration) * el.scrollWidth - a.x
  }, [zoom, duration])
  useEffect(() => {
    const el = scroller.current
    if (!el) return
    const wheel = (e: WheelEvent): void => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault()
        const r = el.getBoundingClientRect()
        const x = e.clientX - r.left
        zoomTo(zoom * Math.exp(-e.deltaY * 0.0025), { time: ((el.scrollLeft + x) / el.scrollWidth) * duration, x })
      } else if (zoom > 1 && Math.abs(e.deltaY) > Math.abs(e.deltaX)) { e.preventDefault(); el.scrollLeft += e.deltaY }
    }
    el.addEventListener('wheel', wheel, { passive: false })
    return () => el.removeEventListener('wheel', wheel)
  })
  const zoomAtHead = (f: number): void => { const el = scroller.current; if (!el) return; const x = (t / duration) * el.scrollWidth - el.scrollLeft; zoomTo(zoom * f, { time: t, x: Math.min(el.clientWidth, Math.max(0, x)) }) }
  // Beim Abspielen bleibt der Kopf sichtbar
  useEffect(() => {
    const el = scroller.current
    if (!el || zoom <= 1 || grab) return
    const x = (t / duration) * el.scrollWidth
    if (x < el.scrollLeft + 20 || x > el.scrollLeft + el.clientWidth - 20) el.scrollLeft = x - (playing ? el.clientWidth * 0.1 : el.clientWidth / 2)
  }, [t, zoom, duration, playing, grab])

  // ---------- Ziehen ----------
  const down = (which: 'in' | 'out') => (e: React.PointerEvent): void => {
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    live.current = trim
    offset.current = toTime(e.clientX) - trim[which === 'in' ? 0 : 1] // Grab-Offset: 1:1, kein Springen zur Mitte
    setGrab(which)
  }
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
    const next = setTrim(grab, snapFrame(toTime(e.clientX) - offset.current, e.altKey, [t]))
    live.current = next
    onPreview(next)
  }
  const up = (): void => {
    if (!grab) return
    const was = grab
    setGrab(null)
    // kein Ziehen in der Wellenform = wie bisher springen
    if (was === 'range') { if (!pending || pending[1] - pending[0] < 2 * FRAME) { setPending(null); onSeek(rangeFrom.current) } return }
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
  const curRange = vr.find((r) => r.id === selRange)
  const rows = Math.min(3, Math.max(1, audio.length))
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
        <small title="Position im Clip (Minuten:Sekunden:Bilder) · ←/→ ein Bild, Umschalt ±1 s" style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--text-1)', minWidth: 120 }}>{timecode(Math.max(0, t - trim[0]))} / {timecode(trim[1] - trim[0])}</small>
        <small>Export: <b style={{ color: 'var(--text-1)' }}>{outDuration.toFixed(1)} s</b></small>
        <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <Button variant="ghost" aria-label="Herauszoomen" title="Herauszoomen (Strg + Mausrad)" disabled={zoom <= 1} onClick={() => zoomAtHead(1 / 1.6)}><ZoomOut size={15} /></Button>
          <Button variant="ghost" aria-label="Hineinzoomen" title="Hineinzoomen bis auf einzelne Bilder (Strg + Mausrad)" disabled={zoom >= maxZoom} onClick={() => zoomAtHead(1.6)}><ZoomIn size={15} /></Button>
        </div>
        {/* eigene Gruppe: rutscht geschlossen in die nächste Zeile, statt einzeln umzubrechen */}
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 8, marginLeft: 'auto' }}>
        {onAudioFiles && <Pill onClick={() => fileInput.current?.click()}><Plus size={13} /> Ton</Pill>}
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
        <div ref={track} style={{ position: 'relative', width: `${zoom * 100}%`, height: '100%', minHeight: 0, touchAction: 'none', display: 'grid', gridTemplateRows: `minmax(24px, 52px) minmax(24px, 1fr) 22px ${rows * ROW}px`, gap: 4, cursor: 'pointer' }}
          onPointerDown={(e) => { if (grab) return; e.currentTarget.setPointerCapture(e.pointerId); setGrab('head'); setSelAudio(null); onSeek(snapFrame(toTime(e.clientX), true)) }} onPointerMove={move} onPointerUp={up}>
          {/* Filmstreifen */}
          <div style={{ display: 'flex', borderRadius: 8, overflow: 'hidden', background: 'rgba(255,255,255,0.05)' }}>
            {(strip ?? []).map((s, i) => <img key={i} src={s} alt="" draggable={false} style={{ flex: 1, minWidth: 0, height: '100%', objectFit: 'cover', display: 'block' }} />)}
          </div>
          {/* Wellenform: ziehen = Bereich wählen und pegeln, klicken = springen */}
          <div title={onRange ? 'Ziehen: Bereich im Originalton wählen und lauter/leiser machen' : undefined} style={{ position: 'relative', borderRadius: 8, background: 'rgba(0,0,0,0.25)', cursor: onRange ? 'text' : undefined }}
            onPointerDown={onRange ? (e) => { if (grab) return; e.stopPropagation(); track.current?.setPointerCapture(e.pointerId); rangeFrom.current = snapFrame(toTime(e.clientX), e.altKey, [t, trim[0], trim[1]]); setPending(null); setSelRange(null); setSelAudio(null); setGrab('range') } : undefined}>
            <svg viewBox={`0 0 ${wave.n} 100`} preserveAspectRatio="none" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
              <path d={wave.d} fill="rgba(255,255,255,0.55)" />
            </svg>
            {vr.map((r) => <div key={r.id} role="button" tabIndex={0} aria-label={`Pegelbereich ${timecode(r.start - trim[0])} bis ${timecode(r.end - trim[0])}, ${r.gainDb} dB`} title="Bereich anklicken zum Ändern · Entf: entfernen"
              onPointerDown={(e) => { e.stopPropagation(); setSelRange(r.id); setPending(null); setSelAudio(null) }} onKeyDown={(e) => { if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); e.stopPropagation(); onRange?.(r.id, null); setSelRange(null) } }}
              style={{ position: 'absolute', top: 0, bottom: 0, left: pct(r.start), width: `calc(${pct(r.end)} - ${pct(r.start)})`, zIndex: 1, borderRadius: 4, cursor: 'pointer', background: r.gainDb >= 0 ? 'rgba(255,214,10,0.22)' : 'rgba(10,132,255,0.22)', border: `1px solid ${selRange === r.id ? '#fff' : r.gainDb >= 0 ? 'rgba(255,214,10,0.8)' : 'rgba(10,132,255,0.8)'}`, fontSize: 10, color: '#fff', padding: '1px 4px', overflow: 'hidden', whiteSpace: 'nowrap' }}>{r.gainDb > 0 ? '+' : ''}{r.gainDb} dB</div>)}
            {pending && <div aria-hidden style={{ position: 'absolute', top: 0, bottom: 0, left: pct(pending[0]), width: `calc(${pct(pending[1])} - ${pct(pending[0])})`, zIndex: 1, borderRadius: 4, background: 'rgba(255,255,255,0.16)', border: '1px dashed #fff', pointerEvents: 'none' }} />}
            {cuts.map((c, i) => <div key={i} title="Wird im Export entfernt" style={{ position: 'absolute', top: 0, bottom: 0, left: pct(c[0]), width: `calc(${pct(c[1])} - ${pct(c[0])})`, background: 'repeating-linear-gradient(135deg, rgba(255,255,255,0.38) 0 4px, rgba(255,255,255,0.1) 4px 8px)', borderLeft: '1px solid rgba(255,255,255,0.8)', borderRight: '1px solid rgba(255,255,255,0.8)' }} />)}
          </div>
          {/* Shots */}
          <div style={{ position: 'relative', borderRadius: 6, background: 'rgba(255,255,255,0.04)' }}>
            {shots.map((s, i) => <div key={i} title={`${LAYOUT_LABEL[s.layout]}${s.auto ? ' (automatisch: keine Person im Ausschnitt → Vollbild)' : ''} · ${fmt(s.start)}–${fmt(s.end)}`} style={{ position: 'absolute', top: 2, bottom: 2, left: pct(s.start), width: `calc(${pct(s.end)} - ${pct(s.start)})`, background: LAYOUT_COLOR[s.layout], borderRadius: 4, fontSize: 10, lineHeight: '18px', paddingLeft: 4, overflow: 'hidden', whiteSpace: 'nowrap', color: '#fff', ...(s.auto ? { outline: '1px dashed var(--warn)' } : {}) }}>{((s.end - s.start) / duration) * zoom >= 0.035 && <>{LAYOUT_LABEL[s.layout]}{s.auto ? ' · auto' : ''}</>}</div>)}{/* schmale Einstellungen ohne Text, Name steht im Tooltip */}
          </div>
          {/* Tonspuren */}
          <div style={{ position: 'relative', borderRadius: 6, background: 'rgba(255,255,255,0.03)', overflowY: audio.length > 3 ? 'auto' : 'hidden', overflowX: 'hidden' }}>
            {!audio.length && <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, fontSize: 11, color: 'var(--text-2)', border: '1px dashed rgba(255,255,255,0.18)', borderRadius: 6, pointerEvents: 'none' }}><Music size={12} /> {busy || 'Soundeffekte oder Musik hierher ziehen'}</div>}
            {audio.map((a, i) => {
              const at = dragAt?.id === a.id ? dragAt.at : a.at
              const on = selAudio === a.id
              return (
                <div key={a.id} role="button" tabIndex={0} aria-label={`Tonspur ${a.name}, ${a.gainDb} dB`} title={`${a.name} · ${a.gainDb > 0 ? '+' : ''}${a.gainDb} dB · ziehen zum Verschieben (Alt: ohne Einrasten), Pfeiltasten: 1 Bild, Entf: entfernen`}
                  onPointerDown={audioDown(a)} onPointerMove={audioMove(a)} onPointerUp={audioUp(a)} onKeyDown={audioKey(a)} onFocus={() => setSelAudio(a.id)}
                  style={{ position: 'absolute', top: i * ROW + 2, height: ROW - 4, left: pct(at), width: `max(14px, ${(a.dur / duration) * 100}%)`, borderRadius: 5, cursor: grab === 'audio' && on ? 'grabbing' : 'grab', overflow: 'hidden', whiteSpace: 'nowrap', fontSize: 10.5, lineHeight: `${ROW - 4}px`, padding: '0 6px', color: '#fff', outline: on ? '2px solid #fff' : 'none', outlineOffset: -1,
                    background: a.kind === 'music' ? 'linear-gradient(180deg, rgba(175,82,222,0.75), rgba(120,50,170,0.75))' : 'linear-gradient(180deg, rgba(48,176,199,0.8), rgba(30,120,140,0.8))', opacity: a.gainDb <= GAIN_MIN_DB ? 0.4 : 1 }}>
                  {a.kind === 'music' ? '♪ ' : ''}{a.name}{a.gainDb !== 0 ? ` · ${a.gainDb > 0 ? '+' : ''}${a.gainDb} dB` : ''}
                </div>
              )
            })}
          </div>
          {mark !== null && <div aria-hidden style={{ position: 'absolute', top: 0, bottom: 0, left: pct(Math.min(mark, t)), width: `calc(${pct(Math.max(mark, t))} - ${pct(Math.min(mark, t))})`, background: 'rgba(255,80,80,0.28)', border: '1px solid rgba(255,120,120,0.9)', borderRadius: 6, pointerEvents: 'none' }} />}
          {ranges.map((r, i) => <button key={`r${i}`} type="button" title={`Gelöscht ${fmt(r[0])}–${fmt(r[1])} · Klicken zum Wiederherstellen`} aria-label={`Gelöschten Bereich ${fmt(r[0])} bis ${fmt(r[1])} wiederherstellen`} onPointerDown={(e) => e.stopPropagation()} onClick={() => onRestoreRange(r)} style={{ position: 'absolute', top: 4, height: 18, left: pct(r[0]), width: `calc(${pct(r[1])} - ${pct(r[0])})`, minWidth: 14, zIndex: 2, border: '1px solid rgba(255,255,255,0.8)', borderRadius: 6, background: 'rgba(255,80,80,0.35)', color: '#fff', fontSize: 11, lineHeight: '16px', padding: 0, cursor: 'pointer', overflow: 'hidden' }}>↺</button>)}
          {/* außerhalb des Beschnitts abdunkeln */}
          <div style={{ position: 'absolute', top: 0, bottom: rows * ROW + 4, left: 0, width: pct(trim[0]), background: 'rgba(0,0,0,0.55)', pointerEvents: 'none' }} />
          <div style={{ position: 'absolute', top: 0, bottom: rows * ROW + 4, right: 0, width: `calc(100% - ${pct(trim[1])})`, background: 'rgba(0,0,0,0.55)', pointerEvents: 'none' }} />
          <div style={{ position: 'absolute', top: 0, bottom: rows * ROW + 4, left: pct(trim[0]), width: `calc(${pct(trim[1])} - ${pct(trim[0])})`, border: '2px solid var(--accent)', borderRadius: 10, pointerEvents: 'none', boxShadow: 'var(--accent-glow)' }} />
          {(['in', 'out'] as const).map((w) => (
            <motion.div key={w} role="slider" aria-label={w === 'in' ? 'Start (Pfeiltasten: 1 Bild)' : 'Ende (Pfeiltasten: 1 Bild)'} aria-valuenow={trim[w === 'in' ? 0 : 1]} aria-valuetext={timecode(trim[w === 'in' ? 0 : 1] - trim[0])} tabIndex={0}
              animate={{ scale: grab === w ? 1.18 : 1, y: grab === w ? -3 : 0 }} transition={base}
              onPointerDown={down(w)} onKeyDown={nudge(w)} style={{ position: 'absolute', top: -4, bottom: rows * ROW, left: `calc(${pct(trim[w === 'in' ? 0 : 1])} - 8px)`, width: 16, padding: '0 5px', borderRadius: 8, background: '#fff', backgroundClip: 'content-box', filter: 'drop-shadow(0 1px 4px rgba(0,0,0,0.5))', cursor: 'ew-resize', zIndex: 3 }} />
          ))}
          <div style={{ position: 'absolute', top: -6, bottom: -2, left: pct(t), width: 2, background: '#fff', pointerEvents: 'none', boxShadow: '0 0 8px rgba(255,255,255,0.8)', zIndex: 4 }}>
            <span style={{ position: 'absolute', top: -2, left: -5, width: 12, height: 12, background: '#fff', borderRadius: '3px 3px 6px 6px' }} />
          </div>
        </div>
      </div>

      {/* Pegel: gewählte Spur, gewählter/neuer Bereich im Originalton oder Originalton gesamt */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: 28, fontSize: 12 }}>
        {!sel && (curRange || pending) ? <>
          <span style={{ fontWeight: 600 }}>Originalton-Bereich</span>
          <small style={{ fontVariantNumeric: 'tabular-nums' }}>{timecode(Math.max(0, (curRange?.start ?? pending![0]) - trim[0]))}–{timecode(Math.max(0, (curRange?.end ?? pending![1]) - trim[0]))}</small>
          <GainSlider label="Pegel des Bereichs" value={curRange?.gainDb ?? 0} onCommit={(db) => { if (curRange) onRange?.(curRange.id, { gainDb: db }); else if (pending) { const id = Math.random().toString(36).slice(2, 10); onRange?.(id, { start: pending[0], end: pending[1], gainDb: db }, true); setPending(null); setSelRange(id) } }} />
          {curRange && <Button variant="ghost" aria-label="Bereich entfernen" title="Bereich entfernen (Entf)" onClick={() => { onRange?.(curRange.id, null); setSelRange(null) }}><Trash2 size={14} /></Button>}
          {!curRange && <small style={{ color: 'var(--text-2)' }}>Regler bewegen, um den Bereich lauter oder leiser zu machen</small>}
          {(curRange?.gainDb ?? 0) > 0 && <small style={{ color: 'var(--text-2)' }}>Lauter geht nur bis zur Aussteuerungsgrenze – Spitzen werden abgefangen statt zu verzerren</small>}
          <Button variant="ghost" onClick={() => { setPending(null); setSelRange(null) }}>Fertig</Button>
        </> : sel ? <>
          <span style={{ fontWeight: 600, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sel.kind === 'music' ? '♪ ' : ''}{sel.name}</span>
          <small style={{ fontVariantNumeric: 'tabular-nums' }}>ab {timecode(Math.max(0, sel.at - trim[0]))}</small>
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
