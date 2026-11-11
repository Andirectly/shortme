import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { baseState, stateOf } from '../../shared/edits'
import { channelPairs, overlap, splitOf, videoPairs, type CandRecord, type CreatorFile, type Pair } from '../../shared/learnData'
import { PAIR_WEIGHT } from '../../shared/learnData'
import { writeFileAtomic } from '../shortme/atomic'
import { loadMeta, projectFile, projectsRoot } from '../shortme/project'
import { loadClips } from '../shortme/clips/analysis'
import { loadEvents, MARK } from '../shortme/clips/audioEvents'
import { loadHeat, heatStats } from '../shortme/clips/heat'
import { loadRatings } from '../shortme/clips/feedback'
import { loadTranscript } from '../shortme/transcription'
import { loadEdits } from '../shortme/edits'
import { loadCorrections, loadDeleted } from '../shortme/corrections'
import type { CandTrace } from '../shortme/clips/select'
import { collecting, datasetDir, readJson } from './store'
import { loadCatalog } from './catalog'
import { remoteCandidates, videoKey } from '../../shared/catalog'

const yieldTurn = (): Promise<void> => new Promise((r) => setImmediate(r))
const jsonl = (rows: unknown[]): string => rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : '')

/** Geteilte Zuordnung Video → Training/Test: einmal vergeben, danach nie mehr geändert (dataset/split.json). */
async function loadSplit(vids: string[]): Promise<Record<string, 'train' | 'test'>> {
  const file = join(datasetDir(), 'split.json')
  const sp = await readJson<Record<string, 'train' | 'test'>>(file, {})
  let dirty = false
  for (const v of vids) if (!sp[v]) { sp[v] = splitOf(v); dirty = true }
  if (dirty) await writeFileAtomic(file, JSON.stringify(sp, null, 1))
  return sp
}

const textIn = (words: Array<{ w: string; start: number; end: number }>, a: number, b: number, skip?: Set<number>): string =>
  words.filter((w, i) => w.start >= a - 0.02 && w.end <= b + 0.02 && !skip?.has(i)).map((w) => w.w).join(' ')

