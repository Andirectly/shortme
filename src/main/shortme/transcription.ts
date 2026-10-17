import { createWriteStream, existsSync } from 'node:fs'
import { readFile, rename, rm, writeFile } from 'node:fs/promises'
import { once } from 'node:events'
import { runFfmpeg } from '../pipeline/ffmpeg'
import { diarizeWav, transcribeWav } from '../engines/asr/client'
import { assignSpeakers, type AsrSegment, type AsrWord, type SpeakerTurn } from '../engines/asr/protocol'
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
}

export type Stage = 'audio' | 'asr' | 'speakers' | 'finalize'
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

/** Reine Funktion: Segmente → Transkript-Struktur (Wortliste, Segment-Indizes, VAD-Intervalle). */
export function buildTranscript(meta: Pick<ProjectMeta, 'hash' | 'durationSec'>, segments: AsrSegment[], turns: SpeakerTurn[] | null): Transcript {
  const sorted = [...segments].sort((a, b) => a.start - b.start)
  const words: AsrWord[] = []
  const segs: TranscriptSegment[] = []
  for (const s of sorted) {
    if (s.words.length === 0) continue
    segs.push({ start: s.start, end: s.end, text: s.text, first: words.length, last: words.length + s.words.length - 1 })
    words.push(...s.words.map((w) => ({ ...w })))
  }
  if (turns) assignSpeakers(words, turns)
  const speakers = turns ? new Set(words.map((w) => w.speaker)).size : 0
  return {
    version: TRANSCRIPT_VERSION, hash: meta.hash, model: 'parakeet-v3', durationSec: meta.durationSec, words, segments: segs,
    speech: sorted.map((s) => [s.start, s.end] as [number, number]), diarized: !!turns, speakers
  }
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
  const transcript = buildTranscript(meta, segments, turns)
  await writeFileAtomic(projectFile(meta.hash, 'transcript.json'), JSON.stringify(transcript))
  await markStage(meta.hash, 'transcript', true)
  report('finalize', 1, 'Fertig')
  return transcript
}
