import { useEffect, useState } from 'react'
import { Radio, Square, Scissors, Clock, HardDrive, MessageSquare, Tv, FolderOpen } from 'lucide-react'
import { channelName, fmtHms, type ChannelCheck } from '@shared/twitch'
import { useTwitch } from './twitchStore'
import { useStore } from './store'
import { useProject } from './projectStore'
import { fmtBytes } from './engines'
import { Button, Pill, Segmented, Switch } from './ui'

const MINUTES = [1, 3, 5, 10]

function Stat({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub?: string }): React.JSX.Element {
  return (
    <div className="sm-glass" style={{ padding: '12px 14px', display: 'grid', gap: 2, minWidth: 0, background: 'rgba(255,255,255,0.03)' }}>
      <small style={{ display: 'flex', gap: 6, alignItems: 'center', color: 'var(--text-2)' }}>{icon} {label}</small>
      <strong style={{ fontSize: 22, fontVariantNumeric: 'tabular-nums' }}>{value}</strong>
      {sub && <small style={{ color: 'var(--text-3)' }}>{sub}</small>}
    </div>
  )
}

/** Tab „Live“: Live-Puffer (Streamlink-Ringpuffer) als Status-Center. Läuft im Hintergrund weiter, auch wenn man den Bereich wechselt. */
export function LiveScreen(): React.JSX.Element {
  const live = useTwitch((s) => s.live)
  const saves = useTwitch((s) => s.saves)
  const draft = useTwitch((s) => s.channelDraft)
  const setDraft = useTwitch((s) => s.setChannelDraft)
  const start = useTwitch((s) => s.start)
  const stop = useTwitch((s) => s.stop)
  const save = useTwitch((s) => s.save)
  const refreshSaves = useTwitch((s) => s.refreshSaves)
  const status = useTwitch((s) => s.status)
  const refreshStatus = useTwitch((s) => s.refreshStatus)
  const go = useStore((s) => s.go)
  const openProject = useProject((s) => s.openProject)
  const projects = useProject((s) => s.projects)
  const [custom, setCustom] = useState('15')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const [minutes, setMinutes] = useState(15)
  const tw = typeof window !== 'undefined' ? window.cutawan?.shortme?.twitch : undefined
  useEffect(() => { void refreshSaves(); void refreshStatus(); void tw?.settings().then((s) => setMinutes(s.bufferMinutes)).catch(() => undefined) }, [refreshSaves, refreshStatus, tw])

  const run = async (fn: () => Promise<string | null>): Promise<void> => { setBusy(true); setMsg(''); const e = await fn(); setBusy(false); if (e) setMsg(e) }
  const [done, setDone] = useState('')
  // Sichern legt nur das Projekt an; Transkription und Engine startet der Nutzer beim Öffnen des Projekts
  const saveMin = (m: number): Promise<void> => run(async () => { setDone(''); const e = await save(m); if (!e) setDone(`Gesichert: die letzten ${m} Min – unten unter „Gesicherte Ausschnitte“ öffnen und Clips finden.`); return e })
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
  const posterOf = (hash: string): string | null => projects.find((p) => p.hash === hash)?.poster ?? null
  const clipsOf = (hash: string): number => projects.find((p) => p.hash === hash)?.clips ?? 0

  return (
    <div className="sm-wrap" style={{ display: 'grid', gap: 18, paddingTop: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <h1 style={{ display: 'flex', gap: 10, alignItems: 'center' }}><Radio size={26} /> Live</h1>
        <span className="sm-tag" style={live.running ? { color: '#ff5a5f', background: 'rgba(255,77,79,0.16)' } : undefined}>{live.running ? `● Aufnahme läuft · ${live.channel}` : 'Bereit'}</span>
      </div>
      <small style={{ color: 'var(--text-2)', marginTop: -10 }}>Nimmt einen laufenden Twitch-Stream im Hintergrund auf und behält immer die letzten {live.running ? live.bufferMinutes : minutes} Minuten.</small>

      {!live.running ? (
        <div className="sm-glass" style={{ padding: 20, display: 'grid', gap: 16 }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <input className="sm-input" style={{ flex: 1, minWidth: 240, fontSize: 16 }} aria-label="Twitch-Kanal" placeholder="Kanalname oder twitch.tv-Link, z. B. papaplatte" value={draft} onChange={(e) => setDraft(e.target.value)} />
            <Button variant="primary" disabled={busy || channel.length < 2 || !canStart} title={canStart ? undefined : 'Erst einen Kanal eingeben, der gerade live ist'} onClick={() => void run(() => start(channel))}><Radio size={14} /> Puffer starten</Button>
          </div>
          {draft.trim() && (
            <div role="status" style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '10px 14px', borderRadius: 14, background: 'rgba(255,255,255,0.04)', border: '1px solid var(--edge)' }}>
              <Tv size={18} aria-hidden style={{ color: shown?.state === 'live' ? '#ff5a5f' : 'var(--text-3)', flexShrink: 0 }} />
              <div style={{ display: 'grid', gap: 2, minWidth: 0 }}>
                <strong style={{ fontSize: 14 }}>{shown?.displayName ?? name ?? draft.trim()}</strong>
                <small style={{ color: !name || shown?.state === 'missing' || shown?.state === 'offline' ? 'var(--warn)' : shown?.state === 'live' ? 'var(--ok)' : 'var(--text-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {!name ? 'Kein gültiger Kanalname (2–25 Zeichen, Buchstaben, Ziffern, _).'
                    : checking || !shown ? 'Prüfe, ob der Kanal live ist …'
                    : shown.state === 'live' ? `● live${shown.title ? ` – ${shown.title}` : ''}`
                    : shown.state === 'offline' ? 'Gerade nicht live.'
                    : shown.state === 'missing' ? 'Diesen Kanal gibt es auf Twitch nicht.'
                    : `Konnte nicht prüfen, ob der Kanal live ist${shown.error ? ` (${shown.error})` : ''} – Start trotzdem möglich.`}
                </small>
              </div>
            </div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16 }}>
            <div style={{ display: 'grid', gap: 8 }}>
              <small style={{ color: 'var(--text-2)' }}>Puffer-Länge (so weit kannst du zurück sichern)</small>
              <Segmented options={['5', '15', '30', '60']} value={String(minutes)} onChange={(v) => { setMinutes(Number(v)); void tw?.setSettings({ bufferMinutes: Number(v) }) }} />
            </div>
            <div style={{ display: 'grid', gap: 8 }}>
              <small style={{ color: 'var(--text-2)' }}>Twitch-Chat mitschreiben (Signal für die Clipsuche)</small>
              <Switch on={!!status?.chatSignal} onChange={(b) => void tw?.setSettings({ chatSignal: b }).then(refreshStatus)} label="Twitch-Chat als Signal nutzen" />
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }}>
            {[['Puffer starten', 'Die Aufnahme läuft im Hintergrund weiter – auch wenn du andere Seiten öffnest.'], ['Moment sichern', '„Letzte 3 Min“ & Co. machen aus dem Puffer sofort ein Projekt.'], ['Clips finden', 'Projekt öffnen und wie gewohnt Clips erstellen lassen.']].map(([t, d], i) => (
              <div key={t} style={{ display: 'grid', gridTemplateColumns: '28px 1fr', gap: 10, padding: 12, borderRadius: 14, background: 'rgba(255,255,255,0.03)', border: '1px solid var(--edge)' }}>
                <span style={{ width: 26, height: 26, borderRadius: 13, display: 'grid', placeItems: 'center', background: 'rgba(255,255,255,0.08)', fontSize: 13 }}>{i + 1}</span>
                <span style={{ display: 'grid', gap: 2 }}><strong style={{ fontSize: 13.5 }}>{t}</strong><small style={{ color: 'var(--text-2)' }}>{d}</small></span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="sm-glass" style={{ padding: 20, display: 'grid', gap: 16 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12 }}>
            <Stat icon={<Clock size={13} />} label="Laufzeit" value={fmtHms(live.runtimeSec)} sub={live.startedAt ? `seit ${new Date(live.startedAt).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} Uhr` : undefined} />
            <Stat icon={<Radio size={13} />} label="Im Puffer" value={fmtHms(live.bufferSec)} sub={`von ${live.bufferMinutes} Min (${Math.round(fill * 100)} %)`} />
            <Stat icon={<HardDrive size={13} />} label="Speicher" value={fmtBytes(live.bytes)} />
            <Stat icon={<MessageSquare size={13} />} label="Chat" value={live.chat ? 'wird mitgeschrieben' : 'aus'} sub={live.adsSkipped > 0 ? `${live.adsSkipped} Werbeblöcke übersprungen` : undefined} />
          </div>
          <div className="sm-bar" aria-hidden><i style={{ width: `${Math.max(fill, 0.02) * 100}%`, transition: 'width 0.6s' }} /></div>
          {live.message && <small>{live.message}</small>}
          <div style={{ display: 'grid', gap: 8 }}>
            <h3>Moment sichern</h3>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              {MINUTES.filter((m) => m <= live.bufferMinutes).map((m) => <Button key={m} variant={m === 3 ? 'primary' : 'secondary'} disabled={busy} onClick={() => void saveMin(m)}><Scissors size={14} /> Letzte {m} Min</Button>)}
              <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                <input className="sm-input" style={{ width: 64 }} inputMode="numeric" aria-label="Eigene Minutenzahl" value={custom} onChange={(e) => setCustom(e.target.value.replace(/\D/g, '').slice(0, 3))} />
                <Pill onClick={() => { const n = Number(custom); if (!busy && n >= 1) void saveMin(n) }}>Min sichern</Pill>
              </span>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', borderTop: '1px solid var(--edge)', paddingTop: 14 }}>
            <Button variant="secondary" disabled={busy} title="Aufnahme beenden und alles Aufgenommene als Projekt sichern" onClick={() => void run(async () => { setDone(''); const r = await stop(true); if (r.saved) setDone('Aufnahme gesichert – unten unter „Gesicherte Ausschnitte“ öffnen.'); return r.error })}><Square size={14} /> Beenden &amp; alles sichern</Button>
            <Button variant="ghost" disabled={busy} title="Aufnahme beenden, nichts sichern" onClick={() => { if (window.confirm('Aufnahme beenden und das Aufgenommene verwerfen?')) void run(async () => (await stop(false)).error) }}>Beenden ohne Sichern</Button>
          </div>
        </div>
      )}
      {msg && <span role="alert" style={{ color: 'var(--warn)', fontSize: 14 }}>{msg}</span>}
      {done && !msg && <span role="status" style={{ color: 'var(--ok)', fontSize: 14 }}>{done}</span>}

      <section style={{ display: 'grid', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}><h3>Gesicherte Ausschnitte</h3><small>{saves.length}</small></div>
        {saves.length === 0
          ? <div className="sm-glass" style={{ padding: 18 }}><small>Noch nichts gesichert. Gesicherte Momente erscheinen hier und unter „Projekte“.</small></div>
          : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: 12 }}>
              {saves.map((s) => { const poster = posterOf(s.hash); const n = clipsOf(s.hash); return (
                <button key={s.hash + s.at} className="sm-card" onClick={() => void openProject(s.hash).then((to) => to && go(to))} style={{ padding: 0, overflow: 'hidden', textAlign: 'left', display: 'grid' }}>
                  <div style={{ aspectRatio: '16/9', background: poster ? `center/cover url(${poster})` : 'rgba(255,255,255,0.04)', display: 'grid', placeItems: 'center' }}>{!poster && <Tv size={22} style={{ color: 'var(--text-3)' }} />}</div>
                  <span style={{ padding: '10px 12px 12px', display: 'grid', gap: 3, minWidth: 0 }}>
                    <strong style={{ fontSize: 13.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.title}</strong>
                    <small>{s.channel} · {fmtHms(s.seconds)} · {new Date(s.at).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</small>
                    <small style={{ display: 'flex', gap: 6, alignItems: 'center', color: n ? 'var(--text-1)' : 'var(--text-3)' }}><FolderOpen size={12} /> {n ? `${n} Clips` : 'Noch nicht analysiert – öffnen'}</small>
                  </span>
                </button>
              ) })}
            </div>
          )}
        <small style={{ color: 'var(--text-3)' }}>Aufnahmen anderer Streamer nur mit deren Erlaubnis veröffentlichen.</small>
      </section>
    </div>
  )
}
