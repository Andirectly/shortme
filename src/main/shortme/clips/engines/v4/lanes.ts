// Engine 4 – vier unabhängige Kandidatenquellen über die ganze Quelle, jede mit eigener Abdeckung und eigenen Belegen (Spezifikation 02 B).
//   speech      : lokales LLM über das Transkript (Satznummern, keine freien Zeiten) – nutzt die vorhandene Shortme-Textsuche
//   audio       : YAMNet-Klassen (Lachen, Jubel, Rufen, Gesang, Musik) + Pegelsprünge + plötzliche Stille – ohne Transkript
//   visual      : Bildänderungen der Keyframes (Szenen/Aktion) – ohne Transkript
//   cross-modal : Qwen3-VL-Embedding-2B, positive/negative Anfragen, Erweiterung um Anfragen aus den Sprach-Seeds
import { join } from 'node:path'
import type { Sentence } from '../../sentences'
import type { Evidence, RawProposal } from '../../../../../shared/engineV2'
import type { Signals } from '../../signals'
import { textSearch, textWindows } from '../v2/search'
import { audioProposals, decodeSeries, type AudioSeries } from '../v2/audioIndex'
import { changeProposals, frameDiffs } from '../v2/visualIndex'
import { buildIndex } from '../v3/embedIndex'
import { readNpy, type Npy2D } from '../v3/npy'
import { peaksOf, scoreQueries } from '../v3/search'
import type { EmbedSession } from '../v3/embedWorker'
import { V3_EMBED_MODEL } from '../v3/revisions'
import type { CoverageWindow, Lane, Seed } from './core'
import type { Tracer } from './trace'
import type { V4Profile } from './revisions'

export interface LaneResult { lane: Lane; seeds: Seed[]; evidence: Evidence[]; coverage: CoverageWindow[]; diag: Record<string, unknown> }

const toSeeds = (lane: Lane, props: RawProposal[], max: number): Seed[] =>
  [...props].sort((a, b) => b.strength - a.strength).slice(0, max).map((p, i) => ({
    id: `${lane}-${i + 1}`, lane, laneRank: i, anchor: p.anchor ?? (p.start + p.end) / 2, span: { start: p.start, end: p.end }, evidenceIds: p.evidenceIds ?? [], hint: p.kind ?? 'sonstiges', summary: p.summary ?? '', laneScore: Number.isFinite(p.strength) ? p.strength : null
  }))

/** Gleichmäßige Abdeckungsfenster (z. B. ganze Quelle durch ASR/YAMNet verarbeitet). */
export function evenWindows(lane: CoverageWindow['lane'], duration: number, step: number, source: string, status: CoverageWindow['status'] = 'inspected', reason?: string): CoverageWindow[] {
  const out: CoverageWindow[] = []
  for (let s = 0; s < duration; s += step) out.push({ lane, startSeconds: Math.round(s * 100) / 100, endSeconds: Math.round(Math.min(duration, s + step) * 100) / 100, status, source, ...(reason ? { reason } : {}) })
  return out
}

