// Ton-Index der neuen Engine: YAMNet-Klassen zu Gruppen (Lachen, Jubel, Rufen, Gesang/Rap, Musik) als eigene, versionierte Zeitreihe.
// Das bisherige events.json (Legacy-Ereignisse) bleibt unberührt. Aus der Zeitreihe entstehen Vorschläge (Spitze, Dauer, Kontrast zum Umfeld);
// Hintergrundmusik allein und Alarmtöne gelten nie automatisch als starker Moment.
import { open, readFile } from 'node:fs/promises'
import { runInference } from '../../../../inference/client'
import { writeFileAtomic } from '../../../atomic'
import { projectFile } from '../../../project'
import { yamnetAvailable, yamnetPath } from '../../audioEvents'
import type { Evidence, RawProposal } from '../../../../../shared/engineV2'

/** Klassenindizes laut resources/yamnet/yamnet_class_map.csv (geprüft): Speech 0, Laughter 13, Shout 6, Whoop 8, Yell 9, Screaming 11, Singing 24, … */
export const GROUPS = {
  laugh: [13, 15, 16, 17, 18],
  cheer: [58, 61, 62, 64],
  shout: [6, 8, 9, 11],
  vocal: [24, 27, 31, 212, 213],
  music: [132]
} as const
export type Group = keyof typeof GROUPS
export const GROUP_NAMES = Object.keys(GROUPS) as Group[]
export const AUDIO_INDEX_REV = 'yamnet-groups-1'
const HOP = 0.48
const CHUNK_SEC = 120

export interface AudioSeries { rev: string; hop: number; frames: number; groups: Record<Group, string> }
const q = (v: number): number => Math.max(0, Math.min(255, Math.round(v * 255)))

/** Rohscores (frames × 521) einer Teilstrecke → Gruppenwerte je Frame (Maximum der Klassen der Gruppe). */
export function groupFrames(scores: Float32Array, frames: number): Record<Group, Uint8Array> {
  const out = {} as Record<Group, Uint8Array>
  for (const g of GROUP_NAMES) {
    const v = new Uint8Array(frames)
    for (let t = 0; t < frames; t++) { let m = 0; for (const c of GROUPS[g]) m = Math.max(m, scores[t * 521 + c]); v[t] = q(m) }
    out[g] = v
  }
  return out
}

const b64 = (u: Uint8Array): string => Buffer.from(u).toString('base64')
export const decodeSeries = (s: AudioSeries): Record<Group, Uint8Array> => Object.fromEntries(GROUP_NAMES.map((g) => [g, new Uint8Array(Buffer.from(s.groups[g], 'base64'))])) as Record<Group, Uint8Array>

const seriesFile = (hash: string): string => projectFile(hash, 'analysis/audio-v2.json')

export async function loadSeries(hash: string): Promise<AudioSeries | null> {
  try { const s = JSON.parse(await readFile(seriesFile(hash), 'utf8')) as AudioSeries; return s.rev === AUDIO_INDEX_REV && s.hop === HOP ? s : null } catch { return null }
}

