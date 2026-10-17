import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import type { ShortmeClip } from '@shared/shortme'
import { withLlm } from '../../engines'
import { assets } from '../../engines'
import { markStage, projectFile, type ProjectMeta } from '../project'
import { writeFileAtomic } from '../atomic'
import { loadTranscript } from '../transcription'
import { signalsFromWav, type Signals } from './signals'
import { detectShots } from './scenes'
import { selectClips } from './select'
import { makeThumbs } from './thumbs'

export interface AnalysisOptions {
  query?: string
  wanted?: number
  signal?: AbortSignal
  /** Erzwingt den Fallback ohne LLM (Tests / kein Modell). */
  noLlm?: boolean
  onProgress?: (stage: string, fraction: number, message: string) => void
}

export interface ClipsFile { version: 1; hash: string; query: string; createdAt: string; mode: 'llm' | 'texttiling'; clips: ShortmeClip[] }

export async function loadClips(hash: string): Promise<ClipsFile | null> {
  try { return JSON.parse(await readFile(projectFile(hash, 'clips.json'), 'utf8')) as ClipsFile } catch { return null }
}

async function cached<T>(hash: string, name: string, make: () => Promise<T>): Promise<T> {
  const f = projectFile(hash, name)
  if (existsSync(f)) { try { return JSON.parse(await readFile(f, 'utf8')) as T } catch { /* neu berechnen */ } }
  const v = await make()
  await writeFileAtomic(f, JSON.stringify(v))
  return v
}

/** Analyse-Signale (je Video normalisiert, gecacht) und Kamerawechsel (TransNetV2, gecacht). */
export async function ensureSignals(meta: ProjectMeta): Promise<Signals> {
  const t = await loadTranscript(meta.hash)
  if (!t) throw new Error('Transkript fehlt – erst transkribieren')
  return cached(meta.hash, 'signals.json', () => signalsFromWav(projectFile(meta.hash, 'audio.wav'), t.words, meta.durationSec))
}

export async function ensureShots(meta: ProjectMeta, signal?: AbortSignal, onProgress?: (f: number) => void): Promise<number[]> {
  if (!(await assets.isInstalled('transnetv2'))) return []
  return cached(meta.hash, 'shots.json', () => detectShots(meta.sourcePath, meta.durationSec, signal, onProgress))
}

/** Stufe „Analysieren + Clips finden“: Signale → Kamerawechsel → LLM-Auswahl (oder TextTiling) → clips.json. */
export async function runAnalysis(meta: ProjectMeta, opts: AnalysisOptions = {}): Promise<ClipsFile> {
  const report = opts.onProgress ?? (() => undefined)
  const t = await loadTranscript(meta.hash)
  if (!t) throw new Error('Transkript fehlt – erst transkribieren')
  report('signals', 0, 'Signale berechnen …')
  const signals = await ensureSignals(meta)
  report('shots', 0, 'Kamerawechsel erkennen …')
  const cuts = await ensureShots(meta, opts.signal, (f) => report('shots', f, 'Kamerawechsel erkennen …'))
  const input = { words: t.words, durationSec: meta.durationSec, signals, cuts }
  const sel = { query: opts.query, wanted: opts.wanted, signal: opts.signal, report }

  let mode: ClipsFile['mode'] = 'llm'
  let clips: ShortmeClip[]
  const llmReady = !opts.noLlm && (await assets.isInstalled('llama-server'))
  if (!llmReady) { mode = 'texttiling'; clips = await selectClips(input, { ...sel, baseUrl: null }) }
  else {
    try { clips = await withLlm((url) => selectClips(input, { ...sel, baseUrl: url })) } catch (e) {
      if (opts.signal?.aborted) throw e
      report('llm', 0, `KI nicht verfügbar (${e instanceof Error ? e.message.slice(0, 80) : e}) – Fallback`)
      mode = 'texttiling'
      clips = await selectClips(input, { ...sel, baseUrl: null })
    }
  }
  report('thumbs', 0, 'Vorschaubilder …')
  await makeThumbs(meta, clips, opts.signal).catch(() => undefined)
  const file: ClipsFile = { version: 1, hash: meta.hash, query: opts.query ?? '', createdAt: new Date().toISOString(), mode, clips }
  await writeFileAtomic(projectFile(meta.hash, 'clips.json'), JSON.stringify(file, null, 1))
  await markStage(meta.hash, 'clips', true)
  return file
}
