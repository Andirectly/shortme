import { useEffect, useState } from 'react'
import { Radio, Scissors } from 'lucide-react'
import { fmtHms, isTwitchUrl, parseHms, type TwitchInfo } from '@shared/twitch'
import { Button, Pill } from './ui'

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

/** Twitch-Bereich unter dem Import-Feld: Zeitbereich (VOD > 1 h), „Letzte Minuten“ (Kanal live), Live-Puffer, Meldungen. */
export function TwitchPanel({ info, error, loading, section, setSection, busy, onLast, onLiveBuffer }: {
  info: TwitchInfo | null; error: string; loading: boolean; section: Section; setSection: (s: Section) => void; busy: boolean
  onLast: (minutes: number) => void; onLiveBuffer: () => void
}): React.JSX.Element {
  const [custom, setCustom] = useState('15')
  const [from, setFrom] = useState('0:00')
  const [to, setTo] = useState('1:00:00')
  const long = !!info && info.state === 'vod' && info.durationSec > 3600
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
        {tag && <span className="sm-tag">{tag}{info && info.durationSec > 0 ? ` · ${fmtHms(info.durationSec)}` : ''}</span>}
      </div>
      {error && <span style={{ color: 'var(--warn)', fontSize: 14 }}>{error}</span>}
      {info?.message && <span style={{ fontSize: 14, color: 'var(--text-2)' }}>{info.message}</span>}

      {long && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <Pill role="radio" pressed={!section} onClick={() => setSection(null)}>Ganzes VOD</Pill>
          <Pill role="radio" pressed={!!section} onClick={() => applyRange(from, to)}><Scissors size={13} /> Zeitbereich</Pill>
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
