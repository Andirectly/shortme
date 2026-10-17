// Gemeinsame Typen für Engines / Modell-Manager (Main ↔ Renderer).

export type AssetKind = 'transcription' | 'llm' | 'vision' | 'engine' | 'vad'

export interface AssetFile {
  url: string
  /** Zieldatei relativ zum Asset-Ordner (bei Archiven: Archivname). */
  name: string
  size: number
  /** Leer = nicht geprüft (nur wenn der Anbieter keinen Hash liefert). */
  sha256: string
}

export interface AssetSpec {
  id: string
  name: string
  kind: AssetKind
  note: string
  /** Datei(en), die geladen werden. */
  files: AssetFile[]
  /** Archiv nach dem Laden entpacken (tar/zip). */
  extract?: boolean
  /** Dateien, die nach der Installation vorhanden sein müssen (relativ zum Asset-Ordner). */
  expect: string[]
  /** Ungefährer VRAM-Bedarf in MB (nur LLM/ASR) bei 16k Kontext. */
  vramMb?: number
  /** Teil der Basis-Empfehlung? Mindest-VRAM in MB, ab dem das Profil empfohlen wird. */
  recommendedFromVramMb?: number
  /** Windows-only (Engine-Binärdateien). */
  platform?: 'win32'
}

export type AssetState = 'installed' | 'missing' | 'downloading' | 'paused' | 'verifying' | 'extracting' | 'error'

export interface AssetStatus {
  id: string
  state: AssetState
  /** 0..1 */
  progress: number
  bytesDone: number
  bytesTotal: number
  error?: string
}

export interface HardwareInfo {
  gpuName: string | null
  vramTotalMb: number
  vramFreeMb: number
  driver: string | null
  freeDiskGb: number
  profile: 'standard' | 'kompakt' | 'cpu'
  recommendedLlm: string
  /** KV-Cache auf q8_0 quantisieren, wenn knapp. */
  kvQuant: boolean
}

export interface CheckItem {
  id: string
  name: string
  ok: boolean
  detail: string
}

export interface EngineEvent {
  type: 'status' | 'log'
  status?: AssetStatus
  message?: string
}
