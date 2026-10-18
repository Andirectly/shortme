import { useEffect, useMemo, useState } from 'react'
import { Check, Download, Save, Star, Upload, Wand2 } from 'lucide-react'
import type { PresetPatch, StylePreset } from '@shared/preset'
import { groupWords } from '@shared/captions'
import { CaptionLayer } from './CaptionLayers'
import { isBuiltin, usePresets } from './presets'
import { useProject } from './projectStore'
import { Button, Pill } from './ui'

const selectStyle: React.CSSProperties = { minWidth: 0, width: '100%', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 8, padding: '6px 10px', color: 'inherit' }

/** Preset-Auswahl (eingebaute und eigene). */
export function PresetPicker({ presetId, onPick }: { presetId: string; onPick: (id: string, p: StylePreset) => void }): React.JSX.Element {
  const all = usePresets((s) => s.all)
  return (
    <select aria-label="Vorlage" value={presetId} onChange={(e) => { const p = all.find((x) => x.id === e.target.value); if (p) onPick(p.id, p) }} style={selectStyle}>
      <optgroup label="Eingebaut">{all.filter((p) => isBuiltin(p.id)).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</optgroup>
      {all.some((p) => !isBuiltin(p.id)) && <optgroup label="Eigene">{all.filter((p) => !isBuiltin(p.id)).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</optgroup>}
    </select>
  )
}

/** Als Preset speichern / überschreiben / als Standard festlegen / auf alle Clips anwenden / importieren / exportieren. */
export function PresetBar({ preset, presetId, patch, titleEnabled, hasApi, canApplyAll, onApplyAll }: { preset: StylePreset; presetId: string; patch: PresetPatch; titleEnabled: boolean; hasApi: boolean; canApplyAll: boolean; onApplyAll?: () => void }): React.JSX.Element {
  const save = usePresets((s) => s.save)
  const importFiles = usePresets((s) => s.importFiles)
  const exportOne = usePresets((s) => s.exportOne)
  const saveStyle = useProject((s) => s.saveStyle)
  const [naming, setNaming] = useState<string | null>(null)
  const [msg, setMsg] = useState('')
  const flash = (m: string): void => { setMsg(m); setTimeout(() => setMsg(''), 2500) }
  const snapshot = (): StylePreset => ({ ...preset, title: { ...preset.title, enabled: titleEnabled } })
  const mineSelected = !isBuiltin(presetId)
  return (
    <div style={{ display: 'grid', gap: 10, padding: '9px 0', borderTop: '1px solid var(--edge)' }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Pill onClick={() => setNaming(naming === null ? `${preset.name} (eigene)` : null)}><Save size={13} /> Speichern als …</Pill>
        <Pill onClick={() => { if (mineSelected) void save(snapshot(), 'overwrite').then(() => flash('Preset überschrieben')) }} disabled={!mineSelected}>Überschreiben</Pill>
        <Pill onClick={() => void saveStyle({ presetId, style: patch, titleEnabled }).then(() => flash('Als Standard festgelegt'))}><Star size={13} /> Standard</Pill>
        {onApplyAll && canApplyAll && <Pill onClick={onApplyAll}><Wand2 size={13} /> Alle Clips</Pill>}
        <Pill onClick={() => void importFiles().then((ok) => flash(ok ? 'Preset importiert' : 'Nichts importiert'))}><Upload size={13} /> Import</Pill>
        <Pill onClick={() => void exportOne(presetId).then((ok) => ok && flash('Preset exportiert'))}><Download size={13} /> Export</Pill>
      </div>
      {naming !== null && (
        <div style={{ display: 'flex', gap: 8 }}>
          <input className="sm-input" aria-label="Preset-Name" value={naming} onChange={(e) => setNaming(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && naming.trim()) { void save({ ...snapshot(), name: naming.trim() }, 'new').then(() => { setNaming(null); flash('Preset gespeichert') }) } }} />
          <Button variant="primary" disabled={!hasApi || !naming.trim()} onClick={() => void save({ ...snapshot(), name: naming.trim() }, 'new').then(() => { setNaming(null); flash('Preset gespeichert') })}>Speichern</Button>
        </div>
      )}
      {msg && <small role="status"><Check size={12} style={{ verticalAlign: -1 }} /> {msg}</small>}
    </div>
  )
}

const SAMPLE = [['Das', 0, 0.4], ['wird', 0.4, 0.8], ['richtig', 0.8, 1.35], ['gut', 1.35, 1.9]] as const

/** Kachel mit animierter Vorschau (läuft in Schleife, gleiche Darstellung wie Editor und Export). */
export function PresetTile({ preset, selected, onClick, label }: { preset: StylePreset; selected: boolean; onClick: () => void; label?: string }): React.JSX.Element {
  const [t, setT] = useState(0)
  useEffect(() => {
    const t0 = performance.now()
    const id = setInterval(() => setT(((performance.now() - t0) / 1000) % 2.8), 50)
    return () => clearInterval(id)
  }, [])
  const groups = useMemo(() => groupWords(SAMPLE.map(([w, a, b], i) => ({ w, start: a, end: b, g: i, hi: i === 2 })), { ...preset.caption, maxWords: 4 }), [preset.caption])
  const W = 150
  const H = (W * 16) / 9
  return (
    <button className="sm-tile" aria-pressed={selected} onClick={onClick} style={{ padding: 8, display: 'grid', gap: 6, textAlign: 'center' }}>
      <div style={{ position: 'relative', height: 74, borderRadius: 10, overflow: 'hidden', background: 'linear-gradient(135deg,#3a3a40,#1b1b1e)' }}>
        <div style={{ position: 'absolute', left: '50%', width: W, height: H, marginLeft: -W / 2, top: 37 - preset.caption.y * H, containerType: 'size' }}>
          <CaptionLayer preset={preset} groups={groups} t={t} scope={`tile-${preset.id.replace(/[^\w]/g, '')}`} />
        </div>
      </div>
      <small>{label ?? preset.name}</small>
    </button>
  )
}
