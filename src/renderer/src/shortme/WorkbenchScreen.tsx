import { useCallback, useEffect, useState } from 'react'
import { Layers, Pause, Play, RotateCcw, X, Swords } from 'lucide-react'
import { STATUS_LABEL, type WbOverview, type WbProject, type WbStatus, type WorkItem } from '@shared/workbench'
import { Button, Switch } from './ui'

const api = (): Window['cutawan']['shortme']['learn'] | null => (typeof window !== 'undefined' ? window.cutawan?.shortme?.learn ?? null : null)
const mmss = (s: number): string => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`
const gb = (b: number): string => (b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : `${Math.round(b / 1e6)} MB`)
const pct = (x: number | null): string => (x === null ? '–' : `${Math.round(x * 100)} %`)
const sec = (x: number | null): string => (x === null ? '–' : `${x > 0 ? '+' : ''}${x.toFixed(1)} s`)

/** Bereich „Werkbank“: Warteschlange links, Gesamtübersicht oder Projekt-Vergleich rechts. */
export function WorkbenchScreen(): React.JSX.Element {
  const [items, setItems] = useState<WorkItem[]>([])
  const [st, setSt] = useState<WbStatus | null>(null)
  const [ov, setOv] = useState<WbOverview | null>(null)
  const [links, setLinks] = useState('')
  const [msg, setMsg] = useState('')
  const [sel, setSel] = useState<string | null>(null)
  const [del, setDel] = useState(true)

  const refresh = useCallback(async () => {
    const a = api(); if (!a) return
    const [l, s, o, cfg] = await Promise.all([a.wbList(), a.wbStatus(), a.wbOverview(), a.settings()])
    setItems(l); setSt(s); setOv(o); setDel(cfg.deleteVideos)
  }, [])
  useEffect(() => { void refresh(); const a = api(); const t = setInterval(() => void refresh(), 15000); const off = a?.onWorkbench((l) => setItems([...l])); return () => { clearInterval(t); off?.() } }, [refresh])

  const add = async (): Promise<void> => {
    const urls = links.split(/\s+/).filter(Boolean)
    if (!urls.length) return
    setMsg('Liest Links …')
    try { const r = await api()!.wbAdd(urls); setMsg(`${r.added} hinzugefügt${r.skipped ? `, ${r.skipped} schon vorhanden` : ''}`); setLinks('') } catch (e) { setMsg(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e)) }
    void refresh()
  }
  const item = items.find((i) => i.id === sel && i.hash)
  const active = items.filter((i) => ['loading', 'transcribing', 'matched', 'generated'].includes(i.status)).length

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 0.9fr) minmax(0, 1.5fr)', gap: 16, paddingTop: 12, height: '100%' }}>
      <section style={{ display: 'grid', gap: 10, alignContent: 'start', minWidth: 0, minHeight: 0 }}>
        <h1 style={{ display: 'flex', gap: 10, alignItems: 'center' }}><Layers size={26} /> Werkbank</h1>
        <div className="sm-glass" style={{ padding: 12, display: 'grid', gap: 8 }}>
          <textarea value={links} onChange={(e) => setLinks(e.target.value)} placeholder="YouTube-Video- oder Kanal-Links" rows={3} style={{ resize: 'vertical', background: 'transparent', color: 'inherit', border: '1px solid var(--edge)', borderRadius: 10, padding: 8 }} />
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <Button variant="primary" onClick={() => void add()} disabled={!links.trim()}>Hinzufügen</Button>
            <Button aria-label={st?.paused ? 'Fortsetzen' : 'Pausieren'} onClick={() => void api()?.wbPause(!st?.paused).then(refresh)}>{st?.paused ? <Play size={15} /> : <Pause size={15} />}</Button>
            <small style={{ marginLeft: 'auto' }}>{msg}</small>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
          <Switch on={del} label="Videodatei nach Auswertung löschen" onChange={(b) => { setDel(b); void api()?.setSettings({ deleteVideos: b }) }} />
          <small>Belegt: {st ? gb(st.bytes) : '–'} · {active} aktiv</small>
        </div>
        <div style={{ display: 'grid', gap: 6, overflow: 'auto', minHeight: 0 }}>
          {items.length === 0 && <small>Noch keine Videos.</small>}
          {items.map((i) => (
            <div key={i.id} className="sm-glass" aria-current={sel === i.id} style={{ padding: '8px 10px', display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: 8, alignItems: 'center', outline: sel === i.id ? '2px solid var(--accent)' : 'none', cursor: i.hash ? 'pointer' : 'default' }} onClick={() => i.hash && setSel(i.id)}>
              <span style={{ minWidth: 0 }}>
                <strong style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 13 }}>{i.title}</strong>
                <small>{i.channel} · {STATUS_LABEL[i.status]}{i.shorts ? ` (${i.shorts})` : ''}{st?.current === i.id ? ' …' : ''}{i.error ? ` – ${i.error}` : ''}</small>
              </span>
              <span style={{ display: 'flex', gap: 4 }}>
                {i.status === 'error' && <Button aria-label="Erneut versuchen" onClick={(e) => { e.stopPropagation(); void api()!.wbRetry(i.id).then(refresh) }}><RotateCcw size={14} /></Button>}
                {st?.current !== i.id && <Button aria-label="Entfernen" onClick={(e) => { e.stopPropagation(); if (sel === i.id) setSel(null); void api()!.wbRemove(i.id).then(refresh) }}><X size={14} /></Button>}
              </span>
            </div>
          ))}
        </div>
      </section>
      <section style={{ minWidth: 0, minHeight: 0, overflow: 'auto' }}>
        {item?.hash ? <ProjectView key={item.hash} hash={item.hash} /> : <Overview ov={ov} />}
      </section>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }): React.JSX.Element {
  return <div className="sm-glass" style={{ padding: 14, display: 'grid', gap: 2 }}><small>{label}</small><strong style={{ fontSize: 24 }}>{value}</strong></div>
}

function Overview({ ov }: { ov: WbOverview | null }): React.JSX.Element {
  if (!ov || ov.videos === 0) return <div className="sm-glass" style={{ padding: 18 }}><small>Noch nichts ausgewertet.</small></div>
  const max = Math.max(1, ...ov.lossStages.map((s) => s.n))
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <h2>Gesamtübersicht</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
        <Stat label="Trefferquote Creator-Momente" value={pct(ov.hitRate)} />
        <Stat label="Abweichung Anfang" value={ov.meanStartDev === null ? '–' : `${ov.meanStartDev} s`} />
        <Stat label="Abweichung Ende" value={ov.meanEndDev === null ? '–' : `${ov.meanEndDev} s`} />
        <Stat label={`Blindtest-Gewinnquote (${ov.blind.decided})`} value={pct(ov.blind.rate)} />
      </div>
      <div className="sm-glass" style={{ padding: 14, display: 'grid', gap: 8 }}>
        <strong>Häufigste Verlust-Stufen</strong>
        {ov.lossStages.length === 0 && <small>Keine verpassten Momente.</small>}
        {ov.lossStages.map((s) => (
          <div key={s.stage} style={{ display: 'grid', gridTemplateColumns: '170px 1fr 30px', gap: 8, alignItems: 'center', fontSize: 13 }}>{s.stage}<div className="sm-bar" style={{ height: 6 }}><i style={{ width: `${(s.n / max) * 100}%` }} /></div><span style={{ textAlign: 'right' }}>{s.n}</span></div>
        ))}
      </div>
      <div className="sm-glass" style={{ padding: 14, display: 'grid', gap: 8 }}>
        <strong>Entwicklung (Trefferquote je Auswertungstag)</strong>
        <div style={{ display: 'flex', gap: 6, alignItems: 'end', height: 90 }}>
          {ov.timeline.map((t) => <div key={t.day} title={`${t.day}: ${pct(t.hitRate)} (${t.n})`} style={{ flex: 1, maxWidth: 40, height: `${Math.max(4, t.hitRate * 100)}%`, background: 'var(--accent)', borderRadius: 4 }} />)}
        </div>
        <small>{ov.videos} Videos · {ov.moments} Creator-Momente</small>
      </div>
    </div>
  )
}

interface Blind { testId: string; left: string; right: string }

function ProjectView({ hash }: { hash: string }): React.JSX.Element {
  const [p, setP] = useState<WbProject | null>(null)
  const [blind, setBlind] = useState<Blind | null>(null)
  const [reveal, setReveal] = useState('')
  const [busy, setBusy] = useState('')
  const [over, setOver] = useState(false)
  const load = useCallback(() => { void api()?.wbProject(hash).then(setP) }, [hash])
  useEffect(load, [load])
  if (!p) return <small>Lädt …</small>

  const evOf = (shortId: string, i: number) => p.eval?.moments.filter((m) => m.shortId === shortId)[i]
  const startBlind = async (kind: 'creator' | 'reference', shortId: string, i: number): Promise<void> => {
    const m = evOf(shortId, i)
    const clipId = m?.clipId ?? p.clips[0]?.id
    if (!clipId) return
    setBusy('Rendert beide Momente …'); setReveal('')
    try { setBlind(await api()!.blindPrepare(hash, { kind, key: `${shortId}:${i}` }, { kind: 'shortme', key: clipId })) } catch (e) { setBusy(e instanceof Error ? e.message : String(e)); return }
    setBusy('')
  }
  const answer = async (c: 'left' | 'right' | 'tie'): Promise<void> => {
    if (!blind) return
    const r = await api()!.blindAnswer(blind.testId, c)
    setReveal(`Links: ${KIND[r.left]} · Rechts: ${KIND[r.right]}`)
    setBlind(null)
  }
  const dropRef = async (e: React.DragEvent): Promise<void> => {
    e.preventDefault(); setOver(false)
    for (const f of Array.from(e.dataTransfer.files)) {
      setBusy(`Ordnet ${f.name} zu …`)
      try { const r = await api()!.wbReference(hash, window.cutawan.pathForFile(f)); setBusy(r.moments ? '' : `${f.name}: keine Zuordnung gefunden`) } catch (err) { setBusy(String(err)) }
    }
    load()
  }
  const creators = p.shorts.filter((s) => s.source === 'creator')
  const refs = p.shorts.filter((s) => s.source === 'reference')
  const covered = (a: number, b: number): boolean => p.shorts.some((s) => s.moments.some((m) => Math.min(m.end, b) - Math.max(m.start, a) > 0.5 * (b - a)))

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <h2 style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.title}</h2>
      {(busy || reveal) && <small>{busy || reveal}</small>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 10, alignItems: 'start' }}>
        <div style={{ display: 'grid', gap: 8 }}>
          <strong>Creator-Shorts</strong>
          {creators.flatMap((s) => s.moments.map((m, i) => {
            const e = evOf(s.id, i)
            return (
              <div key={`${s.id}:${i}`} className="sm-glass" style={{ padding: 10, display: 'grid', gap: 4, fontSize: 12 }}>
                <strong style={{ fontSize: 13 }}>{s.title || s.id}</strong>
                <span>{mmss(m.start)}–{mmss(m.end)} · Leistung {s.ratio === null ? '–' : `${s.ratio}×`}</span>
                <span style={{ color: 'var(--text-1)' }}>{m.text}</span>
                {e && (e.hit ? <span>Überschneidung {pct(e.overlap)} · Anfang {sec(e.startDelta)} · Ende {sec(e.endDelta)}</span> : <span style={{ color: 'var(--warn)' }}>Verpasst bei: {e.lost}</span>)}
                <Button aria-label="Blindtest" onClick={() => void startBlind('creator', s.id, i)}><Swords size={13} /> Blindtest</Button>
              </div>
            )
          }))}
        </div>
        <div style={{ display: 'grid', gap: 8 }}>
          <strong>Shortme-Clips</strong>
          {p.clips.map((c) => (
            <div key={c.id} className="sm-glass" style={{ padding: 10, display: 'grid', gridTemplateColumns: '54px minmax(0, 1fr)', gap: 8, fontSize: 12, outline: covered(c.start, c.end) ? '1px solid var(--accent)' : 'none' }}>
              {c.thumb ? <img src={c.thumb} alt="" style={{ width: 54, height: 96, objectFit: 'cover', borderRadius: 8 }} /> : <div />}
              <span style={{ display: 'grid', gap: 3, alignContent: 'start' }}><strong style={{ fontSize: 13 }}>{c.title}</strong><span>{mmss(c.start)}–{mmss(c.end)} · Score {c.score}</span><span style={{ color: 'var(--text-1)' }}>{c.text}</span></span>
            </div>
          ))}
        </div>
        <div onDragOver={(e) => { e.preventDefault(); setOver(true) }} onDragLeave={() => setOver(false)} onDrop={(e) => void dropRef(e)} style={{ display: 'grid', gap: 8, outline: over ? '2px dashed var(--accent)' : 'none', borderRadius: 12, minHeight: 120, alignContent: 'start' }}>
          <strong>Referenz</strong>
          {refs.length === 0 && <small>MP4 hierher ziehen</small>}
          {refs.flatMap((s) => s.moments.map((m, i) => {
            const e = evOf(s.id, i)
            return (
              <div key={`${s.id}:${i}`} className="sm-glass" style={{ padding: 10, display: 'grid', gap: 4, fontSize: 12 }}>
                <strong style={{ fontSize: 13 }}>{s.title}</strong>
                <span>{mmss(m.start)}–{mmss(m.end)}</span>
                {e?.hit && <span>Überschneidung {pct(e.overlap)} · Anfang {sec(e.startDelta)} · Ende {sec(e.endDelta)}</span>}
                <Button aria-label="Blindtest" onClick={() => void startBlind('reference', s.id, i)}><Swords size={13} /> Blindtest</Button>
              </div>
            )
          }))}
        </div>
      </div>
      {blind && (
        <div role="dialog" aria-label="Blindtest" className="sm-glass" style={{ position: 'fixed', inset: '6vh 8vw', zIndex: 50, padding: 18, display: 'grid', gridTemplateRows: 'minmax(0, 1fr) auto', gap: 12, background: 'rgba(10,10,14,0.92)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, minHeight: 0 }}>
            {[blind.left, blind.right].map((f, i) => <video key={f} src={window.cutawan.mediaUrl(f)} controls style={{ width: '100%', height: '100%', minHeight: 0, objectFit: 'contain', background: '#000', borderRadius: 12 }} aria-label={i ? 'Rechts' : 'Links'} />)}
          </div>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
            <Button variant="primary" onClick={() => void answer('left')}>Links besser</Button>
            <Button onClick={() => void answer('tie')}>Gleich gut</Button>
            <Button variant="primary" onClick={() => void answer('right')}>Rechts besser</Button>
          </div>
        </div>
      )}
    </div>
  )
}
const KIND: Record<string, string> = { shortme: 'Shortme', creator: 'Creator', reference: 'Referenz' }
