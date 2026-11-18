// Mac-Engine – Ton-Ereignisse mit Apple SoundAnalysis (SNClassifySoundRequest .version1, 303 Klassen) über die ganze Tonspur.
// Der Swift-Helfer (native/mac-worker) liefert je Fenster die Klassen-Konfidenzen; hier entstehen daraus Ereignisse mit Hysterese
// (Start ≥ ON, Ende < OFF, Lücken ≤ GAP verbunden). Lachen ≠ lustig: das Ergebnis ist ein Ton-Signal, kein Urteil.
import { execFile } from 'node:child_process'
import { join } from 'node:path'
import { app } from 'electron'
import type { Evidence, EventKind, RawProposal } from '../../../../../shared/engineV2'

export interface SoundWindow { t: number; d: number; c: Record<string, number> }
export type SoundGroup = 'laugh' | 'cheer' | 'shout' | 'gasp' | 'music'
export interface SoundEvent { group: SoundGroup; start: number; end: number; peak: number; labels: string[] }

/** Klassen je Gruppe (Namen aus `shortme-mac-worker labels`). Musik/Gesang nur für „Sprache unsicher“, nicht als Clip-Vorschlag. */
export const SOUND_GROUPS: Record<SoundGroup, string[]> = {
  laugh: ['laughter', 'belly_laugh', 'chuckle_chortle', 'giggle', 'snicker', 'baby_laughter'],
  cheer: ['cheering', 'applause', 'crowd', 'clapping'],
  shout: ['shout', 'screaming', 'yell', 'children_shouting'],
  gasp: ['gasp'],
  music: ['music', 'singing', 'choir_singing', 'rapping', 'humming']
}
const KIND: Record<Exclude<SoundGroup, 'music'>, { kind: EventKind; de: string }> = {
  laugh: { kind: 'witz', de: 'Lachen im Ton' },
  cheer: { kind: 'reaktion', de: 'Jubel/Applaus im Ton' },
  shout: { kind: 'reaktion', de: 'Rufen/Schreien im Ton' },
  gasp: { kind: 'reaktion', de: 'Aufkeuchen im Ton' }
}

export const SOUND_REVISION = 'apple-sound-v1 (version1, win 1.5 s, overlap 0.5, on 0.5/off 0.3/gap 1.0)'

/** Hysterese je Gruppe: Ereignis beginnt bei Gruppen-Konfidenz ≥ on, läuft bis < off; Lücken ≤ gap werden verbunden. */
export function soundEvents(wins: SoundWindow[], o: { on?: number; off?: number; gap?: number } = {}): SoundEvent[] {
  const on = o.on ?? 0.5, off = o.off ?? 0.3, gap = o.gap ?? 1
  const out: SoundEvent[] = []
  const sorted = [...wins].filter((w) => Number.isFinite(w.t) && Number.isFinite(w.d) && w.d > 0).sort((a, b) => a.t - b.t)
  for (const group of Object.keys(SOUND_GROUPS) as SoundGroup[]) {
    let cur: SoundEvent | null = null
    for (const w of sorted) {
      let best = 0, label = ''
      for (const l of SOUND_GROUPS[group]) { const v = w.c[l] ?? 0; if (v > best) { best = v; label = l } }
      if (cur && best >= off) { cur.end = Math.max(cur.end, w.t + w.d); cur.peak = Math.max(cur.peak, best); if (!cur.labels.includes(label)) cur.labels.push(label); continue }
      if (cur) { out.push(cur); cur = null }
      if (best >= on) cur = { group, start: w.t, end: w.t + w.d, peak: best, labels: [label] }
    }
    if (cur) out.push(cur)
  }
  // Lücken ≤ gap innerhalb derselben Gruppe verbinden
  const merged: SoundEvent[] = []
  for (const e of out.sort((a, b) => (a.group === b.group ? a.start - b.start : a.group.localeCompare(b.group)))) {
    const last = merged[merged.length - 1]
    if (last && last.group === e.group && e.start - last.end <= gap) { last.end = Math.max(last.end, e.end); last.peak = Math.max(last.peak, e.peak); for (const l of e.labels) if (!last.labels.includes(l)) last.labels.push(l) }
    else merged.push({ ...e, labels: [...e.labels] })
  }
  return merged.map((e) => ({ ...e, start: r2(e.start), end: r2(e.end), peak: r2(e.peak) }))
}
const r2 = (x: number): number => Math.round(x * 100) / 100

