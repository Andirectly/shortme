import { execFile } from 'node:child_process'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { FFMPEG_PATH } from '../../pipeline/ffmpeg'
import { cosine } from '../../pipeline/faceEmbed'
import { writeFileAtomic } from '../atomic'
import { projectDir, projectFile, type ProjectMeta } from '../project'
import { facePenalty, faceRatio, planShots, type PlanInput } from '../layout/plan'
import type { ClipLayout } from '../layout/run'
import type { ShortmeClip } from '@shared/shortme'

const run = promisify(execFile)

/** Gleiche Person, wenn die mittlere Kosinus-Ähnlichkeit der Track-Embeddings darüber liegt (MobileFaceNet ohne Ausrichtung: gleiche ≈ 0,3–0,55, verschiedene ≈ 0–0,3). */
export const SAME_PERSON_SIM = 0.28
/** Kleine Cluster (zusammen kürzer) gelten als Rauschen. */
const MIN_PERSON_SEC = 4
const FLOOR_SIM = 0.08
/** Unter dieser Sicherheit fragt die App vor dem Rendern nach. */
export const REVIEW_BELOW = 0.6

export type PersonRole = 'normal' | 'main' | 'ignore'
export interface PersonInfo { id: string; label: string; role: PersonRole; seconds: number; thumb?: string }
export interface PersonsFile {
  version: 1
  /** Nutzer hat bestätigt – gilt für das ganze Video. */
  confirmed: boolean
  confidence: number
  needsReview: boolean
  persons: PersonInfo[]
  /** `<clipId>:<trackId>` → Person */
  assignment: Record<string, string>
}

export interface Ident { key: string; emb: Float32Array; sec: number; crop?: Buffer; clip: number; from: number; to: number }

/** Agglomeratives Clustering (average linkage) über Track-Embeddings. Gibt Index-Gruppen zurück. */
export function clusterEmbeddings(items: Array<{ emb: Float32Array; sec: number }>, opt: { threshold?: number; cannotLink?: (i: number, j: number) => boolean; targetK?: number } = {}): number[][] {
  const threshold = opt.threshold ?? SAME_PERSON_SIM
  const blocked = (a: number[], b: number[]): boolean => !!opt.cannotLink && a.some((i) => b.some((j) => opt.cannotLink!(i, j)))
  let groups: number[][] = items.map((_, i) => [i])
  const sim = (a: number[], b: number[]): number => {
    let sum = 0, w = 0
    for (const i of a) for (const j of b) { const ww = Math.min(items[i].sec, items[j].sec) + 0.5; sum += cosine(items[i].emb, items[j].emb) * ww; w += ww }
    return sum / w
  }
  for (;;) {
    let best = -Infinity, bi = -1, bj = -1
    for (let i = 0; i < groups.length; i++) for (let j = i + 1; j < groups.length; j++) { if (blocked(groups[i], groups[j])) continue; const s = sim(groups[i], groups[j]); if (s > best) { best = s; bi = i; bj = j } }
    // Unter der Schwelle nur noch weiter verschmelzen, solange mehr Gruppen übrig sind, als Personen gleichzeitig im Bild waren
    const floor = opt.targetK !== undefined && groups.length > opt.targetK ? FLOOR_SIM : threshold
    if (best < floor || bi < 0) break
    groups = groups.filter((_, k) => k !== bi && k !== bj).concat([[...groups[bi], ...groups[bj]]])
  }
  return groups
}

/** Sicherheit 0..1: Trennschärfe der Cluster und ob gleichzeitig sichtbare Personen = erkannte Personen. */
export function personConfidence(items: Array<{ emb: Float32Array; sec: number }>, clusters: number[][], maxConcurrent: number): number {
  if (clusters.length === 0) return maxConcurrent > 0 ? 0.3 : 1
  const sim = (a: number[], b: number[]): number => { let s = 0, n = 0; for (const i of a) for (const j of b) if (i !== j) { s += cosine(items[i].emb, items[j].emb); n++ } return n ? s / n : 1 }
  let sep = 1
  if (clusters.length >= 2) {
    const within = Math.min(...clusters.map((c) => (c.length > 1 ? sim(c, c) : 0.5)))
    let between = -1
    for (let i = 0; i < clusters.length; i++) for (let j = i + 1; j < clusters.length; j++) between = Math.max(between, sim(clusters[i], clusters[j]))
    sep = Math.max(0, Math.min(1, 0.5 + (within - between) * 2.5))
  }
  const concurrent = maxConcurrent <= clusters.length ? 1 : 0.3
  return Math.min(sep, concurrent)
}

/** Zahl gleichzeitig sichtbarer, nicht winziger Personen, die in mindestens 3 % der Zeit erreicht wird (ignoriert kurze Fehlerkennungen). */
export function maxConcurrentPeople(inputs: PlanInput[]): number {
  const hist: number[] = []
  let ticks = 0
  for (const inp of inputs) {
    for (let i = 0; i < inp.ticks; i += 2) {
      const vis = inp.tracks.filter((t) => i >= t.start && i - t.start < t.centres.length).map((t) => t.areas[i - t.start])
      const big = Math.max(0, ...vis)
      const n = vis.filter((a) => a >= big * 0.3).length
      hist[n] = (hist[n] ?? 0) + 1
      ticks++
    }
  }
  for (let n = hist.length - 1; n >= 1; n--) {
    let atLeast = 0
    for (let k = n; k < hist.length; k++) atLeast += hist[k] ?? 0
    if (atLeast >= ticks * 0.03) return n
  }
  return 0
}

