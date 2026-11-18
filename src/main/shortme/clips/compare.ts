// Engine-Vergleich: Speicher unter <Projekt>/analysis/comparisons/<id>.json. Vergleicht nur Läufe EINES Projekts (= eines Originalvideos); Läufe werden nicht verändert.
import { mkdir, readFile, readdir } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { join } from 'node:path'
import { writeFileAtomic } from '../atomic'
import { projectFile } from '../project'
import { LEGACY_RUN_ID } from '../../../shared/engine'
import { blindOrder, matchEvents, type BlindReview, type CmpRun, type EngineComparison, type EventMatchOverride } from '../../../shared/compare'
import { findClip, loadClips } from './analysis'
import { recheckClip, type ClipRecheck } from './engines/recheck'
import { loadState } from './engines/state'

const dir = (hash: string): string => projectFile(hash, 'analysis/comparisons')
const safeId = (x: unknown): x is string => typeof x === 'string' && /^cmp-[a-z0-9]{6,20}$/.test(x)
const file = (hash: string, id: string): string => { if (!safeId(id)) throw new Error('Ungültige Vergleichs-ID'); return join(dir(hash), `${id}.json`) }

async function runsOf(hash: string, runIds: string[]): Promise<CmpRun[]> {
  const st = await loadState(hash)
  const out: CmpRun[] = []
  for (const id of runIds) {
    const f = await loadClips(hash, id)
    if (!f) throw new Error(`Lauf ${id} hat keine Clipliste`)
    out.push({ runId: id, engineId: id === LEGACY_RUN_ID ? 'legacy' : (st.runs.find((r) => r.runId === id)?.engineId ?? 'legacy'), clips: f.clips })
  }
  return out
}

export async function createComparison(hash: string, runIds: string[]): Promise<EngineComparison> {
  const ids = [...new Set(runIds)]
  if (ids.length < 2 || ids.length > 4) throw new Error('Bitte zwei bis vier Läufe wählen.')
  const st = await loadState(hash)
  const runs = await runsOf(hash, ids)
  const infos = ids.map((id) => st.runs.find((r) => r.runId === id))
  const warnings: string[] = []
  const engines = runs.map((r) => r.engineId)
  if (new Set(engines).size < engines.length) warnings.push('Mehrere Läufe derselben Engine: ihre Optionen können sich unterscheiden – nicht als Engine-Vergleich lesen.')
  const opts = infos.map((i) => (i ? { query: i.options.query, contentType: i.options.contentType, wanted: i.options.wanted, minSec: i.options.minSec, maxSec: i.options.maxSec } : null))
  const first = JSON.stringify(opts.find((o) => o))
  if (opts.some((o) => o && JSON.stringify(o) !== first)) warnings.push('Die Analyseoptionen (Suche, Inhaltstyp, Anzahl, Länge) unterscheiden sich zwischen den Läufen: Ergebnisse sind nur eingeschränkt vergleichbar.')
  if (infos.some((i) => i && i.status !== 'done')) warnings.push('Mindestens ein Lauf ist nicht vollständig abgeschlossen.')
  const c: EngineComparison = {
    comparisonId: `cmp-${randomBytes(5).toString('hex')}`, projectId: hash, kind: 'full-source-discovery', runIds: ids, sourceMediaId: hash,
    frozenComparableOptions: Object.fromEntries(ids.map((id, i) => [id, opts[i]])), warnings, createdAt: new Date().toISOString(),
    eventMatches: matchEvents(runs), manualOverrides: [], reviews: [],
  }
  await save(hash, c)
  return c
}

async function save(hash: string, c: EngineComparison): Promise<void> {
  await mkdir(dir(hash), { recursive: true })
  await writeFileAtomic(file(hash, c.comparisonId), JSON.stringify(c, null, 1))
}
export async function getComparison(hash: string, id: string): Promise<EngineComparison | null> {
  try { return JSON.parse(await readFile(file(hash, id), 'utf8')) as EngineComparison } catch { return null }
}
export async function listComparisons(hash: string): Promise<Array<{ comparisonId: string; createdAt: string; runIds: string[] }>> {
  try {
    const names = (await readdir(dir(hash))).filter((n) => n.endsWith('.json'))
    const all = await Promise.all(names.map((n) => getComparison(hash, n.slice(0, -5))))
    return all.filter((c): c is EngineComparison => !!c).map((c) => ({ comparisonId: c.comparisonId, createdAt: c.createdAt, runIds: c.runIds })).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  } catch { return [] }
}

