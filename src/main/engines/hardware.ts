import { execFile } from 'node:child_process'
import { statfs } from 'node:fs/promises'
import type { HardwareInfo } from '@shared/engines'

export interface GpuRow { name: string; totalMb: number; freeMb: number; driver: string }

/** Parst `nvidia-smi --query-gpu=name,memory.total,memory.free,driver_version --format=csv,noheader,nounits`. Wählt die GPU mit dem meisten VRAM. */
export function parseNvidiaSmi(csv: string): GpuRow | null {
  const rows = csv
    .split(/\r?\n/)
    .map((l) => l.split(',').map((s) => s.trim()))
    .filter((c) => c.length >= 4 && Number.isFinite(Number(c[1])))
    .map((c) => ({ name: c[0], totalMb: Number(c[1]), freeMb: Number(c[2]), driver: c[3] }))
  if (rows.length === 0) return null
  return rows.reduce((a, b) => (b.totalMb > a.totalMb ? b : a))
}

/** Profil/Empfehlung nach VRAM (docs/ROADMAP M2; Messwerte aus spikes/RESULTS.md). */
export function recommend(vramMb: number): Pick<HardwareInfo, 'profile' | 'recommendedLlm' | 'kvQuant'> {
  if (vramMb >= 14000) return { profile: 'standard', recommendedLlm: 'qwen3-14b', kvQuant: false }
  if (vramMb >= 12000) return { profile: 'standard', recommendedLlm: 'qwen3-14b', kvQuant: true }
  if (vramMb >= 7500) return { profile: 'kompakt', recommendedLlm: 'qwen3-8b', kvQuant: false }
  return { profile: 'cpu', recommendedLlm: 'qwen3-8b', kvQuant: true }
}

function run(cmd: string, args: string[], timeout = 8000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout, windowsHide: true }, (err, stdout, stderr) => (err ? reject(err) : resolve(String(stdout) || String(stderr))))
  })
}

export async function freeDiskGb(dir: string): Promise<number> {
  try {
    const s = await statfs(dir)
    return Math.floor((s.bavail * s.bsize) / 1024 ** 3)
  } catch {
    return 0
  }
}

export async function detectHardware(dataDir: string): Promise<HardwareInfo> {
  let gpu: GpuRow | null = null
  try {
    gpu = parseNvidiaSmi(await run('nvidia-smi', ['--query-gpu=name,memory.total,memory.free,driver_version', '--format=csv,noheader,nounits']))
  } catch {
    gpu = null
  }
  const vram = gpu?.totalMb ?? 0
  return {
    gpuName: gpu?.name ?? null,
    vramTotalMb: vram,
    vramFreeMb: gpu?.freeMb ?? 0,
    driver: gpu?.driver ?? null,
    freeDiskGb: await freeDiskGb(dataDir),
    ...recommend(vram)
  }
}

export { run as runCommand }
