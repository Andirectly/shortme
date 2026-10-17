// M0.2 ASR-Spike: node spikes/asr.cjs <parakeet|whisper> <wav> [maxSeconds]
// Ausgabe: spikes/out/asr-<model>.json (Segmente mit Wörtern/Zeiten) + Ergebniszeile
const fs = require('fs')
const path = require('path')
const sherpa = require('sherpa-onnx-node')

const [model, wavPath, maxSecArg] = process.argv.slice(2)
const M = path.join(__dirname, '..', 'models')
const wave = sherpa.readWave(wavPath)
const sr = wave.sampleRate
let samples = wave.samples
if (maxSecArg) samples = samples.subarray(0, Number(maxSecArg) * sr)
const dur = samples.length / sr

let modelConfig
if (model === 'parakeet') {
  const d = path.join(M, 'sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8')
  modelConfig = {
    transducer: { encoder: `${d}/encoder.int8.onnx`, decoder: `${d}/decoder.int8.onnx`, joiner: `${d}/joiner.int8.onnx` },
    tokens: `${d}/tokens.txt`, modelType: 'nemo_transducer', numThreads: 4, provider: process.env.PROV || 'cpu'
  }
} else {
  const d = path.join(M, 'sherpa-onnx-whisper-turbo')
  modelConfig = {
    whisper: { encoder: `${d}/turbo-encoder.int8.onnx`, decoder: `${d}/turbo-decoder.int8.onnx`, language: 'de', task: 'transcribe', tailPaddings: 800 },
    tokens: `${d}/turbo-tokens.txt`, numThreads: 4, provider: process.env.PROV || 'cpu'
  }
}
const rec = new sherpa.OfflineRecognizer({ featConfig: { sampleRate: 16000, featureDim: 80 }, modelConfig })

const vad = new sherpa.Vad(
  { sileroVad: { model: path.join(M, 'silero_vad.onnx'), threshold: 0.5, minSilenceDuration: 0.4, minSpeechDuration: 0.25, maxSpeechDuration: 20, windowSize: 512 }, sampleRate: sr, numThreads: 1, provider: 'cpu', debug: 0 },
  60
)

const segs = []
const t0 = Date.now()
function decode(seg) {
  const stream = rec.createStream()
  stream.acceptWaveform({ samples: seg.samples, sampleRate: sr })
  rec.decode(stream)
  const r = rec.getResult(stream)
  const start = seg.start / sr
  segs.push({ start, end: start + seg.samples.length / sr, text: r.text, tokens: r.tokens, timestamps: (r.timestamps || []).map((t) => t + start), durations: r.durations })
}
const win = 512
for (let i = 0; i + win <= samples.length; i += win) {
  vad.acceptWaveform(samples.subarray(i, i + win))
  while (!vad.isEmpty()) { decode(vad.front(false)); vad.pop() }
}
vad.flush()
while (!vad.isEmpty()) { decode(vad.front(false)); vad.pop() }
const el = (Date.now() - t0) / 1000
fs.writeFileSync(path.join(__dirname, 'out', `asr-${model}.json`), JSON.stringify(segs, null, 1))
const words = segs.reduce((n, s) => n + s.text.trim().split(/\s+/).filter(Boolean).length, 0)
const hasTs = segs.some((s) => s.timestamps.length > 0)
console.log(`ASR ${model} provider=${modelConfig.provider} audio=${dur.toFixed(0)}s time=${el.toFixed(1)}s RTF=${(el / dur).toFixed(3)} segs=${segs.length} words=${words} tokenTimestamps=${hasTs}`)
