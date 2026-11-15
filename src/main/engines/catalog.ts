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
    files: [{ url: `${GH_SHERPA}/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8.tar.bz2`, name: 'parakeet.tar.bz2', size: 487211443, sha256: '1495e91b59d7fc53ddca91f3431758ec99f8fa253fdb0e1e851be0f72b14b0f9' }], // k2-fsa hat das Archiv am 2026-11-07 neu hochgeladen (andere Gewichte, gleiche Dateinamen)
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
    id: 'qwen3-8-27b',
    name: 'Qwen3.8 27B (Q4_K_M)',
    kind: 'llm',
    note: 'Großes Modell für den Hauptrechner · ca. 21 GB VRAM bei 16k Kontext (KV-Cache q8) · Testlab-Kandidat',
    files: [{ url: `${HF}/bartowski/Qwen3.8-27B-GGUF/resolve/main/Qwen3.8-27B-Q4_K_M.gguf`, name: 'Qwen3.8-27B-Q4_K_M.gguf', size: 17442399968, sha256: '880a52af8317974f7b4b064a6bc29ff49e188b91aa218e08eea3078b6b1cc673' }],
    expect: ['Qwen3.8-27B-Q4_K_M.gguf'],
    vramMb: 21000,
    minVramMb: 22000
  },
  {
    id: 'qwen3-asr',
    name: 'Qwen3-ASR 1.7B (Q8_0, nur Text)',
    kind: 'llm',
    note: 'Testlab: zweiter Durchgang (Text) über llama-server mit Audio-Projektor · Wortzeiten kommen weiter aus Parakeet',
    files: [
      { url: `${HF}/ggml-org/Qwen3-ASR-1.7B-GGUF/resolve/main/Qwen3-ASR-1.7B-Q8_0.gguf`, name: 'Qwen3-ASR-1.7B-Q8_0.gguf', size: 2165034944, sha256: '58e22d0532d4eacaf034cfac17a6fed159f37c41390c710186783be439d1fc57' },
      { url: `${HF}/ggml-org/Qwen3-ASR-1.7B-GGUF/resolve/main/mmproj-Qwen3-ASR-1.7B-Q8_0.gguf`, name: 'mmproj-Qwen3-ASR-1.7B-Q8_0.gguf', size: 355709344, sha256: '46c1d533af3f354ceb37ce855dbceff7da7fa7cf1e6a523df3b13440bd164c0d' }
    ],
    expect: ['Qwen3-ASR-1.7B-Q8_0.gguf', 'mmproj-Qwen3-ASR-1.7B-Q8_0.gguf'],
    vramMb: 3500
  },
  {
    id: 'qwen3-vl-embedding-2b',
    name: 'Qwen3-VL-Embedding 2B (Engine 3, PyTorch)',
    kind: 'vision',
    note: 'Engine 3: Bild-/Video-Embeddings für die semantische Suche über das ganze Video (läuft im Python-Worker, nicht in llama.cpp) · Apache-2.0 (Modellkarte) · ca. 4,3 GB, ca. 5 GB VRAM',
    // Revision fest gebunden; Prüfsummen: LFS-Dateien laut Hugging-Face-API, kleine Dateien beim Anlegen des Eintrags selbst berechnet
    files: [
      { url: `${HF}/Qwen/Qwen3-VL-Embedding-2B/resolve/9f2f7e710d6d81056aa5c0a4f04764fec6bb7bda/config.json`, name: 'config.json', size: 1570, sha256: '9172f55b0b9cce70b7f67b10c58a408ccf3ec15c587e6efd4d5f41631237fded' },
      { url: `${HF}/Qwen/Qwen3-VL-Embedding-2B/resolve/9f2f7e710d6d81056aa5c0a4f04764fec6bb7bda/preprocessor_config.json`, name: 'preprocessor_config.json', size: 783, sha256: 'd75c1f9f474add87cb0188d43c4fbf5c232d2af64f156fcefc5311089049100d' },
      { url: `${HF}/Qwen/Qwen3-VL-Embedding-2B/resolve/9f2f7e710d6d81056aa5c0a4f04764fec6bb7bda/video_preprocessor_config.json`, name: 'video_preprocessor_config.json', size: 817, sha256: '59c5c9eb52182eb14c06ffb10ca9effd29adce5f238a95de23ca14a38dbd2cb1' },
      { url: `${HF}/Qwen/Qwen3-VL-Embedding-2B/resolve/9f2f7e710d6d81056aa5c0a4f04764fec6bb7bda/tokenizer.json`, name: 'tokenizer.json', size: 11423705, sha256: 'def76fb086971c7867b829c23a26261e38d9d74e02139253b38aeb9df8b4b50a' },
      { url: `${HF}/Qwen/Qwen3-VL-Embedding-2B/resolve/9f2f7e710d6d81056aa5c0a4f04764fec6bb7bda/tokenizer_config.json`, name: 'tokenizer_config.json', size: 5404, sha256: '355f2b4e5bad7b01f11ef6cb68ebc176f61b95c3276092ea225b1bea0e01e95c' },
      { url: `${HF}/Qwen/Qwen3-VL-Embedding-2B/resolve/9f2f7e710d6d81056aa5c0a4f04764fec6bb7bda/vocab.json`, name: 'vocab.json', size: 2776833, sha256: 'ca10d7e9fb3ed18575dd1e277a2579c16d108e32f27439684afa0e10b1440910' },
      { url: `${HF}/Qwen/Qwen3-VL-Embedding-2B/resolve/9f2f7e710d6d81056aa5c0a4f04764fec6bb7bda/merges.txt`, name: 'merges.txt', size: 1671853, sha256: '8831e4f1a044471340f7c0a83d7bd71306a5b867e95fd870f74d0c5308a904d5' },
      { url: `${HF}/Qwen/Qwen3-VL-Embedding-2B/resolve/9f2f7e710d6d81056aa5c0a4f04764fec6bb7bda/added_tokens.json`, name: 'added_tokens.json', size: 707, sha256: 'c0284b582e14987fbd3d5a2cb2bd139084371ed9acbae488829a1c900833c680' },
      { url: `${HF}/Qwen/Qwen3-VL-Embedding-2B/resolve/9f2f7e710d6d81056aa5c0a4f04764fec6bb7bda/special_tokens_map.json`, name: 'special_tokens_map.json', size: 613, sha256: '76862e765266b85aa9459767e33cbaf13970f327a0e88d1c65846c2ddd3a1ecd' },
      { url: `${HF}/Qwen/Qwen3-VL-Embedding-2B/resolve/9f2f7e710d6d81056aa5c0a4f04764fec6bb7bda/chat_template.jinja`, name: 'chat_template.jinja', size: 5519, sha256: 'a47e6afb389f86f45be7810f17d2686fd42b2bec7ba6e6958abf85845af258c5' },
      { url: `${HF}/Qwen/Qwen3-VL-Embedding-2B/resolve/9f2f7e710d6d81056aa5c0a4f04764fec6bb7bda/model.safetensors`, name: 'model.safetensors', size: 4255140312, sha256: 'c73fa9caeddeb3ff831d46c085a7a5708343248ca777e90f2d486964464509c1' }
    ],
    expect: ['model.safetensors', 'config.json', 'tokenizer.json'],
    vramMb: 5000
  },
  {
    id: 'qwen3-vl-4b',
    name: 'Qwen3-VL 4B Instruct (Q4_K_M + Projektor F16)',
    kind: 'vision',
    note: 'Neue Engine (Beta): Bildbeobachtungen (Frames, Reaktionen, Gameplay) über llama-server · Apache-2.0 · ca. 4 GB VRAM mit Projektor',
    // Version fest an den geprüften Stand des Repos gebunden (kein wechselnder „main“-Download)
    files: [
      { url: `${HF}/Qwen/Qwen3-VL-4B-Instruct-GGUF/resolve/1cd86afb9a95c410a6038ab3b40d8b578c892266/Qwen3VL-4B-Instruct-Q4_K_M.gguf`, name: 'Qwen3VL-4B-Instruct-Q4_K_M.gguf', size: 2497281664, sha256: '66358cb18bb6b3b1b6675aa412c7a88ef01d228f481184d13668e5201c730a0a' },
      { url: `${HF}/Qwen/Qwen3-VL-4B-Instruct-GGUF/resolve/1cd86afb9a95c410a6038ab3b40d8b578c892266/mmproj-Qwen3VL-4B-Instruct-F16.gguf`, name: 'mmproj-Qwen3VL-4B-Instruct-F16.gguf', size: 836180256, sha256: '256f3a43bd4205ffef48d6b92715e1e70b5b0e9aef06522584967513a9985331' }
    ],
    expect: ['Qwen3VL-4B-Instruct-Q4_K_M.gguf', 'mmproj-Qwen3VL-4B-Instruct-F16.gguf'],
    vramMb: 4500
  },
  {
    id: 'voxtral-mini-3b',
    name: 'Voxtral Mini 3B (Q4_K_M + Projektor Q8)',
    kind: 'llm',
    note: 'Neue Engine (Beta): Audioverständnis kurzer Ausschnitte (Gesang/Rap, Stimmwechsel, Reaktionen) über llama-server · Original Apache-2.0, die GGUF-Karte von ggml-org nennt keine Lizenz · ca. 4 GB VRAM',
    files: [
      { url: `${HF}/ggml-org/Voxtral-Mini-3B-2507-GGUF/resolve/20616573013f28229fff61de74359d3eeff61f6a/Voxtral-Mini-3B-2507-Q4_K_M.gguf`, name: 'Voxtral-Mini-3B-2507-Q4_K_M.gguf', size: 2473001920, sha256: '4705be8ec22ca23d12632f4b4a3691faa95917d90a06d3cf3c3ec0e91958f1a8' },
      { url: `${HF}/ggml-org/Voxtral-Mini-3B-2507-GGUF/resolve/20616573013f28229fff61de74359d3eeff61f6a/mmproj-Voxtral-Mini-3B-2507-Q8_0.gguf`, name: 'mmproj-Voxtral-Mini-3B-2507-Q8_0.gguf', size: 715714080, sha256: '4f24c4ef3ce929d02ed9d1cfb050ae9a7365f057c0ddec0d489580982ebe0d02' }
    ],
    expect: ['Voxtral-Mini-3B-2507-Q4_K_M.gguf', 'mmproj-Voxtral-Mini-3B-2507-Q8_0.gguf'],
    vramMb: 4500
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
    id: 'yolov8n-pose',
    name: 'YOLOv8n-Pose',
    kind: 'vision',
    note: 'Personen- und Kopferkennung, auch im Profil (13 MB)',
    files: [{ url: `${HF}/Xenova/yolov8n-pose/resolve/main/onnx/model.onnx`, name: 'yolov8n-pose.onnx', size: 13484153, sha256: '04f6d2416266f2aba6c5ba8b26de33ed9eba3279f972ac02e33f9f1366547586' }],
    expect: ['yolov8n-pose.onnx'],
    recommendedFromVramMb: 0
  },
  {
    id: 'face-embed',
    name: 'Gesichts-Wiedererkennung (MobileFaceNet)',
    kind: 'vision',
    note: 'Erkennt dieselbe Person über Schnitte hinweg (14 MB)',
    files: [{ url: `${HF}/immich-app/buffalo_s/resolve/main/recognition/model.onnx`, name: 'w600k_mbf.onnx', size: 13616099, sha256: '9cc6e4a75f0e2bf0b1aed94578f144d15175f357bdc05e815e5c4a02b319eb4f' }],
    expect: ['w600k_mbf.onnx'],
    recommendedFromVramMb: 0
  },
  {
    id: 'yamnet',
    name: 'YAMNet (Audio-Ereignisse)',
    kind: 'vision',
    note: 'Erkennt Lachen, Applaus und laute Stimme im Ton (16 MB)',
    files: [{ url: `${HF}/audiomagic/yamnet-onnx/resolve/main/yamnet.onnx`, name: 'yamnet.onnx', size: 16093355, sha256: 'd3835ffbbd4a1bb3e777f0ca217b5007907f5171dd5d17c4236b95b2af8f908e' }],
    expect: ['yamnet.onnx'],
    recommendedFromVramMb: 0
  },
  {
    id: 'scrfd-10g',
    name: 'SCRFD-10G (Gesichtserkennung, Test)',
    kind: 'vision',
    note: 'Robuster bei Profil/kleinen Gesichtern – Alternative zu YuNet im Testlab (17 MB)',
    files: [{ url: `${HF}/immich-app/buffalo_l/resolve/main/detection/model.onnx`, name: 'det_10g.onnx', size: 16923827, sha256: '5838f7fe053675b1c7a08b633df49e7af5495cee0493c7dcf6697200b85b5b91' }],
    expect: ['det_10g.onnx'],
    recommendedFromVramMb: 0
  },
  {
    id: 'speaker-segmentation',
    name: 'pyannote Segmentierung 3.0',
    kind: 'vad',
    note: 'Sprecher-Wechsel erkennen (7 MB)',
    files: [{ url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-segmentation-models/sherpa-onnx-pyannote-segmentation-3-0.tar.bz2', name: 'pyannote.tar.bz2', size: 6958444, sha256: '24615ee884c897d9d2ba09bb4d30da6bb1b15e685065962db5b02e76e4996488' }],
    extract: true,
    expect: ['sherpa-onnx-pyannote-segmentation-3-0/model.int8.onnx'],
    recommendedFromVramMb: 0
  },
  {
    id: 'speaker-embedding',
    name: 'WeSpeaker ResNet34',
    kind: 'vad',
    note: 'Sprecher-Stimmabdruck (27 MB)',
    files: [{ url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/wespeaker_en_voxceleb_resnet34_LM.onnx', name: 'wespeaker_en_voxceleb_resnet34_LM.onnx', size: 26530550, sha256: 'e9848563da86f263117134dfd7ad63c92355b37de492b55e325400c9d9c39012' }],
    expect: ['wespeaker_en_voxceleb_resnet34_LM.onnx'],
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
