import { useEffect, useState } from 'react'
import { AlertTriangle, Check, Loader2 } from 'lucide-react'
import { ENGINE_IDS, ENGINE_LABEL, V3_PROFILES, V3_PROFILE_LABEL, displayedRunId, engineOfRun, type SelectionEngineId, type V3Profile } from '@shared/engine'
import { Button, Segmented } from './ui'
import { useProject } from './projectStore'
import { useStore } from './store'

const fmtMB = (n: number): string => (n >= 1e9 ? `${(n / 1e9).toFixed(1).replace('.', ',')} GB` : `${Math.round(n / 1e6)} MB`)

/**
 * Gegenseitig ausschließender Zweifachschalter: genau eine Engine ist für den nächsten Lauf gewählt. Der Schalter steuert dieselbe, im Main-Prozess gespeicherte
 * Projektauswahl wie überall; Gewählte Engine, laufender Job und angezeigter Ergebnislauf sind getrennte Zustände.
 */
export function EngineSwitch({ onSelect, value, disabled }: { onSelect: (e: SelectionEngineId) => void; value: SelectionEngineId; disabled?: boolean }): React.JSX.Element {
  return (
    <div role="group" aria-label="Auswahl-Engine" style={{ opacity: disabled ? 0.55 : 1, pointerEvents: disabled ? 'none' : 'auto' }}>
      <Segmented options={ENGINE_IDS.map((e) => ENGINE_LABEL[e])} value={ENGINE_LABEL[value]} onChange={(l) => onSelect(ENGINE_IDS.find((e) => ENGINE_LABEL[e] === l) ?? 'legacy')} />
    </div>
  )
}

/** Analyseprofil der Engine 3 (Tiefe der Suche): keine eigene Engine. */
export function ProfilePicker({ value, onChange, disabled }: { value: V3Profile; onChange: (p: V3Profile) => void; disabled?: boolean }): React.JSX.Element {
  return (
    <div style={{ display: 'grid', gap: 4, opacity: disabled ? 0.55 : 1, pointerEvents: disabled ? 'none' : 'auto' }}>
      <Segmented options={V3_PROFILES.map((p) => V3_PROFILE_LABEL[p])} value={V3_PROFILE_LABEL[value]} onChange={(l) => onChange(V3_PROFILES.find((p) => V3_PROFILE_LABEL[p] === l) ?? 'balanced')} />
      <small>{value === 'fast' ? 'Grobe Abtastung (12-s-Fenster), wenige Prüfungen.' : value === 'balanced' ? 'Empfohlen: 8-s-Fenster, mehr Anfragen, Standard-Prüfbudget.' : 'Dichtere Abtastung (4-s-Schritt), mehr Anfragen und Prüfungen; dauert deutlich länger.'}</small>
    </div>
  )
}