// -------------------------------------------------------------------------------------------------------------------------------- speech
export async function speechLane(url: string, sentences: Sentence[], o: { duration: number; query?: string; asrModel: string; max: number; tracer: Tracer; signal?: AbortSignal; onProgress?: (f: number) => void }): Promise<LaneResult> {
  // ASR lief über die ganze Tonspur (vorhandenes Transkript); Textsuche läuft in Fenstern darüber
  const coverage = evenWindows('speech', o.duration, 60, `asr:${o.asrModel}`)
  if (!sentences.length) return { lane: 'speech', seeds: [], evidence: [], coverage: coverage.map((w) => ({ ...w, reason: 'keine erkannte Sprache' })), diag: { sentences: 0, note: 'kein Transkript-Text: Lane liefert nichts (keine erfundenen Worte)' } }
  const t0 = Date.now()
  let r: Awaited<ReturnType<typeof textSearch>>
  try {
    r = await textSearch(url, sentences, { query: o.query, modelRev: 'v4-speech', signal: o.signal, onProgress: o.onProgress })
  } catch (e) {
    await o.tracer.record({ role: 'speech_lane', modelRevision: 'qwen3-14b', realInputModalities: ['speech'], actualMediaWindowIds: [], success: false, validatedOutput: false, wallClockMs: Date.now() - t0, status: 'failed', error: String(e).slice(0, 300), input: { sentences: sentences.length } })
    throw e
  }
  const wins = textWindows(sentences)
  for (const w of wins) {
    const a = sentences[w.from].start, b = sentences[w.to].end
    const failed = r.failedRanges.some(([x, y]) => x < b && y > a)
    coverage.push({ lane: 'speech', startSeconds: a, endSeconds: b, status: failed ? 'failed' : 'inspected', source: 'speech-lane-llm', ...(failed ? { reason: 'Modellantwort ungültig' } : {}) })
  }
  await o.tracer.record({ role: 'speech_lane', modelRevision: 'qwen3-14b-q4_k_m (llama-server)', promptRevision: 'v2/text-search', realInputModalities: ['speech'], actualMediaWindowIds: wins.map((w) => `S${w.from}-S${w.to}`), success: true, validatedOutput: true, wallClockMs: Date.now() - t0, status: `windows ${r.windows}, failed ${r.failedWindows}`, input: { sentences: sentences.length, windows: r.windows }, output: { proposals: r.proposals.length } })
  return { lane: 'speech', seeds: toSeeds('speech', r.proposals, o.max), evidence: r.evidence, coverage, diag: { windows: r.windows, failedWindows: r.failedWindows, proposals: r.proposals.length } }
}

// -------------------------------------------------------------------------------------------------------------------------------- audio
/** Pegelsprünge und plötzliche Stille aus dem 1-s-Pegelraster (relativ zum gleitenden Median, also unabhängig von der Gesamtlautstärke). */
export function loudnessEvents(sig: Pick<Signals, 'loudness' | 'silence'>, duration: number, max: number): { proposals: RawProposal[]; evidence: Evidence[] } {
  const L = sig.loudness
  const med = (i: number): number => { const w = L.slice(Math.max(0, i - 12), i).filter((x) => Number.isFinite(x)).sort((a, b) => a - b); return w.length ? w[Math.floor(w.length / 2)] : 0 }
  const cands: Array<{ t: number; v: number; kind: 'peak' | 'drop' }> = []
  for (let i = 12; i < L.length - 2; i++) {
    const m = med(i), jump = L[i] - m
    if (jump > 0.25 && L[i] >= L[i - 1] && L[i] >= L[i + 1]) cands.push({ t: i, v: jump, kind: 'peak' })
    if (m > 0.35 && (sig.silence[i] ?? 0) > 0.8 && (sig.silence[i + 1] ?? 0) > 0.8) cands.push({ t: i, v: m * 0.8, kind: 'drop' })
  }
  const picked: typeof cands = []
  for (const c of cands.sort((a, b) => b.v - a.v)) { if (picked.length >= max) break; if (picked.every((p) => Math.abs(p.t - c.t) > 8)) picked.push(c) }
  const evidence: Evidence[] = [], proposals: RawProposal[] = []
  picked.forEach((c, n) => {
    const id = `ld${n + 1}`
    evidence.push({ id, modality: 'audio', state: 'signal-only', source: 'loudness', start: c.t, end: c.t + 1, observation: c.kind === 'peak' ? `Pegelsprung +${c.v.toFixed(2)} über dem gleitenden Median` : 'plötzliche Stille nach lauter Passage', uncertainty: 'reines Pegelsignal, nicht angehört' })
    proposals.push({ start: Math.max(0, c.t - 12), end: Math.min(duration, c.t + 8), anchor: c.t, source: 'audio', kind: 'reaktion', summary: c.kind === 'peak' ? 'plötzlich lauter Moment' : 'plötzliche Stille', strength: Math.min(1, c.v), evidenceIds: [id] })
  })
  return { proposals, evidence }
}

