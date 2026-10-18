import { useState } from 'react'
import type { ActiveMode, AnimSpec, Appear, GlowColor, PresetPatch, StylePreset } from '@shared/preset'
import { Button, Row, Segmented, Slider, Switch } from './ui'

/** Regler mit „live“ (während des Ziehens: Vorschau) und „commit“ (beim Loslassen: ein Undo-Schritt). */
export function Lv({ label, value, min, max, onLive, onCommit, scale = 1, unit = '' }: { label: string; value: number; min: number; max: number; onLive: (v: number) => void; onCommit: (v: number) => void; /** Anzeige-/Rohwert-Faktor: Wert = Regler / scale */ scale?: number; unit?: string }): React.JSX.Element {
  const [d, setD] = useState<number | null>(null)
  const shown = d ?? Math.round(value * scale)
  return (
    <div style={{ position: 'relative' }}>
      <Slider label={label} value={shown} min={min} max={max} onChange={(v) => { setD(v); onLive(v / scale) }} onCommit={(v) => { setD(null); onCommit(v / scale) }} />
      {unit && <small style={{ position: 'absolute', right: 0, top: -12 }}>{unit}</small>}
    </div>
  )
}

const selectStyle: React.CSSProperties = { minWidth: 0, width: '100%', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 8, padding: '6px 10px', color: 'inherit' }
const BUILTIN_FONTS = ['TikTok Sans', 'Montserrat', 'Inter', 'Poppins', 'Anton']

export interface ControlProps {
  value: StylePreset
  /** vorläufig (Regler wird gezogen) */
  onLive: (p: PresetPatch) => void
  /** endgültig */
  onCommit: (p: PresetPatch) => void
}

const Color = ({ label, value, onCommit }: { label: string; value: string; onCommit: (c: string) => void }): React.JSX.Element => (
  <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text-2)' }}>
    <input type="color" aria-label={label} value={value} onChange={(e) => onCommit(e.target.value)} style={{ width: 34, height: 26, padding: 0, border: '1px solid var(--edge)', borderRadius: 6, background: 'none' }} /> {label}
  </label>
)