/** Alle Datensätze eines Projekts (Shortme-Kandidaten, Creator-/Referenz-Momente) plus Video-Zeile im Rhapsody-Format. */
export async function projectRecords(hash: string, split: 'train' | 'test'): Promise<{ video: Record<string, unknown>; cands: CandRecord[] } | null> {
  const [meta, clipsFile, tr] = await Promise.all([loadMeta(hash), loadClips(hash), loadTranscript(hash)])
  if (!meta || !tr) return null
  const [heat, events, ratings, corr, trace, creator, trend] = await Promise.all([
    loadHeat(hash), loadEvents(hash), loadRatings(hash), loadCorrections(hash),
    readJson<CandTrace[]>(projectFile(hash, 'candidates.json'), []), readJson<CreatorFile | null>(projectFile(hash, 'creator.json'), null), readJson<unknown>(projectFile(hash, 'trend.json'), null)
  ])
  const words = tr.words
  const marks = (a: number, b: number): string[] => {
    const n = new Map<string, number>()
    for (const e of events ?? []) if (e.start < b && e.end > a && e.kind !== 'pause') n.set(MARK[e.kind], (n.get(MARK[e.kind]) ?? 0) + 1)
    return [...n].map(([k, v]) => `${k}×${v}`)
  }
  const base = { vid: hash, contentType: meta.contentType ?? null, split }
  const h = (a: number, b: number): CandRecord['heat'] => { if (!heat) return null; const s = heatStats(heat, a, b); return { mean: +s.mean.toFixed(3), max: +s.peak.toFixed(3) } }
  const cands: CandRecord[] = []

  const gone = await loadDeleted(hash)
  for (const c of [...(clipsFile?.clips ?? []), ...gone.map((g) => g.clip)]) {
    const log = await loadEdits(hash, c.id)
    const st = stateOf(baseState(c), log)
    const cut = new Set(st.cutWords)
    const cutText: string[] = []
    for (const i of st.cutWords) if (words[i]) cutText.push(words[i].w)
    const changed = Math.abs(st.start - c.start) > 0.05 || Math.abs(st.end - c.end) > 0.05 || cutText.length > 0 || st.hook.text !== c.hookText || st.layoutOps.length + st.streamOps.length > 0
    const mine = corr.filter((e) => e.clipId === c.id)
    const rec: CandRecord = {
      ...base, id: `${hash}:${c.id}`, source: 'shortme', start: c.start, end: c.end, transcript: textIn(words, c.start, c.end), marks: marks(c.start, c.end),
      rubric: c.criteria, heat: h(c.start, c.end), rating: ratings[c.id] ? { level: ratings[c.id].level, reasons: ratings[c.id].reasons } : null,
      corrections: changed ? { startShift: +(st.start - c.start).toFixed(2), endShift: +(st.end - c.end).toFixed(2), cutText, hook: st.hook.text !== c.hookText ? { before: c.hookText, after: st.hook.text } : undefined, framing: st.layoutOps.length + st.streamOps.length > 0 } : null,
      exported: mine.some((e) => e.kind === 'export'), playedSec: mine.reduce((s, e) => s + (e.kind === 'played' ? e.sec : 0), 0), fate: gone.some((g) => g.clip.id === c.id) ? 'deleted' : 'selected'
    }
    cands.push(rec)
    // „Meine Version“ als eigener Kandidat, sobald Grenzen oder Inhalt wirklich geändert wurden
    if (Math.abs(st.start - c.start) >= 0.3 || Math.abs(st.end - c.end) >= 0.3 || cutText.length) {
      cands.push({ ...rec, id: `${rec.id}#mine`, start: st.start, end: st.end, transcript: textIn(words, st.start, st.end, cut), marks: marks(st.start, st.end), heat: h(st.start, st.end), rating: null, correctionOf: rec.id, fate: 'corrected' })
    }
  }
  // nicht gewählte Kandidaten aus der Auswahl-Spur (ältere Projekte haben keine)
  const chosen = cands.filter((x) => x.source === 'shortme')
  for (const t of trace) {
    if (t.fate === 'selected' || chosen.some((x) => overlap(x, t) > 0.5)) continue
    cands.push({ ...base, id: `${hash}:t${Math.round(t.start * 10)}`, source: 'shortme', start: t.start, end: t.end, transcript: textIn(words, t.start, t.end), marks: marks(t.start, t.end), rubric: t.criteria, heat: h(t.start, t.end), rating: null, corrections: null, exported: false, playedSec: 0, fate: t.fate })
  }
  for (const s of creator?.shorts ?? []) s.moments.forEach((m, i) => cands.push({
    ...base, id: `${hash}:${s.source}:${s.id}:${i}`, source: s.source, start: m.start, end: m.end, transcript: textIn(words, m.start, m.end), marks: marks(m.start, m.end), rubric: null, heat: h(m.start, m.end),
    rating: null, corrections: null, exported: false, playedSec: 0, creator: { channel: creator!.channel, views: s.views, likes: s.likes, comments: s.comments, date: s.date, ratio: s.ratio }
  }))
  // Rhapsody-Zeile: `vid`, `gt` (100 Bins 0..1 der Wiedergabe-Kurve), `title`, `metadata`, `transcript` (Segmente)
  const gt = heat ? Array.from({ length: 100 }, (_, i) => +heatStats(heat, (i * meta.durationSec) / 100, ((i + 1) * meta.durationSec) / 100).mean.toFixed(3)) : null
  const video = { vid: hash, title: meta.title, gt, metadata: { durationSec: meta.durationSec, contentType: meta.contentType ?? null, url: meta.sourceUrl ?? null, channel: creator?.channel ?? meta.twitch?.channel ?? null, split, ...(trend ? { trend } : {}) }, transcript: tr.segments.map((s) => ({ start: s.start, end: s.end, text: s.text })) }
  return { video, cands }
}

