import { useState } from 'react'
import { FileWarning } from 'lucide-react'
import { Pill } from './ui'

/** „Fehlerbericht exportieren“: Systeminfo + letzte Sitzungs-Logs → Downloads und (falls eingerichtet) privates GitHub-Repo. */
export function LogReportButton({ label = 'Fehlerbericht exportieren' }: { label?: string }): React.JSX.Element | null {
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  if (!window.cutawan?.shortme?.exportLog) return null
  const go = async (): Promise<void> => {
    setBusy(true); setNote('')
    try {
      const r = await window.cutawan.shortme.exportLog()
      setNote(r.uploaded ? `Gespeichert und hochgeladen (${r.uploaded})` : `Gespeichert in Downloads${r.uploadError ? ` – nicht hochgeladen: ${r.uploadError}` : ''}`)
    } catch (e) { setNote(`Fehler: ${e instanceof Error ? e.message : String(e)}`) } finally { setBusy(false) }
  }
  return (
    <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      <Pill onClick={() => { if (!busy) void go() }}><FileWarning size={13} /> {busy ? 'Erstelle Bericht …' : label}</Pill>
      {note && <small role="status" style={{ maxWidth: 420 }}>{note}</small>}
    </span>
  )
}