export async function audioLane(series: AudioSeries | null, sig: Signals, o: { duration: number; max: number; tracer: Tracer; hasAudio: boolean; /** Mac-Engine: Apple SoundAnalysis statt YAMNet */ apple?: { events: { proposals: RawProposal[]; evidence: Evidence[] }; windows: number } }): Promise<LaneResult> {
  if (!o.hasAudio) return { lane: 'audio', seeds: [], evidence: [], coverage: evenWindows('audio', o.duration, 60, 'ffprobe', 'skipped', 'Quelle ohne Tonspur'), diag: { note: 'keine Tonspur' } }
  const props: RawProposal[] = [], evidence: Evidence[] = []
  const coverage: CoverageWindow[] = evenWindows('audio', o.duration, 60, 'loudness-rms')
  if (o.apple) {
    props.push(...o.apple.events.proposals); evidence.push(...o.apple.events.evidence)
    coverage.push(...evenWindows('audio', o.duration, 60, 'apple-soundanalysis'))
    await o.tracer.record({ role: 'audio_event', modelRevision: 'apple-soundanalysis (SNClassifySoundRequest version1)', realInputModalities: ['audio'], actualMediaWindowIds: ['audio.wav'], success: true, validatedOutput: true, wallClockMs: 0, status: `Fenster ${o.apple.windows}, Vorschläge ${o.apple.events.proposals.length}`, input: { wav: 'audio.wav', windows: o.apple.windows }, output: { proposals: o.apple.events.proposals.length } })
  } else if (series) {
    const y = audioProposals(decodeSeries(series), o.duration)
    props.push(...y.proposals); evidence.push(...y.evidence)
    coverage.push(...evenWindows('audio', Math.min(o.duration, series.frames * series.hop), 60, 'yamnet'))
    await o.tracer.record({ role: 'audio_event', modelRevision: `yamnet (${series.rev}, hop ${series.hop}s)`, realInputModalities: ['audio'], actualMediaWindowIds: ['audio.wav'], success: true, validatedOutput: true, wallClockMs: 0, status: `frames ${series.frames}, Vorschläge ${y.proposals.length}`, input: { wav: 'audio.wav', frames: series.frames }, output: { proposals: y.proposals.length } })
  } else {
    await o.tracer.record({ role: 'audio_event', modelRevision: 'yamnet', realInputModalities: ['audio'], actualMediaWindowIds: [], success: false, validatedOutput: false, wallClockMs: 0, status: 'YAMNet nicht installiert', input: {} })
  }
  const ld = loudnessEvents(sig, o.duration, Math.max(4, Math.round(o.duration / 300)))
  props.push(...ld.proposals); evidence.push(...ld.evidence)
  return { lane: 'audio', seeds: toSeeds('audio', props, o.max), evidence, coverage, diag: { yamnet: !!series, appleSound: !!o.apple, loudnessEvents: ld.proposals.length, proposals: props.length } }
}

// -------------------------------------------------------------------------------------------------------------------------------- visual
export function visualLane(scan: { times: number[]; frames: Uint8Array[] } | null, o: { duration: number; max: number }): LaneResult {
  if (!scan || !scan.times.length) return { lane: 'visual', seeds: [], evidence: [], coverage: evenWindows('visual', o.duration, 60, 'keyframes', 'failed', 'keine Keyframes'), diag: { note: 'kein Bild' } }
  const ch = changeProposals(scan.times, frameDiffs(scan.frames), o.duration)
  const coverage: CoverageWindow[] = scan.times.map((t, i) => ({ lane: 'visual' as const, startSeconds: t, endSeconds: Math.min(o.duration, scan.times[i + 1] ?? t + 1), status: 'inspected' as const, source: 'keyframe-diff' }))
  return { lane: 'visual', seeds: toSeeds('visual', ch.proposals, o.max), evidence: ch.evidence, coverage, diag: { keyframes: scan.times.length, proposals: ch.proposals.length } }
}