/** Untertitel-Stil: Schrift, Größe, Farben, Kontur, Schatten, Glow, Box, Position, Wortgruppierung. */
export function CaptionControls({ value, onLive, onCommit, fonts, onImportFonts, hasApi }: ControlProps & { fonts: string[]; onImportFonts: () => void; hasApi: boolean }): React.JSX.Element {
  const c = value.caption
  const set = (p: Partial<StylePreset['caption']> | Record<string, unknown>): void => onCommit({ caption: p as PresetPatch['caption'] })
  const live = (p: Record<string, unknown>): void => onLive({ caption: p as PresetPatch['caption'] })
  const families = [...new Set([...BUILTIN_FONTS, ...fonts])]
  return (
    <div>
      <Row label="Schrift">
        <div style={{ display: 'grid', gap: 8 }}>
          <select aria-label="Schrift" value={c.font.family} onChange={(e) => set({ font: { family: e.target.value, weight: e.target.value === 'Anton' ? 400 : e.target.value === 'Montserrat' ? 800 : 700 } })} style={selectStyle}>
            {families.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
          <Button variant="secondary" disabled={!hasApi} onClick={onImportFonts}>Schrift importieren …</Button>
        </div>
      </Row>
      <Row label="Maße">
        <div style={{ display: 'grid', gap: 8 }}>
          <Lv label="Größe (px)" value={c.sizePx} min={40} max={120} onLive={(v) => live({ sizePx: v })} onCommit={(v) => set({ sizePx: v })} />
          <Lv label="Zeilenabstand" value={c.lineHeight} scale={100} min={100} max={140} onLive={(v) => live({ lineHeight: v })} onCommit={(v) => set({ lineHeight: v })} />
          <Lv label="Wörter/Zeile" value={c.maxWords} min={1} max={5} onLive={(v) => live({ maxWords: v })} onCommit={(v) => set({ maxWords: v })} />
          <Lv label="Position" value={c.y * 100} min={10} max={90} onLive={(v) => live({ y: v / 100 })} onCommit={(v) => set({ y: v / 100 })} />
        </div>
      </Row>
      <Row label="Farben">
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          <Color label="Text" value={c.color} onCommit={(v) => set({ color: v })} />
          <Color label="Hervorhebung" value={c.highlight} onCommit={(v) => set({ highlight: v })} />
        </div>
      </Row>
      <Row label="Großbuchstaben" toggle={<Switch on={c.upper} onChange={(b) => set({ upper: b })} label="Großbuchstaben" />} />
      <Row label="Kontur" toggle={<Switch on={c.outline.enabled} onChange={(b) => set({ outline: { enabled: b } })} label="Kontur" />}>
        {c.outline.enabled && <Lv label="Breite" value={c.outline.widthPct} min={2} max={14} onLive={(v) => live({ outline: { widthPct: v } })} onCommit={(v) => set({ outline: { widthPct: v } })} />}
      </Row>
      <Row label="Schatten" toggle={<Switch on={c.shadow.enabled} onChange={(b) => set({ shadow: { enabled: b } })} label="Schatten" />}>
        {c.shadow.enabled && <>
          <Lv label="Weichzeichnung" value={c.shadow.blurPct} min={2} max={30} onLive={(v) => live({ shadow: { blurPct: v } })} onCommit={(v) => set({ shadow: { blurPct: v } })} />
          <Lv label="Deckkraft" value={c.shadow.opacity * 100} min={10} max={100} onLive={(v) => live({ shadow: { opacity: v / 100 } })} onCommit={(v) => set({ shadow: { opacity: v / 100 } })} />
        </>}
      </Row>
      <Row label="Glow" toggle={<Switch on={c.glow.enabled} onChange={(b) => set({ glow: { enabled: b } })} label="Glow" />}>
        {c.glow.enabled && <>
          <Lv label="Stärke" value={c.glow.strength} min={0} max={100} onLive={(v) => live({ glow: { strength: v } })} onCommit={(v) => set({ glow: { strength: v } })} />
          <Segmented options={['Weiß', 'Gelb', 'Folgt Hervorhebung']} value={c.glow.color === 'white' ? 'Weiß' : c.glow.color === 'yellow' ? 'Gelb' : 'Folgt Hervorhebung'} onChange={(n) => set({ glow: { color: (n === 'Weiß' ? 'white' : n === 'Gelb' ? 'yellow' : 'highlight') as GlowColor } })} />
          <Row label="Stärker auf aktivem Wort" toggle={<Switch on={c.glow.activeBoost} onChange={(b) => set({ glow: { activeBoost: b } })} label="Stärker auf aktivem Wort" />} />
        </>}
      </Row>
      <Row label="Box" toggle={<Switch on={c.box.enabled} onChange={(b) => set({ box: { enabled: b } })} label="Box" />}>
        {c.box.enabled && <Lv label="Deckkraft" value={c.box.opacity * 100} min={10} max={100} onLive={(v) => live({ box: { opacity: v / 100 } })} onCommit={(v) => set({ box: { opacity: v / 100 } })} />}
      </Row>
    </div>
  )
}

const APPEAR: Array<[Appear, string]> = [['none', 'Keine'], ['fade', 'Einblenden'], ['pop', 'Pop'], ['slideUp', 'Hochgleiten'], ['blurIn', 'Blur-In']]
const ACTIVE: Array<[ActiveMode, string]> = [['color', 'Nur Farbe'], ['colorScale', 'Farbe + Vergrößerung'], ['colorGlow', 'Farbe + Glow-Puls']]

/** Animation (Untertitel und Titel getrennt): Erscheinen, aktives Wort, Bewegungsgefühl, Darstellung, Verschwinden. */
export function AnimControls({ kind, anim, onLive, onCommit }: { kind: 'caption' | 'title'; anim: AnimSpec; onLive: (p: PresetPatch) => void; onCommit: (p: PresetPatch) => void }): React.JSX.Element {
  const wrap = (a: Partial<AnimSpec>): PresetPatch => (kind === 'caption' ? { caption: { anim: a } } : { title: { anim: a } })
  const set = (a: Partial<AnimSpec>): void => onCommit(wrap(a))
  const live = (a: Partial<AnimSpec>): void => onLive(wrap(a))
  return (
    <div>
      <Row label="Erscheinen">
        <Segmented options={APPEAR.map((a) => a[1])} value={APPEAR.find((a) => a[0] === anim.appear)![1]} onChange={(n) => set({ appear: APPEAR.find((a) => a[1] === n)![0] })} />
        <Lv label="Dauer (ms)" value={anim.appearMs} min={0} max={600} onLive={(v) => live({ appearMs: v })} onCommit={(v) => set({ appearMs: v })} />
      </Row>
      {kind === 'caption' && (
        <Row label="Aktives Wort">
          <Segmented options={ACTIVE.map((a) => a[1])} value={ACTIVE.find((a) => a[0] === anim.active)![1]} onChange={(n) => set({ active: ACTIVE.find((a) => a[1] === n)![0] })} />
          {anim.active === 'colorScale' && <Lv label="Vergrößerung (×)" value={anim.activeScale} scale={100} min={100} max={130} onLive={(v) => live({ activeScale: v })} onCommit={(v) => set({ activeScale: v })} />}
        </Row>
      )}
      <Row label="Bewegungsgefühl">
        <Lv label="Dämpfung (1,0 = weich)" value={anim.damping} scale={100} min={70} max={100} onLive={(v) => live({ damping: v })} onCommit={(v) => set({ damping: v })} />
      </Row>
      {kind === 'caption' && (
        <Row label="Darstellung"><Segmented options={['Wort für Wort', 'Ganze Zeile']} value={anim.display === 'word' ? 'Wort für Wort' : 'Ganze Zeile'} onChange={(n) => set({ display: n === 'Wort für Wort' ? 'word' : 'line' })} /></Row>
      )}
      <Row label="Verschwinden">
        <Segmented options={['Keine', 'Ausblenden']} value={anim.disappear === 'fade' ? 'Ausblenden' : 'Keine'} onChange={(n) => set({ disappear: n === 'Ausblenden' ? 'fade' : 'none' })} />
        {anim.disappear === 'fade' && <Lv label="Dauer (ms)" value={anim.disappearMs} min={0} max={300} onLive={(v) => live({ disappearMs: v })} onCommit={(v) => set({ disappearMs: v })} />}
      </Row>
    </div>
  )
}

/** Titel: Variante, Größe, Position, Länge, Umbruch (An/Aus und Text gehören zum Clip, siehe Editor). */
export function TitleControls({ value, onLive, onCommit }: ControlProps): React.JSX.Element {
  const t = value.title
  const set = (p: Record<string, unknown>): void => onCommit({ title: p as PresetPatch['title'] })
  const live = (p: Record<string, unknown>): void => onLive({ title: p as PresetPatch['title'] })
  return (
    <div>
      <Row label="Variante"><Segmented options={['Weiße Box', 'Schwarze Box']} value={t.variant === 'white' ? 'Weiße Box' : 'Schwarze Box'} onChange={(n) => set({ variant: n === 'Weiße Box' ? 'white' : 'black' })} /></Row>
      <Row label="Maße">
        <div style={{ display: 'grid', gap: 8 }}>
          <Lv label="Größe (px)" value={t.sizePx} min={32} max={100} onLive={(v) => live({ sizePx: v })} onCommit={(v) => set({ sizePx: v })} />
          <Lv label="Position" value={t.y * 100} min={4} max={50} onLive={(v) => live({ y: v / 100 })} onCommit={(v) => set({ y: v / 100 })} />
          <Lv label="Umbruch (Zeichen)" value={t.maxChars} min={10} max={34} onLive={(v) => live({ maxChars: v })} onCommit={(v) => set({ maxChars: v })} />
        </div>
      </Row>
    </div>
  )
}
