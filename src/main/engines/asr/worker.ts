// Läuft als eigener Prozess (Entladen = Prozess beenden → VRAM/RAM sicher frei).
import { join } from 'node:path'
import { tokensToWords, type AsrMessage, type AsrRequest, type AsrSegment } from './protocol'

const send = (m: AsrMessage): void => { process.send?.(m) }

process.once('message', (req: AsrRequest) => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const sherpa = require('sherpa-onnx-node')
    const t0 = Date.now()
    const wave = sherpa.readWave(req.wav)
    const sr: number = wave.sampleRate
    let samples: Float32Array = wave.samples
    if (req.maxSeconds) samples = samples.subarray(0, req.maxSeconds * sr)
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
    const segments: AsrSegment[] = []
    const decode = (seg: { start: number; samples: Float32Array }): void => {
      const stream = rec.createStream()
      stream.acceptWaveform({ samples: seg.samples, sampleRate: sr })
      rec.decode(stream)
      const r = rec.getResult(stream)
      const start = seg.start / sr
      const end = start + seg.samples.length / sr
      const words = tokensToWords(r.tokens ?? [], (r.timestamps ?? []).map((t: number) => t + start), r.durations, end)
      if (r.text.trim()) segments.push({ start, end, text: r.text.trim(), words })
    }
    const drain = (): void => { while (!vad.isEmpty()) { decode(vad.front(false)); vad.pop() } }
    const t1 = Date.now()
    let lastReport = 0
    for (let i = 0; i + 512 <= samples.length; i += 512) {
      vad.acceptWaveform(samples.subarray(i, i + 512))
      drain()
      if (i - lastReport > sr * 10) { lastReport = i; send({ type: 'progress', done: i / sr, total: samples.length / sr }) }
    }
    vad.flush()
    drain()
    send({ type: 'result', segments, loadMs, decodeMs: Date.now() - t1, audioSec: samples.length / sr })
  } catch (e) {
    send({ type: 'error', message: e instanceof Error ? e.message : String(e) })
  }
  setTimeout(() => process.exit(0), 50)
})
