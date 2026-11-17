import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { Button } from './ui'
import { useProject } from './projectStore'

type P = {
  manifest?: { snapshot?: { profile?: string; gitSha?: string; queryRevision?: string }; source?: { sha256?: string; durationSec?: number }; status?: string; stageSec?: Record<string, number> } | null
  group?: { id: string; lanes: string[]; seeds: Array<{ id: string; lane: string; summary: string; span: { start: number; end: number } }> } | null
  investigation?: Array<{ step: number; window: { id: string; span: { start: number; end: number } }; focus: string; op: string; reason: string; confidence: string; wallClockMs: number }>
  graph?: { stopReason?: string; secondWindow?: boolean; graph?: { nodes: Array<{ id: string; role: string; state: string; span: { start: number; end: number }; description: string; evidenceIds: string[] }>; relations: Array<{ from: string; to: string; kind: string; state: string }>; unknownRoles: string[]; contradiction: boolean } } | null
  variants?: Array<{ id: string; style: string; cut: { startEdgeId: string; endEdgeId: string; span: { start: number; end: number } }; fromJudge: boolean }>
  rounds?: Array<{ round: number; rendered: { path: string; sha256: string; durationSeconds: number; streams: string[] }; judgement: { decision: string; criteria: Array<{ id: string; state: string; reason: string }> } | null; error?: string }>
  repairs?: Array<{ round: number; failure: string; op: string; reason: string; from: string; to: string }>
  edges?: Array<{ id: string; t: number; kind: string }>
  deciles?: Record<string, boolean[]> | null
  output?: { path: string; sha256: string } | null
}

const mmss = (s: number): string => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`
const COLOR: Record<string, string> = { pass: 'var(--ok)', fail: 'var(--warn)', unknown: 'var(--text-2)', 'not-applicable': 'var(--text-3)' }

/** Engine 4: Herkunft eines Clips aus den Lauf-Dateien – warum gefunden, Untersuchung, Graph, Kanten, Varianten, Prüfrunden am gerenderten Clip, Reparaturen. */
export function V4ProvenancePanel({ runId, clipId, onClose }: { runId: string; clipId: string; onClose: () => void }): React.JSX.Element {
  const hash = useProject((s) => s.clipsFile?.hash ?? null)
  const [p, setP] = useState<P | null>(null)
  const [err, setErr] = useState('')
  useEffect(() => { if (hash) void window.cutawan.shortme.v4Provenance(hash, runId, clipId).then((x) => setP(x as P)).catch((e: unknown) => setErr(String(e))) }, [hash, runId, clipId])
  const g = p?.graph?.graph
  return (
    <div role="dialog" aria-label="Herkunft des Clips" onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.55)', display: 'grid', placeItems: 'center', padding: 16 }}>
      <div className="sm-glass" onClick={(e) => e.stopPropagation()} style={{ width: 'min(920px, 100%)', maxHeight: '88vh', overflow: 'auto', padding: 18, display: 'grid', gap: 12, background: 'rgba(20,20,26,0.97)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><h2 style={{ margin: 0 }}>Herkunft · Engine 4</h2><Button variant="secondary" onClick={onClose} aria-label="Schließen"><X size={14} /></Button></div>
        {err && <small role="alert" style={{ color: 'var(--warn)' }}>{err}</small>}
        {!p && !err && <small>Lädt …</small>}
        {p && (
          <>
            <small>Lauf {runId} · Profil {p.manifest?.snapshot?.profile} · Quelle {p.manifest?.source?.sha256?.slice(0, 12)} · Status {p.manifest?.status} · Code {p.manifest?.snapshot?.gitSha?.slice(0, 10)}</small>
            <section><b>Warum gefunden</b>
              {p.group ? <div style={{ display: 'grid', gap: 2 }}><small>Suchwege: {p.group.lanes.join(', ')}</small>{p.group.seeds.map((s) => <small key={s.id}>· {s.lane}: {s.summary || '–'} ({mmss(s.span.start)}–{mmss(s.span.end)})</small>)}</div> : <small>keine Angaben</small>}
            </section>
            <section><b>Nachuntersuchung</b> <small>({p.investigation?.length ?? 0} Schritte{p.graph?.secondWindow ? ', mit Folgefenster' : ''}; Ende: {p.graph?.stopReason})</small>
              {(p.investigation ?? []).map((s) => <small key={s.step} style={{ display: 'block' }}>{s.step}. Fenster {mmss(s.window.span.start)}–{mmss(s.window.span.end)} ({s.focus}) → {s.op}: {s.reason} [{s.confidence}, {Math.round(s.wallClockMs / 100) / 10} s]</small>)}
            </section>
            <section><b>Ereignisgraph</b> {g?.contradiction && <small style={{ color: 'var(--warn)' }}>Widerspruch erkannt</small>}
              {(g?.nodes ?? []).map((n) => <small key={n.id} style={{ display: 'block' }}>{n.role} ({n.state}) {mmss(n.span.start)}–{mmss(n.span.end)}: {n.description}</small>)}
              {g?.unknownRoles?.length ? <small style={{ display: 'block', color: 'var(--text-2)' }}>Nicht beobachtet: {g.unknownRoles.join(', ')}</small> : null}
              {(g?.relations ?? []).map((r, i) => <small key={i} style={{ display: 'block', color: 'var(--text-2)' }}>{r.from} → {r.to}: {r.kind} ({r.state})</small>)}
            </section>
            <section><b>Schnitte</b>
              {(p.variants ?? []).map((v) => <small key={v.id} style={{ display: 'block' }}>{v.id} · {v.style}: {v.cut.startEdgeId} ({mmss(v.cut.span.start)}) → {v.cut.endEdgeId} ({mmss(v.cut.span.end)}){v.fromJudge ? ' · vom Cut-Judge gewählt' : ' · ungeprüfter Gitterkandidat'}</small>)}
              {(p.edges ?? []).map((e) => <small key={e.id} style={{ display: 'block', color: 'var(--text-2)' }}>Kante {e.id}: {e.kind} bei {e.t.toFixed(2)} s</small>)}
            </section>
            <section><b>Prüfung am gerenderten Clip</b>
              {(p.rounds ?? []).map((r) => (
                <div key={r.round} style={{ display: 'grid', gap: 2, marginTop: 4 }}>
                  <small>Runde {r.round}: {r.judgement?.decision ?? `ungültig (${r.error})`} · {r.rendered.durationSeconds.toFixed(1)} s · {r.rendered.streams.join('+')} · SHA {r.rendered.sha256.slice(0, 12)}</small>
                  {r.judgement?.criteria.map((c) => <small key={c.id} style={{ color: COLOR[c.state] }}>{c.id}: {c.state} – {c.reason}</small>)}
                </div>
              ))}
            </section>
            <section><b>Reparaturen</b>{p.repairs?.length ? p.repairs.map((r, i) => <small key={i} style={{ display: 'block' }}>Runde {r.round}: {r.failure} → {r.op} ({r.reason})</small>) : <small> keine</small>}</section>
            <section><b>Abdeckung (Zehntel der Quelle geprüft)</b>
              {Object.entries(p.deciles ?? {}).map(([lane, d]) => <small key={lane} style={{ display: 'block' }}>{lane}: {d.map((x) => (x ? '■' : '□')).join('')}</small>)}
            </section>
          </>
        )}
      </div>
    </div>
  )
}
