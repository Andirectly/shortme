/** Einstellungen › Remote-Geräte (Plan V4, Kap. 4/8.3): Worker an/aus, Autostart, Koppeln mit Code + Fingerabdruck, Test, Entkoppeln. */
import { useEffect, useState } from 'react'
import type { RemoteOverview, RemoteDeviceView, RemoteJobView } from '@shared/remote/ui'
import { Button, Row, Switch } from './ui'

/** Gemeinsamer Remote-Zustand für alle Komponenten (ein Abo auf die Übersicht). */
export function useRemoteOverview(): RemoteOverview | null {
  const api = typeof window !== 'undefined' ? window.cutawan?.shortme?.remote : undefined
  const [o, setO] = useState<RemoteOverview | null>(null)
  useEffect(() => {
    if (!api) return
    void api.overview().then(setO).catch(() => undefined)
    return api.onOverview(setO)
  }, [api])
  return o
}

const COMPUTE: Record<string, string> = {
  sending: 'Wird gesendet …', accepted: 'Angenommen', 'acquiring-source': 'Lädt Video', preparing: 'Vorbereitung', transcribing: 'Transkription',
  analyzing: 'KI-Analyse', selecting: 'Clipauswahl', rendering: 'Rendert Clips', auditing: 'Prüfung', publishing: 'Überträgt', completed: 'Fertig',
  failed: 'Fehlgeschlagen', cancelled: 'Abgebrochen', rejected: 'Abgelehnt', 'resource-paused': 'Pausiert', 'needs-input': 'Eingabe nötig'
}

