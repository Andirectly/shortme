import { useEffect, useState } from 'react'
import { motion, AnimatePresence, useMotionValue, animate, type PanInfo } from 'motion/react'
import { UploadCloud, Link2, Sparkles, ChevronDown, Clock } from 'lucide-react'
import { useStore } from './store'
import { IMG, PRESETS, PROJECTS } from './data'
import { Button, Pill, Segmented, Switch, Row } from './ui'
import { useSprings } from './motion'

export function StartScreen(): React.JSX.Element {
  const openSheet = useStore((s) => s.openSheet)
  const go = useStore((s) => s.go)
  const [over, setOver] = useState(false)
  const { base } = useSprings()
  return (
    <div style={{ maxWidth: 980, margin: '0 auto', display: 'grid', gap: 28, paddingTop: 12 }}>
      <div>
        <h1>Aus langen Videos kurze Clips</h1>
        <p style={{ color: 'var(--text-2)', margin: '8px 0 0' }}>Alles lokal auf deinem Rechner – keine Cloud.</p>
      </div>
      <motion.div
        className="sm-glass"
        role="button"
        tabIndex={0}
        aria-label="Video hierher ziehen oder auswählen"
        animate={{ scale: over ? 1.015 : 1, borderColor: over ? 'rgba(168,85,247,0.8)' : 'rgba(255,255,255,0.08)' }}
        transition={base}
        onDragOver={(e) => { e.preventDefault(); setOver(true) }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); openSheet(true) }}
        onClick={() => openSheet(true)}
        onKeyDown={(e) => e.key === 'Enter' && openSheet(true)}
        style={{ height: 260, display: 'grid', placeItems: 'center', textAlign: 'center', borderStyle: 'dashed' }}
      >
        <div style={{ display: 'grid', gap: 10, justifyItems: 'center' }}>
          <UploadCloud size={44} strokeWidth={1.4} color="rgba(255,255,255,0.7)" />
          <h2>Video hierher ziehen</h2>
          <small>oder klicken zum Auswählen · MP4, MOV, MKV</small>
        </div>
      </motion.div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <div style={{ position: 'relative', flex: 1 }}>
          <Link2 size={16} style={{ position: 'absolute', left: 16, top: 12, color: 'var(--text-3)' }} />
          <input className="sm-input" style={{ paddingLeft: 42 }} placeholder="Oder Link einfügen (YouTube, …)" aria-label="Video-Link" />
        </div>
        <Button variant="secondary" onClick={() => openSheet(true)}>Laden</Button>
      </div>
      <section>
        <h3 style={{ marginBottom: 12 }}>Zuletzt geöffnet</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 14 }}>
          {PROJECTS.map((p) => (
            <motion.button key={p.id} className="sm-card" whileTap={{ scale: 0.97 }} transition={base} onClick={() => go('clips')} style={{ padding: 0, overflow: 'hidden', textAlign: 'left' }}>
              <div style={{ height: 120, backgroundImage: `url(${p.thumb})`, backgroundSize: 'cover', backgroundPosition: 'center' }} />
              <div style={{ padding: 14, display: 'grid', gap: 4 }}>
                <h3>{p.name}</h3>
                <small><Clock size={11} style={{ verticalAlign: -1 }} /> {p.duration} · {p.clips} Clips · {p.date}</small>
              </div>
            </motion.button>
          ))}
        </div>
      </section>
      <CreateSheet />
    </div>
  )
}

