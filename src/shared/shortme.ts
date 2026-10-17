// Shortme: Typen zwischen Main und Renderer (Import, Jobs, Transkript).

export interface ShortmeMeta {
  hash: string
  title: string
  sourcePath: string
  durationSec: number
  width: number
  height: number
  fps: number
  sizeBytes: number
  hasAudio: boolean
  created: string
  stages: Record<string, { done: boolean; at?: string }>
}

export interface ShortmePreflight { ok: boolean; errors: string[]; warnings: string[]; peakGb: number }

export interface ShortmeImport {
  meta: ShortmeMeta
  preflight: ShortmePreflight
  cached: boolean
  poster: string | null
  ambient: string | null
}

export type ShortmeJobState = 'queued' | 'running' | 'paused' | 'stopped' | 'done' | 'error'

export interface ShortmeJob {
  id: string
  hash: string
  title: string
  state: ShortmeJobState
  stage: string
  progress: number
  message: string
  error?: string
}

export interface ShortmeWord { w: string; start: number; end: number; speaker?: number }

export interface ShortmeTranscript {
  version: number
  hash: string
  model: string
  durationSec: number
  words: ShortmeWord[]
  segments: Array<{ start: number; end: number; text: string; first: number; last: number }>
  speech: Array<[number, number]>
  diarized: boolean
  speakers: number
}