export const personsFile = (hash: string): string => projectFile(hash, 'persons.json')
export async function loadPersons(hash: string): Promise<PersonsFile | null> {
  try { return JSON.parse(await readFile(personsFile(hash), 'utf8')) as PersonsFile } catch { return null }
}

async function writeThumb(hash: string, id: string, crop: Buffer): Promise<string> {
  const dir = join(projectDir(hash), 'persons')
  await mkdir(dir, { recursive: true })
  const ppm = join(dir, `${id}.ppm`)
  await writeFile(ppm, Buffer.concat([Buffer.from('P6\n112 112\n255\n'), crop]))
  await run(FFMPEG_PATH, ['-hide_banner', '-loglevel', 'error', '-y', '-i', ppm, '-vf', 'scale=224:224:flags=lanczos', join(dir, `${id}.jpg`)])
  await rm(ppm, { force: true })
  return `persons/${id}.jpg`
}

/** Personen über das ganze Video aus den Track-Embeddings aller Clips; schreibt persons.json und markiert die Tracks. */
export async function buildPersons(meta: ProjectMeta, clips: Array<Pick<ShortmeClip, 'id'>>, layouts: ClipLayout[]): Promise<PersonsFile> {
  const items: Ident[] = []
  layouts.forEach((l, ci) => { for (const id of l.identities) { const t = l.input.tracks.find((x) => x.id === id.track); items.push({ key: `${clips[ci].id}:${id.track}`, emb: id.emb, sec: id.sec, crop: id.crop, clip: ci, from: t?.start ?? 0, to: (t?.start ?? 0) + (t?.centres.length ?? 0) }) } })
  const old = await loadPersons(meta.hash)
  const concurrent = maxConcurrentPeople(layouts.map((l) => l.input))
  // Gleichzeitig sichtbare Tracks desselben Clips sind nie dieselbe Person
  const cannotLink = (i: number, j: number): boolean => items[i].clip === items[j].clip && items[i].from < items[j].to && items[j].from < items[i].to
  const all = clusterEmbeddings(items, { cannotLink, targetK: Math.max(1, concurrent) })
  const total = items.reduce((n, i) => n + i.sec, 0)
  // Winzige Cluster (< 10 % der Gesichtszeit) sind Rauschen (Fehlerkennung, Randgesichter)
  const groups = all.filter((g) => { const sec = g.reduce((n, i) => n + items[i].sec, 0); return sec >= MIN_PERSON_SEC && sec >= total * 0.1 })
    .sort((a, b) => b.reduce((n, i) => n + items[i].sec, 0) - a.reduce((n, i) => n + items[i].sec, 0))
  const confidence = personConfidence(items, groups, concurrent)
  const persons: PersonInfo[] = []
  const assignment: Record<string, string> = {}
  for (let g = 0; g < groups.length; g++) {
    const id = `p${g + 1}`
    const members = groups[g].map((i) => items[i])
    for (const m of members) assignment[m.key] = id
    const best = members.filter((m) => m.crop).sort((a, b) => b.sec - a.sec)[0]
    persons.push({ id, label: old?.persons.find((p) => p.id === id)?.label ?? `Person ${g + 1}`, role: 'normal', seconds: Math.round(members.reduce((n, m) => n + m.sec, 0)), thumb: best?.crop ? await writeThumb(meta.hash, id, best.crop) : undefined })
  }
  const file: PersonsFile = { version: 1, confirmed: false, confidence, needsReview: confidence < REVIEW_BELOW && persons.length > 0, persons, assignment }
  await writeFileAtomic(personsFile(meta.hash), JSON.stringify(file, null, 1))
  return file
}

/** Trägt Personen/Rollen in die Plan-Eingabe ein. */
export function applyPersons(input: PlanInput, clipId: string, file: PersonsFile | null): PlanInput {
  if (!file) return input
  const roles: Record<string, 'main' | 'ignore'> = {}
  for (const p of file.persons) if (p.role !== 'normal') roles[p.id] = p.role
  return { ...input, tracks: input.tracks.map((t) => ({ ...t, person: file.assignment[`${clipId}:${t.id}`] })), personRoles: roles }
}

/** Rollen ändern → alle Clips neu planen (ohne neue Analyse). */
export async function replanWithPersons(hash: string, clips: ShortmeClip[], load: (clipId: string) => Promise<PlanInput | null>, save: (clipId: string, input: PlanInput) => Promise<void>): Promise<ShortmeClip[]> {
  const file = await loadPersons(hash)
  const out: ShortmeClip[] = []
  for (const c of clips) {
    const base = await load(c.id)
    if (!base) { out.push(c); continue }
    const input = applyPersons(base, c.id, file)
    await save(c.id, input)
    const shots = planShots(input)
    const ratio = faceRatio(shots, input)
    out.push({ ...c, shots, faceRatio: ratio, score: c.score + (facePenalty(c.faceRatio ?? 1) - facePenalty(ratio)) })
  }
  return out
}
