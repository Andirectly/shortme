import { motion, AnimatePresence } from 'motion/react'
import { CheckCircle2, Cpu, Download, FolderInput, Pause, Play, X, AlertTriangle, HardDrive, Sparkles } from 'lucide-react'
import { useState } from 'react'
import type { AssetSpec, AssetStatus } from '@shared/engines'
import { Button } from './ui'
import { fmtBytes, requiredIds, useEngines } from './engines'
import { useSprings } from './motion'

const KIND: Record<string, string> = { transcription: 'Transkription', llm: 'Sprachmodell', vision: 'Vision', engine: 'Engine', vad: 'Sprach-Erkennung' }

function Row({ spec, st, recommended }: { spec: AssetSpec; st: AssetStatus | undefined; recommended: boolean }): React.JSX.Element {
  const install = useEngines((s) => s.install)
  const pause = useEngines((s) => s.pause)
  const cancel = useEngines((s) => s.cancel)
  const state = st?.state ?? 'missing'
  const total = spec.files.reduce((n, f) => n + f.size, 0)
  const busy = state === 'downloading' || state === 'verifying' || state === 'extracting'
  const label = state === 'verifying' ? 'SHA-256 wird geprüft …' : state === 'extracting' ? 'Wird entpackt …' : st ? `${fmtBytes(st.bytesDone)} / ${fmtBytes(st.bytesTotal)}` : ''
  return (
    <div className="sm-card" style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 14, alignItems: 'center', padding: 14 }}>
      <div style={{ display: 'grid', gap: 4, minWidth: 0 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <h3>{spec.name}</h3><span className="sm-tag">{KIND[spec.kind]}</span>
          {recommended && <span className="sm-tag" style={{ color: 'var(--accent)' }}>Empfohlen</span>}
        </div>
        <small>{fmtBytes(total)} · {spec.note}</small>
        {(busy || state === 'paused') && (
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <div className="sm-bar" style={{ flex: 1 }}><i style={{ width: `${(st?.progress ?? 0) * 100}%` }} /></div>
            <small>{Math.round((st?.progress ?? 0) * 100)} % · {state === 'paused' ? 'pausiert' : label}</small>
          </div>
        )}
        {state === 'error' && <small style={{ color: 'var(--warn)', display: 'flex', gap: 6, alignItems: 'center' }}><AlertTriangle size={13} /> {st?.error}</small>}
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        {state === 'installed' && <span style={{ color: 'var(--ok)', display: 'flex', gap: 6, alignItems: 'center', fontSize: 13 }}><CheckCircle2 size={16} /> Installiert</span>}
        {(state === 'missing' || state === 'error') && <Button variant="secondary" onClick={() => void install(spec.id)}><Download size={15} /> {state === 'error' ? 'Erneut' : 'Laden'}</Button>}
        {state === 'paused' && <Button variant="secondary" onClick={() => void install(spec.id)}><Play size={15} /> Fortsetzen</Button>}
        {state === 'downloading' && <Button variant="secondary" onClick={() => void pause(spec.id)}><Pause size={15} /> Pausieren</Button>}
        {(state === 'downloading' || state === 'paused') && <Button variant="ghost" aria-label="Abbrechen" onClick={() => void cancel(spec.id)}><X size={15} /></Button>}
      </div>
    </div>
  )
}

export function ModelsScreen(): React.JSX.Element {
  const catalog = useEngines((s) => s.catalog)
  const status = useEngines((s) => s.status)
  const hw = useEngines((s) => s.hw)
  const importFolder = useEngines((s) => s.importFolder)
  const [msg, setMsg] = useState('')
  const rec = new Set(requiredIds(hw))
  const doImport = async (): Promise<void> => {
    const r = await importFolder()
    if (r) setMsg(`${r.imported.length} importiert${r.skipped.length ? `, ${r.skipped.length} übersprungen (Prüfsumme falsch)` : ''}`)
  }
  return (
    <div style={{ maxWidth: 900, margin: '0 auto', display: 'grid', gap: 18, paddingTop: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'end' }}>
        <div><h1>Modelle</h1><small>Werden in der App geladen, nie ins Repo. Downloads lassen sich fortsetzen, jede Datei wird per SHA-256 geprüft.</small></div>
        <Button variant="secondary" onClick={() => void doImport()}><FolderInput size={15} /> Ordner importieren (USB)</Button>
      </div>
      <AnimatePresence>{msg && <motion.small initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} style={{ color: 'var(--text-1)' }}>{msg}</motion.small>}</AnimatePresence>
      {hw && (
        <div className="sm-card" style={{ padding: 14, display: 'flex', gap: 12, alignItems: 'center' }}>
          <Cpu size={20} color="var(--accent)" />
          <div>
            <h3>Empfehlung für diese Hardware</h3>
            <small>{hw.gpuName ? `${hw.gpuName} · ${(hw.vramTotalMb / 1024).toFixed(0)} GB VRAM` : 'Keine NVIDIA-GPU erkannt'} · Profil „{hw.profile}“ → {catalog.find((c) => c.id === hw.recommendedLlm)?.name ?? hw.recommendedLlm}{hw.kvQuant ? ' mit komprimiertem KV-Cache' : ''}</small>
          </div>
        </div>
      )}
      <div style={{ display: 'grid', gap: 10 }}>
        {catalog.map((spec) => <Row key={spec.id} spec={spec} st={status[spec.id]} recommended={rec.has(spec.id)} />)}
      </div>
    </div>
  )
}