// -------------------------------------------------------------------------------------------------------------------------------- cross-modal
export interface V4Query { id: string; text: string; polarity: 'pos' | 'neg'; origin: 'bank' | 'user' | 'speech-expansion' }
/** Kategorie-freie Anfragebank (keine Pflicht-Genres) + negative Anfragen gegen Leerlauf; versioniert in revisions.ts. */
export const QUERY_BANK: V4Query[] = [
  { id: 'q-surprise', text: 'a surprising moment that makes people react', polarity: 'pos', origin: 'bank' },
  { id: 'q-reaction', text: 'a person reacting strongly with face and body', polarity: 'pos', origin: 'bank' },
  { id: 'q-change', text: 'a sudden change in what is happening on screen', polarity: 'pos', origin: 'bank' },
  { id: 'q-laugh', text: 'people laughing hard', polarity: 'pos', origin: 'bank' },
  { id: 'q-wrong', text: 'something goes wrong or fails', polarity: 'pos', origin: 'bank' },
  { id: 'q-perform', text: 'someone performing, singing or showing off a skill', polarity: 'pos', origin: 'bank' },
  { id: 'q-win', text: 'a win, a victory or a celebration', polarity: 'pos', origin: 'bank' },
  { id: 'q-emotion', text: 'an emotional or intense moment', polarity: 'pos', origin: 'bank' },
  { id: 'q-reveal', text: 'something is revealed or shown for the first time', polarity: 'pos', origin: 'bank' },
  { id: 'n-static', text: 'a static screen where nothing happens', polarity: 'neg', origin: 'bank' },
  { id: 'n-menu', text: 'a menu, a loading screen or a black screen', polarity: 'neg', origin: 'bank' },
  { id: 'n-idle', text: 'a person sitting still and talking calmly', polarity: 'neg', origin: 'bank' }
]

export function expandQueries(bank: V4Query[], userQuery: string | undefined, speechSeeds: Seed[], maxExpansion = 4): V4Query[] {
  const out = [...bank]
  const u = (userQuery ?? '').replace(/\s+/g, ' ').trim().slice(0, 300)
  if (u) out.push({ id: 'u-1', text: u, polarity: 'pos', origin: 'user' })
  // Anfrage-Erweiterung: was die Sprach-Lane beschreibt, im Bild wiederfinden (Kontext oder Folge desselben Themas an anderer Stelle)
  speechSeeds.filter((s) => s.summary.trim().length > 8).slice(0, maxExpansion).forEach((s, i) => out.push({ id: `x-${i + 1}`, text: s.summary.slice(0, 200), polarity: 'pos', origin: 'speech-expansion' }))
  return out
}

/** Gegenüber den negativen Anfragen bereinigte Ähnlichkeit (z-Wert je Anfrage minus stärkster negativer z-Wert). */
export function contrastScores(z: Record<string, Float32Array>, pos: string[], neg: string[]): Record<string, Float32Array> {
  const n = Object.values(z)[0]?.length ?? 0
  const negMax = Float32Array.from({ length: n }, (_, i) => Math.max(0, ...neg.map((q) => z[q][i])))
  return Object.fromEntries(pos.map((q) => [q, Float32Array.from(z[q], (v, i) => v - 0.5 * negMax[i])]))
}

