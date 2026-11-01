// Upload: Typen zwischen Main und Renderer, Teilstück-Planung und Dateiprüfung (rein, testbar).
// Logik der Teilstücke nach github.com/fernandolisboa/bardo PR #102 (nur nachgelesen, nichts eingebunden).

export type PlatformId = 'tiktok' | 'youtube' | 'instagram'

export interface PlatformStatus {
  id: PlatformId
  name: string
  /** false = ausgegraute Pille (noch nicht gebaut). */
  available: boolean
  connected: boolean
  account?: string
  /** Client key/secret fehlen noch. */
  needsSetup?: boolean
  message?: string
}

/** Ein exportierter Clip (wird beim Export festgehalten). */
export interface ExportRecord {
  id: string
  hash: string
  clipId: string
  title: string
  hookText: string
  path: string
  durationSec: number
  createdAt: string
}

export type UploadState = 'wartend' | 'laedt' | 'entwurf' | 'fehler'

export interface UploadJob {
  id: string
  exportId: string
  platform: PlatformId
  state: UploadState
  /** 0..1 */
  progress: number
  message: string
  caption: string
  createdAt: string
  publishId?: string
  /** Fortsetzung nach Abbruch: Adresse, Zeitpunkt der Initialisierung, bestätigte Teilstücke. */
  uploadUrl?: string
  initAt?: number
  chunksDone?: number
}

export interface UploadOverview {
  platforms: PlatformStatus[]
  exports: ExportRecord[]
  jobs: UploadJob[]
  /** Offene Entwürfe der letzten 24 h je Plattform. */
  drafts: Partial<Record<PlatformId, number>>
}

export interface ChunkPlan { videoSize: number; chunkSize: number; total: number; ranges: Array<[number, number]> }

const MIB = 1024 * 1024
export const MIN_CHUNK = 5 * MIB
export const MAX_CHUNK = 64 * MIB
export const DEFAULT_CHUNK = 10 * MIB
export const MAX_CHUNKS = 1000
export const DRAFT_LIMIT = 5

/**
 * TikTok-Teilstücke: < 5 MiB am Stück (chunk_size = video_size!), sonst 5 MiB … 64 MB, Anzahl = abgerundet, das letzte
 * Teilstück nimmt den Rest auf (bis 128 MB); höchstens 1000 Stück.
 */
export function planChunks(videoSize: number, preferred = DEFAULT_CHUNK): ChunkPlan {
  if (!Number.isInteger(videoSize) || videoSize <= 0) throw new Error('Leere Datei')
  let chunk = Math.min(MAX_CHUNK, Math.max(MIN_CHUNK, preferred))
  if (videoSize < MIN_CHUNK) chunk = videoSize
  let total = Math.max(1, Math.floor(videoSize / chunk))
  if (total > MAX_CHUNKS) { chunk = Math.min(MAX_CHUNK, Math.ceil(videoSize / MAX_CHUNKS)); total = Math.max(1, Math.floor(videoSize / chunk)) }
  if (total === 1) chunk = videoSize
  const ranges: Array<[number, number]> = []
  for (let i = 0; i < total; i++) ranges.push([i * chunk, i === total - 1 ? videoSize - 1 : (i + 1) * chunk - 1])
  return { videoSize, chunkSize: chunk, total, ranges }
}

export const contentRange = (r: [number, number], videoSize: number): string => `bytes ${r[0]}-${r[1]}/${videoSize}`

export interface FileFacts { ext: string; size: number; durationSec: number; width: number; height: number; fps: number }

/** TikTok-Dateivorgaben (Upload-Modus): verständliche Meldungen statt Upload bei Verstoß. */
export function checkTikTokFile(f: FileFacts): string[] {
  const out: string[] = []
  if (!['.mp4', '.mov', '.webm'].includes(f.ext.toLowerCase())) out.push(`Format ${f.ext || '?'} wird nicht angenommen (MP4, MOV oder WebM).`)
  if (f.size > 4 * 1024 * MIB) out.push('Die Datei ist größer als 4 GB.')
  if (f.durationSec > 600) out.push('Das Video ist länger als 10 Minuten.')
  if (Math.min(f.width, f.height) < 360 || Math.max(f.width, f.height) > 4096) out.push(`Auflösung ${f.width}×${f.height} liegt außerhalb von 360–4096 Pixeln.`)
  if (f.fps && (f.fps < 23 || f.fps > 60)) out.push(`Bildrate ${Math.round(f.fps)} fps liegt außerhalb von 23–60.`)
  return out
}

/** Offene Entwürfe der letzten 24 h. */
export const draftsIn24h = (jobs: UploadJob[], platform: PlatformId, now = Date.now()): number =>
  jobs.filter((j) => j.platform === platform && j.state === 'entwurf' && now - Date.parse(j.createdAt) < 24 * 3600_000).length