/** Zeitreihe berechnen (oder aus dem versionierten Cache lesen). null = YAMNet nicht installiert (Ton-Signale fehlen, das ist kein „kein Signal“). */
export async function ensureSeries(hash: string, wavPath: string, signal?: AbortSignal, onProgress?: (f: number) => void): Promise<{ series: AudioSeries | null; cached: boolean }> {
  const hit = await loadSeries(hash)
  if (hit) return { series: hit, cached: true }
  if (!yamnetAvailable()) return { series: null, cached: false }
  const fh = await open(wavPath, 'r')
  try {
    const size = (await fh.stat()).size
    const total = Math.floor((size - 44) / 2)
    const parts: Array<Record<Group, Uint8Array>> = []
    for (let off = 0; off < total; off += CHUNK_SEC * 16000) {
      signal?.throwIfAborted()
      const n = Math.min(CHUNK_SEC * 16000, total - off)
      if (n < 16000) break
      const buf = Buffer.alloc(n * 2)
      await fh.read(buf, 0, n * 2, 44 + off * 2)
      const wave = new Float32Array(n)
      for (let i = 0; i < n; i++) wave[i] = buf.readInt16LE(i * 2) / 32768
      const out = await runInference(yamnetPath(), { waveform: { data: wave, dims: [n] } }, signal)
      parts.push(groupFrames(out.output_0.data as Float32Array, out.output_0.dims[0]))
      onProgress?.(Math.min(1, (off + n) / total))
    }
    const frames = parts.reduce((a, p) => a + p.laugh.length, 0)
    const groups = {} as Record<Group, string>
    for (const g of GROUP_NAMES) { const all = new Uint8Array(frames); let o = 0; for (const p of parts) { all.set(p[g], o); o += p[g].length } groups[g] = b64(all) }
    const series: AudioSeries = { rev: AUDIO_INDEX_REV, hop: HOP, frames, groups }
    await writeFileAtomic(seriesFile(hash), JSON.stringify(series))
    return { series, cached: false }
  } finally { await fh.close() }
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// Zeitreihe → Vorschläge (reine Logik)

const FLOOR: Record<Group, number> = { laugh: 0.35, cheer: 0.35, shout: 0.4, vocal: 0.3, music: 0.5 }
const MIN_SEC: Record<Group, number> = { laugh: 0.9, cheer: 1.4, shout: 0.9, vocal: 4, music: 8 }
const LABEL: Record<Group, string> = { laugh: 'Lachen', cheer: 'Jubel/Applaus', shout: 'Rufen/Schreien', vocal: 'Gesang/Rap/Sprechgesang', music: 'Musik' }

const smooth = (v: Uint8Array): Float32Array => { const o = new Float32Array(v.length); for (let i = 0; i < v.length; i++) o[i] = ((v[Math.max(0, i - 1)] + v[i] + v[Math.min(v.length - 1, i + 1)]) / 3) / 255; return o }
const quantile = (v: Float32Array, p: number): number => { const s = Float32Array.from(v).sort(); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : 0 }
const median = (v: Float32Array, a: number, b: number): number => { const s = Array.from(v.slice(Math.max(0, a), Math.min(v.length, b))).sort((x, y) => x - y); return s.length ? s[s.length >> 1] : 0 }

export interface AudioPeak { group: Group; start: number; end: number; anchor: number; peak: number; mean: number; contrast: number }

/** Zusammenhängende Abschnitte je Gruppe über Schwelle (absolut und relativ zur eigenen Verteilung), mit Kontrast zum Umfeld (±90 s Median). */
export function audioPeaks(series: Record<Group, Uint8Array>): AudioPeak[] {
  const out: AudioPeak[] = []
  for (const g of GROUP_NAMES) {
    const v = smooth(series[g])
    const thr = Math.max(FLOOR[g], quantile(v, 0.97))
    let t = 0
    while (t < v.length) {
      if (v[t] < thr) { t++; continue }
      let e = t, gap = 0, sum = v[t], n = 1, best = t
      for (let k = t + 1; k < v.length; k++) {
        if (v[k] >= thr) { e = k; gap = 0; sum += v[k]; n++; if (v[k] > v[best]) best = k } else if (++gap > (g === 'vocal' ? 12 : 2)) break
      }
      const start = t * HOP, end = (e + 2) * HOP
      if (end - start >= MIN_SEC[g]) out.push({ group: g, start, end, anchor: best * HOP, peak: v[best], mean: sum / n, contrast: v[best] - median(v, t - 190, e + 190) })
      t = e + 1
    }
  }
  return out
}

/** Peaks → Rohvorschläge + Signal-Belege. Musik allein nur bei starkem Kontrast zum Umfeld, mit niedriger Stärke; Gesang/Rap bekommt Vorrang. */
export function audioProposals(series: Record<Group, Uint8Array>, durationSec: number, maxTotal = Math.max(10, Math.round(durationSec / 90))): { proposals: RawProposal[]; evidence: Evidence[] } {
  const peaks = audioPeaks(series).filter((p) => p.group !== 'music' || (p.contrast >= 0.35 && p.mean >= 0.55))
  const strength = (p: AudioPeak): number => Math.min(1, 0.55 * p.peak + 0.45 * Math.max(0, p.contrast) + (p.group === 'vocal' ? 0.1 : 0) - (p.group === 'music' ? 0.25 : 0))
  const ranked = peaks.map((p) => ({ p, s: strength(p) })).sort((a, b) => b.s - a.s)
  // Jede Gruppe behält mindestens einen Anteil, damit seltene Gruppen (Gesang) nicht von häufigem Lachen verdrängt werden.
  const chosen = new Set<(typeof ranked)[number]>()
  for (const g of GROUP_NAMES) ranked.filter((r) => r.p.group === g).slice(0, Math.max(2, Math.floor(maxTotal / 6))).forEach((r) => chosen.add(r))
  for (const r of ranked) { if (chosen.size >= maxTotal) break; chosen.add(r) }
  const proposals: RawProposal[] = []
  const evidence: Evidence[] = []
  let n = 0
  for (const { p, s } of [...chosen].sort((a, b) => a.p.start - b.p.start)) {
    const id = `ya${++n}`
    const lead = p.group === 'vocal' ? 8 : 14
    let start = Math.max(0, p.start - lead), end = Math.min(durationSec, p.end + 8)
    if (end - start < 20) { start = Math.max(0, Math.min(start, durationSec - 20)); end = Math.min(durationSec, start + 20) }
    evidence.push({ id, modality: 'audio', state: 'signal-only', source: 'yamnet', start: p.start, end: p.end, observation: `${LABEL[p.group]} (Signal, Spitze ${p.peak.toFixed(2)}, Kontrast ${p.contrast.toFixed(2)}, ${(p.end - p.start).toFixed(0)} s)`, modelRev: AUDIO_INDEX_REV, uncertainty: 'nur Klassifikator-Signal, nicht angehört' })
    proposals.push({ start, end, anchor: p.anchor, source: 'audio', kind: p.group === 'vocal' || p.group === 'music' ? 'performance' : 'reaktion', summary: `${LABEL[p.group]} im Ton`, strength: s, evidenceIds: [id] })
  }
  return { proposals, evidence }
}
