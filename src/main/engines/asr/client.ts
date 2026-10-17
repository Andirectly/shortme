import { fork } from 'node:child_process'
import { existsSync } from 'node:fs'
import { basename, join } from 'node:path'
import { assetDir } from '../paths'
import { track, killTree } from '../sidecars'
import type { AsrMessage, AsrSegment } from './protocol'

export interface AsrResult { segments: AsrSegment[]; loadMs: number; decodeMs: number; audioSec: number }

const workerPath = (): string => {
  // Build: out/main/asrWorker.js (Code kann in out/main/chunks/ liegen); Entwicklung/Tests: worker.ts neben dieser Datei.
  const compiled = [join(__dirname, 'asrWorker.js'), join(__dirname, '..', 'asrWorker.js')].find((p) => existsSync(p))
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

/** Transkribiert eine 16-kHz-Mono-WAV mit Parakeet in einem Kindprozess; Prozessende = ASR entladen. */
export function transcribeWav(wav: string, opts: { maxSeconds?: number; signal?: AbortSignal; onProgress?: (done: number, total: number) => void } = {}): Promise<AsrResult> {
  const child = fork(workerPath(), [], {
    execPath: nodeBinary(),
    execArgv: process.versions.electron ? [] : process.execArgv,
    stdio: ['ignore', 'ignore', 'pipe', 'ipc']
  })
  void track(child, 'asr-worker', basename(nodeBinary()))
  return new Promise((resolve, reject) => {
    let err = ''
    child.stderr?.on('data', (d) => (err = (err + d).slice(-800)))
    const abort = (): void => { if (child.pid) void killTree(child.pid); reject(new Error('Abgebrochen')) }
    opts.signal?.addEventListener('abort', abort, { once: true })
    child.on('message', (m: AsrMessage) => {
      if (m.type === 'progress') opts.onProgress?.(m.done, m.total)
      else if (m.type === 'result') resolve(m)
      else reject(new Error(m.message))
    })
    child.once('exit', (code) => reject(new Error(`ASR-Prozess beendet (Code ${code}) ${err}`)))
    child.send({ modelDir: join(assetDir('parakeet-v3'), 'sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8'), vadModel: join(assetDir('silero-vad'), 'silero_vad.onnx'), wav, maxSeconds: opts.maxSeconds })
  })
}
