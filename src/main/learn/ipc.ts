import { cp, readdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { BrowserWindow, dialog, ipcMain } from 'electron'
import { jobs } from '../shortme/ipc'
import { loadMeta, projectFile, projectsRoot } from '../shortme/project'
import { loadClips } from '../shortme/clips/analysis'
import { thumbPath } from '../shortme/clips/thumbs'
import { loadTranscript } from '../shortme/transcription'
import { overview, type EvalFile, type WorkItem } from '../../shared/workbench'
import type { CandRecord, CreatorFile, Pair } from '../../shared/learnData'
import { calibration, counts, MIN_PATTERNS, patterns, stages, suggestRules, type Rule } from '../../shared/learnStats'
import { decideRule, loadRules, removeRule } from './rules'
import { catalogStatus, connectCatalog, disconnectCatalog, syncNow } from './catalog'
import { rebuildDataset, scheduleRebuild, setBusyProbe } from './dataset'
import { collecting, datasetDir, learnFile, loadLearnSettings, onLearnChange, readJson, saveLearnSettings, type LearnSettings } from './store'
import { addLinks, addReference, currentId, evaluateProject, isPaused, kick, loadEvals, removeItem, resetWorkbench, resumeWorkbench, retry, setPaused, storageBytes, workbenchItems } from './workbench'
import { blindAnswer, blindPrepare, blindStats, type MomentRef } from './blind'

const dataUrl = async (p: string): Promise<string | null> => { try { return `data:image/jpeg;base64,${(await readFile(p)).toString('base64')}` } catch { return null } }

async function jsonl<T>(name: string): Promise<T[]> {
  try { return (await readFile(join(datasetDir(), name), 'utf8')).split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l) as T) } catch { return [] }
}

export function registerLearnIpc(): void {
  onLearnChange(() => scheduleRebuild())
  setBusyProbe(() => jobs.list().some((j) => j.state === 'running'))
  // Beim Start nachträglich eintragen, was schon da ist (verzögert, damit der Start nicht langsamer wird)
  setTimeout(() => void collecting().then(async (on) => { if (on) await rebuildDataset() }).catch((e) => console.error('Datensatz:', e)), 120_000).unref()
  resumeWorkbench()
  // Bewertungskatalog beim Start abgleichen (verzögert; nur wenn mit GitHub verbunden)
  setTimeout(() => void catalogStatus().then(async (s) => { if (s.configured) await syncNow() }).catch(() => undefined), 45_000).unref()

  ipcMain.handle('catalog:status', () => catalogStatus())
  ipcMain.handle('catalog:connect', (_e, repo: string, token: string) => connectCatalog(repo, token))
  ipcMain.handle('catalog:sync', () => syncNow())
  ipcMain.handle('catalog:disconnect', () => disconnectCatalog())
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
  ipcMain.handle('learn:stats', async () => {
    const [cands, pairs, evals, rules, cfg] = await Promise.all([jsonl<CandRecord>('candidates.jsonl'), jsonl<Pair>('pairs.jsonl'), loadEvals(), loadRules(), loadLearnSettings()])
    const ms = evals.flatMap((e) => e.moments)
    const c = counts(cands, pairs)
    // Muster und Vorschläge erst ab 50 Korrekturen („Muster zeigen“)
    const unlocked = c.corrections >= MIN_PATTERNS
    const open = unlocked ? suggestRules(cands, ms).filter((r) => !rules.accepted.some((a) => a.id === r.id) && !rules.rejected.includes(r.id)) : []
    return { settings: cfg, counts: c, patterns: unlocked ? patterns(cands, ms) : [], calibration: calibration(cands, pairs, ms), open, accepted: rules.accepted, stages: stages(c, cfg.collect, open.length, rules.accepted.length) }
  })
  ipcMain.handle('learn:rule', (_e, rule: Rule, decision: 'accept' | 'reject') => decideRule(rule, decision))
  ipcMain.handle('learn:ruleRemove', (_e, id: string) => removeRule(id))
  ipcMain.handle('learn:export', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const r = await (win ? dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] }) : dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] }))
    if (r.canceled || !r.filePaths[0]) return null
    const dest = join(r.filePaths[0], `shortme-lerndaten-${new Date().toISOString().slice(0, 10)}`)
    await cp(datasetDir(), join(dest, 'dataset'), { recursive: true }).catch(() => undefined)
    for (const f of ['blind.json', 'rules.json']) await cp(learnFile(f), join(dest, f)).catch(() => undefined)
    return dest
  })
  /** Alles Gelernte entfernen (mit Rückfrage): Datensatz, Werkbank-Liste, Bewertungen, Korrekturen, Spuren. Projekte, Clips und Einstellungen bleiben. */
  ipcMain.handle('learn:clear', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const box = { type: 'warning' as const, buttons: ['Alles löschen', 'Abbrechen'], defaultId: 1, cancelId: 1, title: 'Lerndaten löschen', message: 'Alle Lerndaten löschen?', detail: 'Bewertungen, Korrekturen, Datensatz, Werkbank-Liste und Blindtests werden entfernt. Projekte und Clips bleiben. Der Bewertungskatalog auf GitHub bleibt bestehen und kommt beim nächsten Abgleich zurück.' }
    if ((win ? await dialog.showMessageBox(win, box) : await dialog.showMessageBox(box)).response !== 0) return false
    await resetWorkbench()
    await rm(datasetDir(), { recursive: true, force: true })
    for (const f of ['blind.json', 'rules.json', 'workbench.json', 'catalog.json']) await rm(learnFile(f), { force: true })
    for (const d of ['sf', 'lf', 'tmp']) await rm(learnFile(d), { recursive: true, force: true })
    for (const h of await readdir(projectsRoot()).catch(() => [] as string[])) for (const f of ['ratings.json', 'feedback.json', 'corrections.jsonl', 'candidates.json', 'creator.json', 'eval.json', 'trend.json', 'features8k.f32']) await rm(projectFile(h, f), { force: true })
    return true
  })
  ipcMain.handle('learn:blind:prepare', (_e, hash: string, a: MomentRef, b: MomentRef) => blindPrepare(hash, a, b))
  ipcMain.handle('learn:blind:answer', (_e, id: string, choice: 'left' | 'right' | 'tie') => blindAnswer(id, choice))
}
export type { WorkItem }
