// Engine 4 – Herkunft eines Clips aus den Lauf-Dateien (nur lesen): warum gefunden, Belege, Untersuchungsschritte, Graph, Kanten, Varianten, Prüfrunden, Reparaturen.
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { runDir } from '../state'

const read = async <T>(dir: string, name: string): Promise<T | null> => { try { return JSON.parse(await readFile(join(dir, name), 'utf8')) as T } catch { return null } }
const readLines = async (dir: string, name: string): Promise<unknown[]> => { try { return (await readFile(join(dir, name), 'utf8')).split('\n').filter(Boolean).map((l) => JSON.parse(l)) } catch { return [] } }

export interface V4Provenance {
  runId: string; clipId: string; manifest: Record<string, unknown> | null
  group: { id: string; lanes: string[]; seeds: Array<{ id: string; lane: string; summary: string; span: { start: number; end: number }; evidenceIds: string[] }> } | null
  investigation: unknown[]; graph: unknown | null; variants: unknown[]; rounds: unknown[]; repairs: unknown[]; edges: unknown[]; deciles: Record<string, boolean[]> | null
  output: { path: string; sha256: string } | null; evidence: unknown[]
}

export async function v4Provenance(hash: string, runId: string, clipId: string): Promise<V4Provenance> {
  const dir = runDir(hash, runId)
  const sel = await read<{ chosen: Array<{ clipId: string; fromFinalist: string; output: string }>; finalists: Array<{ id: string; sha256: string; output: string }> }>(dir, 'selection.json')
  const ch = sel?.chosen.find((c) => c.clipId === clipId)
  const fin = ch ? sel!.finalists.find((f) => f.id === ch.fromFinalist) : undefined
  const variantId = ch ? ch.fromFinalist.slice(runId.length + 1).replace(/-r\d+$/, '') : ''
  const variants = ((await read<Array<{ id: string; eventId: string; cut: { startEdgeId: string; endEdgeId: string } }>>(dir, 'variants.json')) ?? [])
  const v = variants.find((x) => x.id === variantId)
  const eventId = v?.eventId ?? ''
  const groupId = eventId.replace(/^eg-/, '')
  const graphs = (await read<Array<{ groupId: string; graph: unknown }>>(dir, 'event_graphs.json')) ?? []
  const cands = await read<{ seeds: Array<{ id: string; lane: string; summary: string; span: { start: number; end: number }; evidenceIds: string[] }>; groups: Array<{ id: string; lanes: string[]; seeds: string[] }> }>(dir, 'candidates.json')
  const g = cands?.groups.find((x) => x.id === groupId)
  const edges = (await read<{ edges: Array<{ id: string }> }>(dir, 'cut_edges.json'))?.edges ?? []
  const repairs = ((await read<Array<{ variantId: string }>>(dir, 'repairs.json')) ?? []).filter((r) => r.variantId === variantId)
  const usedEdges = new Set<string>([v?.cut.startEdgeId, v?.cut.endEdgeId, ...repairs.flatMap((r) => String((r as { to?: string }).to ?? '').split('__'))].filter((x): x is string => !!x))
  const evAll = (await read<Array<{ id: string }>>(dir, 'evidence.json')) ?? []
  const seedEv = new Set(g ? (cands!.seeds.filter((s) => g.seeds.includes(s.id)).flatMap((s) => s.evidenceIds)) : [])
  return {
    runId, clipId, manifest: await read(dir, 'manifest.json'),
    group: g ? { id: g.id, lanes: g.lanes, seeds: cands!.seeds.filter((s) => g.seeds.includes(s.id)) } : null,
    investigation: (await readLines(dir, 'investigation.jsonl')).filter((x) => (x as { groupId?: string }).groupId === groupId),
    graph: graphs.find((x) => x.groupId === groupId) ?? null,
    variants: variants.filter((x) => x.eventId === eventId),
    rounds: ((await read<Array<{ variantId: string }>>(dir, 'verdicts.json')) ?? []).filter((r) => r.variantId === variantId),
    repairs, edges: edges.filter((e) => usedEdges.has(e.id)),
    deciles: (await read<{ deciles: Record<string, boolean[]> }>(dir, 'coverage.json'))?.deciles ?? null,
    output: fin ? { path: fin.output, sha256: fin.sha256 } : null,
    evidence: evAll.filter((e) => seedEv.has(e.id) || e.id.startsWith(`inv-${groupId}.`))
  }
}