/** Liste der an andere Rechner gesendeten Aufträge: Rechenstand, Verbindung und Übertragung getrennt. */
export function RemoteJobsList({ overview, onOpen }: { overview: RemoteOverview; onOpen?: (hash: string) => void }): React.JSX.Element | null {
  const api = window.cutawan?.shortme?.remote
  if (!overview.jobs.length || !api) return null
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      {overview.jobs.map((j: RemoteJobView) => {
        const running = !['completed', 'failed', 'cancelled', 'rejected'].includes(j.compute)
        const transfer = j.bundleTotal ? `Projekt ${j.projectImported ? 'übertragen' : `${j.bundleDone}/${j.bundleTotal} Dateien`}` : ''
        const clips = j.clipsReady || j.clipsPending ? `${j.clipsReady} fertig${j.clipsPending ? ` · ${j.clipsPending} in Übertragung` : ''}` : ''
        return (
          <div key={j.jobId} className="sm-card" style={{ padding: 12, display: 'grid', gap: 6 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline' }}>
              <strong style={{ fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{j.title}</strong>
              <small style={{ whiteSpace: 'nowrap' }}>{j.deviceName} · {j.workerOnline ? 'online' : 'nicht erreichbar'}</small>
            </div>
            <small>
              {COMPUTE[j.compute] ?? j.compute}{j.stage && running ? ` – ${j.stage}` : ''}{j.progress !== undefined && running ? ` (${Math.round(j.progress * 100)} %)` : ''}
              {!j.workerOnline && running && j.lastUpdateAt ? ` · zuletzt bekannt ${new Date(j.lastUpdateAt).toLocaleTimeString('de-DE', { timeStyle: 'short' })}` : ''}
            </small>
            {running && j.progress !== undefined && <div className="sm-bar"><i style={{ width: `${Math.max(j.progress, 0.03) * 100}%` }} /></div>}
            {(transfer || clips) && <small>{[transfer, clips && `Clips: ${clips}`].filter(Boolean).join(' · ')}</small>}
            {j.rejected && <small role="alert" style={{ color: 'var(--warn)' }}>{j.rejected.message}</small>}
            {j.compute === 'failed' && j.stage && <small role="alert" style={{ color: 'var(--warn)' }}>{j.stage}</small>}
            <div style={{ display: 'flex', gap: 8 }}>
              {j.projectImported && j.projectHash && onOpen && <Button variant="primary" onClick={() => onOpen(j.projectHash!)}>Projekt öffnen</Button>}
              {running && j.workerOnline && <Button variant="secondary" onClick={() => void api.cancelJob(j.jobId)}>Abbrechen</Button>}
              {!running && <Button variant="ghost" onClick={() => void api.forgetJob(j.jobId)}>Aus Liste entfernen</Button>}
            </div>
          </div>
        )
      })}
    </div>
  )
}

const CONNECTIVITY: Record<RemoteDeviceView['connectivity'], string> = {
  'online-direct': 'Online · Direkt (P2P)',
  'online-relay': 'Online · Relay',
  connecting: 'Verbinde …',
  offline: 'Nicht erreichbar',
  incompatible: 'Update nötig',
  revoked: 'Entkoppelt'
}
const PLATFORM: Record<string, string> = { darwin: 'Mac', win32: 'Windows', linux: 'Linux' }
const when = (iso?: string): string => (iso ? new Date(iso).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' }) : 'noch nie')

export function RemoteDevices(): React.JSX.Element {
  const api = typeof window !== 'undefined' ? window.cutawan?.shortme?.remote : undefined
  const o = useRemoteOverview()
  const [code, setCode] = useState('')
  const [msg, setMsg] = useState('')
  const [tests, setTests] = useState<Record<string, string>>({})
  if (!api || !o) return <></>
  const run = async (fn: () => Promise<RemoteOverview | void>): Promise<void> => {
    setMsg('')
    try { await fn() } catch (e) { setMsg(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e)) }
  }
  const s = o.settings
  const set = (patch: Partial<typeof s>): void => void run(() => api.setSettings(patch))
  const test = (id: string): void => {
    setTests((t) => ({ ...t, [id]: 'Teste …' }))
    void api.testConnection(id).then((r) => setTests((t) => ({ ...t, [id]: r.ok ? `Antwort in ${r.ms} ms · ${r.route === 'direct' ? 'direkt' : r.route}` : 'Keine Antwort' })))
  }

  return (
    <div style={{ display: 'grid', gap: 4 }}>
      <Row label="Remote-Worker aktivieren" toggle={<Switch on={s.enabled} onChange={(b) => set({ enabled: b })} label="Remote-Worker aktivieren" />} />
      <small style={{ paddingBottom: 6 }}>Gekoppelte Rechner verbinden sich direkt (Peer-to-Peer, Ende-zu-Ende verschlüsselt). Kein Server, keine Cloud.</small>
      {s.enabled && (
        <>
          <Row label="Nach der Anmeldung starten" toggle={<Switch on={s.startAtLogin} onChange={(b) => set({ startAtLogin: b })} label="Nach der Anmeldung starten" />} />
          <Row label="Im Hintergrund weiterlaufen (Fenster schließen beendet den Worker nicht)" toggle={<Switch on={s.keepRunningInBackground} onChange={(b) => set({ keepRunningInBackground: b })} label="Im Hintergrund weiterlaufen" />} />
          <Row label="Name dieses Rechners">
            <input className="sm-input" aria-label="Name dieses Rechners" defaultValue={s.deviceName} maxLength={80} onBlur={(e) => { if (e.target.value.trim() && e.target.value !== s.deviceName) set({ deviceName: e.target.value }) }} />
          </Row>
        </>
      )}
      {o.error && <small role="alert" style={{ color: 'var(--warn)' }}>{o.error.code === 'SECRET_STORE_UNAVAILABLE' ? 'Kein sicherer Schlüsselspeicher verfügbar – Remote ist gesperrt, die lokale Verarbeitung funktioniert weiter.' : `Remote-Worker startet nicht: ${o.error.message}`}</small>}

      {o.thisDevice && (
        <>
          <h3 style={{ fontSize: 15, marginTop: 12 }}>Geräte</h3>
          <div style={{ display: 'grid', gap: 6 }}>
            <DeviceLine name={`${o.thisDevice.name} (dieser Rechner)`} detail={PLATFORM[o.thisDevice.platform] ?? o.thisDevice.platform} />
            {o.devices.map((d) => (
              <div key={d.deviceId} style={{ display: 'grid', gap: 4 }}>
                <DeviceLine
                  name={d.name}
                  detail={`${PLATFORM[d.platform] ?? d.platform} · ${CONNECTIVITY[d.connectivity]}${d.connectivity === 'offline' ? ` · zuletzt ${when(d.lastSeenAt)}` : ''}`}
                  actions={<>
                    <Button variant="secondary" disabled={!d.connectivity.startsWith('online')} onClick={() => test(d.deviceId)}>Verbindung testen</Button>
                    <Button variant="ghost" onClick={() => { if (window.confirm(`„${d.name}“ entkoppeln? Dieser Rechner nimmt sofort nichts mehr von ihm an. Ist er gerade offline, erfährt er es erst beim nächsten Kontakt.`)) void run(() => api.unpair(d.deviceId)) }}>Entkoppeln</Button>
                  </>}
                />
                {tests[d.deviceId] && <small role="status">{tests[d.deviceId]}</small>}
              </div>
            ))}
            {o.devices.length === 0 && <small>Noch kein Gerät gekoppelt.</small>}
          </div>

          <h3 style={{ fontSize: 15, marginTop: 12 }}>Gerät koppeln</h3>
          {o.pairRequests.map((r) => (
            <div key={r.deviceId} role="alertdialog" aria-label="Kopplungsanfrage" className="sm-glass" style={{ padding: 12, display: 'grid', gap: 8 }}>
              <strong>„{r.name}“ ({PLATFORM[r.platform] ?? r.platform}) möchte sich koppeln</strong>
              <small>Prüfe, dass auf beiden Rechnern derselbe Code steht:</small>
              <code style={{ fontSize: 22, letterSpacing: 2 }}>{r.fingerprint}</code>
              <div style={{ display: 'flex', gap: 8 }}>
                <Button variant="primary" onClick={() => void run(() => api.confirmPairing(r.deviceId, true))}>Stimmt überein – koppeln</Button>
                <Button variant="ghost" onClick={() => void run(() => api.confirmPairing(r.deviceId, false))}>Ablehnen</Button>
              </div>
            </div>
          ))}
          {o.invite ? (
            <div style={{ display: 'grid', gap: 6 }}>
              <small>Diesen Code auf dem anderen Rechner unter „Code eingeben“ einfügen (gültig bis {new Date(o.invite.expiresAt).toLocaleTimeString('de-DE', { timeStyle: 'short' })}, nur einmal):</small>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <code style={{ fontSize: 12, wordBreak: 'break-all', flex: 1 }}>{o.invite.code}</code>
                <Button variant="secondary" onClick={() => void navigator.clipboard.writeText(o.invite!.code).then(() => setMsg('Code kopiert'))}>Kopieren</Button>
                <Button variant="ghost" onClick={() => void run(() => api.cancelInvite())}>Abbrechen</Button>
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <Button variant="secondary" onClick={() => void run(() => api.createInvite())}>Code erzeugen</Button>
              <input className="sm-input" aria-label="Kopplungscode des anderen Rechners" placeholder="oder Code des anderen Rechners eingeben" value={code} onChange={(e) => setCode(e.target.value)} style={{ flex: 1, minWidth: 220 }} />
              <Button variant="primary" disabled={!/^[0-9a-f]{64}$/i.test(code.trim())} onClick={() => void run(async () => { const r = await api.acceptInvite(code.trim()); setCode(''); setMsg('Suche den anderen Rechner …'); return r })}>Verbinden</Button>
            </div>
          )}
        </>
      )}
      {msg && <small role="status">{msg}</small>}
      {(o.jobs.length > 0 || o.workerJobs.length > 0) && <h3 style={{ fontSize: 15, marginTop: 12 }}>Aufträge</h3>}
      <RemoteJobsList overview={o} />
      {o.workerJobs.map((w) => (
        <div key={w.jobId} className="sm-card" style={{ padding: 12, display: 'grid', gap: 4 }}>
          <strong style={{ fontSize: 14 }}>Für {w.from}: {w.url}</strong>
          <small>{COMPUTE[w.compute] ?? w.compute}{w.stage ? ` – ${w.stage}` : ''} · {w.published} Clips freigegeben{w.pendingOffers ? ` · ${w.pendingOffers} Dateien warten auf Abholung` : ''}</small>
          {w.error && <small role="alert" style={{ color: 'var(--warn)' }}>{w.error}</small>}
        </div>
      ))}
    </div>
  )
}

function DeviceLine({ name, detail, actions }: { name: string; detail: string; actions?: React.ReactNode }): React.JSX.Element {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: 8, alignItems: 'center' }}>
      <div style={{ display: 'grid' }}><span>{name}</span><small>{detail}</small></div>
      {actions && <div style={{ display: 'flex', gap: 6 }}>{actions}</div>}
    </div>
  )
}
