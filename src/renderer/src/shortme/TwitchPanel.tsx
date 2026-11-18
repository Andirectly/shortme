import { useEffect, useRef, useState } from 'react'
import { Radio, Scissors } from 'lucide-react'
import { fmtHms, isTwitchUrl, parseHms, type TwitchInfo } from '@shared/twitch'
import { Button, Pill, Segmented } from './ui'

/** Prüft einen Twitch-Link (Debounce 600 ms): Art, Länge, live? laufendes VOD? */
export function useTwitchInspect(link: string): { info: TwitchInfo | null; error: string; loading: boolean } {
  const [state, setState] = useState<{ link: string; info: TwitchInfo | null; error: string }>({ link: '', info: null, error: '' })
  const twitch = isTwitchUrl(link)
  useEffect(() => {
    if (!twitch || !window.cutawan?.shortme?.twitch) return
    let alive = true
    const t = setTimeout(() => {
      window.cutawan.shortme.twitch.inspect(link.trim())
        .then((info) => { if (alive) setState({ link, info, error: '' }) })
        .catch((e) => { if (alive) setState({ link, info: null, error: e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e) }) })
    }, 600)
    return () => { alive = false; clearTimeout(t) }
  }, [link, twitch])
  const fresh = twitch && state.link === link
  return { info: fresh ? state.info : null, error: fresh ? state.error : '', loading: twitch && !fresh }
}

export type Section = [number, number] | null

const MINUTES = [3, 5, 10]
const STEPS: Record<string, number> = { '1 Min': 60, '5 Min': 300, '10 Min': 600 }
/** Abstand der Zeitmarken: höchstens ~8 Beschriftungen auf der Leiste. */
const tickEvery = (dur: number): number => [300, 600, 900, 1800, 3600, 7200].find((t) => dur / t <= 8) ?? 7200

