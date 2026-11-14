import { useEffect } from 'react'
import { AlertTriangle, Check, Loader2 } from 'lucide-react'
import { ENGINE_LABEL, displayedRunId, engineOfRun, type SelectionEngineId } from '@shared/engine'
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
      <Segmented options={[ENGINE_LABEL.legacy, ENGINE_LABEL['multimodal-v2']]} value={ENGINE_LABEL[value]} onChange={(l) => onSelect(l === ENGINE_LABEL['multimodal-v2'] ? 'multimodal-v2' : 'legacy')} />
    </div>
  )
}

/** Gut sichtbares Kennzeichen, welche Engine gemeint ist (neue Engine hervorgehoben). */
export function EngineBadge({ engine, prefix }: { engine: SelectionEngineId; prefix?: string }): React.JSX.Element {
  const v2 = engine === 'multimodal-v2'
  return <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', padding: '3px 10px', borderRadius: 999, fontSize: 12, fontWeight: 600, background: v2 ? 'var(--accent)' : 'rgba(255,255,255,0.12)', color: v2 ? '#fff' : 'var(--text-1)' }}>{prefix}{ENGINE_LABEL[engine]}</span>
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
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
        {running && <Loader2 size={14} className="sm-spin" />}
        {running ? <EngineBadge engine={st.selected} prefix={`Läuft (${Math.round((job?.progress ?? 0) * 100)} %): `} /> : shownEngine ? <EngineBadge engine={shownEngine} prefix="Angezeigt: " /> : <small>Noch keine Ergebnisse</small>}
        {!running && shownEngine && st.selected !== shownEngine && <small>Nächster Lauf: {ENGINE_LABEL[st.selected]}</small>}
      </div>
      {running && <small>{job?.message} · Angezeigt bleiben die Ergebnisse der {shownEngine ? ENGINE_LABEL[shownEngine] : 'bisherigen Anzeige'}. „Stoppen & behalten“ beendet den Lauf.</small>}
      {engine.modelsChecked && engine.missing.length === 0 && <small style={{ display: 'flex', gap: 5, alignItems: 'center', color: 'var(--ok)' }}><Check size={12} /> Modelle der neuen Engine installiert (Bild, Ton, Text)</small>}
      {engine.msg && <small role="alert" style={{ color: 'var(--warn)', display: 'flex', gap: 6, alignItems: 'center' }}><AlertTriangle size={12} /> {engine.msg}</small>}
      {engine.missing.length > 0 && (st.selected === 'multimodal-v2' || engine.msg) && (
        <div role="alert" className="sm-glass" style={{ padding: '10px 14px', display: 'grid', gap: 6, justifyItems: 'start' }}>
          <small>Für die neue Engine fehlt: {engine.missing.map((m) => `${m.name}${m.sizeBytes ? ` (${fmtMB(m.sizeBytes)})` : ''}`).join(', ')}.</small>
          <Button variant="primary" onClick={() => go('models')}>Modell-Manager öffnen</Button>
        </div>
      )}
    </div>
  )
}