/** Override speichern und die Zuordnung daraus neu berechnen (Algorithmus + alle Overrides in Reihenfolge). */
export async function addOverride(hash: string, id: string, o: Omit<EventMatchOverride, 'createdAt'>): Promise<EngineComparison> {
  const c = await getComparison(hash, id)
  if (!c) throw new Error('Vergleich nicht gefunden')
  c.manualOverrides.push({ ...o, createdAt: new Date().toISOString() })
  c.eventMatches = matchEvents(await runsOf(hash, c.runIds), c.manualOverrides)
  await save(hash, c)
  return c
}

/** Blindes Urteil: Die Reihenfolge der Läufe je Match ist aus Vergleichs- und Match-ID abgeleitet; das Ergebnis speichert die Reihenfolge, damit sie später auflösbar bleibt. */
export const blindPresentation = (c: EngineComparison, matchId: string): string[] => blindOrder(c.eventMatches.find((m) => m.matchId === matchId)?.members.map((m) => m.runId) ?? [], `${c.comparisonId}:${matchId}`)

export async function addReview(hash: string, id: string, r: Pick<BlindReview, 'matchId' | 'choice' | 'reasonTags' | 'reviewerSessionId'>): Promise<EngineComparison> {
  const c = await getComparison(hash, id)
  if (!c) throw new Error('Vergleich nicht gefunden')
  if (!['a', 'b', 'c', 'd', 'tie', 'all-weak'].includes(r.choice)) throw new Error('Ungültige Wahl')
  const order = blindPresentation(c, r.matchId)
  if (!order.length) throw new Error('Match nicht gefunden')
  c.reviews = c.reviews.filter((x) => x.matchId !== r.matchId)
  c.reviews.push({ reviewId: `rv-${randomBytes(4).toString('hex')}`, comparisonId: id, matchId: r.matchId, reviewerSessionId: r.reviewerSessionId, anonymizedPresentationOrder: order, choice: r.choice, judgedAt: new Date().toISOString(), reasonTags: r.reasonTags })
  await save(hash, c)
  return c
}

/** Anzeigeinfos der Clips aller Läufe eines Vergleichs (Titel, Zeiten, Schnitte) für die Ansicht. */
export async function clipIndex(hash: string, c: EngineComparison): Promise<Record<string, { title: string; start: number; end: number; score: number; autoCuts: Array<{ start: number; end: number }> }>> {
  const out: Record<string, { title: string; start: number; end: number; score: number; autoCuts: Array<{ start: number; end: number }> }> = {}
  for (const r of await runsOf(hash, c.runIds)) for (const k of r.clips) out[k.id] = { title: k.title, start: k.start, end: k.end, score: k.score, autoCuts: k.autoCuts ?? [] }
  return out
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// clip-recheck: getrennt von der Quellanalyse gespeichert (<id>.rechecks.json), nie in Matches/Exklusiv-Zahlen eingerechnet.
const recheckFile = (hash: string, id: string): string => file(hash, id).replace(/\.json$/, '.rechecks.json')
export async function listRechecks(hash: string, id: string): Promise<ClipRecheck[]> {
  try { return JSON.parse(await readFile(recheckFile(hash, id), 'utf8')) as ClipRecheck[] } catch { return [] }
}
export async function addRecheck(hash: string, id: string, clipId: string, byEngine: 'multimodal-v2' | 'legacy' | 'engine4' | 'engine-mac'): Promise<ClipRecheck[]> {
  const c = await getComparison(hash, id)
  if (!c) throw new Error('Vergleich nicht gefunden')
  const found = await findClip(hash, clipId)
  if (!found || !c.runIds.includes(found.runId)) throw new Error('Clip gehört nicht zu diesem Vergleich')
  const r = await recheckClip(hash, found.clip, found.runId, byEngine)
  const all = [...(await listRechecks(hash, id)), r]
  await mkdir(dir(hash), { recursive: true })
  await writeFileAtomic(recheckFile(hash, id), JSON.stringify(all, null, 1))
  return all
}