/** Zeitbereich zum Ziehen: zwei Griffe auf 0 … Dauer, rastet im gewählten Schritt ein (Ende darf genau auf das VOD-Ende). Tastatur: Pfeile ± Schritt, mit Umschalt ± 10 Schritte. */
export function RangeBar({ duration, value, step, onChange }: { duration: number; value: [number, number]; step: number; onChange: (r: [number, number]) => void }): React.JSX.Element {
  const track = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<0 | 1 | null>(null)
  const st = Math.min(step, duration)
  const snap = (t: number): number => Math.min(duration, Math.max(0, t >= duration - st / 2 ? duration : Math.round(t / st) * st))
  const at = (clientX: number): number => { const r = track.current!.getBoundingClientRect(); return snap(((clientX - r.left) / r.width) * duration) }
  const set = (h: 0 | 1, t: number): void => onChange(h === 0 ? [Math.min(t, value[1] - st), value[1]].map((x) => Math.max(0, x)) as [number, number] : [value[0], Math.min(duration, Math.max(t, value[0] + st))])
  const pct = (t: number): string => `${(t / duration) * 100}%`
  const every = tickEvery(duration)
  const ticks = Array.from({ length: Math.floor(duration / every) + 1 }, (_, i) => i * every)
  const handle = (h: 0 | 1): React.JSX.Element => (
    <div key={h} role="slider" tabIndex={0} aria-label={h === 0 ? 'Start' : 'Ende'} aria-valuemin={0} aria-valuemax={Math.round(duration)} aria-valuenow={Math.round(value[h])} aria-valuetext={fmtHms(value[h])}
      onPointerDown={(e) => { e.stopPropagation(); e.currentTarget.setPointerCapture(e.pointerId); setDrag(h) }}
      onKeyDown={(e) => { const d = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -1 : 0; if (d) { e.preventDefault(); set(h, snap(value[h] + d * st * (e.shiftKey ? 10 : 1))) } }}
      style={{ position: 'absolute', top: -6, bottom: -6, left: `calc(${pct(value[h])} - 8px)`, width: 16, padding: '0 5px', borderRadius: 8, background: '#fff', backgroundClip: 'content-box', cursor: 'ew-resize', touchAction: 'none', zIndex: drag === h ? 3 : 2 }}>
      {/* Zeit am Griff: Start links-, Ende rechtsbündig, damit sich beide bei kurzem Bereich nicht überdecken */}
      <span style={{ position: 'absolute', bottom: 'calc(100% + 4px)', ...(h === 0 ? { right: 0 } : { left: 0 }), padding: '1px 6px', borderRadius: 6, background: drag === h ? '#fff' : 'rgba(255,255,255,0.14)', color: drag === h ? '#000' : 'var(--text-1)', fontSize: 11, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', pointerEvents: 'none' }}>{fmtHms(value[h])}</span>
    </div>
  )
  return (
    <div style={{ display: 'grid', gap: 6, padding: '28px 8px 0' }}>
      <div ref={track} style={{ position: 'relative', height: 28, borderRadius: 8, background: 'rgba(255,255,255,0.06)', cursor: 'pointer', touchAction: 'none' }}
        onPointerDown={(e) => { const t = at(e.clientX); const h = Math.abs(t - value[0]) <= Math.abs(t - value[1]) ? 0 : 1; e.currentTarget.setPointerCapture(e.pointerId); setDrag(h); set(h, t) }}
        onPointerMove={(e) => { if (drag !== null) set(drag, at(e.clientX)) }} onPointerUp={() => setDrag(null)} onPointerCancel={() => setDrag(null)}>
        {ticks.map((t) => <span key={t} style={{ position: 'absolute', top: 0, bottom: 0, left: pct(t), width: 1, background: 'rgba(255,255,255,0.12)' }} />)}
        <div style={{ position: 'absolute', top: 0, bottom: 0, left: pct(value[0]), width: `calc(${pct(value[1])} - ${pct(value[0])})`, borderRadius: 8, background: 'rgba(255,255,255,0.22)', border: '2px solid var(--accent)', boxSizing: 'border-box', pointerEvents: 'none' }} />
        {handle(0)}{handle(1)}
      </div>
      <div style={{ position: 'relative', height: 14 }} aria-hidden>
        {ticks.map((t) => <small key={t} style={{ position: 'absolute', left: pct(t), transform: t === 0 ? 'none' : 'translateX(-50%)', fontSize: 11, color: 'var(--text-3)', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{fmtHms(t).replace(/:00$/, '')}</small>)}
      </div>
    </div>
  )
}

/** Twitch-Bereich unter dem Import-Feld: ganzes VOD oder Zeitbereich, „Letzte Minuten“ (Kanal live), Live-Puffer, Meldungen. */
export function TwitchPanel({ info, error, loading, section, setSection, busy, onLast, onLiveBuffer }: {
  info: TwitchInfo | null; error: string; loading: boolean; section: Section; setSection: (s: Section) => void; busy: boolean
  onLast: (minutes: number) => void; onLiveBuffer: () => void
}): React.JSX.Element {
  const [custom, setCustom] = useState('15')
  const [from, setFrom] = useState('0:00')
  const [to, setTo] = useState('1:00:00')
  const [step, setStep] = useState('5 Min')
  const vod = !!info && info.state === 'vod' && info.durationSec > 0
  const applyRange = (f: string, t: string): void => {
    const a = parseHms(f), b = parseHms(t)
    setFrom(f); setTo(t)
    if (Number.isFinite(a) && Number.isFinite(b) && b > a && info) setSection([Math.floor(a), Math.floor(Math.min(b, info.durationSec))])
  }
  const tag = info ? { vod: 'VOD', clip: 'Clip', live: 'Live', offline: 'Offline', novods: 'Keine VODs' }[info.state] : null
  return (
    <div className="sm-card" role="status" aria-live="polite" style={{ padding: 14, display: 'grid', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <Radio size={16} color={info?.state === 'live' ? 'var(--warn)' : 'var(--text-3)'} />
        <strong style={{ fontSize: 14, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {loading ? 'Twitch-Link wird geprüft …' : error ? 'Twitch' : `${info?.channel ?? 'Twitch'}${info?.title && info.state !== 'live' ? ` · ${info.title}` : ''}`}
        </strong>
        {info?.recording && <span className="sm-tag" style={{ color: 'var(--warn)' }}>läuft noch</span>}{tag && <span className="sm-tag">{tag}{info && info.durationSec > 0 ? ` · ${fmtHms(info.durationSec)}` : ''}</span>}
      </div>
      {error && <span style={{ color: 'var(--warn)', fontSize: 14 }}>{error}</span>}
      {info?.message && <span style={{ fontSize: 14, color: 'var(--text-2)' }}>{info.message}</span>}

      {vod && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <Pill role="radio" pressed={!section} onClick={() => setSection(null)}>{info?.recording ? 'Ganzes VOD (bis jetzt)' : 'Ganzes VOD'}</Pill>
          <Pill role="radio" pressed={!!section} onClick={() => applyRange(from, parseHms(to) > info.durationSec ? fmtHms(info.durationSec) : to)}><Scissors size={13} /> Zeitbereich</Pill>
          {section && info && (
            <div style={{ flexBasis: '100%', display: 'grid', gap: 8 }}>
              <RangeBar duration={info.durationSec} value={section} step={STEPS[step]} onChange={(r) => { setSection(r); setFrom(fmtHms(r[0])); setTo(fmtHms(r[1])) }} />
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <small>Raster</small><Segmented options={Object.keys(STEPS)} value={step} onChange={setStep} />
              </div>
            </div>
          )}
          {section && (
            <>
              <input className="sm-input" style={{ width: 96 }} aria-label="Von" value={from} onChange={(e) => applyRange(e.target.value, to)} />
              <small>bis</small>
              <input className="sm-input" style={{ width: 96 }} aria-label="Bis" value={to} onChange={(e) => applyRange(from, e.target.value)} />
              <small>{fmtHms(section[1] - section[0])} lang</small>
            </>
          )}
        </div>
      )}

      {info?.state === 'live' && info.live && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {MINUTES.map((m) => <Pill key={m} onClick={() => !busy && onLast(m)}>Letzte {m} Min</Pill>)}
          <input className="sm-input" style={{ width: 64 }} inputMode="numeric" aria-label="Eigene Minutenzahl" value={custom} onChange={(e) => setCustom(e.target.value.replace(/\D/g, '').slice(0, 3))} />
          <Pill onClick={() => { const n = Number(custom); if (!busy && n >= 1) onLast(n) }}>Min holen</Pill>
          <span style={{ flex: 1 }} />
          <Button variant="secondary" onClick={onLiveBuffer}><Radio size={14} /> Live-Puffer starten</Button>
        </div>
      )}
      {info && (info.state === 'novods' && info.title) && (
        <div><Button variant="secondary" onClick={onLiveBuffer}><Radio size={14} /> Live-Puffer starten</Button></div>
      )}
      <small>VODs laufen je nach Kanal nach 7–60 Tagen ab · Fremde Inhalte nur mit Erlaubnis des Streamers veröffentlichen</small>
    </div>
  )
}
