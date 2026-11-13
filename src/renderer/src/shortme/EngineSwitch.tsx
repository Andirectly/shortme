import { useEffect } from 'react'
import { AlertTriangle, Loader2 } from 'lucide-react'
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
      <small style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        {running && <Loader2 size={12} className="sm-spin" />}
        {running
          ? `${ENGINE_LABEL[st.selected]} läuft (${Math.round((job?.progress ?? 0) * 100)} %). Angezeigt: Ergebnisse der ${shownEngine ? ENGINE_LABEL[shownEngine] : 'bisherigen Anzeige'}. „Stoppen & behalten“ beendet den Lauf.`
          : shownEngine ? `Ergebnisse: ${ENGINE_LABEL[shownEngine]}${st.selected !== shownEngine ? ` · gewählt für den nächsten Lauf: ${ENGINE_LABEL[st.selected]}` : ''}` : 'Noch keine Ergebnisse'}
      </small>
      {engine.msg && <small role="alert" style={{ color: 'var(--warn)', display: 'flex', gap: 6, alignItems: 'center' }}><AlertTriangle size={12} /> {engine.msg}</small>}
      {engine.missing.length > 0 && (
        <div role="alert" className="sm-glass" style={{ padding: '10px 14px', display: 'grid', gap: 6, justifyItems: 'start' }}>
          <small>Für die neue Engine fehlt: {engine.missing.map((m) => `${m.name}${m.sizeBytes ? ` (${fmtMB(m.sizeBytes)})` : ''}`).join(', ')}.</small>
          <Button variant="primary" onClick={() => go('models')}>Modell-Manager öffnen</Button>
        </div>
      )}
    </div>
  )
}
