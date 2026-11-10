import { fork, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { basename, join } from 'node:path'
import { assetDir } from '../paths'
import { track, killTree } from '../sidecars'
import type { AsrMessage, AsrRequest, AsrSegment, Range, SpeakerTurn, VadParams } from './protocol'

export interface AsrResult { segments: AsrSegment[]; loadMs: number; decodeMs: number; audioSec: number }

const workerPath = (): string => {
  // Build: out/main/asrWorker.js (Code kann in out/main/chunks/ liegen); Entwicklung/Tests: worker.ts neben dieser Datei.
  const candidates = [join(__dirname, 'asrWorker.js'), join(__dirname, '..', 'asrWorker.js')].map((p) => p.replace('app.asar', 'app.asar.unpacked'))
  const compiled = candidates.find((p) => existsSync(p))
  // Paketiert liegt der Worker in app.asar.unpacked (eine fremde Node-Laufzeit kann kein asar lesen).
  return compiled ?? join(__dirname, 'worker.ts')
}

/**
 * sherpa-onnx-node nutzt externe Buffer, die Electrons V8 verbietet → ASR läuft in einer echten Node-Laufzeit
 * (Asset 'node-runtime'); außerhalb von Electron (Tests/Skripte) genügt das laufende Node.
 */
function nodeBinary(): string {
  if (!process.versions.electron) return process.execPath
  const exe = join(assetDir('node-runtime'), 'node-v22.23.3-win-x64', 'node.exe')
  if (!existsSync(exe)) throw new Error('Node-Laufzeit fehlt – bitte im Modell-Manager installieren')
  return exe
}

/** Startet den Worker mit einer Anfrage; `onMessage` sieht alle Nachrichten, Rückgabe = erste Endnachricht. */
function runWorker(req: AsrRequest, onMessage: (m: AsrMessage) => void, signal?: AbortSignal): Promise<AsrMessage> {
  signal?.throwIfAborted()
  // Ohne Modelldateien meldet sherpa nur „Please check your config!“
  if ('modelDir' in req && !existsSync(join(req.modelDir, 'encoder.int8.onnx'))) return Promise.reject(new Error('Transkriptionsmodell fehlt: Einstellungen → Modelle → „Alles laden“.'))
  const child: ChildProcess = fork(workerPath(), [], {
    execPath: nodeBinary(),
    execArgv: process.versions.electron ? [] : process.execArgv,
    stdio: ['ignore', 'ignore', 'pipe', 'ipc']
  })
  void track(child, 'asr-worker', basename(nodeBinary()))
  return new Promise((resolve, reject) => {
    let err = ''
    let settled = false
    const finish = (fn: () => void): void => {
      if (settled) return
      settled = true
      signal?.removeEventListener('abort', abort)
      if (child.pid && child.exitCode === null) void killTree(child.pid)
      fn()
    }
    const abort = (): void => finish(() => reject(new Error('Abgebrochen')))
    child.stderr?.on('data', (d) => (err = (err + d).slice(-800)))
    signal?.addEventListener('abort', abort, { once: true })
    child.on('message', (m: AsrMessage) => {
      onMessage(m)
      if (m.type === 'result' || m.type === 'turns' || m.type === 'gaps') finish(() => resolve(m))
      else if (m.type === 'error') finish(() => reject(new Error(m.message)))
    })
    child.once('exit', (code) => finish(() => reject(new Error(`ASR-Prozess beendet (Code ${code}) ${err}`))))
    child.send(req)
  })
}

export interface TranscribeOpts {
  maxSeconds?: number
  /** VAD-Parameter (Standard: VAD_DEFAULTS). */
  vad?: VadParams
  /** Ab dieser Sekunde fortsetzen (Checkpoint). */
  resumeFrom?: number
  signal?: AbortSignal
  onProgress?: (done: number, total: number) => void
  /** Jedes fertige Segment (zum sofortigen Speichern). */
  onSegment?: (s: AsrSegment) => void
}

/** Transkribiert eine 16-kHz-Mono-WAV mit Parakeet; Prozessende = ASR entladen. */
export async function transcribeWav(wav: string, opts: TranscribeOpts = {}): Promise<AsrResult> {
  const segments: AsrSegment[] = []
  const end = await runWorker(
    { mode: 'asr', modelDir: join(assetDir('parakeet-v3'), 'sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8'), vadModel: join(assetDir('silero-vad'), 'silero_vad.onnx'), wav, maxSeconds: opts.maxSeconds, vad: opts.vad, resumeFrom: opts.resumeFrom },
    (m) => {
      if (m.type === 'progress') opts.onProgress?.(m.done, m.total)
      else if (m.type === 'segment') { segments.push(m.segment); opts.onSegment?.(m.segment) }
    },
    opts.signal
  )
  if (end.type !== 'result') throw new Error('Unerwartete Antwort des ASR-Prozesses')
  return { segments, loadMs: end.loadMs, decodeMs: end.decodeMs, audioSec: end.audioSec }
}

export interface GapResult { found: Range[]; segments: AsrSegment[]; scanMs: number; decodeMs: number }

/** Lückensuche + Nachtranskription (siehe protocol.ts, mode 'gaps'); `wordSpans` = [Start, Ende] der vorhandenen Wörter. */
export async function fillGaps(wav: string, wordSpans: Range[], opts: { signal?: AbortSignal; minGap?: number; margin?: number; ranges?: Range[] } = {}): Promise<GapResult> {
  const segments: AsrSegment[] = []
  const end = await runWorker(
    { mode: 'gaps', modelDir: join(assetDir('parakeet-v3'), 'sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8'), vadModel: join(assetDir('silero-vad'), 'silero_vad.onnx'), wav, words: wordSpans, minGap: opts.minGap, margin: opts.margin, ranges: opts.ranges },
    (m) => { if (m.type === 'segment') segments.push(m.segment) },
    opts.signal
  )
  if (end.type !== 'gaps') throw new Error('Unerwartete Antwort des ASR-Prozesses')
  return { found: end.found, segments, scanMs: end.scanMs, decodeMs: end.decodeMs }
}

/** Feste Bereiche ohne VAD-Vorfilter dekodieren (Testlab „zweiter Durchgang“). */
export async function transcribeRanges(wav: string, ranges: Range[], opts: { signal?: AbortSignal } = {}): Promise<AsrSegment[]> {
  const r = await fillGaps(wav, [], { signal: opts.signal, ranges })
  return r.segments
}

/** Sprecher-Segmentierung (pyannote 3.0 + wespeaker); Ergebnis: Sprecher-Abschnitte. */
export async function diarizeWav(wav: string, opts: { numClusters?: number; threshold?: number; signal?: AbortSignal } = {}): Promise<SpeakerTurn[]> {
  const end = await runWorker(
    { mode: 'diarize', segModel: join(assetDir('speaker-segmentation'), 'sherpa-onnx-pyannote-segmentation-3-0', 'model.int8.onnx'), embModel: join(assetDir('speaker-embedding'), 'wespeaker_en_voxceleb_resnet34_LM.onnx'), wav, numClusters: opts.numClusters, threshold: opts.threshold },
    () => undefined,
    opts.signal
  )
  if (end.type !== 'turns') throw new Error('Unerwartete Antwort des ASR-Prozesses')
  return end.turns
}
