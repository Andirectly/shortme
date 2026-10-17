import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'motion/react'
import { ArrowLeft, Play, Pause, Undo2, Redo2, Scissors, Rewind, Monitor, ShieldCheck, Check } from 'lucide-react'
import { useStore } from './store'
import { IMG, PRESETS, TRANSCRIPT } from './data'
import { useClipList } from './clipData'
import { useProject } from './projectStore'
import { Button, Pill, Segmented, Slider, Switch, Row } from './ui'
import { useSprings } from './motion'

const WAVE = Array.from({ length: 160 }, (_, i) => 0.25 + 0.75 * Math.abs(Math.sin(i * 0.37) * Math.cos(i * 0.113 + 1.3)))
const ZONES: Record<string, { top: number; bottom: number; right: number }> = { TikTok: { top: 0.12, bottom: 0.2, right: 0.14 }, Reels: { top: 0.1, bottom: 0.18, right: 0.1 }, Shorts: { top: 0.1, bottom: 0.22, right: 0.12 } }

export function EditorScreen(): React.JSX.Element {
  const clipId = useStore((s) => s.activeClip)
  const list = useClipList()
  const clip = list.find((c) => c.id === clipId) ?? list[0]
  const real = useProject((s) => s.clipsFile?.clips.find((c) => c.id === clipId))
  const transcript = useProject((s) => s.transcript)
  const exportClips = useProject((s) => s.exportClips)
  const exportJob = useProject((s) => s.exportJob)
  const trim = useStore((s) => s.trim)
  const hook = useStore((s) => s.hookText)
  const presetId = useStore((s) => s.presetId)
  const go = useStore((s) => s.go)
  const apply = useStore((s) => s.apply)
  const undo = useStore((s) => s.undo)
  const redo = useStore((s) => s.redo)
  const canUndo = useStore((s) => s.undoStack.length > 0)
  const canRedo = useStore((s) => s.redoStack.length > 0)
  const setTrim = useStore((s) => s.setTrim)
  const setHook = useStore((s) => s.setHook)
  const { base } = useSprings()

  const words = useMemo(() => (real && transcript
    ? transcript.words.slice(real.firstWord, real.lastWord + 1).map((w, i) => ({ w: w.w, t: Math.max(0, w.start - real.start), hi: real.tags.some((g) => g.word === real.firstWord + i) }))
    : TRANSCRIPT.map((w, i) => ({ ...w, t: (i * clip.duration) / TRANSCRIPT.length }))), [clip.duration, real, transcript])
  const [cut, setCut] = useState<number[]>([])
  const [t, setT] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [tab, setTab] = useState('Untertitel')
  const [showSource, setShowSource] = useState(true)
  const [zone, setZone] = useState('Aus')
  const [hl, setHl] = useState(true)
  const [size, setSize] = useState(60)
  const [pos, setPos] = useState(68)
  const [layout, setLayout] = useState('Smart')
  const [person, setPerson] = useState('Person links')
  const [saved, setSaved] = useState(true)
  const preset = PRESETS.find((p) => p.id === presetId)!

  // Autosave (lokal): Beschnitt, Schnitte, Hook
  useEffect(() => {
    setSaved(false)
    const id = setTimeout(() => { try { localStorage.setItem(`sm.edit.${clipId}`, JSON.stringify({ trim, cut, hook })) } catch { /* ignore */ } setSaved(true) }, 600)
    return () => clearTimeout(id)
  }, [trim, cut, hook, clipId])
  useEffect(() => {
    try { const v = localStorage.getItem(`sm.edit.${clipId}`); if (v) { const d = JSON.parse(v); setCut(d.cut ?? []); setTrim(d.trim); setHook(d.hook) } } catch { /* ignore */ }
  }, [clipId, setTrim, setHook])

  // Wiedergabe-Simulation
  useEffect(() => {
    if (!playing) return
    let last = performance.now(); let raf = 0
    const step = (n: number): void => { const dt = (n - last) / 1000; last = n; setT((x) => { const nx = x + dt; if (nx >= trim[1]) { setPlaying(false); return trim[1] } return nx }); raf = requestAnimationFrame(step) }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [playing, trim])

  useEffect(() => {
    const k = (e: KeyboardEvent): void => {
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      if (e.ctrlKey && e.key.toLowerCase() === 'z') { e.preventDefault(); undo() }
      else if (e.ctrlKey && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) { e.preventDefault(); redo() }
      else if (e.key === ' ') { e.preventDefault(); setPlaying((p) => !p) }
    }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [undo, redo])

  const toggleCut = (i: number): void => {
    const was = cut.includes(i)
    apply({ label: 'Zeile', undo: () => setCut((c) => (was ? [...c, i] : c.filter((x) => x !== i))), redo: () => setCut((c) => (was ? c.filter((x) => x !== i) : [...c, i])) })
  }
  const curIdx = Math.max(0, words.findLastIndex((w) => w.t <= t))
  const cap = words.slice(Math.floor(curIdx / 3) * 3, Math.floor(curIdx / 3) * 3 + 3)
  const zn = ZONES[zone]

  return (
    <div style={{ display: 'grid', gridTemplateRows: 'auto 1fr 170px', gap: 12, height: 'calc(100vh - 60px)', paddingTop: 4 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <Button variant="ghost" aria-label="Zurück" onClick={() => go('clips')}><ArrowLeft size={18} /></Button>
        <h2 style={{ flex: 1 }}>{clip.title}</h2>
        <small style={{ display: 'flex', alignItems: 'center', gap: 4 }}>{saved ? <><Check size={13} /> Gespeichert</> : 'Speichert …'}</small>
        <Button variant="ghost" aria-label="Rückgängig (Strg+Z)" disabled={!canUndo} onClick={undo}><Undo2 size={16} /></Button>
        <Button variant="ghost" aria-label="Wiederholen (Strg+Y)" disabled={!canRedo} onClick={redo}><Redo2 size={16} /></Button>
        <Button variant="primary" disabled={exportJob?.state === 'running'} onClick={() => void exportClips([clipId], presetId, false)}>{exportJob?.state === 'running' ? `${Math.round(exportJob.progress * 100)} %` : 'Exportieren'}</Button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '300px minmax(0, 1fr) 320px', gap: 14, minHeight: 0 }}>
        {/* Transkript */}
        <div className="sm-glass" style={{ padding: 16, overflowY: 'auto' }}>
          <h3 style={{ marginBottom: 10 }}>Transkript</h3>
          <div style={{ lineHeight: 1.9, fontSize: 14 }}>
            {words.map((w, i) => (
              <Fragment key={i}>
              <span onClick={(e) => { if (e.altKey) toggleCut(i); else setT(w.t) }} onDoubleClick={() => toggleCut(i)} title="Klick: springen · Doppelklick: herausschneiden"
                style={{ cursor: 'default', padding: '1px 2px', borderRadius: 4, marginRight: 3, textDecoration: cut.includes(i) ? 'line-through' : 'none', opacity: cut.includes(i) ? 0.35 : 1, background: i === curIdx ? 'rgba(168,85,247,0.35)' : 'transparent' }}>{w.w}</span>{' '}
              </Fragment>
            ))}
          </div>
          <small style={{ display: 'block', marginTop: 12 }}>Doppelklick auf ein Wort schneidet es heraus.</small>
        </div>

        {/* Vorschau */}
        <div style={{ display: 'flex', gap: 14, justifyContent: 'center', alignItems: 'center', minHeight: 0 }}>
          {showSource && <div style={{ position: 'relative', height: '56%', aspectRatio: '16/9', borderRadius: 12, overflow: 'hidden', border: '1px solid var(--edge)', backgroundImage: `url(${IMG.source})`, backgroundSize: 'cover', alignSelf: 'center', maxWidth: '38%' }}><span className="sm-tag" style={{ position: 'absolute', top: 8, left: 8, background: 'rgba(0,0,0,0.5)' }}>Quelle 16:9</span></div>}
          <div style={{ position: 'relative', height: '100%', aspectRatio: '9/16', borderRadius: 16, overflow: 'hidden', border: '1px solid var(--edge-highlight)', backgroundImage: `url(${clip.thumb})`, backgroundSize: 'cover', boxShadow: '0 20px 60px rgba(0,0,0,0.5)' }}>
            {t < 3 && hook && <div style={{ position: 'absolute', top: '14%', left: 0, right: 0, textAlign: 'center', fontFamily: 'Poppins', fontWeight: 700, fontSize: 18, padding: '0 20px', textShadow: '0 2px 10px #000' }}>{hook}</div>}
            <div style={{ position: 'absolute', left: 0, right: 0, top: `${pos}%`, textAlign: 'center', fontFamily: preset.font, fontWeight: preset.weight, fontSize: size / 3.2, textTransform: preset.upper ? 'uppercase' : 'none', color: preset.color, WebkitTextStroke: '0.6px #000', textShadow: '0 2px 8px rgba(0,0,0,0.6)', padding: '0 14px' }}>
              {cap.map((w, i) => <span key={i} style={{ color: hl && w.hi ? preset.hi : i + Math.floor(curIdx / 3) * 3 === curIdx ? preset.hi : preset.color, marginRight: 6, background: preset.box ? 'rgba(0,0,0,0.6)' : 'none' }}>{w.w}</span>)}
            </div>
            {zn && <div aria-hidden style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}><div style={{ position: 'absolute', left: 0, right: 0, top: 0, height: `${zn.top * 100}%`, background: 'rgba(239,68,68,0.28)' }} /><div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: `${zn.bottom * 100}%`, background: 'rgba(239,68,68,0.28)' }} /><div style={{ position: 'absolute', right: 0, top: `${zn.top * 100}%`, bottom: `${zn.bottom * 100}%`, width: `${zn.right * 100}%`, background: 'rgba(239,68,68,0.28)' }} /></div>}
          </div>
        </div>

        {/* Inspector */}
        <div className="sm-glass" style={{ padding: 16, overflowY: 'auto', display: 'grid', alignContent: 'start', gap: 12 }}>
          <Segmented options={['Untertitel', 'Bildausschnitt', 'Hook']} value={tab} onChange={setTab} />
          {tab === 'Untertitel' && (
            <div>
              <Row label="Stil"><Segmented options={PRESETS.map((p) => p.name)} value={preset.name} onChange={(n) => useStore.getState().setPreset(PRESETS.find((p) => p.name === n)!.id)} /></Row>
              <Row label="Größe"><Slider label="Schrift" value={size} onChange={setSize} /></Row>
              <Row label="Position" hint="Drag-Regler"><Slider label="Vertikal" value={pos} min={10} max={90} onChange={setPos} /></Row>
              <Row label="Hervorhebung (KI-Tags)"><Switch on={hl} onChange={setHl} label="Hervorhebung" /></Row>
              <Row label="Sicherheitszonen"><Segmented options={['Aus', 'TikTok', 'Reels', 'Shorts']} value={zone} onChange={setZone} /></Row>
            </div>
          )}
          {tab === 'Bildausschnitt' && (
            <div>
              <Row label="Layout (pro Shot)"><Segmented options={['Smart', 'Ganzes Bild', 'Split', 'Fest']} value={layout} onChange={setLayout} /></Row>
              <Row label="Kamera folgt" hint="ab hier"><Segmented options={['Person links', 'Person rechts']} value={person} onChange={setPerson} /></Row>
              <Row label="Quelle anzeigen"><Switch on={showSource} onChange={setShowSource} label="Quelle anzeigen" /></Row>
              <small>Gesichtsquote {Math.round(clip.faceRatio * 100)} %</small>
            </div>
          )}
          {tab === 'Hook' && (
            <div>
              <Row label="Text"><input className="sm-input" value={hook} onChange={(e) => setHook(e.target.value)} onFocus={(e) => { const prev = hook; e.currentTarget.dataset.prev = prev }} onBlur={(e) => { const prev = e.currentTarget.dataset.prev ?? ''; const next = hook; if (prev !== next) apply({ label: 'Hook', undo: () => setHook(prev), redo: () => setHook(next) }) }} /></Row>
              <Row label="Dauer"><Slider label="Sekunden" value={3} min={1} max={6} onChange={() => undefined} /></Row>
            </div>
          )}
        </div>
      </div>

      <Timeline duration={clip.duration} trim={trim} t={t} setT={setT} words={words} playing={playing} setPlaying={setPlaying}
        onTrim={(next) => { const prev = useStore.getState().trim; apply({ label: 'Beschnitt', undo: () => setTrim(prev), redo: () => setTrim(next) }) }} onPreview={(next) => setTrim(next)} base={base}
        onCheckEnd={() => { setT(Math.max(trim[0], trim[1] - 2.5)); setPlaying(true) }} />
    </div>
  )
}

