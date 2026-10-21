// Testlab-Verfahren ohne Video: Platz „Clip-Transkription“ (Wörter) und Platz „Clip-Auswahl (LLM)“ (Clips mit Scores und Begründungen).
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rm } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { dataRoot } from '../engines/paths'
import { withAsr, withLlmModel } from '../engines'
import { transcribeRanges, transcribeWav } from '../engines/asr/client'
import { qwenMerged } from './qwenAsr'
import { runFfmpeg } from '../pipeline/ffmpeg'
import { writeFileAtomic } from '../shortme/atomic'
import { loadMeta } from '../shortme/project'
import { loadTranscript } from '../shortme/transcription'
import { ensureShots, ensureSignals } from '../shortme/clips/analysis'
import { loadEvents } from '../shortme/clips/audioEvents'
import { loadHeat } from '../shortme/clips/heat'
import { selectClips } from '../shortme/clips/select'
import { loadProfile } from '../shortme/profiles'
import { recordMeasured } from './registry'
import type { LabResult } from '../../shared/models'

const vramMb = (): number => { try { return Number(execFileSync('nvidia-smi', ['--query-gpu=memory.used', '--format=csv,noheader,nounits'], { encoding: 'utf8', windowsHide: true }).split('\n')[0]) } catch { return -1 } }

const empty = (model: string, slot: string, source: string, start: number, dur: number): LabResult => ({
  version: 1, model, slot, source, start, dur, runtimeSec: 0, vramPeakMb: -1, speechFaceShare: null, speechSec: 0, idSwitches: 0, context: '', hz: 1, tracks: [], active: [], shots: []
})

/** Modell-ID (Testlab) → Verfahren. */
export const CLIP_ASR_MODELS: Record<string, 'standard' | 'pass2' | 'qwen'> = { parakeet_v3_clip: 'standard', parakeet_pass2: 'pass2', qwen3_asr_17b: 'qwen' }
/** Modell-ID (Testlab) → Asset des Modell-Managers. */
export const LLM_ASSETS: Record<string, string> = { qwen3_14b: 'qwen3-14b', qwen3_8_27b_q4: 'qwen3-8-27b' }

const cacheFile = (kind: string, key: string): string => join(dataRoot(), 'testlab', `${kind}-${key}.json`)
const key = (...parts: Array<string | number>): string => createHash('sha1').update(parts.join('|') + '|v1').digest('hex').slice(0, 18)

async function cached(file: string): Promise<LabResult | null> { try { return JSON.parse(await readFile(file, 'utf8')) as LabResult } catch { return null } }

