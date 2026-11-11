import { useEffect, useState } from 'react'
import { useTwitch } from './twitchStore'
import { CheckCircle2, XCircle, RefreshCw } from 'lucide-react'
import type { UpdateCheckResult, UpdateDownloadState } from '@shared/types'
import type { CatalogStatus } from '@shared/catalog'
import { fmtBytes, requiredIds, useEngines } from './engines'
import { useStore } from './store'
import { Button, Pill, Row, Segmented, Switch } from './ui'

/** Gespeicherte Facecam-Layouts pro Twitch-Kanal ansehen und löschen. */
function ChannelLayouts(): React.JSX.Element | null {
  const api = typeof window !== 'undefined' ? window.cutawan?.shortme : undefined
  const [list, setList] = useState<Array<{ channel: string; preset: string; gap: number; updatedAt: string }>>([])
  useEffect(() => { void api?.channelLayouts().then(setList).catch(() => undefined) }, [api])
  if (!api) return null
  const PRESET: Record<string, string> = { top: 'Facecam oben', half: '50 : 50', bottom: 'Facecam unten', pip: 'Kleines Fenster' }
  return (
    <Row label="Kanal-Layouts (Facecam + Gameplay)">
      {list.length === 0 ? <small>Noch keine gespeichert.</small> : (
        <div style={{ display: 'grid', gap: 8 }}>
          {list.map((l) => (
            <div key={l.channel} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ flex: 1, fontSize: 14 }}>{l.channel}</span>
              <span className="sm-tag">{PRESET[l.preset] ?? l.preset}</span>
              <Button variant="ghost" aria-label={`Layout von ${l.channel} löschen`} onClick={() => void api.channelLayoutDelete(l.channel).then(setList)}>Löschen</Button>
            </div>
          ))}
        </div>
      )}
    </Row>
  )
}

function TwitchSettings(): React.JSX.Element {
  const status = useTwitch((s) => s.status)
  const refresh = useTwitch((s) => s.refreshStatus)
  const [token, setToken] = useState('')
  const [minutes, setMinutes] = useState(15)
  const [msg, setMsg] = useState('')
  const api = typeof window !== 'undefined' ? window.cutawan?.shortme?.twitch : undefined
  useEffect(() => { void refresh(); void api?.settings().then((s) => setMinutes(s.bufferMinutes)) }, [refresh, api])
  if (!api) return <></>
  const saveToken = async (value: string): Promise<void> => { await api.setToken(value); setToken(''); setMsg(value ? 'Token gespeichert' : 'Token entfernt'); void refresh() }
  return (
    <div className="sm-glass" style={{ padding: '4px 22px 16px' }}>
      <Row label="Twitch-Chat als Ranking-Signal nutzen" toggle={<Switch on={!!status?.chatSignal} onChange={(b) => void api.setSettings({ chatSignal: b }).then(refresh)} label="Twitch-Chat als Ranking-Signal nutzen" />} />
      <ChannelLayouts />
      <Row label="Live-Puffer (Minuten)"><Segmented options={['5', '15', '30', '60']} value={String(minutes)} onChange={(v) => { setMinutes(Number(v)); void api.setSettings({ bufferMinutes: Number(v) }) }} /></Row>
      <Row label="Twitch-Token (optional)">
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <input className="sm-input" type="password" autoComplete="off" aria-label="Twitch-Token" placeholder={status?.hasToken ? 'Token gespeichert' : 'auth-token des eigenen Kontos'} value={token} onChange={(e) => setToken(e.target.value)} />
          <Button variant="secondary" disabled={!token.trim()} onClick={() => void saveToken(token)}>Speichern</Button>
          {status?.hasToken && <Button variant="ghost" onClick={() => void saveToken('')}>Entfernen</Button>}
        </div>
        {msg && <small role="status">{msg}</small>}
      </Row>
    </div>
  )
}

