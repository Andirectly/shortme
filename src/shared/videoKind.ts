// Inhaltstyp („Was ist das für ein Video?“): steuert Bildausschnitt, Ton-Markierungen, Ranking-Gewichte und die Prompt-Variante.
// Die Profile liegen als Konfigurationsdateien in resources/profiles/<typ>.json.

export type ContentType = 'podcast' | 'vlog' | 'solo' | 'stream' | 'talk'

export const CONTENT_TYPES: Array<{ id: ContentType; label: string }> = [
  { id: 'podcast', label: 'Podcast / Interview' },
  { id: 'vlog', label: 'Vlog' },
  { id: 'solo', label: 'Talking Head / Solo' },
  { id: 'stream', label: 'Stream / Gaming' },
  { id: 'talk', label: 'Vortrag / Präsentation' }
]

export const contentLabel = (t: ContentType): string => CONTENT_TYPES.find((c) => c.id === t)?.label ?? t

/** Bildausschnitt-Wahl im Erstellen-Dialog. */
export type FrameChoice = 'smart' | 'fit' | 'split' | 'fixed' | 'stream'

export const FRAME_LABELS: Record<FrameChoice, string> = { smart: 'Smart', fit: 'Vollbild', split: 'Split', fixed: 'Fest', stream: 'Facecam + Gameplay' }
export const frameFromLabel = (l: string): FrameChoice => (Object.entries(FRAME_LABELS).find(([, v]) => v === l)?.[0] as FrameChoice | undefined) ?? 'smart'

export interface KindProfile {
  id: ContentType
  label: string
  /** Standard-Bildausschnitt dieses Typs. */
  frame: FrameChoice
  tracking: {
    /** Bei zwei Sprechern im Wechsel: Split-Bild erlaubt. */
    split: boolean
    /** speaker = folgt dem Sprechenden, main = bleibt bei der Hauptperson, fixed = ein fester Ausschnitt. */
    follow: 'speaker' | 'main' | 'fixed'
  }
  /** Ton-Markierungen im Transkript für das LLM (laugh, applause, loud, pause). */
  marks: string[]
  /** Gewichte der Ranking-Signale (1 = unverändert; signal = Lautstärke/Ausbrüche, heat = „Most replayed“, chat = Twitch-Chat). */
  ranking: { signal: number; heat: number; chat: number }
  /** Prompt-Variante: Zusatz-Hinweis für die Clip-Auswahl. */
  prompt: string
  /** Vorgesehene (integrierte, aktive) Modelle; fehlt eines, arbeitet die Pipeline ohne es weiter. */
  models: string[]
}

export const FALLBACK_PROFILE: KindProfile = {
  id: 'podcast', label: 'Podcast / Interview', frame: 'smart', tracking: { split: true, follow: 'speaker' },
  marks: ['laugh', 'applause', 'loud', 'pause'], ranking: { signal: 5, heat: 1, chat: 1 }, prompt: '', models: ['yamnet']
}

/** Gültige Profil-Datei zu einem vollständigen Profil ergänzen. */
export function sanitizeProfile(x: unknown, id: ContentType): KindProfile {
  const o = (x ?? {}) as Partial<KindProfile>
  const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 20 ? v : d)
  const frames: FrameChoice[] = ['smart', 'fit', 'split', 'fixed', 'stream']
  const follows = ['speaker', 'main', 'fixed']
  return {
    id, label: typeof o.label === 'string' ? o.label : contentLabel(id),
    frame: frames.includes(o.frame as FrameChoice) ? (o.frame as FrameChoice) : FALLBACK_PROFILE.frame,
    tracking: { split: o.tracking?.split !== false, follow: follows.includes(o.tracking?.follow as string) ? (o.tracking!.follow as KindProfile['tracking']['follow']) : 'speaker' },
    marks: Array.isArray(o.marks) ? o.marks.filter((m): m is string => typeof m === 'string') : FALLBACK_PROFILE.marks,
    ranking: { signal: num(o.ranking?.signal, 5), heat: num(o.ranking?.heat, 1), chat: num(o.ranking?.chat, 1) },
    prompt: typeof o.prompt === 'string' ? o.prompt : '',
    models: Array.isArray(o.models) ? o.models.filter((m): m is string => typeof m === 'string') : []
  }
}

/** Eingaben der automatischen Einschätzung beim Import. */
export interface KindStats {
  /** Facecam gefunden (kleines, ortsfestes Gesicht in einer Ecke/am Rand). */
  facecam: boolean
  /** Stichproben mit einem großen Gesicht / mit zwei oder mehr großen Gesichtern (Anteile 0..1). */
  oneFace: number
  twoFaces: number
  /** Kamerawechsel pro Minute (grobe Zählung). */
  cutsPerMin: number
  twitch: boolean
}

export interface KindGuess { kind: ContentType; reason: string }

/** Typ aus den Stichproben einschätzen (reine Regeln, bewusst einfach und erklärbar). */
export function guessKind(s: KindStats): KindGuess {
  if (s.twitch) return { kind: 'stream', reason: 'Twitch-Import' }
  if (s.facecam) return { kind: 'stream', reason: 'Facecam im Bild gefunden' }
  if (s.twoFaces >= 0.35) return { kind: 'podcast', reason: 'zwei Personen im Bild' }
  if (s.oneFace >= 0.5) return s.cutsPerMin > 6 ? { kind: 'vlog', reason: 'eine Person, viele Schnitte' } : { kind: 'solo', reason: 'eine Person, ruhiges Bild' }
  return { kind: 'talk', reason: 'kaum Gesichter im Bild' }
}