/** Clip-Transkription: dasselbe Stück Ton, links Parakeet wie in der Pipeline (VAD-Segmente), rechts zweiter Durchgang (zusammenhängend, ohne VAD). */
export async function runClipAsrSide(model: string, path: string, start: number, dur: number, onProgress: (m: string) => void): Promise<LabResult> {
  const mode = CLIP_ASR_MODELS[model]
  if (!mode) throw new Error('Für dieses Modell gibt es noch kein Testverfahren')
  await mkdir(join(dataRoot(), 'testlab'), { recursive: true })
  const file = cacheFile('clipasr', key(path, model, start, dur))
  const hit = await cached(file)
  if (hit) { onProgress('aus dem Zwischenspeicher'); return hit }
  onProgress('Ton ausschneiden …')
  const wav = join(dataRoot(), 'testlab', `clipasr-${key(path, start, dur)}.wav`)
  if (!existsSync(wav)) await runFfmpeg(['-y', '-ss', String(start), '-t', String(dur), '-i', path, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', wav])
  onProgress(mode === 'standard' ? 'Parakeet (VAD-Segmente) …' : mode === 'pass2' ? 'Parakeet, zweiter Durchgang (zusammenhängend) …' : 'Qwen3-ASR wird geladen und hört zu …')
  const base = vramMb()
  const t0 = Date.now()
  // Qwen3-ASR liefert nur Text (kein Python-Aligner): Wortzeiten kommen von Parakeet, Einfügungen bekommen geschätzte Zeiten
  const segments = mode === 'qwen' ? await qwenMerged(wav, dur) : await withAsr(() => (mode === 'standard' ? transcribeWav(wav).then((r) => r.segments) : transcribeRanges(wav, [[0, dur]])))
  const runtimeSec = (Date.now() - t0) / 1000
  const words = segments.flatMap((s) => s.words).sort((a, b) => a.start - b.start).map((w) => ({ w: w.w, start: +w.start.toFixed(2), end: +w.end.toFixed(2) }))
  const res: LabResult = { ...empty(model, 'clip_asr', basename(path), start, dur), runtimeSec: +runtimeSec.toFixed(1), vramPeakMb: base >= 0 ? Math.max(0, vramMb() - base) : -1, text: { words }, context: `${words.length} Wörter` }
  await writeFileAtomic(file, JSON.stringify(res))
  await recordMeasured(model, { runtimeSec: res.runtimeSec, vramPeakMb: res.vramPeakMb, speechFaceShare: null, clip: `Clip-Transkription ${Math.round(dur)} s · ${words.length} Wörter`, at: new Date().toISOString() })
  return res
}

/** Clip-Auswahl: dieselbe Quelle (Projekt mit Transkript), Abschnitt [start, start+dur] – nur das LLM wechselt. */
export async function runLlmSide(model: string, sourceId: string, start: number, dur: number, onProgress: (m: string) => void): Promise<LabResult> {
  const asset = LLM_ASSETS[model]
  if (!asset) throw new Error('Für dieses Modell gibt es noch kein Testverfahren')
  const hash = sourceId.startsWith('project:') ? sourceId.slice(8) : ''
  if (!hash) throw new Error('Für die Clip-Auswahl wird ein Projekt mit Transkript gebraucht (erst Video importieren und transkribieren).')
  const meta = await loadMeta(hash)
  if (!meta) throw new Error('Projekt nicht gefunden')
  const t = await loadTranscript(hash)
  if (!t) throw new Error('Das Projekt hat noch kein Transkript – erst „Clips finden“ starten.')
  const end = Math.min(meta.durationSec, start + dur)
  const file = cacheFile('llm', key(hash, model, start, dur))
  const hit = await cached(file)
  if (hit) { onProgress('aus dem Zwischenspeicher'); return hit }
  const words = t.words.filter((w) => w.start >= start && w.end <= end)
  if (words.length < 40) throw new Error('In diesem Abschnitt gibt es kaum Text – anderen Abschnitt wählen.')
  onProgress('Signale …')
  const signals = await ensureSignals(meta)
  const cuts = await ensureShots(meta)
  const events = await loadEvents(hash)
  const heat = await loadHeat(hash)
  const profile = await loadProfile(meta.contentType)
  const input = { words, durationSec: end, signals, cuts, heat, events, weights: profile.ranking }
  const wanted = Math.max(2, Math.round((end - start) / 150))
  onProgress(`Modell wird geladen und wählt Clips (${asset}) …`)
  const base = vramMb()
  let peak = base
  const poll = setInterval(() => { peak = Math.max(peak, vramMb()) }, 500)
  const t0 = Date.now()
  let clips
  try {
    clips = await withLlmModel(asset, (url) => selectClips(input, { baseUrl: url, wanted, query: profile.prompt || undefined, report: (_s, f, m) => onProgress(`${m} ${Math.round(f * 100)} %`), topicsCache: { load: async () => null, save: async () => undefined } }))
  } finally { clearInterval(poll) }
  if (clips.length && clips.every((c) => /^Heuristik/.test(c.reason))) throw new Error('Das Modell hat nicht geantwortet (Auswahl fiel auf die Heuristik zurück) – nichts gespeichert.')
  const runtimeSec = (Date.now() - t0) / 1000
  const res: LabResult = {
    ...empty(model, 'llm', basename(meta.sourcePath), start, end - start), runtimeSec: +runtimeSec.toFixed(1), vramPeakMb: base >= 0 ? Math.max(0, peak - base) : -1,
    context: `${wanted} gewünscht · ${words.length} Wörter`,
    clips: clips.map((c) => ({ title: c.title, score: c.score, reason: c.reason, start: +c.start.toFixed(1), end: +c.end.toFixed(1) })).sort((a, b) => b.score - a.score)
  }
  await writeFileAtomic(file, JSON.stringify(res))
  await recordMeasured(model, { runtimeSec: res.runtimeSec, vramPeakMb: res.vramPeakMb, speechFaceShare: null, clip: `Clip-Auswahl ${Math.round(end - start)} s Text · ${res.clips!.length} Clips`, at: new Date().toISOString() })
  return res
}

export const cleanClipAsrCache = async (path: string, start: number, dur: number): Promise<void> => { await rm(join(dataRoot(), 'testlab', `clipasr-${key(path, start, dur)}.wav`), { force: true }) }
