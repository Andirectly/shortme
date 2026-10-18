// Shortme: Typen zwischen Main und Renderer (Import, Jobs, Transkript).
import type { TwitchMeta } from './twitch'
import type { StreamLayout } from './streamLayout'
import type { ContentType } from './videoKind'

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
  twitch?: TwitchMeta
  /** Gewählter Inhaltstyp (Erstellen-Dialog, im Editor umstellbar). */
  contentType?: ContentType
  sourceUrl?: string
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
  /** „Most replayed“-Stärke 0..1 über den Clip (nur YouTube-Importe). */
  heat?: number
  /** Chat-Aktivität 0..1 über den Clip (nur Twitch mit Chat-Schalter). */
  chat?: number
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
  /** Gesichtsquote 0..1 und Shots (feste Ausschnitte je Einstellung), nach M5. */
  faceRatio?: number
  shots?: ShortmeShot[]
  /** Facecam-Layout des Clips (erkannt oder vom Kanal übernommen); Grundlage für Szenen mit layout 'stream'. */
  stream?: StreamLayout
  /** Korrigierte Untertitel-Texte (globaler Wortindex → Text): Zeichensetzung, Groß-/Kleinschreibung, erkannte Fehler. */
  corrections?: Record<number, string>
}

/** Eine Einstellung: fester Ausschnitt, keine Kamerabewegung. Zeiten relativ zum Clipbeginn (Sekunden). */
export interface ShortmeShot {
  start: number
  end: number
  layout: 'smart' | 'split' | 'fit' | 'fixed' | 'stream'
  /** layout 'stream': Facecam oben/unten/50:50/Fenster + Gameplay (Rahmen der Quelle). */
  stream?: StreamLayout
  /** Horizontale Mitte (0..1 der Quellbreite) des 9:16-Ausschnitts; bei split: obere Person. */
  cx: number
  /** split: untere Person. */
  cx2?: number
  zoom: number
  track?: number
}

export interface ShortmeClips {
  version: 1
  hash: string
  query: string
  createdAt: string
  mode: 'llm' | 'texttiling'
  clips: ShortmeClip[]
  /** Gewählter Inhaltstyp des Projekts und (bei Twitch) der Kanal. */
  contentType?: ContentType | null
  channel?: string | null
  /** Vorschaubilder als Data-URL je Clip-ID. */
  thumbs: Record<string, string | null>
  /** Quellvideo (für die Editor-Vorschau über media://). */
  source: { path: string; width: number; height: number; title: string; durationSec: number } | null
}

/** Plan des Exports für die Editor-Vorschau (Zeiten in Quell-Sekunden; Shots clip-relativ zu `start`). */
export interface PreviewPlan {
  start: number
  end: number
  duration: number
  cuts: Array<[number, number]>
  shots: ShortmeShot[]
  pieces: Array<{ src0: number; src1: number; out0: number; zoom: number; shot: ShortmeShot }>
}

/** „Wer ist wer?“ – erkannte Personen des Videos (Vorschaubild als Data-URL). */
export type PersonRole = 'normal' | 'main' | 'ignore'
export interface ShortmePerson { id: string; label: string; role: PersonRole; seconds: number; thumb: string | null }
export interface ShortmePersons { confirmed: boolean; confidence: number; needsReview: boolean; persons: ShortmePerson[] }
export interface PersonsPatch { labels?: Record<string, string>; roles?: Record<string, PersonRole> }
