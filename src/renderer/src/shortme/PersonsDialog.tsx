import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useState } from 'react'
import type { PersonRole } from '@shared/shortme'
import { Button, Segmented } from './ui'
import { useProject } from './projectStore'
import { useSprings } from './motion'

const ROLES: Array<[PersonRole, string]> = [['normal', 'Normal'], ['main', 'Hauptperson'], ['ignore', 'Ignorieren']]

/** „Wer ist wer?“ – erkannte Personen als Karten; Zuordnung gilt für das ganze Video. Erscheint vor dem Export, wenn die Erkennung unsicher ist. */
export function PersonsDialog(): React.JSX.Element | null {
  const open = useProject((s) => s.personsOpen)
  const persons = useProject((s) => s.persons)
  const save = useProject((s) => s.savePersons)
  const close = useProject((s) => s.closePersons)
  const { base } = useSprings()
  const [labels, setLabels] = useState<Record<string, string>>({})
  const [roles, setRoles] = useState<Record<string, PersonRole>>({})
  useEffect(() => {
    if (!persons) return
    setLabels(Object.fromEntries(persons.persons.map((p) => [p.id, p.label])))
    setRoles(Object.fromEntries(persons.persons.map((p) => [p.id, p.role])))
  }, [persons, open])
  if (!persons) return null
  const roleName = (r: PersonRole): string => ROLES.find((x) => x[0] === r)![1]
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div key="scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={close} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 80 }} />
          <motion.div key="dlg" role="dialog" aria-label="Wer ist wer?" className="sm-glass" initial={{ opacity: 0, scale: 0.95, y: 12 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.97 }} transition={base}
            style={{ position: 'fixed', zIndex: 81, left: '50%', top: '10vh', translate: '-50% 0', width: 'min(720px, 92vw)', maxHeight: '80vh', overflow: 'auto', padding: 24, display: 'grid', gap: 16, background: 'rgba(20,20,20,0.96)' }}>
            <div>
              <h2>Wer ist wer?</h2>
              <small>{persons.needsReview ? `Die Erkennung ist nur zu ${Math.round(persons.confidence * 100)} % sicher.` : 'Erkannte Personen dieses Videos.'}</small>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 }}>
              {persons.persons.map((p) => (
                <div key={p.id} className="sm-card" style={{ padding: 12, display: 'grid', gap: 10 }}>
                  <div style={{ aspectRatio: '1', borderRadius: 10, background: p.thumb ? `center/cover url(${p.thumb})` : 'rgba(255,255,255,0.06)' }} />
                  <input value={labels[p.id] ?? ''} onChange={(e) => setLabels({ ...labels, [p.id]: e.target.value })} aria-label="Name" style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 8, padding: '6px 10px', color: 'inherit' }} />
                  <Segmented options={ROLES.map((r) => r[1])} value={roleName(roles[p.id] ?? 'normal')} onChange={(v) => setRoles({ ...roles, [p.id]: ROLES.find((r) => r[1] === v)![0] })} />
                  <small>{p.seconds} s im Bild</small>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <Button variant="secondary" onClick={close}>Abbrechen</Button>
              <Button variant="primary" onClick={() => void save({ labels, roles })}>Bestätigen</Button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
