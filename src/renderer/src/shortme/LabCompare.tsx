import { useMemo } from 'react'
import { alignWords } from '@shared/wordDiff'
import type { LabResult } from '@shared/models'

const mark: React.CSSProperties = { background: 'rgba(255,214,10,0.22)', borderRadius: 4, padding: '0 2px' }
const miss: React.CSSProperties = { background: 'rgba(255,92,92,0.22)', borderRadius: 4, padding: '0 2px' }

const Tags = ({ r }: { r: LabResult }): React.JSX.Element => (
  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
    <span className="sm-tag">Laufzeit {r.runtimeSec} s</span>
    {r.vramPeakMb >= 0 && <span className="sm-tag">VRAM-Spitze +{r.vramPeakMb} MB</span>}
    <small>{r.context}</small>
  </div>
)

/** Platz „Clip-Transkription“: beide Transkripte nebeneinander, Unterschiede markiert (gelb = anders geschrieben/neu, rot = fehlt auf der anderen Seite). */
export function TextCompare({ a, b, nameA, nameB }: { a: LabResult; b: LabResult; nameA: string; nameB: string }): React.JSX.Element {
  const wa = useMemo(() => a.text?.words ?? [], [a])
  const wb = useMemo(() => b.text?.words ?? [], [b])
  const ops = useMemo(() => alignWords(wa.map((w) => w.w), wb.map((w) => w.w)), [wa, wb])
  const sa = new Map<number, 'sub' | 'del'>(), sb = new Map<number, 'sub' | 'ins'>()
  let diffs = 0
  for (const o of ops) {
    if (o.kind === 'same') continue
    diffs++
    if (o.a !== undefined) sa.set(o.a, o.kind === 'del' ? 'del' : 'sub')
    if (o.b !== undefined) sb.set(o.b, o.kind === 'ins' ? 'ins' : 'sub')
  }
  const col = (label: string, r: LabResult, words: Array<{ w: string; start: number; end: number }>, marks: Map<number, string>): React.JSX.Element => (
    <div style={{ display: 'grid', gap: 8, minWidth: 0, alignContent: 'start' }}>
      <strong style={{ fontSize: 14 }}>{label}</strong>
      <Tags r={r} />
      <div className="sm-card" style={{ padding: 12, lineHeight: 1.9, fontSize: 14, maxHeight: 460, overflowY: 'auto' }}>
        {words.map((w, i) => <span key={i} title={`${w.start.toFixed(1)} s`} style={marks.get(i) === 'sub' ? mark : marks.get(i) ? miss : undefined}>{w.w}{' '}</span>)}
      </div>
    </div>
  )
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <span className="sm-tag">{diffs} Unterschiede</span><span className="sm-tag">{wa.length} vs. {wb.length} Wörter</span>
        <small><span style={mark}>gelb</span> anders · <span style={miss}>rot</span> nur auf einer Seite</small>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 16 }}>
        {col(`A · ${nameA}`, a, wa, sa)}
        {col(`B · ${nameB}`, b, wb, sb)}
      </div>
    </div>
  )
}

const overlapShare = (x: { start: number; end: number }, y: { start: number; end: number }): number => Math.max(0, Math.min(x.end, y.end) - Math.max(x.start, y.start)) / Math.max(1, Math.min(x.end - x.start, y.end - y.start))
const fmt = (s: number): string => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`

/** Platz „Clip-Auswahl (LLM)“: dieselbe Quelle, Clips beider Modelle mit Score, Begründung und Laufzeit; Clips, die sich zeitlich überschneiden, sind als gemeinsam markiert. */
export function ClipsCompare({ a, b, nameA, nameB }: { a: LabResult; b: LabResult; nameA: string; nameB: string }): React.JSX.Element {
  const ca = a.clips ?? [], cb = b.clips ?? []
  const shared = (c: { start: number; end: number }, other: typeof ca): boolean => other.some((o) => overlapShare(c, o) > 0.5)
  const mean = (l: typeof ca): string => (l.length ? (l.reduce((n, c) => n + c.score, 0) / l.length).toFixed(0) : '–')
  const col = (label: string, r: LabResult, list: typeof ca, other: typeof ca): React.JSX.Element => (
    <div style={{ display: 'grid', gap: 8, minWidth: 0, alignContent: 'start' }}>
      <strong style={{ fontSize: 14 }}>{label}</strong>
      <Tags r={r} />
      <div style={{ display: 'flex', gap: 6 }}><span className="sm-tag">{list.length} Clips</span><span className="sm-tag">Ø Score {mean(list)}</span><span className="sm-tag">{list.filter((c) => shared(c, other)).length} gemeinsam</span></div>
      {list.map((c, i) => (
        <div key={i} className="sm-card" style={{ padding: 12, display: 'grid', gap: 4 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span className="sm-score">{c.score}</span>
            <strong style={{ fontSize: 14, flex: 1 }}>{c.title}</strong>
            {shared(c, other) && <span className="sm-tag" title="Das andere Modell hat eine überlappende Stelle gewählt">gemeinsam</span>}
          </div>
          <small>{fmt(c.start)}–{fmt(c.end)} · {Math.round(c.end - c.start)} s</small>
          <span style={{ fontSize: 13, color: 'var(--text-2)' }}>{c.reason}</span>
        </div>
      ))}
    </div>
  )
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 16 }}>
      {col(`A · ${nameA}`, a, ca, cb)}
      {col(`B · ${nameB}`, b, cb, ca)}
    </div>
  )
}
