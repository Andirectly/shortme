import { useCallback, useEffect, useState } from 'react'
import { GraduationCap, Check, X, Download, Trash2 } from 'lucide-react'
import { LEVEL_LABEL, type Level } from '@shared/learn'
import { MIN_MODEL, MIN_PATTERNS, STAGES, type LearnStats, type Rule } from '@shared/learnStats'
import { Button, Switch } from './ui'

const api = (): Window['cutawan']['shortme']['learn'] | null => (typeof window !== 'undefined' ? window.cutawan?.shortme?.learn ?? null : null)
const pct = (x: number): string => `${Math.round(x * 100)} %`
const SOURCES: Array<[keyof LearnStats['counts']['pairs'], string]> = [['rating', 'Bewertung'], ['correction', 'Korrektur'], ['creator', 'Creator'], ['heatmap', 'Heatmap'], ['blind', 'Blindtest']]

function Bar({ value, max, label }: { value: number; max: number; label: string }): React.JSX.Element {
  return (
    <div style={{ display: 'grid', gap: 4 }}>
      <small style={{ display: 'flex', justifyContent: 'space-between' }}><span>{label}</span><span>{value} / {max}</span></small>
      <div className="sm-bar" style={{ height: 6 }}><i style={{ width: `${Math.min(100, (value / max) * 100)}%` }} /></div>
    </div>
  )
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }): React.JSX.Element {
  return <div className="sm-glass" style={{ padding: 14, display: 'grid', gap: 2 }}><small>{label}</small><strong style={{ fontSize: 24 }}>{value}</strong>{sub && <small>{sub}</small>}</div>
}

/** Bereich „Lernen“: Sammeln, Zähler, Muster, Eichung, Regel-Vorschläge. Nichts wirkt ohne deine Bestätigung. */
export function LearnScreen(): React.JSX.Element {
  const [s, setS] = useState<LearnStats | null>(null)
  const [msg, setMsg] = useState('')
  const load = useCallback(async () => { const a = api(); if (a) setS(await a.stats().catch(() => null)) }, [])
  useEffect(() => { void load(); void api()?.rebuild().then(load).catch(() => undefined) }, [load])
  if (!s) return <div style={{ paddingTop: 12 }}><h1><GraduationCap size={26} /> Lernen</h1></div>
  const { counts: c, calibration: cal } = s
  const set = (p: Partial<LearnStats['settings']>): void => void api()!.setSettings(p).then(load)
  const decide = (r: Rule, d: 'accept' | 'reject'): void => void api()!.rule(r, d).then(load)

  return (
    <div style={{ display: 'grid', gap: 14, paddingTop: 12, maxWidth: 1000, alignContent: 'start' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <h1 style={{ display: 'flex', gap: 10, alignItems: 'center', flex: 1 }}><GraduationCap size={26} /> Lernen</h1>
        <span aria-label={s.settings.collect ? 'Sammelt' : 'Aus'} style={{ width: 10, height: 10, borderRadius: 5, background: s.settings.collect ? 'var(--ok)' : 'rgba(255,255,255,0.25)' }} />
        <Switch on={s.settings.collect} label="Daten sammeln" onChange={(b) => set({ collect: b })} />
      </div>

      <div className="sm-glass" style={{ padding: 14, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {STAGES.map((st, i) => (
          <span key={st.id} className="sm-tag" style={{ opacity: s.stages[st.id] ? 1 : 0.45, display: 'inline-flex', gap: 4, alignItems: 'center' }}>{s.stages[st.id] && <Check size={12} />}{i + 1}. {st.label}</span>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
        <Tile label="Kandidaten" value={String(c.candidates)} sub={`${c.withHeat} mit Heatmap`} />
        <Tile label="Creator-Shorts" value={String(c.creatorShorts)} />
        <Tile label="Korrekturen" value={String(c.corrections)} />
        <Tile label="Bewertungen" value={String(c.ratings.strong + c.ratings.mid + c.ratings.bad)} sub={(['strong', 'mid', 'bad'] as Level[]).map((l) => `${LEVEL_LABEL[l]} ${c.ratings[l]}`).join(' · ')} />
      </div>

      <div className="sm-glass" style={{ padding: 14, display: 'grid', gap: 10 }}>
        <Bar value={c.corrections} max={MIN_PATTERNS} label="Muster zeigen (Korrekturen)" />
        <Bar value={c.entries} max={MIN_MODEL} label="Modell trainieren (Einträge mit Heatmap oder Creator-Short)" />
        <small>Paare: {SOURCES.map(([k, l]) => `${l} ${c.pairs[k]}`).join(' · ')}</small>
      </div>

      {s.patterns.length > 0 && (
        <div className="sm-glass" style={{ padding: 14, display: 'grid', gap: 6 }}>
          <strong>Muster</strong>
          {s.patterns.map((p) => <span key={p}>{p}</span>)}
        </div>
      )}

      <div className="sm-glass" style={{ padding: 14, display: 'grid', gap: 8 }}>
        <strong>Eichung</strong>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 10 }}>
          <Tile label="Übereinstimmung mit deinen Bewertungen" value={cal.ratings ? pct(cal.ratings.rate) : '–'} sub={cal.ratings ? `${cal.ratings.n} Paare (${cal.ratings.scope})` : undefined} />
          <Tile label="Treffer auf Heatmap-Spitzen" value={cal.peaks ? pct(cal.peaks.hit) : '–'} sub={cal.peaks ? `Zufall ${pct(cal.peaks.base)} · ${cal.peaks.n} Clips` : undefined} />
          <Tile label="Treffer auf Creator-Momente" value={cal.creator ? pct(cal.creator.rate) : '–'} sub={cal.creator ? `${cal.creator.n} Momente` : undefined} />
        </div>
      </div>

      {(s.open.length > 0 || s.accepted.length > 0) && (
        <div style={{ display: 'grid', gap: 8 }}>
          <strong>Regeln</strong>
          {s.open.map((r) => (
            <div key={r.id} className="sm-glass" style={{ padding: 12, display: 'flex', gap: 10, alignItems: 'center' }}>
              <span style={{ flex: 1 }}>{r.text}</span>
              <Button variant="primary" onClick={() => decide(r, 'accept')}><Check size={14} /> Übernehmen</Button>
              <Button onClick={() => decide(r, 'reject')}><X size={14} /> Ablehnen</Button>
            </div>
          ))}
          {s.accepted.map((r) => (
            <div key={r.id} className="sm-glass" style={{ padding: 12, display: 'flex', gap: 10, alignItems: 'center', outline: '1px solid var(--accent)' }}>
              <span style={{ flex: 1 }}>{r.text}</span>
              <Button onClick={() => void api()!.ruleRemove(r.id).then(load)}><X size={14} /> Entfernen</Button>
            </div>
          ))}
        </div>
      )}

      <details className="sm-glass" style={{ padding: 14 }}>
        <summary>Erweitert</summary>
        <div style={{ paddingTop: 10 }}><Switch on={s.settings.trend} label="Trend-Signal zum Hauptthema (YouTube-Suche, schwach)" onChange={(b) => set({ trend: b })} /></div>
      </details>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <Button onClick={() => void api()!.exportData().then((p) => setMsg(p ? `Exportiert nach ${p}` : ''))}><Download size={14} /> Daten exportieren</Button>
        <Button onClick={() => void api()!.clearData().then((ok) => { if (ok) { setMsg('Gelöscht'); void load() } })}><Trash2 size={14} /> Alle Lerndaten löschen</Button>
        <small>{msg}</small>
      </div>
    </div>
  )
}
