import { createWriteStream, existsSync } from 'node:fs'
import { readFile, rename, rm, writeFile } from 'node:fs/promises'
import { once } from 'node:events'
import { runFfmpeg } from '../pipeline/ffmpeg'
import { diarizeWav, fillGaps, transcribeWav } from '../engines/asr/client'
import { assignSpeakers, newWordsOnly, type AsrSegment, type AsrWord, type Range, type SpeakerTurn } from '../engines/asr/protocol'
import { withAsr } from '../engines'
import { markStage, projectFile, type ProjectMeta } from './project'
import { writeFileAtomic } from './atomic'

export const TRANSCRIPT_VERSION = 1

export interface TranscriptSegment { start: number; end: number; text: string; first: number; last: number }
export interface Transcript {
  version: number
  hash: string
  model: 'parakeet-v3'
  durationSec: number
  words: AsrWord[]
  segments: TranscriptSegment[]
  /** Sprach-Intervalle laut VAD (Silero) – Grundlage für Grenzen und Pausenschnitte. */
  speech: Array<[number, number]>
  diarized: boolean
  speakers: number
  gaps?: GapReport
}

/** Bericht der Lückensuche (Sprache hörbar, aber keine Wörter): gefundene und gefüllte Lücken. */
export interface GapReport { found: number; filled: number; foundSec: number; wordsAdded: number; ranges: Range[] }

export type Stage = 'audio' | 'asr' | 'gaps' | 'speakers' | 'finalize'
export interface Progress { stage: Stage; fraction: number; message: string }

export interface TranscribeOptions { diarize?: boolean; signal?: AbortSignal; onProgress?: (p: Progress) => void }

const ASR_JSONL = 'asr.jsonl'

/** Cache: fertiges Transkript (passende Version, ggf. mit Sprechern) wird ohne Rechnen zurückgegeben. */
export async function loadTranscript(hash: string): Promise<Transcript | null> {
  try {
    const t = JSON.parse(await readFile(projectFile(hash, 'transcript.json'), 'utf8')) as Transcript
    return t.version === TRANSCRIPT_VERSION ? t : null
  } catch { return null }
}

/** Liest die Checkpoint-Zeilen; eine abgebrochene letzte Zeile wird verworfen. */
export async function readCheckpoint(hash: string): Promise<AsrSegment[]> {
  let text = ''
  try { text = await readFile(projectFile(hash, ASR_JSONL), 'utf8') } catch { return [] }
  const out: AsrSegment[] = []
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    try { out.push(JSON.parse(line) as AsrSegment) } catch { break }
  }
  return out
}

/** Reine Funktion: Segmente → Transkript-Struktur (Wortliste, Segment-Indizes, VAD-Intervalle). Wörter sind immer nach Zeit sortiert. */
export function buildTranscript(meta: Pick<ProjectMeta, 'hash' | 'durationSec'>, segments: AsrSegment[], turns: SpeakerTurn[] | null, gaps?: GapReport): Transcript {
  const sorted = [...segments].sort((a, b) => a.start - b.start)
  const tagged: Array<{ w: AsrWord; seg: number }> = []
  sorted.forEach((s, i) => { for (const w of s.words) tagged.push({ w: { ...w }, seg: i }) })
  // Nur bei verschachtelten Segmenten (Lücken-Funde innerhalb eines VAD-Segments) ist eine Umsortierung nötig
  const ordered = tagged.every((t, i) => i === 0 || t.w.start >= tagged[i - 1].w.start - 1e-6) ? tagged : [...tagged].sort((x, y) => x.w.start - y.w.start)
  const words = ordered.map((t) => t.w)
  const segs: TranscriptSegment[] = []
  for (let i = 0; i < ordered.length;) {
    let j = i
    while (j + 1 < ordered.length && ordered[j + 1].seg === ordered[i].seg) j++
    const src = sorted[ordered[i].seg]
    const whole = j - i + 1 === src.words.length
    segs.push({ start: whole ? src.start : words[i].start, end: whole ? src.end : words[j].end, text: whole ? src.text : words.slice(i, j + 1).map((w) => w.w).join(' '), first: i, last: j })
    i = j + 1
  }
  if (turns) assignSpeakers(words, turns)
  const speakers = turns ? new Set(words.map((w) => w.speaker)).size : 0
  return {
    version: TRANSCRIPT_VERSION, hash: meta.hash, model: 'parakeet-v3', durationSec: meta.durationSec, words, segments: segs,
    speech: sorted.map((s) => [s.start, s.end] as [number, number]), diarized: !!turns, speakers, ...(gaps ? { gaps } : {})
  }
}

/**
 * Lücken-Funde in die Segmentliste übernehmen: nur Wörter, die zeitlich nicht in ein vorhandenes Wort fallen. Reine Funktion.
 * Rückgabe: neue Segmente (mit `filled`) und der Bericht.
 */
export function mergeFilled(base: AsrSegment[], found: Range[], filled: AsrSegment[]): { segments: AsrSegment[]; report: GapReport } {
  const existing = base.flatMap((s) => s.words)
  const kept: AsrSegment[] = []
  let wordsAdded = 0
  const fillable = new Set<number>()
  for (const f of [...filled].sort((a, b) => a.start - b.start)) {
    const words = newWordsOnly(f.words, [...existing, ...kept.flatMap((k) => k.words)])
    if (!words.length) continue
    kept.push({ start: words[0].start, end: words[words.length - 1].end, text: words.map((w) => w.w).join(' '), words, filled: true })
    wordsAdded += words.length
    found.forEach(([a, b], i) => { if (words.some((w) => w.start >= a - 0.5 && w.end <= b + 0.5)) fillable.add(i) })
  }
  return { segments: kept, report: { found: found.length, filled: fillable.size, foundSec: +found.reduce((n, [a, b]) => n + b - a, 0).toFixed(1), wordsAdded, ranges: found.map(([a, b]) => [+a.toFixed(2), +b.toFixed(2)] as Range) } }
}