/** Bewertungskatalog über ein privates GitHub-Repo auf allen Rechnern teilen (Token nur in der Windows-Anmeldeinformationsverwaltung). */
function CatalogSettings(): React.JSX.Element {
  const api = typeof window !== 'undefined' ? window.cutawan?.shortme?.catalog : undefined
  const [st, setSt] = useState<CatalogStatus | null>(null)
  const [repo, setRepo] = useState('Andirectly/shortme-data')
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  useEffect(() => { void api?.status().then(setSt).catch(() => undefined) }, [api])
  if (!api) return <></>
  const run = async (fn: () => Promise<CatalogStatus>): Promise<void> => {
    setBusy(true); setMsg('')
    try { setSt(await fn()); setToken('') } catch (e) { setMsg(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e)) }
    setBusy(false)
  }
  const c = st?.counts
  return (
    <Row label="Bewertungen teilen (GitHub)">
      <div style={{ display: 'grid', gap: 8 }}>
        {st?.configured ? (
          <>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <span className="sm-tag">Verbunden · {st.repo}</span>
              <Button variant="secondary" disabled={busy} onClick={() => void run(() => api.sync())}>{busy ? 'Gleicht ab …' : 'Jetzt abgleichen'}</Button>
              <Button variant="ghost" disabled={busy} onClick={() => void run(() => api.disconnect())}>Trennen</Button>
            </div>
            <small>{st.entries} Bewertungen{c ? ` (stark ${c.strong} · mittel ${c.mid} · schlecht ${c.bad})` : ''}, davon {st.fromOthers} von anderen Rechnern{st.lastSync ? ` · zuletzt ${new Date(st.lastSync).toLocaleString('de-DE')}` : ''}</small>
          </>
        ) : (
          <>
            <input className="sm-input" aria-label="Repo" placeholder="Besitzer/Repo" value={repo} onChange={(e) => setRepo(e.target.value)} />
            <input className="sm-input" aria-label="GitHub-Token" type="password" autoComplete="off" placeholder="GitHub-Token (Contents: Read and write, nur dieses Repo)" value={token} onChange={(e) => setToken(e.target.value)} />
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <Button variant="primary" disabled={busy || !repo.trim() || !token.trim()} onClick={() => void run(() => api.connect(repo, token))}>{busy ? 'Verbindet …' : 'Verbinden'}</Button>
              <small>Einmal pro Rechner. Bewertungen: {st?.entries ?? 0} lokal.</small>
            </div>
          </>
        )}
        {(msg || st?.lastError) && <small role="alert" style={{ color: 'var(--warn)' }}>{msg || st?.lastError}</small>}
      </div>
    </Row>
  )
}

/** Zielordner der Exporte (je Projekt ein Unterordner). */
function ExportFolder(): React.JSX.Element {
  const api = typeof window !== 'undefined' ? window.cutawan?.shortme : undefined
  const [st, setSt] = useState<{ dir: string; isDefault: boolean } | null>(null)
  useEffect(() => { void api?.exportDir().then(setSt).catch(() => undefined) }, [api])
  return (
    <Row label="Zielordner">
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <input className="sm-input" readOnly value={st?.dir ?? ''} aria-label="Zielordner" />
        <Button variant="secondary" onClick={() => void api?.chooseExportDir().then(setSt)}>Ändern</Button>
        {st && !st.isDefault && <Button variant="ghost" onClick={() => void api?.resetExportDir().then(setSt)}>Standard</Button>}
      </div>
    </Row>
  )
}

