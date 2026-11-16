// Engine 3 („Adaptive AI“): eigene Kandidatensuche über das ganze Video mit einem semantischen Bild-Index (Qwen3-VL-Embedding im Python-Worker), dazu die
// Ton-, Text- und Chat-Quellen; Rangfusion je Quelle; danach die Detailprüfung und der redaktionelle Teil wie in Engine 2 (transparent als Kompatibilitätspfad
// geführt – Bild/Ton-Prüfer sind Qwen3-VL-4B und Voxtral, nicht das in der Spezifikation genannte MiniCPM-o). Läuft NICHT über selectV2: eigener Dispatcher-Pfad,
// eigene Run-IDs, eigener Index, eigene Budgets.
import { join } from 'node:path'
import type { SelectionOutcome, SelectionRequest } from '..'
import { isV3Profile, type V3Profile } from '../../../../../shared/engine'
import { runPipeline, type V3Discovery, type V3Hooks } from '../v2'
import { buildIndex } from './embedIndex'
import { verifyAv } from './avCheck'
import { withAv, withTemporal } from './avWorker'
import { groundVideo } from './temporal'
import { withEmbedder } from './embedWorker'
import { v3MissingModels } from './models'
import { readNpy } from './npy'
import { V3_AV_MODEL, V3_EMBED_CODE, V3_EMBED_MODEL, V3_PROFILE_CONFIG, V3_TEMPORAL_MODEL, v3Revisions } from './revisions'
import { QUERY_SET, fuseRrf, peaksOf, peaksToProposals, scoreQueries, temporalProposals, type Peak, type SearchQuery } from './search'

export function activeQueries(profile: V3Profile, userQuery?: string): SearchQuery[] {
  const base = QUERY_SET.filter((q) => q.rank <= V3_PROFILE_CONFIG[profile].queries)
  const u = (userQuery ?? '').replace(/\s+/g, ' ').trim().slice(0, 300)
  return u ? [...base, { id: 'user', text: u, kind: 'sonstiges', label: `Suchwunsch/Profil: ${u.slice(0, 60)}`, rank: 0 }] : base
}

async function discover(req: SelectionRequest, profile: V3Profile, ctx: Parameters<V3Hooks['discover']>[0]): Promise<V3Discovery> {
  const cfg = V3_PROFILE_CONFIG[profile]
  const { project } = ctx
  const queries = activeQueries(profile, ctx.query)
  return withEmbedder(req.runId, async (s) => {
    const idx = await buildIndex(s, { hash: project.hash, video: project.sourcePath, durationSec: project.durationSec, cfg, signal: ctx.signal, onProgress: (f, m) => ctx.report(f * 0.9, m) })
    ctx.report(0.92, 'Suchanfragen einbetten …')
    const qPath = join(idx.dir, `queries-${Date.now().toString(36)}.npy`)
    await s.worker.request('embed_text', { texts: queries.map((q) => q.text), outPath: qPath }, { runId: s.runId, timeoutMs: 120_000, signal: ctx.signal })
    const Q = await readNpy(qPath)
    const scores = scoreQueries(idx.vectors, Q, queries.map((q) => q.id))
    const topK = Math.max(6, Math.round(0.02 * idx.wins.length))
    const peaks: Peak[] = scores.flatMap((sc) => peaksOf(sc, idx.wins, { topK, minZ: 2, mergeGapSec: cfg.windowSec * 1.5 }))
    const { proposals, evidence } = peaksToProposals(peaks, queries, `${V3_EMBED_MODEL.id}@${V3_EMBED_MODEL.revision.slice(0, 8)}`, project.durationSec)
    const failedSec = idx.meta.failed.reduce((n, [a, b]) => n + (b - a), 0)
    const problems = idx.meta.failed.length ? [`Embedding-Index: ${idx.meta.failed.length} Abschnitte (${Math.round(failedSec)} s) nicht eingebettet`] : []
    return {
      proposals, evidence, modality: idx.meta.failed.length ? 'failed' : 'signal-only', coverage: Math.max(0, 1 - failedSec / project.durationSec), problems,
      models: { embedding: `${V3_EMBED_MODEL.id}@${V3_EMBED_MODEL.revision}`, embeddingCode: `${V3_EMBED_CODE.repo}@${V3_EMBED_CODE.commit}`, torch: String(s.health.torch ?? '?'), gpu: String(s.health.gpu ?? '?') },
      diag: {
        index: { fingerprint: idx.meta.fingerprint, windows: idx.wins.length, dimension: idx.meta.dimension, cached: idx.cached, buildSeconds: idx.cached ? 0 : idx.meta.seconds, peakVramBytes: idx.meta.peakVramBytes ?? 'nicht gemessen', failed: idx.meta.failed, windowSec: cfg.windowSec, hopSec: cfg.hopSec, frames: cfg.frames },
        queries: scores.map((sc) => ({ id: sc.id, text: queries.find((q) => q.id === sc.id)!.text, meanCos: +sc.mean.toFixed(4), stdCos: +sc.std.toFixed(4), peaks: peaks.filter((p) => p.query === sc.id).length, topZ: +Math.max(...sc.z).toFixed(2) })),
        peaks: peaks.length, workerLoad: s.loadInfo, note: 'Ähnlichkeiten sind je Anfrage normalisiert (z-Wert) und nur innerhalb dieses Modellraums vergleichbar'
      }
    }
  })
}