export async function crossModalLane(s: EmbedSession, o: { hash: string; video: string; duration: number; profile: V4Profile; queries: V4Query[]; max: number; tracer: Tracer; signal?: AbortSignal; onProgress?: (f: number, m: string) => void }): Promise<LaneResult & { vectors: Npy2D; wins: Array<{ start: number; end: number }> }> {
  const t0 = Date.now()
  const idx = await buildIndex(s, { hash: o.hash, video: o.video, durationSec: o.duration, cfg: o.profile.embed, signal: o.signal, onProgress: (f, m) => o.onProgress?.(f * 0.9, m) })
  await o.tracer.record({ role: 'video_embedding', modelRevision: `${V3_EMBED_MODEL.id}@${V3_EMBED_MODEL.revision}`, realInputModalities: ['video'], actualMediaWindowIds: idx.wins.map((w) => `w${w.index}`).slice(0, 2000), success: true, validatedOutput: true, wallClockMs: Date.now() - t0, status: `${idx.wins.length} Fenster, ${idx.meta.failed.length} Lücken, cached=${idx.cached}`, input: { frames: o.profile.embed.frames, windowSec: o.profile.embed.windowSec, hopSec: o.profile.embed.hopSec, fingerprint: idx.meta.fingerprint }, output: { dimension: idx.meta.dimension, windows: idx.wins.length } })
  const qPath = join(idx.dir, `v4-queries-${Date.now().toString(36)}.npy`)
  const t1 = Date.now()
  await s.worker.request('embed_text', { texts: o.queries.map((q) => q.text), outPath: qPath }, { runId: s.runId, timeoutMs: 120_000, signal: o.signal })
  const Q = await readNpy(qPath)
  await o.tracer.record({ role: 'query_embedding', modelRevision: `${V3_EMBED_MODEL.id}@${V3_EMBED_MODEL.revision}`, realInputModalities: ['text'], actualMediaWindowIds: [], success: true, validatedOutput: true, wallClockMs: Date.now() - t1, status: `${o.queries.length} Anfragen`, input: { queries: o.queries }, output: { rows: Q.rows } })
  const sc = scoreQueries(idx.vectors, Q, o.queries.map((q) => q.id))
  const z = Object.fromEntries(sc.map((x) => [x.id, x.z]))
  const pos = o.queries.filter((q) => q.polarity === 'pos').map((q) => q.id), neg = o.queries.filter((q) => q.polarity === 'neg').map((q) => q.id)
  const cs = contrastScores(z, pos, neg)
  const props: RawProposal[] = [], evidence: Evidence[] = []
  const topK = Math.max(2, Math.ceil(o.duration / 900))
  let n = 0
  for (const q of pos) {
    // feste Top-K je Anfrage statt starrer Schwelle (Werte sind nicht kalibriert)
    for (const p of peaksOf({ id: q, cos: sc.find((x) => x.id === q)!.cos, mean: 0, std: 1, z: cs[q] }, idx.wins, { topK, minZ: 0.8, mergeGapSec: o.profile.embed.windowSec * 1.5 })) {
      const id = `xm${++n}`
      const qq = o.queries.find((x) => x.id === q)!
      evidence.push({ id, modality: 'visual', state: 'signal-only', source: V3_EMBED_MODEL.id, start: p.start, end: p.end, observation: `Bild-Embedding passt zu „${qq.text}“ (z ${p.z.toFixed(2)} nach Abzug der Leerlauf-Anfragen)`, modelRev: V3_EMBED_MODEL.revision, uncertainty: 'Abruf im Embedding-Raum, kein Verständnis; kein Viralitätswert' })
      props.push({ start: Math.max(0, p.start - 6), end: Math.min(o.duration, p.end + 4), anchor: p.anchor, source: 'visual', channel: 'cross-modal', kind: 'sonstiges', summary: qq.text, strength: p.z, evidenceIds: [id] })
    }
  }
  const coverage: CoverageWindow[] = idx.wins.map((w) => ({ lane: 'visual' as const, startSeconds: w.start, endSeconds: w.end, status: idx.meta.failed.some(([a, b]) => a < w.end && b > w.start) ? 'failed' as const : 'inspected' as const, source: 'qwen3-vl-embedding' }))
  coverage.push(...coverage.map((c) => ({ ...c, lane: 'cross-modal' as const })))
  return { lane: 'cross-modal', seeds: toSeeds('cross-modal', props, o.max), evidence, coverage, vectors: idx.vectors, wins: idx.wins, diag: { windows: idx.wins.length, cached: idx.cached, queries: o.queries.length, expansion: o.queries.filter((q) => q.origin !== 'bank').map((q) => q.text), proposals: props.length } }
}

/**
 * Sprache unsicher (V4-012): in 60-s-Fenstern, in denen YAMNet überwiegend Gesang/Rap oder Musik hört, gelten ASR-Wörter als unsicher.
 * Ergebnis: Fenster [start, end) mit Anteil; der Aufrufer stuft dort Sprachbelege auf `unknown` und die Abdeckung auf `partial` herab.
 */
export function speechUncertainWindows(groups: { vocal?: Uint8Array; music?: Uint8Array } | null, hop: number, duration: number, threshold = 0.5): Array<{ start: number; end: number; share: number }> {
  if (!groups?.vocal && !groups?.music) return []
  const n = Math.max(groups.vocal?.length ?? 0, groups.music?.length ?? 0)
  const out: Array<{ start: number; end: number; share: number }> = []
  for (let s = 0; s < duration; s += 60) {
    const a = Math.floor(s / hop), b = Math.min(n, Math.ceil(Math.min(duration, s + 60) / hop))
    let hit = 0
    for (let k = a; k < b; k++) if ((groups.vocal?.[k] ?? 0) > 140 || (groups.music?.[k] ?? 0) > 140) hit++
    const share = b > a ? hit / (b - a) : 0
    if (share > threshold) out.push({ start: s, end: Math.min(duration, s + 60), share: Math.round(share * 100) / 100 })
  }
  return out
}