/** Blindtest-Urteile: dataset/blind.jsonl, je Zeile { winner, loser, vid } (Unentschieden werden nicht eingetragen). */
async function blindPairs(split: Record<string, 'train' | 'test'>): Promise<Pair[]> {
  try {
    const { readFile } = await import('node:fs/promises')
    return (await readFile(join(datasetDir(), 'blind.jsonl'), 'utf8')).split('\n').filter(Boolean).map((l) => JSON.parse(l) as { winner: string; loser: string; vid: string })
      .map((b) => ({ a: b.winner, b: b.loser, source: 'blind' as const, weight: PAIR_WEIGHT.blind, vid: b.vid, split: split[b.vid] ?? splitOf(b.vid) }))
  } catch { return [] }
}

export interface BuildInfo { at: string; videos: number; cands: number; pairs: number }
let running: Promise<BuildInfo> | null = null

/** Datensatz komplett neu aus den Projektdateien bauen (idempotent; trägt vorhandene Projekte nachträglich ein). Gibt zwischen den Projekten den Prozess frei. */
export function rebuildDataset(): Promise<BuildInfo> {
  return (running ??= (async () => {
    try {
      const dirs = await readdir(projectsRoot()).catch(() => [] as string[])
      const split = await loadSplit(dirs)
      const videos: unknown[] = []
      const cands: CandRecord[] = []
      const pairs: Pair[] = []
      const localVideos = new Set<string>()
      for (const d of dirs) {
        const r = await projectRecords(d, split[d] ?? splitOf(d)).catch((e) => { console.error('Datensatz', d, e); return null })
        await yieldTurn()
        if (!r) continue
        const m = await loadMeta(d)
        if (m) localVideos.add(videoKey({ hash: d, sourceUrl: m.sourceUrl, twitch: m.twitch }))
        videos.push(r.video); cands.push(...r.cands); pairs.push(...videoPairs(r.cands))
      }
      // Bewertungen anderer Rechner (Katalog über GitHub) zu Videos, die es hier nicht gibt: zählen in Lernbereich und Paare mit
      const remote = remoteCandidates(await loadCatalog(), localVideos)
      const byVideo = new Map<string, CandRecord[]>()
      for (const c of remote) byVideo.set(c.vid, [...(byVideo.get(c.vid) ?? []), c])
      for (const list of byVideo.values()) pairs.push(...videoPairs(list))
      cands.push(...remote)
      pairs.push(...channelPairs(cands), ...(await blindPairs(split)))
      const dir = datasetDir()
      await writeFileAtomic(join(dir, 'videos.jsonl'), jsonl(videos))
      await writeFileAtomic(join(dir, 'candidates.jsonl'), jsonl(cands))
      await writeFileAtomic(join(dir, 'pairs.jsonl'), jsonl(pairs))
      return { at: new Date().toISOString(), videos: videos.length, cands: cands.length, pairs: pairs.length }
    } finally { running = null }
  })())
}

let timer: ReturnType<typeof setTimeout> | null = null
let busy: () => boolean = () => false
/** Nach Änderungen verzögert neu bauen; solange Jobs laufen (Transkription, Analyse, Export, Werkbank), wird weiter gewartet. */
export function setBusyProbe(fn: () => boolean): void { busy = fn }
export function scheduleRebuild(delayMs = 30_000): void {
  if (timer) clearTimeout(timer)
  timer = setTimeout(async () => {
    timer = null
    if (!(await collecting())) return
    if (busy()) return scheduleRebuild(60_000)
    await rebuildDataset().catch((e) => console.error('Datensatz:', e))
  }, delayMs)
  timer.unref?.()
}