/** Audio (16 kHz mono WAV) extrahieren – Checkpoint `audio.wav`; nur mit Marker `audio.done` gültig. */
async function ensureAudio(meta: ProjectMeta, signal?: AbortSignal): Promise<string> {
  const wav = projectFile(meta.hash, 'audio.wav')
  if (existsSync(projectFile(meta.hash, 'audio.done')) && existsSync(wav)) return wav
  const tmp = `${wav}.part.wav`
  await rm(tmp, { force: true })
  await runFfmpeg(['-y', '-i', meta.sourcePath, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', tmp], { signal })
  await rm(wav, { force: true })
  await rename(tmp, wav)
  await writeFile(projectFile(meta.hash, 'audio.done'), '1')
  return wav
}

/**
 * Transkription mit Checkpoints: Audio → ASR (Segmente werden sofort in `asr.jsonl` angehängt, Fortsetzen ab dem
 * Ende des letzten Segments) → optional Sprecher → `transcript.json`. Zweiter Lauf = Cache.
 */
export async function runTranscription(meta: ProjectMeta, opts: TranscribeOptions = {}): Promise<Transcript> {
  const { signal } = opts
  const report = (stage: Stage, fraction: number, message: string): void => opts.onProgress?.({ stage, fraction, message })

  const cached = await loadTranscript(meta.hash)
  if (cached && (!opts.diarize || cached.diarized)) { report('finalize', 1, 'Aus dem Cache'); return cached }

  report('audio', 0, 'Audio wird vorbereitet …')
  const wav = await ensureAudio(meta, signal)
  report('audio', 1, 'Audio bereit')

  let segments = await readCheckpoint(meta.hash)
  if (!existsSync(projectFile(meta.hash, 'asr.done'))) {
    const resumeFrom = segments.length ? segments[segments.length - 1].end : 0
    // Datei neu schreiben, damit eine halbe letzte Zeile verschwindet, dann anhängen
    await writeFile(projectFile(meta.hash, ASR_JSONL), segments.map((s) => JSON.stringify(s) + '\n').join(''))
    const out = createWriteStream(projectFile(meta.hash, ASR_JSONL), { flags: 'a' })
    try {
      report('asr', resumeFrom / meta.durationSec, resumeFrom > 0 ? `Setzt bei ${Math.round(resumeFrom)} s fort …` : 'Transkribiert …')
      await withAsr(() => transcribeWav(wav, {
        signal,
        resumeFrom,
        onProgress: (done, total) => report('asr', done / total, 'Transkribiert …'),
        onSegment: (s) => { out.write(JSON.stringify(s) + '\n'); segments.push(s) }
      }))
    } finally {
      out.end()
      await once(out, 'close').catch(() => undefined)
    }
    await writeFile(projectFile(meta.hash, 'asr.done'), '1')
    await markStage(meta.hash, 'asr', true)
  }
  report('asr', 1, 'Transkription fertig')

  // Lücken: Sprache hörbar, aber keine Wörter → ohne VAD-Vorfilter nachtranskribieren (Checkpoint gaps.json + gaps.done)
  let gaps: GapReport | undefined
  const gapFile = projectFile(meta.hash, 'gaps.json')
  if (!existsSync(projectFile(meta.hash, 'gaps.done'))) {
    report('gaps', 0, 'Lücken im Transkript suchen …')
    try {
      const base = await readCheckpoint(meta.hash)
      const res = await withAsr(() => fillGaps(wav, base.flatMap((s) => s.words.map((w) => [w.start, w.end] as Range)), { signal }))
      const merged = mergeFilled(base, res.found, res.segments)
      if (merged.segments.length) await writeFile(projectFile(meta.hash, ASR_JSONL), [...base, ...merged.segments].map((s) => JSON.stringify(s) + '\n').join('')) // (Zeilenende wie im Checkpoint)
      await writeFileAtomic(gapFile, JSON.stringify(merged.report))
      await writeFile(projectFile(meta.hash, 'gaps.done'), '1')
      gaps = merged.report
    } catch (e) { if (signal?.aborted) throw e; console.error('Lückensuche fehlgeschlagen (Transkript bleibt wie es ist):', e) }
  } else { try { gaps = JSON.parse(await readFile(gapFile, 'utf8')) as GapReport } catch { gaps = undefined } }
  report('gaps', 1, gaps ? `${gaps.filled} von ${gaps.found} Lücken gefüllt` : 'Lückensuche übersprungen')

  let turns: SpeakerTurn[] | null = null
  if (opts.diarize) {
    const f = projectFile(meta.hash, 'speakers.json')
    if (existsSync(f)) turns = JSON.parse(await readFile(f, 'utf8')) as SpeakerTurn[]
    else {
      report('speakers', 0, 'Sprecher werden erkannt …')
      turns = await withAsr(() => diarizeWav(wav, { signal }))
      await writeFileAtomic(f, JSON.stringify(turns))
    }
    report('speakers', 1, 'Sprecher erkannt')
  }

  segments = await readCheckpoint(meta.hash)
  const transcript = buildTranscript(meta, segments, turns, gaps)
  await writeFileAtomic(projectFile(meta.hash, 'transcript.json'), JSON.stringify(transcript))
  await markStage(meta.hash, 'transcript', true)
  report('finalize', 1, 'Fertig')
  return transcript
}