/** Lighthouse: zeitliche Verortung der Anfragen über das ganze Video (eigener Rangkanal 'temporal'). */
async function temporal(req: SelectionRequest, profile: V3Profile, ctx: Parameters<V3Hooks['discover']>[0]): Promise<V3Discovery> {
  const { project } = ctx
  const queries = activeQueries(profile, ctx.query)
  const topK = Math.max(2, Math.ceil(project.durationSec / 900))
  const total = Math.max(6, Math.ceil(project.durationSec / 150)) // Gesamtbudget Verortungs-Vorschläge
  return withTemporal(req.runId, async (s) => {
    const r = await groundVideo(s, { hash: project.hash, video: project.sourcePath, durationSec: project.durationSec, queries, topK, total, signal: ctx.signal, onProgress: ctx.report })
    const { proposals, evidence } = temporalProposals(r.moments, queries, `${V3_TEMPORAL_MODEL.id}@${V3_TEMPORAL_MODEL.codeCommit.slice(0, 8)}`, project.durationSec)
    const failedSec = r.failed.reduce((n, [a, b]) => n + (b - a), 0)
    return {
      proposals, evidence, modality: r.failed.length ? 'failed' : 'signal-only', coverage: Math.max(0, 1 - failedSec / project.durationSec),
      problems: r.failed.length ? [`Lighthouse: ${r.failed.length} Fenster (${Math.round(failedSec)} s) nicht ausgewertet`] : [],
      models: { temporal: `${V3_TEMPORAL_MODEL.id} (Code ${V3_TEMPORAL_MODEL.codeCommit.slice(0, 8)}, Checkpoint Zenodo 13960580)` },
      diag: { windows: r.windows, cached: r.cached, seconds: Math.round(r.seconds * 10) / 10, moments: r.moments.length, proposals: proposals.length, failed: r.failed, peakVramBytes: r.peakVramBytes ?? 'nicht gemessen', queries: queries.length, note: 'Modellwerte nicht kalibriert; Rangfusion je Kanal. Modell ist auf Vlogs (QVHighlights, ≤ 150 s) trainiert, Fenster 120 s mit 10 s Überlappung' }
    }
  })
}

export function v3Hooks(req: SelectionRequest, profile: V3Profile): V3Hooks {
  const cfg = V3_PROFILE_CONFIG[profile]
  return { profile, detailMax: cfg.detailMax, finalists: cfg.finalists, discover: (ctx) => discover(req, profile, ctx), ...(cfg.temporal ? { temporal: (ctx: Parameters<V3Hooks['discover']>[0]) => temporal(req, profile, ctx) } : {}), avMax: cfg.avMax, verifyAv: (ctx) => withAv(req.runId, async (s) => ({ ...(await verifyAv(s, { hash: req.project.hash, video: req.project.sourcePath, durationSec: req.project.durationSec, targets: ctx.targets, signal: ctx.signal, onProgress: ctx.report })), models: { av: `${V3_AV_MODEL.id}@${V3_AV_MODEL.revision}`, torch: String(s.health.torch ?? '?'), gpu: String(s.health.gpu ?? '?') } })), fuse: (raw) => fuseRrf(raw), revisions: () => v3Revisions(profile), missing: v3MissingModels }
}

export function selectV3(req: SelectionRequest): Promise<SelectionOutcome> {
  const profile: V3Profile = isV3Profile(req.profile) ? req.profile : 'balanced'
  return runPipeline(req, { engine: 'adaptive-v3', v3: v3Hooks(req, profile) })
}