/** Clip-Vorschläge (ohne Musik) mit Belegen; Fenster um das Ereignis: Vorlauf für den Auslöser, Nachlauf für die Reaktion. */
export function soundProposals(events: SoundEvent[], duration: number, max: number): { proposals: RawProposal[]; evidence: Evidence[] } {
  const proposals: RawProposal[] = [], evidence: Evidence[] = []
  const strong = events.filter((e) => e.group !== 'music').sort((a, b) => b.peak * Math.min(3, b.end - b.start) - a.peak * Math.min(3, a.end - a.start)).slice(0, max)
  strong.forEach((e, i) => {
    const g = e.group as Exclude<SoundGroup, 'music'>
    const id = `as${i + 1}`
    evidence.push({ id, modality: 'audio', state: 'signal-only', source: 'apple-soundanalysis', start: e.start, end: e.end, observation: `${KIND[g].de} (${e.labels.join(', ')}, max ${e.peak.toFixed(2)})`, modelRev: SOUND_REVISION, uncertainty: 'Ton-Klassifikation, nicht angesehen; Lachen heißt nicht automatisch lustig' })
    proposals.push({ start: Math.max(0, e.start - 14), end: Math.min(duration, e.end + 6), anchor: e.start, source: 'audio', kind: KIND[g].kind, summary: KIND[g].de, strength: e.peak, evidenceIds: [id] })
  })
  return { proposals, evidence }
}

/** 60-s-Fenster, in denen Musik/Gesang überwiegt (ASR-Wörter dort unsicher; gleiche Rolle wie speechUncertainWindows mit YAMNet). */
export function musicWindows(wins: SoundWindow[], duration: number, threshold = 0.5): Array<{ start: number; end: number; share: number }> {
  const out: Array<{ start: number; end: number; share: number }> = []
  for (let s = 0; s < duration; s += 60) {
    const inWin = wins.filter((w) => w.t >= s && w.t < s + 60)
    if (!inWin.length) continue
    const hit = inWin.filter((w) => SOUND_GROUPS.music.some((l) => (w.c[l] ?? 0) >= 0.5) && (w.c.speech ?? 0) < 0.5).length
    const share = hit / inWin.length
    if (share > threshold) out.push({ start: s, end: Math.min(duration, s + 60), share: r2(share) })
  }
  return out
}

/** Pfad zum Swift-Helfer (Paket: Resources/bin, Entwicklung: SwiftPM-Ausgabe). */
export function macWorkerExe(): string {
  if (app?.isPackaged) return join(process.resourcesPath, 'bin', 'shortme-mac-worker')
  return join(process.cwd(), 'native', 'mac-worker', '.build', 'release', 'shortme-mac-worker')
}

function runWorker(args: string[], signal?: AbortSignal, timeoutMs = 600_000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(macWorkerExe(), args, { maxBuffer: 256 * 1024 * 1024, timeout: timeoutMs, signal }, (err, stdout, stderr) => {
      if (err) reject(new Error(`shortme-mac-worker ${args[0]}: ${(stderr || err.message).trim().slice(0, 300)}`))
      else resolve(stdout)
    })
  })
}

/** Ganze Tonspur klassifizieren (gemessen: 17,5 min in 4,3 s, 47 MB RAM auf M1 Pro). */
export async function analyzeSound(wav: string, signal?: AbortSignal): Promise<SoundWindow[]> {
  const out = await runWorker(['sound-events', wav, '1.5', '0.5'], signal)
  return out.split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l) as SoundWindow)
}

export interface MacProbe { physicalMemoryBytes: number; availableMemoryBytes?: number; swapUsedBytes?: number; metalName?: string; metalRecommendedWorkingSetBytes?: number; memoryPressure: 'normal' | 'warn' | 'critical' | 'unknown'; thermalState: string; lowPowerMode: boolean; cpuCount: number; performanceCores?: number; modelIdentifier?: string; osVersion: string }
export async function probeMac(): Promise<MacProbe> {
  return JSON.parse(await runWorker(['probe'], undefined, 15_000)) as MacProbe
}
