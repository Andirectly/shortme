import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { Sparkles } from 'lucide-react'
import changelog from '../../../../CHANGELOG.md?raw'
import { changelogSection, parseNotes, type NotesBlock } from '@shared/releaseNotes'
import { Button } from './ui'
import { useProject } from './projectStore'
import { useSprings } from './motion'

const HEAD: Record<string, string> = { added: 'Neu', changed: 'Geändert', fixed: 'Behoben', removed: 'Entfernt' }
const plain = (s: string): string => s.replace(/`([^`]+)`/g, '$1').replace(/\*\*([^*]+)\*\*/g, '$1')

export const notesOf = (version: string): NotesBlock[] => parseNotes(changelogSection(changelog, version))
/** Alle Versionen aus dem Changelog, neueste zuerst. */
export const allVersions = (): string[] => [...changelog.matchAll(/^##\s+\[?(\d+\.\d+\.\d+)\]?/gm)].map((m) => m[1])

export function NotesBlocks({ blocks }: { blocks: NotesBlock[] }): React.JSX.Element {
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {blocks.map((b, i) => (
        <section key={i} style={{ display: 'grid', gap: 4 }}>
          {b.heading && <small style={{ textTransform: 'uppercase', letterSpacing: '0.06em' }}>{HEAD[b.heading.toLowerCase()] ?? b.heading}</small>}
          <ul style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 4, fontSize: 14, lineHeight: 1.45 }}>{b.items.map((t, j) => <li key={j}>{plain(t)}</li>)}</ul>
        </section>
      ))}
    </div>
  )
}

const SEEN = 'sm-notes-seen'
const readSeen = (): string | null => { try { return localStorage.getItem(SEEN) } catch { return __VERSION__ } }
const writeSeen = (): void => { try { localStorage.setItem(SEEN, __VERSION__) } catch { /* ohne Speicher erscheint es beim nächsten Start erneut */ } }

/**
 * Einmal nach einem Update: „Neu in Version x“. Eine frische Installation (nichts gemerkt, noch keine Projekte) merkt sich die Version still;
 * wer schon Projekte hat (Update von einer Version ohne diese Anzeige), sieht die Notizen.
 */
export function PatchNotesAfterUpdate(): React.JSX.Element | null {
  const { base } = useSprings()
  const [show, setShow] = useState(false)
  useEffect(() => {
    let on = true
    void (async () => {
      await useProject.getState().loadProjects().catch(() => undefined)
      const seen = readSeen()
      if (!on || seen === __VERSION__ || notesOf(__VERSION__).length === 0) return
      if (!seen && useProject.getState().projects.length === 0) return writeSeen()
      setShow(true)
    })()
    return () => { on = false }
  }, [])
  const close = (): void => { writeSeen(); setShow(false) }
  return (
    <AnimatePresence>
      {show && (
        <>
          <motion.div key="notes-scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={close} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 82 }} />
          <motion.div key="notes" role="dialog" aria-label={`Neu in Version ${__VERSION__}`} className="sm-glass" initial={{ opacity: 0, scale: 0.94, filter: 'blur(8px)' }} animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }} exit={{ opacity: 0, scale: 0.96 }} transition={base}
            style={{ position: 'fixed', zIndex: 83, left: 'calc(50% - 280px)', top: '12vh', width: 560, maxHeight: '70vh', overflowY: 'auto', padding: 26, background: 'rgba(24,24,32,0.95)', display: 'grid', gap: 16 }}>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}><Sparkles color="var(--accent)" /><h2>Neu in Version {__VERSION__}</h2></div>
            <NotesBlocks blocks={notesOf(__VERSION__)} />
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}><Button variant="primary" onClick={close}>Verstanden</Button></div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
