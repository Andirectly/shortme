import { readFile } from 'node:fs/promises'
import { ipcMain } from 'electron'
import { jobs } from '../shortme/ipc'
import { loadMeta, projectFile } from '../shortme/project'
import { loadClips } from '../shortme/clips/analysis'
import { thumbPath } from '../shortme/clips/thumbs'
import { loadTranscript } from '../shortme/transcription'
import { overview, type EvalFile, type WorkItem } from '../../shared/workbench'
import type { CreatorFile } from '../../shared/learnData'
import { rebuildDataset, scheduleRebuild, setBusyProbe } from './dataset'
import { collecting, loadLearnSettings, onLearnChange, readJson, saveLearnSettings, type LearnSettings } from './store'
import { addLinks, addReference, currentId, evaluateProject, isPaused, kick, loadEvals, removeItem, resumeWorkbench, retry, setPaused, storageBytes, workbenchItems } from './workbench'
import { blindAnswer, blindPrepare, blindStats, type MomentRef } from './blind'

const dataUrl = async (p: string): Promise<string | null> => { try { return `data:image/jpeg;base64,${(await readFile(p)).toString('base64')}` } catch { return null } }

export function registerLearnIpc(): void {
  onLearnChange(() => scheduleRebuild())
  setBusyProbe(() => jobs.list().some((j) => j.state === 'running'))
  // Beim Start nachträglich eintragen, was schon da ist (verzögert, damit der Start nicht langsamer wird)
  setTimeout(() => void collecting().then(async (on) => { if (on) await rebuildDataset() }).catch((e) => console.error('Datensatz:', e)), 120_000).unref()
  resumeWorkbench()

  ipcMain.handle('learn:settings', () => loadLearnSettings())
  ipcMain.handle('learn:setSettings', async (_e, p: Partial<LearnSettings>) => { const s = await saveLearnSettings(p); if (s.collect) kick(); return s })
  ipcMain.handle('learn:rebuild', () => rebuildDataset())

  ipcMain.handle('learn:wb:list', () => workbenchItems())
  ipcMain.handle('learn:wb:add', (_e, urls: string[]) => addLinks(urls))
  ipcMain.handle('learn:wb:retry', (_e, id: string) => retry(id))
  ipcMain.handle('learn:wb:remove', (_e, id: string) => removeItem(id))
  ipcMain.handle('learn:wb:pause', (_e, p: boolean) => { setPaused(p); return isPaused() })
  ipcMain.handle('learn:wb:status', async () => ({ paused: isPaused(), current: currentId(), bytes: await storageBytes() }))
  ipcMain.handle('learn:wb:overview', async () => ({ ...overview(await loadEvals()), blind: await blindStats() }))
  ipcMain.handle('learn:wb:reference', (_e, hash: string, file: string) => addReference(hash, file))
  ipcMain.handle('learn:wb:project', async (_e, hash: string) => {
    const [meta, clips, tr, creator, ev] = await Promise.all([loadMeta(hash), loadClips(hash), loadTranscript(hash), readJson<CreatorFile | null>(projectFile(hash, 'creator.json'), null), evaluateProject(hash)])
    if (!meta || !clips) return null
    const text = (a: number, b: number): string => (tr?.words ?? []).filter((w) => w.start >= a - 0.05 && w.end <= b + 0.05).map((w) => w.w).join(' ').slice(0, 160)
    return {
      title: meta.title,
      clips: await Promise.all(clips.clips.map(async (c) => ({ id: c.id, start: c.start, end: c.end, score: Math.round(c.score), title: c.title, thumb: await dataUrl(thumbPath(hash, c.id)), text: text(c.start, c.end) }))),
      shorts: (creator?.shorts ?? []).map((s) => ({ ...s, moments: s.moments.map((m) => ({ ...m, text: text(m.start, m.end) })) })),
      eval: ev as EvalFile | null
    }
  })
  ipcMain.handle('learn:blind:prepare', (_e, hash: string, a: MomentRef, b: MomentRef) => blindPrepare(hash, a, b))
  ipcMain.handle('learn:blind:answer', (_e, id: string, choice: 'left' | 'right' | 'tie') => blindAnswer(id, choice))
}
export type { WorkItem }
