// Zusätzliche Tonspuren im Editor (Soundeffekte, Musik): reine Daten + Platzierung auf der Ausgabe-Zeitachse.
// Von Editor (Vorschau) und Export (FFmpeg-Mischung) gemeinsam genutzt – Vorschau = Export.

export interface AudioClip {
  id: string
  /** Dateiname im Projektordner `media/` (relativ, damit das Projekt beim Remote-Job mitwandert). */
  file: string
  /** Anzeigename (ursprünglicher Dateiname). */
  name: string
  /** Beginn in Quellzeit (wie Trim/Schnitte); der Ton läuft ab dort ohne Unterbrechung auf der Ausgabe weiter. */
  at: number
  /** Länge der Datei in Sekunden. */
  dur: number
  /** Pegel in dB (0 = unverändert). */
  gainDb: number
  kind: 'sfx' | 'music'
}

export const GAIN_MIN_DB = -40
export const GAIN_MAX_DB = 12
export const clampDb = (db: number): number => Math.min(GAIN_MAX_DB, Math.max(GAIN_MIN_DB, Math.round(db * 10) / 10))
export const dbToGain = (db: number): number => Math.pow(10, db / 20)

/** Ein Abschnitt der Ausgabe: Quelle [src0, src1) liegt ab Ausgabezeit out0. */
export interface KeepSpan { src0: number; src1: number; out0: number }

export interface PlacedAudio {
  file: string
  /** Ausgabezeit, ab der die Datei hörbar ist. */
  delay: number
  /** Sprung in die Datei (Ton beginnt vor dem Clip). */
  offset: number
  /** Hörbare Länge auf der Ausgabe. */
  len: number
  gainDb: number
}

/** Quellzeit → Ausgabezeit über die Abschnitte des eigentlichen Clips (ohne Cold-Opener-Vorspann); in einer entfernten Lücke der Beginn des nächsten Abschnitts. */
export function outTimeOf(src: number, keeps: KeepSpan[]): number {
  for (const k of keeps) {
    if (src < k.src0) return k.out0
    if (src < k.src1) return k.out0 + (src - k.src0)
  }
  const last = keeps[keeps.length - 1]
  return last ? last.out0 + (last.src1 - last.src0) : 0
}

/** Tonspuren auf die Ausgabe legen (`keeps` = Abschnitte des Clips ohne Vorspann); was ganz außerhalb liegt oder stumm ist, entfällt. */
export function placeAudio(clips: AudioClip[], keeps: KeepSpan[], outDuration: number): PlacedAudio[] {
  const first = keeps.reduce((m, k) => Math.min(m, k.src0), Infinity)
  const out: PlacedAudio[] = []
  for (const c of clips) {
    if (!(c.dur > 0) || c.gainDb <= GAIN_MIN_DB) continue
    // Beginnt der Ton vor dem Clip, fehlt sein Anfang (wie beim Video)
    const offset = Math.max(0, first - c.at)
    const delay = offset > 0 ? outTimeOf(first, keeps) : outTimeOf(c.at, keeps)
    const len = Math.min(c.dur - offset, outDuration - delay)
    if (len > 0.02) out.push({ file: c.file, delay, offset, len, gainDb: c.gainDb })
  }
  return out
}