/** YouTube verlangt auf manchen Rechnern eine Anmeldung (Bot-Prüfung): Firefox-Cookies oder cookies.txt. Chrome/Edge scheiden unter Windows aus (verschlüsselt). */
function YouTubeLogin(): React.JSX.Element {
  const api = typeof window !== 'undefined' ? window.cutawan : undefined
  const [mode, setMode] = useState('Aus')
  const [msg, setMsg] = useState('')
  const apply = (s: { importCookiesBrowser: string; hasImportCookiesFile: boolean }): void => setMode(s.hasImportCookiesFile ? 'Datei' : s.importCookiesBrowser === 'firefox' ? 'Firefox' : 'Aus')
  useEffect(() => { void api?.getSettings().then(apply).catch(() => undefined) }, [api])
  if (!api) return <></>
  const choose = async (v: string): Promise<void> => {
    setMsg('')
    if (v === 'Datei') { apply(await api.importCookiesFile()); return }
    await api.clearCookiesFile()
    apply(await api.updateSettings({ importCookiesBrowser: v === 'Firefox' ? 'firefox' : '' }))
  }
  return (
    <Row label="YouTube-Anmeldung (bei „Bot-Prüfung“)">
      <div style={{ display: 'grid', gap: 6 }}>
        <Segmented options={['Aus', 'Firefox', 'Datei']} value={mode} onChange={(v) => void choose(v).catch((e: unknown) => setMsg(e instanceof Error ? e.message : String(e)))} />
        <small>{mode === 'Firefox' ? 'Nutzt die Anmeldung aus Firefox (dort bei YouTube angemeldet sein).' : mode === 'Datei' ? 'cookies.txt gespeichert. Erneut „Datei“ wählen, um sie zu ersetzen.' : 'Nur nötig, wenn YouTube-Links „Bot-Prüfung“ melden.'}</small>
        {msg && <small role="alert" style={{ color: 'var(--warn)' }}>{msg}</small>}
      </div>
    </Row>
  )
}

/** Fehlende Modelle anzeigen und mit einem Klick laden (Fortschritt liegt auf der Seite „Modelle“). */
function ModelSettings(): React.JSX.Element {
  const { catalog, status, hw, installingAll, installRecommended } = useEngines()
  const rec = new Set(requiredIds(hw))
  const missing = catalog.filter((c) => rec.has(c.id) && status[c.id]?.state !== 'installed')
  const size = missing.reduce((n, c) => n + c.files.reduce((m, f) => m + f.size, 0), 0)
  return (
    <Row label="Modelle">
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <small style={{ flex: 1, color: missing.length ? 'var(--warn)' : undefined }}>{missing.length === 0 ? 'Alles bereit' : `${missing.length} fehlen (${fmtBytes(size)}): ${missing.map((c) => c.name).join(', ')}`}</small>
        {missing.length > 0 && <Button variant="primary" disabled={installingAll} onClick={() => void installRecommended()}>{installingAll ? 'Lädt …' : 'Alles laden'}</Button>}
      </div>
    </Row>
  )
}

/** Updates aus den GitHub-Releases: suchen, laden, neu starten. */
function UpdateSettings(): React.JSX.Element {
  const api = typeof window !== 'undefined' ? window.cutawan : undefined
  const [res, setRes] = useState<UpdateCheckResult | null>(null)
  const [dl, setDl] = useState<UpdateDownloadState>({ status: 'idle', progress: 0 })
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  useEffect(() => {
    if (!api) return
    void api.getUpdateDownloadState().then(setDl).catch(() => undefined)
    return api.onUpdateDownloadState(setDl)
  }, [api])
  if (!api) return <></>
  const run = async (fn: () => Promise<unknown>): Promise<void> => {
    setBusy(true); setMsg('')
    try { await fn() } catch (e) { setMsg(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e)) }
    setBusy(false)
  }
  const downloading = dl.status === 'downloading'
  const ready = dl.status === 'downloaded'
  const err = msg || res?.error || (dl.status === 'error' ? dl.error : '')
  return (
    <Row label="Updates">
      <div style={{ display: 'grid', gap: 8 }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <small style={{ flex: 1 }}>{res ? `Version ${res.currentVersion}${res.latestVersion ? (res.updateAvailable ? ` · neu: ${res.latestVersion}` : ' · aktuell') : ''}` : 'Version prüfen'}</small>
          {ready
            ? <Button variant="primary" disabled={busy} onClick={() => void run(() => api.installUpdate())}>Neu starten und installieren</Button>
            : res?.updateAvailable && !downloading
              ? <Button variant="primary" disabled={busy} onClick={() => void run(() => api.downloadUpdate())}>Update laden</Button>
              : <Button variant="secondary" disabled={busy || downloading} onClick={() => void run(async () => setRes(await api.checkForUpdates()))}>Nach Updates suchen</Button>}
        </div>
        {downloading && <div className="sm-bar" aria-label="Update-Download"><i style={{ width: `${Math.max(dl.progress, 0.02) * 100}%` }} /></div>}
        {err && <small role="alert" style={{ color: 'var(--warn)' }}>{err}</small>}
      </div>
    </Row>
  )
}

