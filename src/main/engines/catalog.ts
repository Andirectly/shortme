import type { AssetSpec } from '@shared/engines'

const HF = 'https://huggingface.co'
const GH_SHERPA = 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models'
const GH_LLAMA = 'https://github.com/ggml-org/llama.cpp/releases/download/b11711'

/** Hashes aus den Anbieter-Metadaten (HF x-linked-etag, GitHub digest) am 2026-10-17. */
const ALL: AssetSpec[] = [
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
    id: 'gemma-4-e4b-it',
    name: 'Gemma 4 E4B (Engine Mac, Bild + Ton, MLX)',
    kind: 'vision',
    note: 'Engine Mac: sieht und hört jeden Kandidaten (Nachuntersuchung, Schnittwahl, Prüfung des fertigen Clips) · Google Gemma 4, Apache-2.0 · 4-bit-MLX (mlx-community) · ca. 5,2 GB',
    // Revision fest gebunden; Prüfsummen: LFS-Dateien laut Hugging-Face-API, kleine Dateien beim Anlegen des Eintrags selbst berechnet
    files: [
      { url: `${HF}/mlx-community/gemma-4-e4b-it-4bit/resolve/475b9088d29754a3379866cf5aeb6b41acd313c2/chat_template.jinja`, name: 'chat_template.jinja', size: 17336, sha256: '2f1b4d75d067bae3fe44e676721c7f077d243bc007156cb9c2f8b5836613d082' },
      { url: `${HF}/mlx-community/gemma-4-e4b-it-4bit/resolve/475b9088d29754a3379866cf5aeb6b41acd313c2/config.json`, name: 'config.json', size: 6628, sha256: '780ccb3a514a5f1ced161d383f948fc22eca9b84b752ca19494f625bd9bad7a6' },
      { url: `${HF}/mlx-community/gemma-4-e4b-it-4bit/resolve/475b9088d29754a3379866cf5aeb6b41acd313c2/generation_config.json`, name: 'generation_config.json', size: 208, sha256: 'd4226bbe3117d2d253ba4609720ba82c6c4ce4627a9a6ae05387c78983ac03de' },
      { url: `${HF}/mlx-community/gemma-4-e4b-it-4bit/resolve/475b9088d29754a3379866cf5aeb6b41acd313c2/model.safetensors.index.json`, name: 'model.safetensors.index.json', size: 240961, sha256: 'f8accac59ee7efe87e0c298c854610b262c3cadd477407503147c71209ff0093' },
      { url: `${HF}/mlx-community/gemma-4-e4b-it-4bit/resolve/475b9088d29754a3379866cf5aeb6b41acd313c2/processor_config.json`, name: 'processor_config.json', size: 1316, sha256: 'de3e580aebdc98272d4c4547daffe6525fcbae18a83a0e0bcf0d7444d4ee6f37' },
      { url: `${HF}/mlx-community/gemma-4-e4b-it-4bit/resolve/475b9088d29754a3379866cf5aeb6b41acd313c2/tokenizer_config.json`, name: 'tokenizer_config.json', size: 2740, sha256: '080d9e1aff284e2f6043889cd05367966f7c7b80e025fbc0b06745e218158656' },
      { url: `${HF}/mlx-community/gemma-4-e4b-it-4bit/resolve/475b9088d29754a3379866cf5aeb6b41acd313c2/tokenizer.json`, name: 'tokenizer.json', size: 32169626, sha256: 'cc8d3a0ce36466ccc1278bf987df5f71db1719b9ca6b4118264f45cb627bfe0f' },
      { url: `${HF}/mlx-community/gemma-4-e4b-it-4bit/resolve/475b9088d29754a3379866cf5aeb6b41acd313c2/model.safetensors`, name: 'model.safetensors', size: 5146800534, sha256: '932b8271fc3fe65adcc78b96c10c6268bbfb13e8f67d1358727c0d6ee97e1eff' }
    ],
    expect: ['model.safetensors', 'config.json', 'tokenizer.json', 'processor_config.json'],
    platform: 'darwin'
  },
  {
    id: 'lfm3-omni-2b',
    name: 'LFM3-Omni 2B (Engine Mac, Bild + Ton, MLX)',
    kind: 'vision',
    note: 'Engine Mac: sieht und hört jeden Kandidaten und den fertigen Clip (Bilder + separat zugeführter Ton) · Liquid AI, LFM Open License v1.0 (private Nutzung) · 8-bit MLX · ca. 2,9 GB, gemessen ~3,2 GB Speicher',
    // Revision fest gebunden; alle Dateien mit SHA-256 (große Dateien gegen die LFS-Prüfsumme der Hugging-Face-API abgeglichen, scripts/catalog-entry.py)
    files: [
      { url: `${HF}/LiquidAI/LFM3-Omni-2B-MLX-8bit/resolve/5901d16cbc5f1774243db907cd407f825591f743/LICENSE`, name: 'LICENSE', size: 10574, sha256: '4d28ca14dedc0b3d0fcc2b3339f0e79931faa33874f3d24f522183a8fc70068c' },
      { url: `${HF}/LiquidAI/LFM3-Omni-2B-MLX-8bit/resolve/5901d16cbc5f1774243db907cd407f825591f743/README.md`, name: 'README.md', size: 5458, sha256: 'd47467d6217e65050ff4df5e49b5999dddb481cd4c9a10fb716aa896ef8bff78' },
      { url: `${HF}/LiquidAI/LFM3-Omni-2B-MLX-8bit/resolve/5901d16cbc5f1774243db907cd407f825591f743/audio_tokenizer/config.json`, name: 'audio_tokenizer/config.json', size: 512, sha256: '04d24ad70085288c0c10a8788e470fabd0a786c27b772bfd90ea1cde1cf3ac6d' },
      { url: `${HF}/LiquidAI/LFM3-Omni-2B-MLX-8bit/resolve/5901d16cbc5f1774243db907cd407f825591f743/audio_tokenizer/model.safetensors`, name: 'audio_tokenizer/model.safetensors', size: 147143540, sha256: '45984a872fdcf0b94cd0ec68822bbf26f0c6fcb580cfaba0f7fa3ee60355137f' },
      { url: `${HF}/LiquidAI/LFM3-Omni-2B-MLX-8bit/resolve/5901d16cbc5f1774243db907cd407f825591f743/chat_template.jinja`, name: 'chat_template.jinja', size: 13527, sha256: '8533df07040707cfc576ddd88d82683ed768b4cbeea0d946d87f26979f52f7ec' },
      { url: `${HF}/LiquidAI/LFM3-Omni-2B-MLX-8bit/resolve/5901d16cbc5f1774243db907cd407f825591f743/config.json`, name: 'config.json', size: 7941, sha256: '4e2803b6c2738b3a3d5081bf29282a4533c2c414ca0ace6ae2ef2b9831286a27' },
      { url: `${HF}/LiquidAI/LFM3-Omni-2B-MLX-8bit/resolve/5901d16cbc5f1774243db907cd407f825591f743/configuration_lfm3.py`, name: 'configuration_lfm3.py', size: 6113, sha256: '176cced35657aedfea7d7002221360582d1c05fcaca882c21508bc3a73b282e5' },
      { url: `${HF}/LiquidAI/LFM3-Omni-2B-MLX-8bit/resolve/5901d16cbc5f1774243db907cd407f825591f743/configuration_lfm3_omni.py`, name: 'configuration_lfm3_omni.py', size: 14598, sha256: '9eccce3925353022c9a4d1cf59111830bbb2694e8c8d12ea439304e48a173c6a' },
      { url: `${HF}/LiquidAI/LFM3-Omni-2B-MLX-8bit/resolve/5901d16cbc5f1774243db907cd407f825591f743/configuration_lfm3_vl.py`, name: 'configuration_lfm3_vl.py', size: 9158, sha256: '249e980a0b0ebd355be18bc0119b33809fa618b777c46f5424445a196c5cbc2e' },
      { url: `${HF}/LiquidAI/LFM3-Omni-2B-MLX-8bit/resolve/5901d16cbc5f1774243db907cd407f825591f743/configuration_liquid_codec.py`, name: 'configuration_liquid_codec.py', size: 5401, sha256: 'ad89deb17164b8ae9a59d9c86545fd01ad281786c8702850aff9042e5f94a463' },
      { url: `${HF}/LiquidAI/LFM3-Omni-2B-MLX-8bit/resolve/5901d16cbc5f1774243db907cd407f825591f743/feature_extraction_lfm3_omni.py`, name: 'feature_extraction_lfm3_omni.py', size: 8935, sha256: 'bafd4bcf85d17c0bbf5cf213633935a6b03c731e55a348e70b0ecaf5a876ef5e' },
      { url: `${HF}/LiquidAI/LFM3-Omni-2B-MLX-8bit/resolve/5901d16cbc5f1774243db907cd407f825591f743/generation_config.json`, name: 'generation_config.json', size: 392, sha256: '5f069cac2df137d9ac81bdd7aee88d48052a3897f9761cc9ba2f357f93405b85' },
      { url: `${HF}/LiquidAI/LFM3-Omni-2B-MLX-8bit/resolve/5901d16cbc5f1774243db907cd407f825591f743/image_processing_lfm3_vl.py`, name: 'image_processing_lfm3_vl.py', size: 12036, sha256: '57db0cfa668bf89a6ff898874e1321e78c257d200f25c98e0ea52b30b8740088' },
      { url: `${HF}/LiquidAI/LFM3-Omni-2B-MLX-8bit/resolve/5901d16cbc5f1774243db907cd407f825591f743/lfm3_conv.py`, name: 'lfm3_conv.py', size: 8532, sha256: '80d4a985382a22774212759248a6b4c737bfbf9c2a47b3dd7f797dda748e4bb4' },
      { url: `${HF}/LiquidAI/LFM3-Omni-2B-MLX-8bit/resolve/5901d16cbc5f1774243db907cd407f825591f743/model.safetensors`, name: 'model.safetensors', size: 2713590678, sha256: '3a6b0836c6c84caa6e479ce650389bea27cb4dba2f56e593e4f78f294bdeba97' },
      { url: `${HF}/LiquidAI/LFM3-Omni-2B-MLX-8bit/resolve/5901d16cbc5f1774243db907cd407f825591f743/model.safetensors.index.json`, name: 'model.safetensors.index.json', size: 80412, sha256: 'b358abc8010ac593d58cf89ee63a130b748db8db7597ed2b7c85f616182056bc' },
      { url: `${HF}/LiquidAI/LFM3-Omni-2B-MLX-8bit/resolve/5901d16cbc5f1774243db907cd407f825591f743/modeling_lfm3.py`, name: 'modeling_lfm3.py', size: 42359, sha256: 'e8cd5254ea99ce6bd731b57b10908c2e8b5010ce8315341f895a38484885eeab' },
      { url: `${HF}/LiquidAI/LFM3-Omni-2B-MLX-8bit/resolve/5901d16cbc5f1774243db907cd407f825591f743/modeling_lfm3_omni.py`, name: 'modeling_lfm3_omni.py', size: 98277, sha256: '9872e64112f9e255fba43212771226772af521e93f99c1984ecba1049664c465' },
      { url: `${HF}/LiquidAI/LFM3-Omni-2B-MLX-8bit/resolve/5901d16cbc5f1774243db907cd407f825591f743/modeling_lfm3_vl.py`, name: 'modeling_lfm3_vl.py', size: 45019, sha256: '06d98684d2f4322bf65140f206f0bf194d14f6587387cd354ad580c12585ff28' },
      { url: `${HF}/LiquidAI/LFM3-Omni-2B-MLX-8bit/resolve/5901d16cbc5f1774243db907cd407f825591f743/modeling_liquid_codec.py`, name: 'modeling_liquid_codec.py', size: 17884, sha256: '5ca87e1b6e0549b40dc90fad5ee9d55620e9defb78c67e19c5937208c8e14f74' },
      { url: `${HF}/LiquidAI/LFM3-Omni-2B-MLX-8bit/resolve/5901d16cbc5f1774243db907cd407f825591f743/processing_lfm3_omni.py`, name: 'processing_lfm3_omni.py', size: 39031, sha256: '07f97f35ccd0262b586c8878251f46c6a84e1e15ed92b0072a3acd3a63d2de5f' },
      { url: `${HF}/LiquidAI/LFM3-Omni-2B-MLX-8bit/resolve/5901d16cbc5f1774243db907cd407f825591f743/processing_lfm3_vl.py`, name: 'processing_lfm3_vl.py', size: 12152, sha256: 'd770011e71c8b8e94ea9436d4f6768b42db60c5db70145d47f326f5d76f633f6' },
      { url: `${HF}/LiquidAI/LFM3-Omni-2B-MLX-8bit/resolve/5901d16cbc5f1774243db907cd407f825591f743/processor_config.json`, name: 'processor_config.json', size: 2089, sha256: 'd7475adcb748c70c08af13cbfc64305c34eca5f3af18d4018f73a9d50a8c702c' },
      { url: `${HF}/LiquidAI/LFM3-Omni-2B-MLX-8bit/resolve/5901d16cbc5f1774243db907cd407f825591f743/tokenizer.json`, name: 'tokenizer.json', size: 17908634, sha256: '41927bd314d17d7d7fadb44e10cd0919f7b71528d7741596d8cbd15c6945ec44' },
      { url: `${HF}/LiquidAI/LFM3-Omni-2B-MLX-8bit/resolve/5901d16cbc5f1774243db907cd407f825591f743/tokenizer_config.json`, name: 'tokenizer_config.json', size: 674, sha256: 'ee4860abad5b84284f816d2812fc23a7477ce827ed6b4708af9a02c68ed00c7c' },
      { url: `${HF}/LiquidAI/LFM3-Omni-2B-MLX-8bit/resolve/5901d16cbc5f1774243db907cd407f825591f743/video_preprocessor_config.json`, name: 'video_preprocessor_config.json', size: 706, sha256: '1ed75befc55ce0eda07fdcd7ad02c08605a973fcb1aebfbd0b86bb5221ae7c97' },
      { url: `${HF}/LiquidAI/LFM3-Omni-2B-MLX-8bit/resolve/5901d16cbc5f1774243db907cd407f825591f743/video_processing_lfm3_vl.py`, name: 'video_processing_lfm3_vl.py', size: 17161, sha256: '9a6b7804c520b59ae6a20bff4814196c187ef5b3ed8c93cbd7d0a9a66c413478' }
    ],
    expect: ['model.safetensors', 'config.json', 'tokenizer.json', 'processor_config.json', 'audio_tokenizer/model.safetensors'],
    platform: 'darwin'
  },
  {
    id: 'qwen3.5-9b-mlx',
    name: 'Qwen3.5 9B (Engine Mac, Redaktion, MLX)',
    kind: 'llm',
    note: 'Engine Mac: Sprachsuche, Schnittplan, Titel, Rangfolge und Inhaltsprüfung des fertigen Clips · Apache-2.0 · 4-bit MLX (mlx-community) · ca. 6 GB',
    // Revision fest gebunden; alle Dateien mit SHA-256 (große Dateien gegen die LFS-Prüfsumme der Hugging-Face-API abgeglichen, scripts/catalog-entry.py)
    files: [
      { url: `${HF}/mlx-community/Qwen3.5-9B-4bit/resolve/8b2b98c00a6b4d291155e4890773ca8f769aee53/README.md`, name: 'README.md', size: 666, sha256: '1407e3e3337063c280b2fe1a63724908a5051cfbf26cd8b98f247432b0382537' },
      { url: `${HF}/mlx-community/Qwen3.5-9B-4bit/resolve/8b2b98c00a6b4d291155e4890773ca8f769aee53/chat_template.jinja`, name: 'chat_template.jinja', size: 7756, sha256: 'a4aee8afcf2e0711942cf848899be66016f8d14a889ff9ede07bca099c28f715' },
      { url: `${HF}/mlx-community/Qwen3.5-9B-4bit/resolve/8b2b98c00a6b4d291155e4890773ca8f769aee53/config.json`, name: 'config.json', size: 3331, sha256: 'a96942cb6a8a1d3f1d17514d81a1925d04362a6a3233b389d13012211baaa9f8' },
      { url: `${HF}/mlx-community/Qwen3.5-9B-4bit/resolve/8b2b98c00a6b4d291155e4890773ca8f769aee53/model-00001-of-00002.safetensors`, name: 'model-00001-of-00002.safetensors', size: 5349771222, sha256: 'a68b87558c6ef43f74c2bd63ce7e9092ceddc3101f3def0030774bae5f42aadd' },
      { url: `${HF}/mlx-community/Qwen3.5-9B-4bit/resolve/8b2b98c00a6b4d291155e4890773ca8f769aee53/model-00002-of-00002.safetensors`, name: 'model-00002-of-00002.safetensors', size: 600449850, sha256: 'b0a770bf8469c7f3f18756a0e0283f1c1174344a83e059a4e483f6af4907352d' },
      { url: `${HF}/mlx-community/Qwen3.5-9B-4bit/resolve/8b2b98c00a6b4d291155e4890773ca8f769aee53/model.safetensors.index.json`, name: 'model.safetensors.index.json', size: 123592, sha256: 'dd023913fb87cfdae27fb11dcf695117c925833796ccac3c64117d6652d8ff1e' },
      { url: `${HF}/mlx-community/Qwen3.5-9B-4bit/resolve/8b2b98c00a6b4d291155e4890773ca8f769aee53/preprocessor_config.json`, name: 'preprocessor_config.json', size: 390, sha256: '27225450ac9c6529872ee1924fcb0962ff5634834f817040f444118116f4e516' },
      { url: `${HF}/mlx-community/Qwen3.5-9B-4bit/resolve/8b2b98c00a6b4d291155e4890773ca8f769aee53/processor_config.json`, name: 'processor_config.json', size: 1300, sha256: '14932921ca485d458a04dafd8069fbb0a4505622a48208d19ed247115801385b' },
      { url: `${HF}/mlx-community/Qwen3.5-9B-4bit/resolve/8b2b98c00a6b4d291155e4890773ca8f769aee53/tokenizer.json`, name: 'tokenizer.json', size: 19989343, sha256: '87a7830d63fcf43bf241c3c5242e96e62dd3fdc29224ca26fed8ea333db72de4' },
      { url: `${HF}/mlx-community/Qwen3.5-9B-4bit/resolve/8b2b98c00a6b4d291155e4890773ca8f769aee53/tokenizer_config.json`, name: 'tokenizer_config.json', size: 1139, sha256: 'e98f1901ac6f0adff67b1d540bfa0c36ac1a0cf59eb72ed78146ef89aafa1182' },
      { url: `${HF}/mlx-community/Qwen3.5-9B-4bit/resolve/8b2b98c00a6b4d291155e4890773ca8f769aee53/video_preprocessor_config.json`, name: 'video_preprocessor_config.json', size: 385, sha256: '7768af27c1fafa9cc9011c1dc20067e03f8915e03b63504550e11d5066986d13' },
      { url: `${HF}/mlx-community/Qwen3.5-9B-4bit/resolve/8b2b98c00a6b4d291155e4890773ca8f769aee53/vocab.json`, name: 'vocab.json', size: 6722759, sha256: 'ce99b4cb2983d118806ce0a8b777a35b093e2000a503ebde25853284c9dfa003' }
    ],
    expect: ['model-00001-of-00002.safetensors', 'model-00002-of-00002.safetensors', 'config.json', 'tokenizer.json'],
    platform: 'darwin'
  },
  {
    id: 'minicpm-o-4_5',
    name: 'MiniCPM-o 4.5 (Engine 3, Video + Audio, PyTorch)',
    kind: 'vision',
    note: 'Engine 3: prüft Ereignisse mit echtem Bild UND Ton in einem Modell (läuft im Python-Worker) · Apache-2.0 (Modellkarte) · ca. 18,8 GB, ca. 19 GB VRAM (gemessen: 18,1 GB geladen, 22 GB Spitze)',
    // Revision fest gebunden; Prüfsummen der LFS-Dateien gegen die Hugging-Face-API geprüft, kleine Dateien selbst berechnet; Gewichte der Sprachausgabe (assets/) werden nicht geladen
    files: [
      { url: `${HF}/openbmb/MiniCPM-o-4_5/resolve/fb09628e98b1f55d8d5b863e0eccfcdd11bff499/added_tokens.json`, name: 'added_tokens.json', size: 2706, sha256: '34d823f7a691ddec4816ac5dfe5fc487963e3d75ab3be374590c02fc0a7fa3f5' },
      { url: `${HF}/openbmb/MiniCPM-o-4_5/resolve/fb09628e98b1f55d8d5b863e0eccfcdd11bff499/config.json`, name: 'config.json', size: 6439, sha256: 'b0c03cf9f0cfc1178ade50e4ba62727ca7a77aa6a6a71eda6668d8f289e96c1d' },
      { url: `${HF}/openbmb/MiniCPM-o-4_5/resolve/fb09628e98b1f55d8d5b863e0eccfcdd11bff499/configuration_minicpmo.py`, name: 'configuration_minicpmo.py', size: 10135, sha256: 'b0c56c192d4aa57d3dc358338a4a93413b8b68e7c7a7c5b82a5af35afab1d86a' },
      { url: `${HF}/openbmb/MiniCPM-o-4_5/resolve/fb09628e98b1f55d8d5b863e0eccfcdd11bff499/generation_config.json`, name: 'generation_config.json', size: 178, sha256: 'cf29e6aecb72503bd220cccb6d86bde84a9f57e77c741dedb8670036106e2119' },
      { url: `${HF}/openbmb/MiniCPM-o-4_5/resolve/fb09628e98b1f55d8d5b863e0eccfcdd11bff499/merges.txt`, name: 'merges.txt', size: 1402109, sha256: 'ac8ff86a72bee70828fbc1119bc4398c6f3a9a6e490d7b0dbe917be025478bd0' },
      { url: `${HF}/openbmb/MiniCPM-o-4_5/resolve/fb09628e98b1f55d8d5b863e0eccfcdd11bff499/model-00001-of-00004.safetensors`, name: 'model-00001-of-00004.safetensors', size: 5273477136, sha256: '30c40b9a10386c1bc404568d8829e5aada2e3501d9de6fb46ff80451aff7e077' },
      { url: `${HF}/openbmb/MiniCPM-o-4_5/resolve/fb09628e98b1f55d8d5b863e0eccfcdd11bff499/model-00002-of-00004.safetensors`, name: 'model-00002-of-00004.safetensors', size: 5301855080, sha256: 'fe0faef420aca8f771bec1f9fcfaae01206c56b8e64e4429a1ff500c962fbf96' },
      { url: `${HF}/openbmb/MiniCPM-o-4_5/resolve/fb09628e98b1f55d8d5b863e0eccfcdd11bff499/model-00003-of-00004.safetensors`, name: 'model-00003-of-00004.safetensors', size: 5301855048, sha256: '5d0b20153f9bfa88ebcd1cb6bbd5b7cac4c217b3cafb137a291a1b380d8b7821' },
      { url: `${HF}/openbmb/MiniCPM-o-4_5/resolve/fb09628e98b1f55d8d5b863e0eccfcdd11bff499/model-00004-of-00004.safetensors`, name: 'model-00004-of-00004.safetensors', size: 2866549964, sha256: 'f61addf4747c94fedcaee059e5d9918ed15543beec494404139a99f2f86c9b31' },
      { url: `${HF}/openbmb/MiniCPM-o-4_5/resolve/fb09628e98b1f55d8d5b863e0eccfcdd11bff499/model.safetensors.index.json`, name: 'model.safetensors.index.json', size: 117202, sha256: 'e578de05a95804bb15237a6fd7c236414e0160cd76751da82c9f7f0d134596e7' },
      { url: `${HF}/openbmb/MiniCPM-o-4_5/resolve/fb09628e98b1f55d8d5b863e0eccfcdd11bff499/modeling_minicpmo.py`, name: 'modeling_minicpmo.py', size: 214356, sha256: '25359f891d1aa81de16b51a24a97b8c8262b83ce3920c36b92be441fde8e4282' },
      { url: `${HF}/openbmb/MiniCPM-o-4_5/resolve/fb09628e98b1f55d8d5b863e0eccfcdd11bff499/modeling_navit_siglip.py`, name: 'modeling_navit_siglip.py', size: 42559, sha256: '1a40a58cb7dfa93f723685f860d1cf3caf3a0ecf52b7904db0c4007aacd1536f' },
      { url: `${HF}/openbmb/MiniCPM-o-4_5/resolve/fb09628e98b1f55d8d5b863e0eccfcdd11bff499/preprocessor_config.json`, name: 'preprocessor_config.json', size: 842, sha256: '10350f12d5636b24e19265d72c5543b462251f54ca18afaa147f6f2ece9591e0' },
      { url: `${HF}/openbmb/MiniCPM-o-4_5/resolve/fb09628e98b1f55d8d5b863e0eccfcdd11bff499/processing_minicpmo.py`, name: 'processing_minicpmo.py', size: 67284, sha256: '3a1f017339b92c2fa768d7737db76cc4689d2280b68a71866b06f7dedc8ac1c2' },
      { url: `${HF}/openbmb/MiniCPM-o-4_5/resolve/fb09628e98b1f55d8d5b863e0eccfcdd11bff499/special_tokens_map.json`, name: 'special_tokens_map.json', size: 12002, sha256: 'a119f5bb22d8818d33514e0b58a224c111bb8e7aa1702d625a23fbe82e6e86b5' },
      { url: `${HF}/openbmb/MiniCPM-o-4_5/resolve/fb09628e98b1f55d8d5b863e0eccfcdd11bff499/tokenization_minicpmo_fast.py`, name: 'tokenization_minicpmo_fast.py', size: 3249, sha256: 'c9c71d0d7ef0c113829e2d810619c9e0a69cffe04c732c4d80599b40a33bc7bf' },
      { url: `${HF}/openbmb/MiniCPM-o-4_5/resolve/fb09628e98b1f55d8d5b863e0eccfcdd11bff499/tokenizer.json`, name: 'tokenizer.json', size: 11437712, sha256: '6d55eb34389b8c87403763cc1d80447d91c85c7cd39cd5e3c0dc2d49edad989d' },
      { url: `${HF}/openbmb/MiniCPM-o-4_5/resolve/fb09628e98b1f55d8d5b863e0eccfcdd11bff499/tokenizer_config.json`, name: 'tokenizer_config.json', size: 101726, sha256: 'cb1325fdb3b0b9f38b64607399d3e163fbe32bf49c273c229755a0dbce83f813' },
      { url: `${HF}/openbmb/MiniCPM-o-4_5/resolve/fb09628e98b1f55d8d5b863e0eccfcdd11bff499/utils.py`, name: 'utils.py', size: 95702, sha256: '0372698343830d4a96524f56a91a8cabf628fd7c57dde8b25db43eed1f6042c1' },
      { url: `${HF}/openbmb/MiniCPM-o-4_5/resolve/fb09628e98b1f55d8d5b863e0eccfcdd11bff499/vocab.json`, name: 'vocab.json', size: 2776833, sha256: 'ca10d7e9fb3ed18575dd1e277a2579c16d108e32f27439684afa0e10b1440910' }
    ],
    expect: ['model-00001-of-00004.safetensors', 'model-00004-of-00004.safetensors', 'config.json', 'modeling_minicpmo.py'],
    vramMb: 19000
  },
  {
    id: 'lighthouse-cg-detr-clip',
    name: 'Lighthouse CG-DETR (CLIP) + CLIP ViT-B/32 (Engine 3, Zeitpunkt-Suche)',
    kind: 'vision',
    note: 'Engine 3: findet zu einer Beschreibung die passenden Momente und Saliency im Video · Checkpoint Zenodo 13960580 (CC-BY-4.0, MD5 laut Zenodo geprüft), Code Apache-2.0 · CLIP-Gewicht von OpenAI (MIT) · ca. 0,5 GB, unter 1 GB VRAM',
    files: [
      { url: 'https://zenodo.org/api/records/13960580/files/clip_cg_detr_qvhighlight.ckpt/content', name: 'clip_cg_detr_qvhighlight.ckpt', size: 143416407, sha256: 'a47b5de4cfb0c3050affffd7cdec8347bb1e135b343bfc202077c781a065be9c' },
      { url: 'https://openaipublic.azureedge.net/clip/models/40d365715913c9da98579312b702a82c18be219cc2a73407c4526f58eba950af/ViT-B-32.pt', name: 'ViT-B-32.pt', size: 353976522, sha256: '40d365715913c9da98579312b702a82c18be219cc2a73407c4526f58eba950af' }
    ],
    expect: ['clip_cg_detr_qvhighlight.ckpt', 'ViT-B-32.pt'],
    vramMb: 1000
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
  },
  {
    id: 'llama-server',
    name: 'llama.cpp (Metal)',
    kind: 'engine',
    note: 'llama-server für die lokale Clip-Auswahl (Apple Silicon, Metal)',
    files: [{ url: `${GH_LLAMA}/llama-b11711-bin-macos-arm64.tar.gz`, name: 'llama.tar.gz', size: 12251264, sha256: 'dc1f09829c2f5c7d6e23966548ac1569a442337cbb210df1fabdcf33f3c3181f' }],
    extract: true,
    expect: ['llama-b11711/llama-server', 'llama-b11711/libggml-metal.dylib'],
    platform: 'darwin',
    recommendedFromVramMb: 0
  },
  {
    id: 'node-runtime',
    name: 'Node.js 22 (ASR-Laufzeit)',
    kind: 'engine',
    note: 'Eigene Node-Laufzeit für sherpa-onnx (läuft nicht im Electron-Prozess: "External buffers are not allowed")',
    files: [{ url: 'https://nodejs.org/dist/v22.23.3/node-v22.23.3-darwin-arm64.tar.gz', name: 'node.tar.gz', size: 49963763, sha256: '23b25245dcfb9af7262f8ff142e9e2e0af025368117329e7a7458a51e5922f53' }],
    extract: true,
    expect: ['node-v22.23.3-darwin-arm64/bin/node'],
    platform: 'darwin',
    recommendedFromVramMb: 0
  }
]

// Engine-Binärdateien gibt es je Plattform einmal (gleiche id) → nur die passende anbieten
export const CATALOG: AssetSpec[] = ALL.filter((s) => !s.platform || s.platform === process.platform)

export const byId = (id: string): AssetSpec => {
  const s = CATALOG.find((c) => c.id === id)
  if (!s) throw new Error(`Unbekanntes Asset: ${id}`)
  return s
}
