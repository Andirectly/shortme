// Läuft als eigener Prozess in echter Node-Laufzeit (Entladen = Prozess beenden → VRAM/RAM sicher frei).
import { join } from 'node:path'
import { tokensToWords, type AsrMessage, type AsrRequest, type AsrSegment } from './protocol'

const send = (m: AsrMessage): void => { process.send?.(m) }

function runAsr(req: Extract<AsrRequest, { mode: 'asr' }>): void {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const sherpa = require('sherpa-onnx-node')
  const t0 = Date.now()
  const wave = sherpa.readWave(req.wav)
  const sr: number = wave.sampleRate
  let samples: Float32Array = wave.samples
  if (req.maxSeconds) samples = samples.subarray(0, req.maxSeconds * sr)
  const offset = Math.floor((req.resumeFrom ?? 0) * sr)
  const rec = new sherpa.OfflineRecognizer({
    featConfig: { sampleRate: 16000, featureDim: 80 },
    modelConfig: {
      transducer: { encoder: join(req.modelDir, 'encoder.int8.onnx'), decoder: join(req.modelDir, 'decoder.int8.onnx'), joiner: join(req.modelDir, 'joiner.int8.onnx') },
      tokens: join(req.modelDir, 'tokens.txt'), modelType: 'nemo_transducer', numThreads: 4, provider: 'cpu'
    }
  })
  const vad = new sherpa.Vad(
    { sileroVad: { model: req.vadModel, threshold: 0.5, minSilenceDuration: 0.4, minSpeechDuration: 0.25, maxSpeechDuration: 20, windowSize: 512 }, sampleRate: sr, numThreads: 1, provider: 'cpu', debug: 0 },
    60
  )
  const loadMs = Date.now() - t0
  const decode = (seg: { start: number; samples: Float32Array }): void => {
    const stream = rec.createStream()
    stream.acceptWaveform({ samples: seg.samples, sampleRate: sr })
    rec.decode(stream)
    const r = rec.getResult(stream)
    const start = (seg.start + offset) / sr
    const end = start + seg.samples.length / sr
    const words = tokensToWords(r.tokens ?? [], (r.timestamps ?? []).map((t: number) => t + start), r.durations, end)
    // Auch leere Segmente melden: das Sprach-Intervall (VAD) wird für Pausenschnitte gebraucht.
    const segment: AsrSegment = { start, end, text: r.text.trim(), words }
    send({ type: 'segment', segment })
  }
  const drain = (): void => { while (!vad.isEmpty()) { decode(vad.front(false)); vad.pop() } }
  const t1 = Date.now()
  let lastReport = 0
  for (let i = offset; i + 512 <= samples.length; i += 512) {
    vad.acceptWaveform(samples.subarray(i, i + 512))
    drain()
    if (i - lastReport > sr * 5) { lastReport = i; send({ type: 'progress', done: i / sr, total: samples.length / sr }) }
  }
  vad.flush()
  drain()
  send({ type: 'result', loadMs, decodeMs: Date.now() - t1, audioSec: samples.length / sr })
}

function runDiarize(req: Extract<AsrRequest, { mode: 'diarize' }>): void {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const sherpa = require('sherpa-onnx-node')
  const t0 = Date.now()
  const wave = sherpa.readWave(req.wav)
  const sd = new sherpa.OfflineSpeakerDiarization({
    segmentation: { pyannote: { model: req.segModel }, numThreads: 2, provider: 'cpu' },
    embedding: { model: req.embModel, numThreads: 2, provider: 'cpu' },
    clustering: { numClusters: req.numClusters ?? -1, threshold: req.threshold ?? 0.6 },
    minDurationOn: 0.3,
    minDurationOff: 0.5
  })
  const turns = sd.process(wave.samples).map((s: { start: number; end: number; speaker: number }) => ({ start: s.start, end: s.end, speaker: s.speaker }))
  send({ type: 'turns', turns, ms: Date.now() - t0 })
}

process.once('message', (req: AsrRequest) => {
  try {
    if (req.mode === 'diarize') runDiarize(req)
    else runAsr(req)
  } catch (e) {
    send({ type: 'error', message: e instanceof Error ? e.message : String(e) })
  }
})