export function SettingsScreen(): React.JSX.Element {
  const [profile, setProfile] = useState('TikTok')
  const [quality, setQuality] = useState('Hoch')
  const [encoder, setEncoder] = useState('Auto')
  const [subs, setSubs] = useState('Eingebrannt')
  const [names, setNames] = useState(true)
  const testlab = useStore((s) => s.testlab)
  const setTestlab = useStore((s) => s.setTestlab)
  const check = useEngines((s) => s.check)
  const checking = useEngines((s) => s.checking)
  const refreshCheck = useEngines((s) => s.refreshCheck)
  return (
    <div style={{ maxWidth: 820, margin: '0 auto', display: 'grid', gap: 8, paddingTop: 12 }}>
      <h1>Einstellungen</h1>
      <div className="sm-glass" style={{ padding: '4px 22px 16px' }}>
        <Row label="Export-Profil"><Segmented options={['TikTok', 'Reels', 'Shorts', 'Eigenes']} value={profile} onChange={setProfile} /></Row>
        <Row label="Qualität"><Segmented options={['Normal', 'Hoch', 'Maximal']} value={quality} onChange={setQuality} /></Row>
        <Row label="Encoder"><Segmented options={['Auto', 'NVENC', 'CPU']} value={encoder} onChange={setEncoder} /></Row>
        <Row label="Untertitel"><Segmented options={['Eingebrannt', 'SRT', 'Beides']} value={subs} onChange={setSubs} /></Row>
        <Row label="Testlab (Menü und gewählte Testlab-Modelle)"><Switch on={testlab} onChange={setTestlab} label="Testlab anzeigen" /></Row>
        <Row label="Dateinamen nach KI-Titel"><Switch on={names} onChange={setNames} label="Dateinamen nach KI-Titel" /></Row>
        <ExportFolder />
      </div>
      <div className="sm-glass" style={{ padding: '4px 22px 16px' }}>
        <ModelSettings />
        <UpdateSettings />
        <YouTubeLogin />
        <CatalogSettings />
      </div>
      <h3 style={{ marginTop: 8 }}>Twitch</h3>
      <TwitchSettings />
      <div className="sm-glass" style={{ padding: '14px 22px', display: 'grid', gap: 10 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}><h3>Systemcheck</h3><div style={{ display: 'flex', gap: 8 }}><Pill onClick={() => void refreshCheck()}><RefreshCw size={13} className={checking ? 'sm-spin' : ''} /> Neu prüfen</Pill><Pill onClick={() => void window.cutawan?.shortme?.openLogs()}>Logs öffnen</Pill></div></div>
        {check.map((c) => (
          <div key={c.id} style={{ display: 'grid', gridTemplateColumns: '24px 210px 1fr', alignItems: 'center', gap: 8, fontSize: 14 }}>
            {c.ok ? <CheckCircle2 size={17} color="var(--ok)" /> : <XCircle size={17} color="var(--warn)" />}<span>{c.name}</span><small>{c.detail}</small>
          </div>
        ))}
      </div>
    </div>
  )
}
