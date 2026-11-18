import { useEffect, useState } from 'react'
import { Radio, Square, Scissors } from 'lucide-react'
import { channelName, fmtHms, type ChannelCheck } from '@shared/twitch'
import { useTwitch } from './twitchStore'
import { useStore } from './store'
import { useProject } from './projectStore'
import { fmtBytes } from './engines'
import { Button, Pill } from './ui'

const MINUTES = [3, 5, 10]

/** Tab „Live“: Live-Puffer (Streamlink-Ringpuffer). Läuft im Hintergrund weiter, auch wenn man den Bereich wechselt. */
export function LiveScreen(): React.JSX.Element {
  const live = useTwitch((s) => s.live)
  const saves = useTwitch((s) => s.saves)
  const draft = useTwitch((s) => s.channelDraft)
  const setDraft = useTwitch((s) => s.setChannelDraft)
  const start = useTwitch((s) => s.start)
  const stop = useTwitch((s) => s.stop)
  const save = useTwitch((s) => s.save)
  const refreshSaves = useTwitch((s) => s.refreshSaves)
  const go = useStore((s) => s.go)
  const openProject = useProject((s) => s.openProject)
  const [custom, setCustom] = useState('15')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { void refreshSaves() }, [refreshSaves])

  const run = async (fn: () => Promise<string | null>): Promise<void> => { setBusy(true); setMsg(''); const e = await fn(); setBusy(false); if (e) setMsg(e) }
  const [done, setDone] = useState('')
  // Sichern legt nur das Projekt an; Transkription und Engine startet der Nutzer beim Öffnen des Projekts
  const saveMin = (m: number): Promise<void> => run(async () => { setDone(''); const e = await save(m); if (!e) setDone(`Gesichert (letzte ${m} Min) – unter „Gesicherte Ausschnitte“ oder „Projekte“ öffnen und Engine wählen.`); return e })
  const channel = (draft || live.channel || '').trim()
  const fill = live.bufferMinutes ? Math.min(1, live.bufferSec / (live.bufferMinutes * 60)) : 0
  // Kanal prüfen, sobald die Eingabe kurz ruht: gibt es ihn, sendet er gerade? (nie „ins Leere“ aufnehmen)
  const [check, setCheck] = useState<ChannelCheck | null>(null)
  const [checking, setChecking] = useState(false)
  const name = channelName(draft)
  useEffect(() => {
    if (live.running || !name || !window.cutawan) return
    let alive = true
    const id = setTimeout(() => { setChecking(true); void window.cutawan.shortme.twitch.checkChannel(name).then((c) => { if (alive) setCheck(c) }).catch(() => undefined).finally(() => { if (alive) setChecking(false) }) }, 700)
    return () => { alive = false; clearTimeout(id) }
  }, [name, live.running])
  const shown = check && check.channel === name ? check : null
  const canStart = !!name && (!window.cutawan || shown?.state === 'live' || shown?.state === 'unknown')

  return (
    <div className="sm-wrap" style={{ display: 'grid', gap: 16, paddingTop: 12 }}>
      <h1 style={{ display: 'flex', gap: 10, alignItems: 'center' }}><Radio size={26} /> Live</h1>

      <div className="sm-cols">
      <div className="sm-glass" style={{ padding: 18, display: 'grid', gap: 14 }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <input className="sm-input" style={{ flex: 1 }} aria-label="Twitch-Kanal" placeholder="Kanalname, z. B. papaplatte" disabled={live.running} value={live.running ? live.channel ?? '' : draft} onChange={(e) => setDraft(e.target.value)} />
          {live.running
            ? <>
                <Button variant="primary" disabled={busy} title="Aufnahme beenden und alles Aufgenommene als Projekt sichern" onClick={() => void run(async () => { setDone(''); const r = await stop(true); if (r.saved) setDone('Aufnahme gesichert – unter „Gesicherte Ausschnitte“ oder „Projekte“ öffnen und Engine wählen.'); return r.error })}><Square size={14} /> Stoppen &amp; sichern</Button>
                <Button variant="secondary" disabled={busy} title="Aufnahme beenden, nichts sichern" onClick={() => { if (window.confirm('Aufnahme beenden und das Aufgenommene verwerfen?')) void run(async () => (await stop(false)).error) }}>Verwerfen</Button>
              </>
            : <Button variant="primary" disabled={busy || channel.length < 2 || !canStart} title={canStart ? undefined : 'Erst einen Kanal eingeben, der gerade live ist'} onClick={() => void run(() => start(channel))}><Radio size={14} /> Puffer starten</Button>}
        </div>
        {!live.running && draft.trim() && (
          <small role="status" style={{ color: !name || shown?.state === 'missing' || shown?.state === 'offline' ? 'var(--warn)' : shown?.state === 'live' ? 'var(--ok)' : 'var(--text-2)' }}>
            {!name ? 'Kein gültiger Kanalname (2–25 Zeichen, Buchstaben, Ziffern, _).'
              : checking || !shown ? `Prüfe „${name}“ …`
              : shown.state === 'live' ? `● ${shown.displayName ?? name} ist live${shown.title ? ` – ${shown.title}` : ''}`
              : shown.state === 'offline' ? `${shown.displayName ?? name} ist gerade nicht live.`
              : shown.state === 'missing' ? `Den Kanal „${name}“ gibt es auf Twitch nicht.`
              : `Konnte nicht prüfen, ob „${name}“ live ist${shown.error ? ` (${shown.error})` : ''} – Start trotzdem möglich.`}
          </small>
        )}

        {live.running && (
          <>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <span className="sm-tag">Kanal {live.channel}</span>
              <span className="sm-tag">Laufzeit {fmtHms(live.runtimeSec)}</span>
              <span className="sm-tag">Puffer {fmtHms(live.bufferSec)} von {live.bufferMinutes} Min</span>
              <span className="sm-tag">Speicher {fmtBytes(live.bytes)}</span>
              {live.chat && <span className="sm-tag">Chat wird mitgeschrieben</span>}
              {live.adsSkipped > 0 && <span className="sm-tag">{live.adsSkipped} Werbeblöcke übersprungen</span>}
            </div>
            <div className="sm-bar" aria-hidden><i style={{ width: `${Math.max(fill, 0.02) * 100}%`, transition: 'width 0.6s' }} /></div>
            {live.message && <small>{live.message}</small>}
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              {MINUTES.map((m) => <Pill key={m} onClick={() => !busy && void saveMin(m)}>Letzte {m} Min</Pill>)}
              <input className="sm-input" style={{ width: 64 }} inputMode="numeric" aria-label="Eigene Minutenzahl" value={custom} onChange={(e) => setCustom(e.target.value.replace(/\D/g, '').slice(0, 3))} />
              <Pill onClick={() => { const n = Number(custom); if (!busy && n >= 1) void saveMin(n) }}><Scissors size={13} /> Min sichern</Pill>
            </div>
          </>
        )}
        {msg && <span style={{ color: 'var(--warn)', fontSize: 14 }}>{msg}</span>}
        {done && !msg && <span role="status" style={{ color: 'var(--ok)', fontSize: 14 }}>{done}</span>}
        <small>Eigene Aufnahmen nur mit Erlaubnis des Streamers veröffentlichen</small>
      </div>

      <section>
        <h3 style={{ marginBottom: 10 }}>Gesicherte Ausschnitte</h3>
        {saves.length === 0
          ? <small>Noch nichts gesichert.</small>
          : (
            <div style={{ display: 'grid', gap: 8 }}>
              {saves.map((s) => (
                <button key={s.hash + s.at} className="sm-card" onClick={() => void openProject(s.hash).then((to) => to && go(to))} style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '10px 14px', textAlign: 'left' }}>
                  <span style={{ flex: 1, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.title}</span>
                  <small>{fmtHms(s.seconds)} · {new Date(s.at).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</small>
                </button>
              ))}
            </div>
          )}
      </section>
      </div>
    </div>
  )
}