function CreateSheet(): React.JSX.Element {
  const open = useStore((s) => s.sheetOpen)
  const openSheet = useStore((s) => s.openSheet)
  const opts = useStore((s) => s.opts)
  const setOpts = useStore((s) => s.setOpts)
  const presetId = useStore((s) => s.presetId)
  const setPreset = useStore((s) => s.setPreset)
  const go = useStore((s) => s.go)
  const [adv, setAdv] = useState(false)
  const { bounce, reduced } = useSprings()
  const y = useMotionValue(0)

  useEffect(() => {
    const k = (e: KeyboardEvent): void => { if (e.key === 'Escape') openSheet(false) }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [openSheet])
  useEffect(() => { if (open) y.set(0) }, [open, y])

  // Wurfgeste: Endpunkt aus der Geschwindigkeit projizieren (decelerationRate 0.998),
  // Geschwindigkeit an die Feder übergeben (docs/DESIGN.md, Skill apple-design §5/§6).
  const onEnd = (_: unknown, info: PanInfo): void => {
    const projected = y.get() + ((info.velocity.y / 1000) * 0.998) / (1 - 0.998)
    if (projected > 260 || info.velocity.y > 800) openSheet(false)
    else animate(y, 0, { type: 'spring', duration: 0.3, bounce: 0.2, velocity: info.velocity.y })
  }
  const start = (): void => { openSheet(false); go('processing') }
  const stop = { onPointerDownCapture: (e: React.PointerEvent) => e.stopPropagation() }

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div key="scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => openSheet(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 60 }} />
          <motion.div
            key="sheet"
            role="dialog"
            aria-label="Clips erstellen"
            className="sm-glass"
            initial={reduced ? { opacity: 0 } : { y: '100%' }}
            animate={reduced ? { opacity: 1 } : { y: 0 }}
            exit={reduced ? { opacity: 0 } : { y: '100%' }}
            transition={bounce}
            drag={reduced ? false : 'y'}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0.08, bottom: 0.6 }}
            dragMomentum={false}
            onDragEnd={onEnd}
            style={{ y, position: 'fixed', left: 'calc(50% - 360px)', width: 720, bottom: 12, top: 56, zIndex: 61, background: 'rgba(24,24,32,0.92)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
          >
            <div style={{ display: 'grid', placeItems: 'center', padding: '10px 0 6px', touchAction: 'none' }}>
              <span style={{ width: 40, height: 5, borderRadius: 3, background: 'rgba(255,255,255,0.25)' }} />
            </div>
            <div style={{ display: 'flex', gap: 16, padding: '4px 24px 12px' }} {...stop}>
              <img src={IMG.source} alt="" style={{ width: 160, borderRadius: 10, border: '1px solid var(--edge)' }} />
              <div style={{ display: 'grid', alignContent: 'center', gap: 4 }}>
                <h2>Tattoo-Folge (Sidequests).mp4</h2>
                <small>12:09 · 1920×1080 · Deutsch erkannt</small>
              </div>
            </div>
            <div style={{ overflowY: 'auto', padding: '0 24px 12px' }} {...stop}>
              <Row label="Format"><Segmented options={['9:16', '1:1', '16:9']} value={opts.format} onChange={(format) => setOpts({ format })} /></Row>
              <Row label="Bildausschnitt"><Segmented options={['Smart', 'Ganzes Bild', 'Split', 'Fest']} value={opts.frame} onChange={(frame) => setOpts({ frame })} /></Row>
              <Row label="Cliplänge"><Segmented options={['Automatisch', '≤ 30 s', '30–60 s', '60–90 s']} value={opts.length} onChange={(length) => setOpts({ length })} /></Row>
              <Row label="Untertitel">
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 10 }}>
                  {PRESETS.map((p) => (
                    <button key={p.id} className="sm-tile" aria-pressed={opts.captions === 'preset' && presetId === p.id} onClick={() => { setPreset(p.id); setOpts({ captions: 'preset' }) }}>
                      <div style={{ fontFamily: p.font, fontWeight: p.weight, textTransform: p.upper ? 'uppercase' : 'none', fontSize: 15, color: p.color, background: p.box ? 'rgba(0,0,0,0.7)' : 'none', display: 'inline-block', padding: p.box ? '0 6px' : 0, WebkitTextStroke: '0.5px #000' }}>
                        Das <span style={{ color: p.hi }}>Wort</span>
                      </div>
                      <small style={{ display: 'block', marginTop: 6 }}>{p.name}</small>
                    </button>
                  ))}
                  <button className="sm-tile" aria-pressed={opts.captions === 'off'} onClick={() => setOpts({ captions: 'off' })}>
                    <div style={{ fontSize: 15, color: 'var(--text-3)' }}>Aus</div>
                    <small style={{ display: 'block', marginTop: 6 }}>Keine Untertitel</small>
                  </button>
                </div>
              </Row>
              <Row label="Sprechpausen entfernen"><Switch on={opts.removePauses} onChange={(removePauses) => setOpts({ removePauses })} label="Sprechpausen entfernen" /></Row>
              <Row label="Workflow"><Segmented options={['Automatisch', 'Prüfen & Bearbeiten']} value={opts.workflow} onChange={(workflow) => setOpts({ workflow })} /></Row>
              <Row label="Wonach suchen?" hint="optional">
                <textarea className="sm-input" rows={2} placeholder="z. B. lustige Momente, Fachwissen, Streit …" value={opts.query} onChange={(e) => setOpts({ query: e.target.value })} />
              </Row>
              <div style={{ borderTop: '1px solid var(--edge)', paddingTop: 12 }}>
                <Pill pressed={adv} onClick={() => setAdv(!adv)}>Erweitert <ChevronDown size={14} style={{ transform: adv ? 'rotate(180deg)' : 'none' }} /></Pill>
                {adv && (
                  <div style={{ display: 'grid', gap: 10, marginTop: 12 }}>
                    <small>Sprache</small>
                    <Segmented options={['Automatisch', 'Deutsch', 'Englisch']} value="Automatisch" onChange={() => undefined} />
                    <small>Modell</small>
                    <Segmented options={['Parakeet v3 + Qwen3-14B', 'Whisper turbo + Qwen3-14B']} value="Parakeet v3 + Qwen3-14B" onChange={() => undefined} />
                  </div>
                )}
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, padding: '14px 24px', borderTop: '1px solid var(--edge)' }}>
              <Button variant="secondary" onClick={() => openSheet(false)}>Abbrechen</Button>
              <Button variant="primary" onClick={start}><Sparkles size={16} /> Clips finden</Button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
