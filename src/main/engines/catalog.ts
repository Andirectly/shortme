import type { AssetSpec } from '@shared/engines'

const HF = 'https://huggingface.co'
const GH_SHERPA = 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models'
const GH_LLAMA = 'https://github.com/ggml-org/llama.cpp/releases/download/b11711'

/** Hashes aus den Anbieter-Metadaten (HF x-linked-etag, GitHub digest) am 2026-10-17. */
export const CATALOG: AssetSpec[] = [
  {
    id: 'parakeet-v3',
    name: 'Parakeet TDT 0.6B v3 (int8)',
    kind: 'transcription',
    note: 'Schnell (RTF 0,04), Wortzeiten, 25 Sprachen',
    files: [{ url: `${GH_SHERPA}/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8.tar.bz2`, name: 'parakeet.tar.bz2', size: 487170055, sha256: '5793d0fd397c5778d2cf2126994d58e9d56b1be7c04d13c7a15bb1b4eafb16bf' }],
    extract: true,
    expect: ['sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8/encoder.int8.onnx', 'sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8/decoder.int8.onnx', 'sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8/joiner.int8.onnx', 'sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8/tokens.txt'],
    recommendedFromVramMb: 0
  },
  {
    id: 'whisper-turbo',
    name: 'Whisper large-v3-turbo (int8)',
    kind: 'transcription',
    note: 'Optional · keine Wortzeiten',
    files: [{ url: `${GH_SHERPA}/sherpa-onnx-whisper-turbo.tar.bz2`, name: 'whisper-turbo.tar.bz2', size: 563790207, sha256: 'b11acbbcd660b44a8e0df33724feb5aaa709cf65668f2823d59f656312544f22' }],
    extract: true,
    expect: ['sherpa-onnx-whisper-turbo/turbo-encoder.int8.onnx', 'sherpa-onnx-whisper-turbo/turbo-decoder.int8.onnx', 'sherpa-onnx-whisper-turbo/turbo-tokens.txt']
  },
  {
    id: 'silero-vad',
    name: 'Silero VAD',
    kind: 'vad',
    note: 'Sprach-Erkennung für Pausen und Grenzen',
    files: [{ url: `${GH_SHERPA}/silero_vad.onnx`, name: 'silero_vad.onnx', size: 643854, sha256: '9e2449e1087496d8d4caba907f23e0bd3f78d91fa552479bb9c23ac09cbb1fd6' }],
    expect: ['silero_vad.onnx'],
    recommendedFromVramMb: 0
  },
  {
    id: 'qwen3-14b',
    name: 'Qwen3-14B (Q4_K_M)',
    kind: 'llm',
    note: 'Clip-Auswahl · 13,6 GB VRAM bei 16k Kontext',
    files: [{ url: `${HF}/unsloth/Qwen3-14B-GGUF/resolve/main/Qwen3-14B-Q4_K_M.gguf`, name: 'Qwen3-14B-Q4_K_M.gguf', size: 9001753984, sha256: '5eaa0870bd81ed3b58a630a271234cfa604e43ffb3a19cd68e54a80dd9d52a66' }],
    expect: ['Qwen3-14B-Q4_K_M.gguf'],
    vramMb: 13600,
    recommendedFromVramMb: 14000
  },
  {
    id: 'qwen3-8b',
    name: 'Qwen3-8B (Q4_K_M)',
    kind: 'llm',
    note: 'Kompakt-Profil für 8–12 GB VRAM',
    files: [{ url: `${HF}/unsloth/Qwen3-8B-GGUF/resolve/main/Qwen3-8B-Q4_K_M.gguf`, name: 'Qwen3-8B-Q4_K_M.gguf', size: 5027784512, sha256: '120307ba529eb2439d6c430d94104dabd578497bc7bfe7e322b5d9933b449bd4' }],
    expect: ['Qwen3-8B-Q4_K_M.gguf'],
    vramMb: 8500,
    recommendedFromVramMb: 7500
  },
  {
    id: 'gemma3-12b',
    name: 'Gemma 3 12B (Q4_K_M)',
    kind: 'llm',
    note: 'Alternative · 12,2 GB VRAM',
    files: [{ url: `${HF}/unsloth/gemma-3-12b-it-GGUF/resolve/main/gemma-3-12b-it-Q4_K_M.gguf`, name: 'gemma-3-12b-it-Q4_K_M.gguf', size: 7300778336, sha256: '15b8fd9d8672cd4240c178c217ca781409291f34e353d2e913b29c7602ceb3ff' }],
    expect: ['gemma-3-12b-it-Q4_K_M.gguf'],
    vramMb: 12200
  },
  {
    id: 'transnetv2',
    name: 'TransNetV2',
    kind: 'vision',
    note: 'Kamerawechsel-Erkennung (31 MB)',
    files: [{ url: `${HF}/elya5/transnetv2/resolve/main/transnetv2.onnx`, name: 'transnetv2.onnx', size: 31250929, sha256: 'c4d54a682bace32f25136ef83ca2c9d403e8f8193775efeb995172a0d95a8e0c' }],
    expect: ['transnetv2.onnx'],
    recommendedFromVramMb: 0
  },
  {
    id: 'llama-server',
    name: 'llama.cpp (CUDA 13.4)',
    kind: 'engine',
    note: 'llama-server für die lokale Clip-Auswahl',
    files: [
      { url: `${GH_LLAMA}/llama-b11711-bin-win-cuda-13.4-x64.zip`, name: 'llama.zip', size: 154901998, sha256: '3bc03e22b169d03e6973da4126022ae655dd8ae0c79eb9ad5d27cddb17abd179' },
      { url: `${GH_LLAMA}/cudart-llama-bin-win-cuda-13.4-x64.zip`, name: 'cudart.zip', size: 423535356, sha256: '738f8c251ac22b70c3ae6f83a10cf222725df0395246a2cf58f32bdb85fbe668' }
    ],
    extract: true,
    expect: ['llama-server.exe', 'ggml-cuda.dll', 'cudart64_13.dll'],
    platform: 'win32',
    recommendedFromVramMb: 0
  },
  {
    id: 'node-runtime',
    name: 'Node.js 22 (ASR-Laufzeit)',
    kind: 'engine',
    note: 'Eigene Node-Laufzeit für sherpa-onnx (läuft nicht im Electron-Prozess: "External buffers are not allowed")',
    files: [{ url: 'https://nodejs.org/dist/v22.23.3/node-v22.23.3-win-x64.zip', name: 'node.zip', size: 35574076, sha256: '2b0ff57b049cda1bbcea2240eec20467018713c1efe1f7360c2681859b90ed71' }],
    extract: true,
    expect: ['node-v22.23.3-win-x64/node.exe'],
    platform: 'win32',
    recommendedFromVramMb: 0
  }
]

export const byId = (id: string): AssetSpec => {
  const s = CATALOG.find((c) => c.id === id)
  if (!s) throw new Error(`Unbekanntes Asset: ${id}`)
  return s
}
