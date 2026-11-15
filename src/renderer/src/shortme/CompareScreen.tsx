import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, ArrowLeft } from 'lucide-react'
import { ENGINE_LABEL, LEGACY_RUN_ID, type RunInfo } from '@shared/engine'
import { clipPieces, sourceToOutputTime, type EngineComparison, type EventMatch } from '@shared/compare'
import { Button, Segmented } from './ui'
import { useProject } from './projectStore'
import { useStore } from './store'

type Info = Record<string, { title: string; start: number; end: number; score: number; autoCuts: Array<{ start: number; end: number }> }>
const api = (): Window['cutawan']['shortme'] | null => (typeof window !== 'undefined' ? window.cutawan?.shortme ?? null : null)
const mmss = (s: number): string => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`
const LETTER = ['A', 'B', 'C']
const CHOICE: Array<[string, 'a' | 'b' | 'c' | 'tie' | 'all-weak']> = [['A', 'a'], ['B', 'b'], ['C', 'c'], ['Gleich gut', 'tie'], ['Alle schwach', 'all-weak']]

/** Engine-Vergleich über dieselbe Originaldatei: Ereignis-Zuordnung, Exklusiv-Treffer, blinde Bewertung. Die Läufe selbst bleiben unverändert. */
export function CompareScreen(): React.JSX.Element {
  const hash = useProject((s) => s.clipsFile?.hash ?? s.imported?.meta.hash ?? null)
  const state = useProject((s) => s.engine.state)
  const go = useStore((s) => s.go)
  const runs = useMemo(() => [{ runId: LEGACY_RUN_ID, engineId: 'legacy', createdAt: '', clipCount: undefined } as Partial<RunInfo> & { runId: string }, ...(state?.runs ?? []).filter((r) => r.status === 'done')], [state])
  const label = useCallback((id: string): string => { const r = state?.runs.find((x) => x.runId === id); return `${ENGINE_LABEL[r?.engineId ?? 'legacy']}${r?.options.profile ? ` · ${r.options.profile}` : ''}${r ? ` · ${id.slice(-5)}` : ''}` }, [state])
  const [pick, setPick] = useState<string[]>([])
  const [cmp, setCmp] = useState<{ c: EngineComparison; clips: Info } | null>(null)
  const [err, setErr] = useState('')
  const [blind, setBlind] = useState(true)
  const [order, setOrder] = useState<Record<string, string[]>>({})
  const [revealed, setRevealed] = useState<Set<string>>(new Set())

  const reload = useCallback(async (id: string) => { const a = api(); if (a && hash) setCmp(await a.compareGet(hash, id)) }, [hash])
  useEffect(() => { // zuletzt erstellten Vergleich zeigen
    const a = api(); if (!a || !hash) return
    void a.compareList(hash).then((l) => (l[0] ? reload(l[0].comparisonId) : undefined)).catch(() => undefined)
  }, [hash, reload])
  useEffect(() => { // blinde Reihenfolge je Match laden
    const a = api(); if (!a || !hash || !cmp) return
    for (const m of cmp.c.eventMatches) if (m.members.length > 1 && !order[m.matchId]) void a.compareBlind(hash, cmp.c.comparisonId, m.matchId).then((o) => setOrder((p) => ({ ...p, [m.matchId]: o })))
  }, [hash, cmp, order])

  if (!hash || !state) return <div style={{ paddingTop: 12 }}><h1>Engines vergleichen</h1><p>Zuerst ein Projekt öffnen.</p></div>
  const create = async (): Promise<void> => { setErr(''); try { const r = await api()!.compareCreate(hash, pick); setOrder({}); setRevealed(new Set()); await reload(r.comparisonId) } catch (e) { setErr(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e)) } }
  const split = async (m: EventMatch): Promise<void> => { if (cmp) { await api()!.compareOverride(hash, cmp.c.comparisonId, { action: 'split', memberRefs: m.members.map((x) => ({ runId: x.runId, eventId: x.eventId })) }); setOrder({}); await reload(cmp.c.comparisonId) } }
  const merge = async (a: EventMatch, b: EventMatch): Promise<void> => { if (cmp) { await api()!.compareOverride(hash, cmp.c.comparisonId, { action: 'merge', memberRefs: [...a.members, ...b.members].map((x) => ({ runId: x.runId, eventId: x.eventId })) }); setOrder({}); await reload(cmp.c.comparisonId) } }
  const review = async (m: EventMatch, choice: 'a' | 'b' | 'c' | 'tie' | 'all-weak'): Promise<void> => { if (cmp) { await api()!.compareReview(hash, cmp.c.comparisonId, { matchId: m.matchId, choice, reasonTags: [] }); setRevealed((p) => new Set(p).add(m.matchId)); await reload(cmp.c.comparisonId) } }

  const c = cmp?.c
  const exclusive = (rid: string): number => c?.eventMatches.filter((m) => m.kind === 'engine-exclusive' && m.members[0].runId === rid).length ?? 0
  const memberInfo = (rid: string, m: EventMatch): { titles: string; span: string; at: string } => {
    const mem = m.members.find((x) => x.runId === rid)
    const cl = mem?.clipIds.map((id) => cmp!.clips[id]).filter(Boolean) ?? []
    if (!mem || !cl.length) return { titles: '—', span: '', at: '' }
    const anchor = m.alignment.sourceAnchorSec
    const t = cl.map((k) => sourceToOutputTime(clipPieces(k), anchor)).find((x) => x !== 'omitted')
    return { titles: cl[0].title, span: cl.map((k) => `${mmss(k.start)}–${mmss(k.end)}`).join(' · '), at: t === undefined ? 'im Schnitt ausgelassen' : '' }
  }
  const shared = c?.eventMatches.filter((m) => m.members.length > 1) ?? []

  return (
    <div style={{ display: 'grid', gap: 14, paddingTop: 12, alignContent: 'start' }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}><Button variant="secondary" onClick={() => go('clips')}><ArrowLeft size={14} /> Zurück</Button><h1 style={{ margin: 0 }}>Engines vergleichen</h1></div>
      <div className="sm-glass" style={{ padding: 14, display: 'grid', gap: 8 }}>
        <small>Zwei oder drei fertige Läufe desselben Videos wählen. Neue Läufe entstehen über „Neu berechnen“ mit der jeweiligen Engine (volle Analyse des Originals).</small>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {runs.map((r) => <label key={r.runId} style={{ display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" checked={pick.includes(r.runId)} onChange={(e) => setPick((p) => (e.target.checked ? [...p, r.runId].slice(-3) : p.filter((x) => x !== r.runId)))} />{label(r.runId)}{r.clipCount != null ? ` (${r.clipCount})` : ''}</label>)}
        </div>
        <div><Button variant="primary" disabled={pick.length < 2} onClick={() => void create()}>Vergleich erstellen</Button></div>
        {err && <small role="alert" style={{ color: 'var(--warn)' }}>{err}</small>}
      </div>
      {c && (
        <>
          {c.warnings.map((w) => <small key={w} role="alert" style={{ color: 'var(--warn)', display: 'flex', gap: 6, alignItems: 'center' }}><AlertTriangle size={12} /> {w}</small>)}
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
            {c.runIds.map((r) => <div key={r} className="sm-glass" style={{ padding: '8px 14px' }}><strong>{label(r)}</strong><br /><small>{exclusive(r)} nur hier gefunden (Endergebnis; ein verworfener Kandidat im Rohpool zählt hier nicht als „nicht gefunden“)</small></div>)}
            <div className="sm-glass" style={{ padding: '8px 14px' }}><strong>{shared.length}</strong> gemeinsame Ereignisse<br /><small>{c.eventMatches.filter((m) => m.kind === 'ambiguous').length} unklar</small></div>
          </div>
          <Segmented options={['Blind bewerten', 'Aufgedeckt']} value={blind ? 'Blind bewerten' : 'Aufgedeckt'} onChange={(l) => setBlind(l === 'Blind bewerten')} />
          <div style={{ display: 'grid', gap: 8 }}>
            {c.eventMatches.map((m, idx) => {
              const done = c.reviews.find((x) => x.matchId === m.matchId)
              const hide = blind && m.members.length > 1 && !revealed.has(m.matchId) && !done
              const ord = order[m.matchId] ?? m.members.map((x) => x.runId)
              const next = c.eventMatches[idx + 1]
              return (
                <div key={m.matchId} className="sm-glass" style={{ padding: 12, display: 'grid', gap: 6 }}>
                  <small>{mmss(m.alignment.sourceAnchorSec)} · {m.kind === 'shared-event' ? (m.confidenceLabel === 'manual-match' ? 'von dir zusammengeführt' : m.confidenceLabel === 'strong-match' ? 'gemeinsames Ereignis' : 'mögliches gemeinsames Ereignis') : m.kind === 'ambiguous' ? 'unklar zugeordnet' : `nur ${hide ? 'eine Engine' : label(m.members[0].runId)}`}{m.alignment.temporalIou != null ? ` · Überlappung ${Math.round(m.alignment.temporalIou * 100)} %` : ''}</small>
                  <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.max(1, ord.length)}, minmax(0, 1fr))`, gap: 10 }}>
                    {ord.map((rid, i) => { const mi = memberInfo(rid, m); return (
                      <div key={rid}><b>{hide ? `Variante ${LETTER[i]}` : label(rid)}</b><div>{mi.titles}</div><small>{mi.span}</small>{mi.at && <div><small style={{ color: 'var(--warn)' }}>{mi.at}</small></div>}</div>
                    ) })}
                  </div>
                  {m.members.length > 1 && (
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                      {CHOICE.filter(([, v]) => (v !== 'c' || ord.length > 2)).map(([l, v]) => <Button key={v} variant={done?.choice === v ? 'primary' : 'secondary'} onClick={() => void review(m, v)}>{l}</Button>)}
                      <Button variant="secondary" onClick={() => void split(m)}>Trennen</Button>
                      {done && <small>Bewertet: {done.choice === 'tie' ? 'gleich gut' : done.choice === 'all-weak' ? 'alle schwach' : `Variante ${done.choice.toUpperCase()} = ${label(done.anonymizedPresentationOrder['abc'.indexOf(done.choice)] ?? '')}`}</small>}
                    </div>
                  )}
                  {m.members.length === 1 && next && <div><Button variant="secondary" onClick={() => void merge(m, next)}>Mit nächstem Ereignis zusammenführen</Button></div>}
                </div>
              )
            })}
          </div>
          <small>Nicht umgesetzt: synchrones Mehrfach-Abspielen der Clips nebeneinander. Die Zeitzuordnung (Quellzeit → Clipzeit, „im Schnitt ausgelassen“) ist vorhanden und getestet.</small>
        </>
      )}
    </div>
  )
}