/** Die Python-Laufzeit von Engine 3 über den Modell-Manager-Weg installieren/reparieren (mit Fortschrittszeilen). */
export function RuntimeInstall({ onDone }: { onDone: () => void }): React.JSX.Element {
  const [busy, setBusy] = useState(false)
  const [line, setLine] = useState('')
  const [err, setErr] = useState('')
  const api = typeof window !== 'undefined' ? window.cutawan?.shortme : undefined
  useEffect(() => api?.onV3RuntimeProgress((l) => setLine(l)), [api])
  const run = (): void => { setBusy(true); setErr(''); void api!.v3RuntimeInstall().then(onDone).catch((e: unknown) => setErr(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e))).finally(() => setBusy(false)) }
  useEffect(() => { if (api) run() }, []) // eslint-disable-line react-hooks/exhaustive-deps -- startet die Installation einmal selbst
  return (
    <div style={{ display: 'grid', gap: 4, justifyItems: 'start' }}>
      <Button variant="primary" disabled={busy || !api} onClick={run}>{busy ? 'Installiert …' : 'Erneut versuchen'}</Button>
      {busy && line && <small style={{ maxWidth: 420, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{line}</small>}
      {err && <small role="alert" style={{ color: 'var(--warn)' }}>{err}</small>}
    </div>
  )
}

/** Gut sichtbares Kennzeichen, welche Engine gemeint ist (neue Engine hervorgehoben). */
export function EngineBadge({ engine, prefix }: { engine: SelectionEngineId; prefix?: string }): React.JSX.Element {
  const bg = engine === 'adaptive-v3' ? '#7c3aed' : engine === 'multimodal-v2' ? '#3b6df0' : 'rgba(255,255,255,0.16)'
  return <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', padding: '3px 10px', borderRadius: 999, fontSize: 12, fontWeight: 600, background: bg, color: '#fff' }}>{prefix}{ENGINE_LABEL[engine]}</span>
}

/** Schalter in der Clipliste (nahe „Neu berechnen“) mit Statuszeile: Anzeige, laufender Lauf, fehlende Modelle, Fehler. */
export function EngineBar(): React.JSX.Element | null {
  const hash = useProject((s) => s.clipsFile?.hash ?? s.imported?.meta.hash ?? null)
  const engine = useProject((s) => s.engine)
  const job = useProject((s) => s.job)
  const loadEngine = useProject((s) => s.loadEngine)
  const selectEngine = useProject((s) => s.selectEngine)
  const recompute = useProject((s) => s.recompute)
  const go = useStore((s) => s.go)
  const profile = useProject((s) => s.startProfile)
  const setProfile = useProject((s) => s.setStartProfile)
  const query = useStore((s) => s.opts.query)
  const count = useStore((s) => s.opts.count)
  useEffect(() => { if (hash) void loadEngine(hash) }, [hash, loadEngine])
  const st = engine.state
  if (!hash || !st) return null
  const running = !!job && job.hash === hash && ['queued', 'running', 'paused'].includes(job.state)
  const wanted = count && count !== 'Auto' ? Number(count) : undefined
  const shownEngine = engineOfRun(st, displayedRunId(st))
  const cur = { query: query || undefined, wanted }
  return (
    <div style={{ display: 'grid', gap: 6, justifyItems: 'end' }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
        <EngineSwitch value={st.selected} disabled={running || engine.pending} onSelect={(e) => void selectEngine(e, cur)} />
        <Button variant="secondary" disabled={running || engine.pending} onClick={() => void recompute(cur)}>Neu berechnen</Button>
        {st.runs.filter((r) => r.status === 'done').length > 1 && <Button variant="secondary" onClick={() => go('compare')}>Engines vergleichen</Button>}
      </div>
      {st.selected === 'adaptive-v3' && <ProfilePicker value={profile} onChange={setProfile} disabled={running || engine.pending} />}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
        {running && <Loader2 size={14} className="sm-spin" />}
        {running ? <EngineBadge engine={st.selected} prefix={`Läuft (${Math.round((job?.progress ?? 0) * 100)} %): `} /> : shownEngine ? <EngineBadge engine={shownEngine} prefix="Angezeigt: " /> : <small>Noch keine Ergebnisse</small>}
        {!running && shownEngine && st.selected !== shownEngine && <small>Nächster Lauf: {ENGINE_LABEL[st.selected]}</small>}
      </div>
      {running && <small>{job?.message} · Angezeigt bleiben die Ergebnisse der {shownEngine ? ENGINE_LABEL[shownEngine] : 'bisherigen Anzeige'}. „Stoppen & behalten“ beendet den Lauf.</small>}
      {engine.modelsChecked && engine.missing.length === 0 && <small style={{ display: 'flex', gap: 5, alignItems: 'center', color: 'var(--ok)' }}><Check size={12} /> Modelle für Engine 2 und 3 installiert</small>}
      {engine.msg && <small role="alert" style={{ color: 'var(--warn)', display: 'flex', gap: 6, alignItems: 'center' }}><AlertTriangle size={12} /> {engine.msg}</small>}
      {engine.missing.length > 0 && (st.selected !== 'legacy' || engine.msg) && (
        <div role="alert" className="sm-glass" style={{ padding: '10px 14px', display: 'grid', gap: 6, justifyItems: 'start' }}>
          <small>Für {ENGINE_LABEL[st.selected]} fehlt: {engine.missing.map((m) => `${m.name}${m.sizeBytes ? ` (${fmtMB(m.sizeBytes)})` : ''}`).join(', ')}.</small>
          {engine.missing.some((m) => m.id === 'python-runtime-v3') && <RuntimeInstall onDone={() => void loadEngine(hash)} />}
          {engine.missing.some((m) => m.id !== 'python-runtime-v3') && <Button variant="primary" onClick={() => go('models')}>Modell-Manager öffnen</Button>}
        </div>
      )}
    </div>
  )
}
