// Läuft als eigener Prozess in echter Node-Laufzeit (Entladen = Prozess beenden → VRAM/RAM sicher frei).
import { join } from 'node:path'
import { chunkRange, findGaps, GAP_MIN_SEC, GAP_MARGIN_SEC, tokensToWords, VAD_DEFAULTS, VAD_SCAN, type AsrMessage, type AsrRequest, type AsrSegment, type Range, type VadParams } from './protocol'

const send = (m: AsrMessage): void => { process.send?.(m) }

type Sherpa = any // eslint-disable-line @typescript-eslint/no-explicit-any

function makeRecognizer(sherpa: Sherpa, modelDir: string): Sherpa {
  return new sherpa.OfflineRecognizer({
    featConfig: { sampleRate: 16000, featureDim: 80 },
    modelConfig: {
      transducer: { encoder: join(modelDir, 'encoder.int8.onnx'), decoder: join(modelDir, 'decoder.int8.onnx'), joiner: join(modelDir, 'joiner.int8.onnx') },
      tokens: join(modelDir, 'tokens.txt'), modelType: 'nemo_transducer', numThreads: 4, provider: 'cpu'
    }
  })
}

function makeVad(sherpa: Sherpa, model: string, sr: number, p: VadParams): Sherpa {
  return new sherpa.Vad(
    { sileroVad: { model, threshold: p.threshold, minSilenceDuration: p.minSilence, minSpeechDuration: p.minSpeech, maxSpeechDuration: p.maxSpeech, windowSize: 512 }, sampleRate: sr, numThreads: 1, provider: 'cpu', debug: 0 },
    60
  )
}

/** Dekodiert ein Stück Audio ohne VAD; Zeiten sind absolut (start = Sekunde des ersten Samples). */
function decodeChunk(rec: Sherpa, samples: Float32Array, sr: number, start: number): AsrSegment {
  const stream = rec.createStream()
  stream.acceptWaveform({ samples, sampleRate: sr })
  rec.decode(stream)
  const r = rec.getResult(stream)
  const end = start + samples.length / sr
  const words = tokensToWords(r.tokens ?? [], (r.timestamps ?? []).map((t: number) => t + start), r.durations, end)
  return { start, end, text: r.text.trim(), words }
}

function runAsr(req: Extract<AsrRequest, { mode: 'asr' }>): void {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const sherpa = require('sherpa-onnx-node')
  const t0 = Date.now()
  const wave = sherpa.readWave(req.wav)
  const sr: number = wave.sampleRate
  let samples: Float32Array = wave.samples
  if (req.maxSeconds) samples = samples.subarray(0, req.maxSeconds * sr)
  const offset = Math.floor((req.resumeFrom ?? 0) * sr)
  const rec = makeRecognizer(sherpa, req.modelDir)
  const params = req.vad ?? VAD_DEFAULTS
  const vad = makeVad(sherpa, req.vadModel, sr, params)
  const loadMs = Date.now() - t0
  let lastEnd = 0 // Ende des zuletzt gemeldeten Wortes: mit Polster überlappende Wörter benachbarter Segmente werden nur einmal gemeldet
  const decode = (seg: { start: number; samples: Float32Array }): void => {
    // Polster: etwas Stille/Rand vor und hinter dem VAD-Segment mitdekodieren (VAD schneidet Wortanfänge/-enden gern ab)
    const padN = Math.round(params.pad * sr)
    const from = Math.max(0, seg.start + offset - padN)
    const to = Math.min(samples.length, seg.start + offset + seg.samples.length + padN)
    const chunk = padN > 0 ? samples.subarray(from, to) : seg.samples
    const dec = decodeChunk(rec, chunk, sr, (padN > 0 ? from : seg.start + offset) / sr)
    const start = (seg.start + offset) / sr
    const end = start + seg.samples.length / sr
    const words = padN > 0 ? dec.words.filter((w) => w.start >= lastEnd - 0.02) : dec.words
    if (words.length) lastEnd = Math.max(lastEnd, words[words.length - 1].end)
    // Auch leere Segmente melden: das Sprach-Intervall (VAD) wird für Pausenschnitte gebraucht.
    send({ type: 'segment', segment: { start, end, text: padN > 0 ? words.map((w) => w.w).join(' ') : dec.text, words } })
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

/** Lücken: Sprache hörbar (empfindliche VAD), aber keine Wörter → mit Rand ohne VAD-Vorfilter neu dekodieren. */
function runGaps(req: Extract<AsrRequest, { mode: 'gaps' }>): void {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const sherpa = require('sherpa-onnx-node')
  const t0 = Date.now()
  const wave = sherpa.readWave(req.wav)
  const sr: number = wave.sampleRate
  const samples: Float32Array = wave.samples
  const fixed = req.ranges && req.ranges.length ? req.ranges : null
  const vad = makeVad(sherpa, req.vadModel, sr, VAD_SCAN)
  const speech: Range[] = []
  const take = (): void => { while (!vad.isEmpty()) { const g = vad.front(false); speech.push([g.start / sr, (g.start + g.samples.length) / sr]); vad.pop() } }
  if (!fixed) {
    for (let i = 0; i + 512 <= samples.length; i += 512) { vad.acceptWaveform(samples.subarray(i, i + 512)); take() }
    vad.flush()
    take()
  }
  const words = req.words.map(([start, end]) => ({ start, end }))
  const gaps = fixed ?? findGaps(speech, words, req.minGap ?? GAP_MIN_SEC)
  const scanMs = Date.now() - t0
  const rec = makeRecognizer(sherpa, req.modelDir)
  const t1 = Date.now()
  const margin = fixed ? 0 : req.margin ?? GAP_MARGIN_SEC
  for (const [a, b] of gaps) {
    for (const [c0, c1] of chunkRange(Math.max(0, a - margin), Math.min(samples.length / sr, b + margin))) {
      const seg = decodeChunk(rec, samples.subarray(Math.floor(c0 * sr), Math.floor(c1 * sr)), sr, c0)
      send({ type: 'segment', segment: { ...seg, filled: true } })
    }
  }
  send({ type: 'gaps', found: gaps, scanMs, decodeMs: Date.now() - t1 })
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
    else if (req.mode === 'gaps') runGaps(req)
    else runAsr(req)
  } catch (e) {
    send({ type: 'error', message: e instanceof Error ? e.message : String(e) })
  }
})
