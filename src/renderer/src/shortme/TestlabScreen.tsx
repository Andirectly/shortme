import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { usePresets } from './presets'
import { ClipsCompare, TextCompare } from './LabCompare'
import { ChevronDown, ChevronRight, FlaskConical, Pause, Play } from 'lucide-react'
import type { LabResult, LabSource, ModelView, ModelsView } from '@shared/models'
import { sourceRects } from '@shared/previewDraw'
import { Button, Pill } from './ui'
import { useProject } from './projectStore'

const lab = (): Window['cutawan']['shortme']['testlab'] | null => (typeof window !== 'undefined' && window.cutawan?.shortme?.testlab ? window.cutawan.shortme.testlab : null)
const COLORS = ['#7CFF9B', '#FFB04D', '#FF7CE0', '#6FE3FF', '#7FA1FF', '#FFE45E']
const STATUS_LABEL: Record<string, string> = { aktiv: 'aktiv', test: 'Test', entfernen: 'zum Entfernen', kandidat: 'noch nicht integriert' }
const fmt = (s: number): string => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`

/** Infobox: eingeklappt Kurzbeschreibung, aufgeklappt Vorteile/Nachteile/Größe/Lizenz/geeignet für; gemessene Werte (dein Rechner) vor Katalogwerten. */
function InfoBox({ m }: { m: ModelView | undefined }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  if (!m) return <div className="sm-card" style={{ padding: 12 }}><small>Kein Modell gewählt.</small></div>
  const me = m.measured
  return (
    <div className="sm-card" style={{ padding: 12, display: 'grid', gap: 8 }}>
      <button onClick={() => setOpen(!open)} aria-expanded={open} style={{ display: 'flex', gap: 8, alignItems: 'start', background: 'none', border: 0, padding: 0, textAlign: 'left', cursor: 'pointer', color: 'inherit' }}>
        {open ? <ChevronDown size={16} style={{ marginTop: 2, flex: 'none' }} /> : <ChevronRight size={16} style={{ marginTop: 2, flex: 'none' }} />}
        <span style={{ display: 'grid', gap: 2 }}><span style={{ fontSize: 14 }}>{m.short}</span><small>Status: {STATUS_LABEL[m.effective]}</small></span>
      </button>
      {me && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }} title={`gemessen auf deinem Rechner (${me.clip})`}>
          <span className="sm-tag">Laufzeit {me.runtimeSec} s</span>
          <span className="sm-tag">VRAM +{me.vramPeakMb >= 0 ? me.vramPeakMb : '?'} MB</span>
          {me.speechFaceShare !== null && <span className="sm-tag">Sprechzeit mit Gesicht {Math.round(me.speechFaceShare * 100)} %</span>}
        </div>
      )}
      {open && (
        <div style={{ display: 'grid', gap: 6, fontSize: 13 }}>
          <div>{m.pros.map((p) => <div key={p}>✓ {p}</div>)}</div>
          <div>{m.cons.map((c) => <div key={c} style={{ color: 'var(--text-2)' }}>– {c}</div>)}</div>
          <small>Größe/Tempo (Katalog): {m.size}</small>
          <small>Lizenz: {m.license}</small>
          <small>Geeignet für: {m.bestFor}</small>
        </div>
      )}
    </div>
  )
}

interface Overlays { boxes: boolean; ids: boolean; speaker: boolean; crop: boolean }

/** Ein Ergebnis über dem Video: Overlays aus den gespeicherten Daten (kein erneutes Rechnen). */
function Pane({ res, label, path, t, playing, master, onTime, overlays }: { res: LabResult; label: string; path: string; t: number; playing: boolean; master: boolean; onTime: (t: number) => void; overlays: Overlays }): React.JSX.Element {
  const vref = useRef<HTMLVideoElement>(null)
  const cref = useRef<HTMLCanvasElement>(null)
  const wrap = useRef<HTMLDivElement>(null)
  const url = window.cutawan.mediaUrl(path)
  useEffect(() => { const v = vref.current; if (v && Math.abs(v.currentTime - (res.start + t)) > 0.15) v.currentTime = res.start + t }, [t, res.start])
  useEffect(() => { const v = vref.current; if (!v) return; if (playing) void v.play().catch(() => undefined); else v.pause() }, [playing])
  useEffect(() => {
    if (!master || !playing) return
    let raf = 0
    const tick = (): void => { const v = vref.current; if (v) onTime(Math.min(res.dur, Math.max(0, v.currentTime - res.start))); raf = requestAnimationFrame(tick) }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [master, playing, onTime, res.start, res.dur])
  // Overlays zeichnen
  useEffect(() => {
    const c = cref.current, v = vref.current, w = wrap.current
    if (!c || !v || !w) return
    const W = w.clientWidth, H = w.clientHeight
    if (c.width !== W || c.height !== H) { c.width = W; c.height = H }
    const g = c.getContext('2d')!
    g.clearRect(0, 0, W, H)
    const vw = v.videoWidth || 16, vh = v.videoHeight || 9
    const sc = Math.min(W / vw, H / vh)
    const rw = vw * sc, rh = vh * sc, rx = (W - rw) / 2, ry = (H - rh) / 2
    const k = Math.floor(t * res.hz)
    const sp = res.active[Math.min(res.active.length - 1, Math.max(0, k))]
    if (overlays.boxes || overlays.ids || overlays.speaker) {
      for (const tk of res.tracks) {
        const i = Math.round((t - tk.t0) * res.hz)
        if (i < 0 || i >= tk.boxes.length) continue
        const [x1, y1, x2, y2] = tk.boxes[i]
        const col = COLORS[tk.id % COLORS.length]
        const isSp = sp === tk.id
        if (overlays.boxes || (overlays.speaker && isSp)) {
          g.lineWidth = overlays.speaker && isSp ? 4 : 2
          g.strokeStyle = col
          if (overlays.boxes || isSp) g.strokeRect(rx + x1 * rw, ry + y1 * rh, (x2 - x1) * rw, (y2 - y1) * rh)
        }
        if (overlays.ids) { g.fillStyle = col; g.font = '600 12px system-ui'; g.fillText(`T${tk.id}${overlays.speaker && isSp ? ' ★' : ''}`, rx + x1 * rw + 2, ry + y1 * rh - 4) }
      }
    }
    if (overlays.crop) {
      const shot = res.shots.find((s) => t >= s.start && t < s.end) ?? res.shots[res.shots.length - 1]
      if (shot) {
        g.strokeStyle = '#ffe45e'; g.lineWidth = 3
        for (const r of sourceRects({ width: vw, height: vh }, { layout: shot.layout as 'smart', cx: shot.cx, cx2: shot.cx2 }, shot.zoom || 1)) g.strokeRect(rx + r.x * rw, ry + 1, r.w * rw, rh - 2)
      }
    }
  }, [t, res, overlays])
  return (
    <div style={{ display: 'grid', gap: 8, minWidth: 0 }}>
      <div ref={wrap} style={{ position: 'relative', aspectRatio: '16 / 9', background: '#000', borderRadius: 14, overflow: 'hidden', border: '1px solid var(--edge)' }}>
        <video ref={vref} src={url} muted={!master} preload="auto" playsInline onLoadedMetadata={() => { if (vref.current) vref.current.currentTime = res.start + t }} style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }} />
        <canvas ref={cref} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }} />
        <span className="sm-tag" style={{ position: 'absolute', top: 8, left: 8 }}>{label}</span>
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {res.video ? (
          <>
            <span className="sm-tag" title={`gemessen: ${res.runtimeSec} s für ${Math.round(res.dur)} s Video`}>Exportzeit für 60 s ≈ {res.per60Sec} s</span>
            <span className="sm-tag">Zusätzliche App-Größe +{res.extraMb} MB</span>
            <small style={{ alignSelf: 'center' }}>{res.context}</small>
          </>
        ) : null}
        {!res.video && <span className="sm-tag">Laufzeit {res.runtimeSec} s</span>}
        {!res.video && <span className="sm-tag">VRAM-Spitze +{res.vramPeakMb >= 0 ? `${res.vramPeakMb} MB` : '?'}</span>}
        {!res.video && <span className="sm-tag" title={`${res.speechSec} s Sprache (VAD)`}>Sprechzeit mit Gesicht {res.speechFaceShare === null ? '–' : `${Math.round(res.speechFaceShare * 100)} %`}</span>}
        {!res.video && <span className="sm-tag">{res.tracks.length} Spuren</span>}
        {!res.video && <small style={{ alignSelf: 'center' }}>{res.context}</small>}
        {!res.video && <span className="sm-tag" title="Neue Spur beginnt ≤ 3 s nach dem Ende einer anderen an gleicher Stelle, ohne Kamerawechsel (Schätzung)">ID-Wechsel (geschätzt) {res.idSwitches}</span>}
      </div>
    </div>
  )
}

export function TestlabScreen(): React.JSX.Element {
  const hasApi = useProject((s) => s.hasApi)
  const [view, setView] = useState<ModelsView | null>(null)
  const [sources, setSources] = useState<LabSource[]>([])
  const [slot, setSlot] = useState('face')
  const [aId, setA] = useState('')
  const [bId, setB] = useState('')
  const [srcId, setSrc] = useState('')
  const [start, setStart] = useState(60)
  const [dur, setDur] = useState(30)
  const [running, setRunning] = useState(false)
  const [msgs, setMsgs] = useState<{ A: string; B: string }>({ A: '', B: '' })
  const [err, setErr] = useState('')
  const [results, setResults] = useState<{ a: LabResult; b: LabResult; path: string } | null>(null)
  const [t, setT] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [ov, setOv] = useState<Overlays>({ boxes: true, ids: true, speaker: true, crop: true })
  const [decided, setDecided] = useState('')
  const api = lab()
  const reload = useCallback(async () => { if (api) setView(await api.models()) }, [api])
  useEffect(() => { void reload(); if (api) void api.sources().then((l) => { setSources(l); setSrc((cur) => cur || l[0]?.id || '') }) }, [api, reload])
  useEffect(() => api?.onProgress((p) => setMsgs((m) => ({ ...m, [p.side]: p.message }))), [api])
  const models = useMemo(() => (view?.models ?? []).filter((m) => m.slot === slot), [view, slot])
  useEffect(() => {
    if (!view) return
    const act = view.active[slot]
    const integrated = models.filter((m) => m.integrated)
    setA((cur) => (integrated.some((m) => m.id === cur) ? cur : act || integrated[0]?.id || ''))
    setB((cur) => (integrated.some((m) => m.id === cur) && cur !== act ? cur : integrated.find((m) => m.id !== act)?.id ?? ''))
  }, [view, slot, models])
  const mA = models.find((m) => m.id === aId), mB = models.find((m) => m.id === bId)
  const src = sources.find((s) => s.id === srcId)
  const comparable = slot === 'face' || slot === 'tracking' || slot === 'renderer' || slot === 'clip_asr' || slot === 'llm'
  const shownSources = slot === 'llm' ? sources.filter((x) => x.kind === 'project') : sources
  useEffect(() => { if (slot === 'llm') { setDur((d) => (d < 300 ? 600 : d)); setSrc((cur) => (shownSources.some((x) => x.id === cur) ? cur : shownSources[0]?.id ?? cur)) } }, [slot, shownSources])
  const allPresets = usePresets((p) => p.all)
  const loadPresets = usePresets((p) => p.load)
  const [presetId, setPresetId] = useState('glow-karaoke')
  useEffect(() => { void loadPresets() }, [loadPresets])
  // Chrome Headless Shell für Remotion im Hintergrund vorbereiten, sobald der Renderer-Platz offen ist
  useEffect(() => { if (slot === 'renderer' && api) void api.prepareRemotion().catch(() => undefined) }, [slot, api])
  const run = async (): Promise<void> => {
    if (!api || !src || !aId || !bId) return
    setRunning(true); setErr(''); setResults(null); setPlaying(false); setT(0); setDecided(''); setMsgs({ A: 'wartet …', B: 'wartet …' })
    try {
      const r = await api.run({ slot, modelA: aId, modelB: bId, source: srcId, start, dur, presetId })
      setResults({ ...r, path: src.path })
      await reload()
    } catch (e) { setErr(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e)) } finally { setRunning(false) }
  }
  const decide = async (keep: 'A' | 'B'): Promise<void> => {
    if (!api || !results) return
    const [k, d] = keep === 'A' ? [results.a.model, results.b.model] : [results.b.model, results.a.model]
    setView(await api.decide(slot, k, d))
    setDecided(`${models.find((m) => m.id === k)?.name} ist jetzt aktiv für „${view?.slots.find((s) => s.id === slot)?.name}“; ${models.find((m) => m.id === d)?.name} ist zum Entfernen markiert (Code bleibt).`)
  }
  const onTime = useCallback((x: number) => setT(x), [])
  const seek = (x: number): void => { setT(x) }

  if (!hasApi || !api) return <div style={{ paddingTop: 12 }}><h1>Testlab</h1><small>Nur in der Desktop-App verfügbar.</small></div>
  const sel: React.CSSProperties = { width: '100%', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 8, padding: '8px 10px', color: 'inherit' }
  const optionsFor = (other: string): React.JSX.Element[] => models.map((m) => <option key={m.id} value={m.id} disabled={!m.integrated || m.id === other}>{m.name}{!m.integrated ? ' – noch nicht integriert' : m.id === other ? ' – schon auf der anderen Seite' : ` – ${STATUS_LABEL[m.effective]}${m.installed ? '' : ' (wird beim Start geladen)'}`}</option>)
  return (
    <div style={{ maxWidth: 1280, margin: '0 auto', display: 'grid', gap: 16, paddingTop: 12, paddingBottom: 40 }}>
      <div><h1 style={{ display: 'flex', gap: 10, alignItems: 'center' }}><FlaskConical size={26} /> Testlab</h1></div>
      <div className="sm-glass" style={{ padding: 16, display: 'grid', gap: 14 }}>
        <label style={{ display: 'grid', gap: 6, maxWidth: 420 }}><small>Platz</small>
          <select aria-label="Platz" value={slot} onChange={(e) => { setSlot(e.target.value); setResults(null) }} style={sel}>
            {(view?.slots ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 16 }}>
          <div style={{ display: 'grid', gap: 8 }}><small>Links (A)</small><select aria-label="Modell links" value={aId} onChange={(e) => setA(e.target.value)} style={sel}>{optionsFor(bId)}</select><InfoBox m={mA} /></div>
          <div style={{ display: 'grid', gap: 8 }}><small>Rechts (B)</small><select aria-label="Modell rechts" value={bId} onChange={(e) => setB(e.target.value)} style={sel}>{optionsFor(aId)}</select><InfoBox m={mB} /></div>
        </div>
        {slot === 'renderer' && (
          <label style={{ display: 'grid', gap: 6, maxWidth: 420 }}><small>Preset (für beide Seiten gleich)</small>
            <select aria-label="Preset" value={presetId} onChange={(e) => setPresetId(e.target.value)} style={sel}>{allPresets.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
          </label>
        )}
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) 120px 120px auto', gap: 12, alignItems: 'end' }}>
          <label style={{ display: 'grid', gap: 6 }}><small>Testclip</small>
            <select aria-label="Testclip" value={srcId} onChange={(e) => setSrc(e.target.value)} style={sel}>{shownSources.map((s) => <option key={s.id} value={s.id}>{s.label}{s.durationSec ? ` (${fmt(s.durationSec)})` : ''}</option>)}</select>
          </label>
          <label style={{ display: 'grid', gap: 6 }}><small>Start (s)</small><input className="sm-input" type="number" min={0} value={start} onChange={(e) => setStart(Math.max(0, +e.target.value))} aria-label="Start in Sekunden" /></label>
          <label style={{ display: 'grid', gap: 6 }}><small>Dauer (s)</small><input className="sm-input" type="number" min={5} max={slot === 'llm' ? 1800 : 120} value={dur} onChange={(e) => setDur(Math.min(slot === 'llm' ? 1800 : 120, Math.max(5, +e.target.value)))} aria-label="Dauer in Sekunden" /></label>
          <Button variant="primary" disabled={running || !src || !aId || !bId || !comparable} onClick={() => void run()}>{running ? 'Läuft …' : 'Vergleich starten'}</Button>
        </div>
        {!comparable && <small>Für diesen Platz gibt es noch keinen Vergleich.</small>}
        {running && <small>A: {msgs.A} · B: {msgs.B}</small>}
        {err && <small style={{ color: 'var(--warn)' }}>{err}</small>}
      </div>
      {results && (results.a.text || results.a.clips) && (
        <div className="sm-glass" style={{ padding: 16, display: 'grid', gap: 14 }}>
          {results.a.text ? <TextCompare a={results.a} b={results.b} nameA={mA?.name ?? results.a.model} nameB={mB?.name ?? results.b.model} /> : <ClipsCompare a={results.a} b={results.b} nameA={mA?.name ?? results.a.model} nameB={mB?.name ?? results.b.model} />}
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
            <Button variant="secondary" onClick={() => void decide('A')}>Links behalten</Button>
            <Button variant="secondary" onClick={() => void decide('B')}>Rechts behalten</Button>
          </div>
          {decided && <small role="status" style={{ textAlign: 'center' }}>{decided}</small>}
        </div>
      )}
      {results && !results.a.text && !results.a.clips && (
        <div className="sm-glass" style={{ padding: 16, display: 'grid', gap: 14 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 16 }}>
            <Pane res={results.a} label={`A · ${mA?.name ?? results.a.model}`} path={results.a.video ?? results.path} t={t} playing={playing} master onTime={onTime} overlays={ov} />
            <Pane res={results.b} label={`B · ${mB?.name ?? results.b.model}`} path={results.b.video ?? results.path} t={t} playing={playing} master={false} onTime={onTime} overlays={ov} />
          </div>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <Button variant="primary" aria-label={playing ? 'Pause' : 'Abspielen'} onClick={() => setPlaying(!playing)} style={{ width: 44, padding: 0 }}>{playing ? <Pause size={16} /> : <Play size={16} />}</Button>
            <small style={{ width: 90 }}>{fmt(t)} / {fmt(results.a.dur)}</small>
            <input type="range" aria-label="Zeitleiste (beide Seiten)" min={0} max={results.a.dur} step={0.04} value={t} onChange={(e) => seek(+e.target.value)} style={{ flex: 1, minWidth: 200 }} />
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <Pill pressed={ov.boxes} onClick={() => setOv({ ...ov, boxes: !ov.boxes })}>Gesichtsboxen</Pill>
              <Pill pressed={ov.ids} onClick={() => setOv({ ...ov, ids: !ov.ids })}>Spur-IDs</Pill>
              <Pill pressed={ov.speaker} onClick={() => setOv({ ...ov, speaker: !ov.speaker })}>Aktiver Sprecher</Pill>
              <Pill pressed={ov.crop} onClick={() => setOv({ ...ov, crop: !ov.crop })}>9:16-Ausschnitt</Pill>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
            <Button variant="secondary" onClick={() => void decide('A')}>Links behalten</Button>
            <Button variant="secondary" onClick={() => void decide('B')}>Rechts behalten</Button>
          </div>
          {decided && <small role="status" style={{ textAlign: 'center' }}>{decided}</small>}
        </div>
      )}
    </div>
  )
}