/** Erststart-Assistent: lädt alles Empfohlene (fortsetzbar). */
export function SetupWizard(): React.JSX.Element | null {
  const { loaded, catalog, status, hw, wizardDismissed, installingAll, installRecommended, dismissWizard, check } = useEngines()
  const { base } = useSprings()
  if (!loaded || wizardDismissed) return null
  const ids = requiredIds(hw)
  const items = ids.map((id) => ({ spec: catalog.find((c) => c.id === id)!, st: status[id] })).filter((x) => x.spec)
  const missing = items.filter((x) => x.st?.state !== 'installed')
  if (missing.length === 0 && !installingAll) return null
  const total = missing.reduce((n, x) => n + x.spec.files.reduce((m, f) => m + f.size, 0), 0)
  const done = items.every((x) => x.st?.state === 'installed')
  return (
    <AnimatePresence>
      <motion.div key="wiz-scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 80 }} />
      <motion.div key="wiz" role="dialog" aria-label="Einrichtung" className="sm-glass" initial={{ opacity: 0, scale: 0.94, filter: 'blur(8px)' }} animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }} transition={base}
        style={{ position: 'fixed', zIndex: 81, left: 'calc(50% - 300px)', top: '12vh', width: 600, padding: 26, background: 'rgba(24,24,32,0.95)', display: 'grid', gap: 16 }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}><Sparkles color="var(--accent)" /><h2>Einrichtung</h2></div>
        <small>Shortme arbeitet komplett lokal. Für diese Hardware ({hw?.gpuName ?? 'ohne GPU'}, {hw ? (hw.vramTotalMb / 1024).toFixed(0) : 0} GB VRAM) werden {fmtBytes(total)} geladen.</small>
        <div style={{ display: 'grid', gap: 8 }}>
          {items.map(({ spec, st }) => (
            <div key={spec.id} style={{ display: 'grid', gridTemplateColumns: '24px 1fr 90px', gap: 10, alignItems: 'center', fontSize: 14 }}>
              {st?.state === 'installed' ? <CheckCircle2 size={17} color="var(--ok)" /> : st?.state === 'error' ? <AlertTriangle size={17} color="var(--warn)" /> : <HardDrive size={16} color="var(--text-3)" />}
              <div style={{ display: 'grid', gap: 3 }}>{spec.name}{st && ['downloading', 'verifying', 'extracting'].includes(st.state) && <div className="sm-bar" style={{ height: 4 }}><i style={{ width: `${st.progress * 100}%` }} /></div>}{st?.state === 'error' && <small style={{ color: 'var(--warn)' }}>{st.error}</small>}</div>
              <small style={{ textAlign: 'right' }}>{fmtBytes(spec.files.reduce((n, f) => n + f.size, 0))}</small>
            </div>
          ))}
        </div>
        {done && <small style={{ color: 'var(--ok)' }}>Alles bereit. Systemcheck: {check.filter((c) => c.ok).length} von {check.length} grün.</small>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <Button variant="secondary" onClick={dismissWizard}>{done ? 'Schließen' : 'Später'}</Button>
          {!done && <Button variant="primary" disabled={installingAll} onClick={() => void installRecommended()}><Download size={15} /> {installingAll ? 'Lädt …' : 'Alles installieren'}</Button>}
        </div>
      </motion.div>
    </AnimatePresence>
  )
}