function Timeline({ duration, trim, t, setT, words, playing, setPlaying, onTrim, onPreview, onCheckEnd, base }: {
  duration: number; trim: [number, number]; t: number; setT: (n: number) => void; words: { t: number }[]; playing: boolean; setPlaying: (b: boolean) => void
  onTrim: (t: [number, number]) => void; onPreview: (t: [number, number]) => void; onCheckEnd: () => void; base: object
}): React.JSX.Element {
  const track = useRef<HTMLDivElement>(null)
  const [grab, setGrab] = useState<'in' | 'out' | null>(null)
  const start = useRef<[number, number]>(trim)
  const offset = useRef(0)
  const bounds = useMemo(() => words.flatMap((w, i) => [w.t, words[i + 1]?.t ?? duration]), [words, duration])
  const snap = useCallback((x: number) => bounds.reduce((b, c) => (Math.abs(c - x) < Math.abs(b - x) ? c : b), bounds[0]), [bounds])
  const toTime = (clientX: number): number => { const r = track.current!.getBoundingClientRect(); return ((clientX - r.left) / r.width) * duration }
  const pct = (x: number): string => `${(x / duration) * 100}%`

  const down = (which: 'in' | 'out') => (e: React.PointerEvent): void => {
    e.currentTarget.setPointerCapture(e.pointerId)
    start.current = trim
    offset.current = toTime(e.clientX) - trim[which === 'in' ? 0 : 1] // Grab-Offset: 1:1, kein Springen zur Mitte
    setGrab(which)
  }
  const move = (e: React.PointerEvent): void => {
    if (!grab) return
    const x = toTime(e.clientX) - offset.current
    const v = Math.min(duration, Math.max(0, snap(x)))
    onPreview(grab === 'in' ? [Math.min(v, trim[1] - 1), trim[1]] : [trim[0], Math.max(v, trim[0] + 1)])
  }
  const up = (): void => {
    if (!grab) return
    const next = useStore.getState().trim
    useStore.getState().setTrim(start.current)
    if (next[0] !== start.current[0] || next[1] !== start.current[1]) onTrim(next)
    setGrab(null)
  }

  return (
    <div className="sm-glass" style={{ padding: 14, display: 'grid', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <Button variant="ghost" aria-label={playing ? 'Pause' : 'Abspielen'} onClick={() => setPlaying(!playing)}>{playing ? <Pause size={16} /> : <Play size={16} />}</Button>
        <small style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--text-1)' }}>{t.toFixed(1)} s / {(trim[1] - trim[0]).toFixed(1)} s</small>
        <div style={{ flex: 1 }} />
        <Pill onClick={onCheckEnd}><Rewind size={13} /> Ende prüfen</Pill>
        <Pill onClick={() => onTrim([trim[0], Math.min(duration, snap(trim[1] + 4))])}><Scissors size={13} /> Satz verlängern</Pill>
        <Pill onClick={() => onTrim([trim[0], Math.max(trim[0] + 1, snap(trim[1] - 4))])}><Scissors size={13} /> Satz kürzen</Pill>
      </div>
      <div ref={track} style={{ position: 'relative', height: 72, touchAction: 'none' }} onPointerDown={(e) => { if (e.target === e.currentTarget || (e.target as HTMLElement).dataset.wave) setT(Math.max(0, Math.min(duration, toTime(e.clientX)))) }} onPointerMove={move} onPointerUp={up}>
        <div className="sm-wave" data-wave="1" style={{ position: 'absolute', inset: '8px 0' }}>{WAVE.map((h, i) => <i data-wave="1" key={i} style={{ height: `${h * 100}%`, opacity: i / WAVE.length * duration >= trim[0] && i / WAVE.length * duration <= trim[1] ? 1 : 0.25 }} />)}</div>
        <div style={{ position: 'absolute', top: 0, bottom: 0, left: pct(trim[0]), width: `calc(${pct(trim[1] - trim[0])})`, border: '2px solid var(--accent)', borderRadius: 10, pointerEvents: 'none', boxShadow: 'var(--accent-glow)' }} />
        {(['in', 'out'] as const).map((w) => (
          <motion.div key={w} role="slider" aria-label={w === 'in' ? 'Start' : 'Ende'} aria-valuenow={trim[w === 'in' ? 0 : 1]} tabIndex={0}
            animate={{ scale: grab === w ? 1.18 : 1, y: grab === w ? -3 : 0 }} transition={base}
            onPointerDown={down(w)} style={{ position: 'absolute', top: -4, bottom: -4, left: `calc(${pct(trim[w === 'in' ? 0 : 1])} - 7px)`, width: 14, borderRadius: 7, background: '#fff', boxShadow: '0 2px 10px rgba(0,0,0,0.5)', cursor: 'ew-resize' }} />
        ))}
        <div style={{ position: 'absolute', top: 0, bottom: 0, left: pct(t), width: 2, background: '#fff', pointerEvents: 'none' }} />
      </div>
      <small><Monitor size={11} style={{ verticalAlign: -1 }} /> Griffe rasten an Wortgrenzen ein · <ShieldCheck size={11} style={{ verticalAlign: -1 }} /> Ende am Satzende empfohlen</small>
    </div>
  )
}
