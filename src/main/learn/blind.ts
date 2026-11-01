import { appendFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { app } from 'electron'
import { baseState } from '../../shared/edits'
import { guardEmptyShots, type PlanOptions } from '../../shared/layoutPlan'
import type { ShortmeClip } from '../../shared/shortme'
import type { CreatorFile } from '../../shared/learnData'
import { blindWinRate, type BlindResult } from '../../shared/workbench'
import { allowMediaPath } from '../mediaAccess'
import { loadProfile } from '../shortme/profiles'
import { loadClips, ensureShots, ensureSignals } from '../shortme/clips/analysis'
import { layoutForClip } from '../shortme/layout/run'
import { exportClip } from '../shortme/render/exporter'
import { allPresets, effectivePreset } from '../shortme/presets'
import { loadStyle } from '../shortme/styleDefaults'
import { loadTranscript } from '../shortme/transcription'
import { writeFileAtomic } from '../shortme/atomic'
import { projectFile } from '../shortme/project'
import { datasetDir, learnFile, notifyLearnChange, readJson } from './store'
import { ensureSource } from './workbench'

/** Verweis auf einen Moment: Shortme-Clip (`key` = Clip-Id) oder Creator/Referenz (`key` = `<Short-Id>:<Index>`). */
export interface MomentRef { kind: 'shortme' | 'creator' | 'reference'; key: string }
interface Resolved extends MomentRef { start: number; end: number; candId: string }

async function resolveMoment(hash: string, r: MomentRef): Promise<Resolved> {
  if (r.kind === 'shortme') {
    const c = (await loadClips(hash))?.clips.find((x) => x.id === r.key)
    if (!c) throw new Error('Clip nicht gefunden')
    return { ...r, start: c.start, end: c.end, candId: `${hash}:${c.id}` }
  }
  const [id, i] = [r.key.slice(0, r.key.lastIndexOf(':')), Number(r.key.slice(r.key.lastIndexOf(':') + 1))]
  const m = (await readJson<CreatorFile | null>(projectFile(hash, 'creator.json'), null))?.shorts.find((s) => s.id === id)?.moments[i]
  if (!m) throw new Error('Moment nicht gefunden')
  return { ...r, start: m.start, end: m.end, candId: `${hash}:${r.kind}:${id}:${i}` }
}

/** Gleicher Weg für jede Seite: eigener Ausschnitt (Layout-Planung wie in der Pipeline) und Standard-Preset, ohne Wasserzeichen. */
async function renderMoment(hash: string, start: number, end: number, label: string): Promise<string> {
  const meta = await ensureSource(hash)
  const tr = await loadTranscript(hash)
  if (!tr) throw new Error('Transkript fehlt')
  const w = tr.words
  const first = Math.max(0, w.findIndex((x) => x.start >= start - 0.05))
  let last = first
  for (let k = first; k < w.length && w[k].end <= end + 0.05; k++) last = k
  const clip: ShortmeClip = { id: label, start, end, firstWord: first, lastWord: last, score: 0, criteria: { hook: 0, payoff: 0, quotable: 0, standalone: 0, density: 0 }, title: label, hookText: '', reason: '', tags: [], source: 'llm', snap: [], extended: 0 }
  const profile = await loadProfile(meta.contentType)
  const plan: Partial<PlanOptions> = { allowSplit: profile.tracking.split, follow: profile.tracking.follow }
  const l = await layoutForClip(meta, clip, await ensureShots(meta), undefined, undefined, plan)
  clip.shots = guardEmptyShots(l.shots, l.input)
  const style = effectivePreset(await allPresets(), baseState(clip, undefined, await loadStyle()).caption)
  const exp = await exportClip(meta, clip, tr, await ensureSignals(meta), { outDir: join(app.getPath('temp'), 'shortme-blind'), style, captions: true, hook: false })
  allowMediaPath(exp.path)
  return exp.path
}

const pending = new Map<string, { hash: string; left: Resolved; right: Resolved }>()

/** Zwei Momente rendern, Seiten zufällig; die Herkunft bleibt bis zur Antwort verborgen. */
export async function blindPrepare(hash: string, a: MomentRef, b: MomentRef): Promise<{ testId: string; left: string; right: string }> {
  const [ra, rb] = await Promise.all([resolveMoment(hash, a), resolveMoment(hash, b)])
  const swap = Math.random() < 0.5
  const [left, right] = swap ? [rb, ra] : [ra, rb]
  const id = randomUUID().slice(0, 8)
  const lp = await renderMoment(hash, left.start, left.end, `blind-${id}-L`)
  const rp = await renderMoment(hash, right.start, right.end, `blind-${id}-R`)
  pending.set(id, { hash, left, right })
  return { testId: id, left: lp, right: rp }
}

const blindFile = (): string => learnFile('blind.json')
export const loadBlind = (): Promise<BlindResult[]> => readJson<BlindResult[]>(blindFile(), [])
export async function blindStats(): Promise<ReturnType<typeof blindWinRate>> { return blindWinRate(await loadBlind()) }

export async function blindAnswer(testId: string, choice: 'left' | 'right' | 'tie'): Promise<{ left: MomentRef['kind']; right: MomentRef['kind'] }> {
  const t = pending.get(testId)
  if (!t) throw new Error('Test nicht gefunden')
  pending.delete(testId)
  const res: BlindResult = { at: new Date().toISOString(), hash: t.hash, left: { kind: t.left.kind, id: t.left.candId }, right: { kind: t.right.kind, id: t.right.candId }, choice }
  await writeFileAtomic(blindFile(), JSON.stringify([...(await loadBlind()), res]))
  if (choice !== 'tie') {
    const [w, l] = choice === 'left' ? [t.left, t.right] : [t.right, t.left]
    await appendFile(join(datasetDir(), 'blind.jsonl'), JSON.stringify({ winner: w.candId, loser: l.candId, vid: t.hash, winnerKind: w.kind, loserKind: l.kind }) + '\n').catch(async () => {
      await writeFileAtomic(join(datasetDir(), 'blind.jsonl'), JSON.stringify({ winner: w.candId, loser: l.candId, vid: t.hash, winnerKind: w.kind, loserKind: l.kind }) + '\n')
    })
  }
  notifyLearnChange()
  return { left: t.left.kind, right: t.right.kind }
}
