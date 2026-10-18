import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { AssetManager } from './manager'
import type { CheckItem, HardwareInfo } from '@shared/engines'
import { runCommand } from './hardware'
import { LlamaServer } from './sidecars'
import { dataRoot } from './paths'
import { FFMPEG_PATH } from '../pipeline/ffmpeg'
import { ytDlpPath } from '../pipeline/ytdlp'
import { modelsDir } from '../pipeline/detect'

const MIN_RESERVE_GB = 1

async function tryRun(cmd: string, args: string[]): Promise<string | null> {
  try { return (await runCommand(cmd, args, 15000)).trim() } catch { return null }
}

/** Systemcheck (Einstellungen → Systemcheck, Setup-Assistent). */
export async function runSystemCheck(mgr: AssetManager, hw: HardwareInfo): Promise<CheckItem[]> {
  const items: CheckItem[] = []

  const ff = await tryRun(FFMPEG_PATH, ['-version'])
  const enc = ff ? await tryRun(FFMPEG_PATH, ['-hide_banner', '-encoders']) : null
  const nvenc = !!enc && enc.includes('h264_nvenc')
  items.push({ id: 'ffmpeg', name: 'FFmpeg', ok: !!ff, detail: ff ? `${ff.split('\n')[0].slice(0, 40)}${nvenc ? ' · NVENC im Build' : ' · kein NVENC'}` : 'nicht gefunden' })

  const yt = existsSync(ytDlpPath()) ? await tryRun(ytDlpPath(), ['--version']) : null
  items.push({ id: 'yt-dlp', name: 'yt-dlp', ok: !!yt, detail: yt ? `${yt} · selbst-aktualisierend` : 'noch nicht geladen (wird im Assistenten installiert)' })

  const llamaInstalled = await mgr.isInstalled('llama-server')
  const llamaVer = llamaInstalled ? await tryRun(LlamaServer.exe(), ['--version']) : null
  items.push({ id: 'llama-server', name: 'llama-server', ok: !!llamaVer, detail: llamaInstalled ? (llamaVer ? 'startet' : 'startet nicht (CUDA-Treiber prüfen)') : 'nicht installiert' })

  let ort = 'nicht ladbar'
  let ortOk = false
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const o = require('onnxruntime-node')
    ort = `onnxruntime-node ${o.env?.versions?.common ?? ''}`.trim()
    ortOk = true
  } catch { /* bleibt "nicht ladbar" */ }
  let sherpaOk = false
  try { require('sherpa-onnx-node'); sherpaOk = true } catch { /* nicht ladbar */ }
  items.push({ id: 'runtime', name: 'ONNX Runtime / sherpa-onnx', ok: ortOk && sherpaOk, detail: `${ort} · sherpa-onnx ${sherpaOk ? 'ok' : 'nicht ladbar'}` })

  items.push({ id: 'gpu', name: 'GPU / VRAM', ok: !!hw.gpuName, detail: hw.gpuName ? `${hw.gpuName} · ${(hw.vramTotalMb / 1024).toFixed(0)} GB · Treiber ${hw.driver}` : 'keine NVIDIA-GPU erkannt (CPU-Betrieb sehr langsam)' })

  const vision = ['lr-asd-frontend.onnx', 'lr-asd-backend.onnx', 'face-detection-yunet.onnx', 'ultraface-rfb-320.onnx', 'silero-vad.onnx'].filter((f) => !existsSync(join(modelsDir(), f)))
  items.push({ id: 'bundled-models', name: 'Mitgelieferte Modelle', ok: vision.length === 0, detail: vision.length ? `fehlen: ${vision.join(', ')}` : 'Gesichter, LR-ASD, VAD vorhanden' })

  const required = ['parakeet-v3', 'silero-vad', 'transnetv2', 'yolov8n-pose', 'node-runtime', 'speaker-segmentation', 'speaker-embedding', hw.recommendedLlm]
  const missing: string[] = []
  for (const id of required) if (!(await mgr.isInstalled(id))) missing.push(id)
  items.push({ id: 'models', name: 'Modelle (Assistent)', ok: missing.length === 0, detail: missing.length ? `fehlen: ${missing.join(', ')}` : `Parakeet, ${hw.recommendedLlm}, TransNetV2` })

  items.push({ id: 'disk', name: 'Freier Speicher', ok: hw.freeDiskGb >= MIN_RESERVE_GB, detail: `${hw.freeDiskGb} GB frei in ${dataRoot()} · Reserve ≥ ${MIN_RESERVE_GB} GB` })
  return items
}
