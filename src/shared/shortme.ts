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

export type ClipTagKind = 'emphasis' | 'entity' | 'hook'

export interface ShortmeClip {
  id: string
  /** Sekunden im Quellvideo (nach dem Einrasten). */
  start: number
  end: number
  /** Wortindizes im Transkript (erstes/letztes Wort des Clips). */
  firstWord: number
  lastWord: number
  /** 0–100 (Raster + Finalisten-Vergleich + Signale). */
  score: number
  criteria: { hook: number; payoff: number; quotable: number; standalone: number; density: number }
  title: string
  hookText: string
  /** Ein Satz Begründung zum Score. */
  reason: string
  /** Schlüsselwörter für Untertitel (Wortindex im Transkript). */
  tags: Array<{ word: number; kind: ClipTagKind }>
  source: 'llm' | 'texttiling'
  /** Durchlaufene Einrast-Stufen, z. B. ['word','sentence','silence_end']. */
  snap: string[]
  /** Ende wurde im Schritt „Ende prüfen“ um n Sätze verlängert. */
  extended: number
}

export interface ShortmeClips {
  version: 1
  hash: string
  query: string
  createdAt: string
  mode: 'llm' | 'texttiling'
  clips: ShortmeClip[]
  /** Vorschaubilder als Data-URL je Clip-ID. */
  thumbs: Record<string, string | null>
}
