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
  /** Hörbare Länge in Sekunden (nach Kürzen/Teilen). */
  dur: number
  /** Sprung in die Datei (vorn gekürzt oder hinterer Teil nach dem Teilen). */
  in?: number
  /** Länge der ganzen Datei (Grenze beim Verlängern); fehlt bei alten Spuren → in + dur. */
  fileDur?: number
  /** Pegel in dB (0 = unverändert). */
  gainDb: number
  kind: 'sfx' | 'music'
}

export const GAIN_MIN_DB = -40
export const GAIN_MAX_DB = 30
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
  // verschobene Stücke (nicht aufsteigend): zuerst das Stück, das die Zeit enthält
  const hit = keeps.find((k) => src >= k.src0 && src < k.src1)
  if (hit) return hit.out0 + (src - hit.src0)
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
    const lead = Math.max(0, first - c.at)
    const offset = (c.in ?? 0) + lead
    const delay = lead > 0 ? outTimeOf(first, keeps) : outTimeOf(c.at, keeps)
    const len = Math.min(c.dur - lead, outDuration - delay)
    if (len > 0.02) out.push({ file: c.file, delay, offset, len, gainDb: c.gainDb })
  }
  return out
}

/** Pegel für einen Bereich des Originaltons (Quellzeit), z. B. eine leise Stelle lauter machen. Überlappende Bereiche addieren sich. */
export interface VoiceRange { id: string; start: number; end: number; gainDb: number }

/** Übergangszeit an den Bereichsgrenzen (klickfrei). */
export const RANGE_RAMP = 0.03

/** Zusätzlicher Pegel (dB) an Quellzeit `t` – mit derselben Rampe wie im Export. */
export function rangeDbAt(ranges: VoiceRange[], t: number): number {
  let db = 0
  for (const r of ranges) {
    const w = Math.min(1, Math.max(0, Math.min((t - r.start) / RANGE_RAMP, (r.end - t) / RANGE_RAMP)))
    if (w > 0) db += 20 * Math.log10(1 + (dbToGain(r.gainDb) - 1) * w)
  }
  return db
}

/**
 * FFmpeg-Filter auf der Ausgabe-Zeitachse (nach der Lautheitsnormalisierung – sonst gleicht diese den Pegel wieder aus).
 * `pieces` = Stücke in Ausgabereihenfolge; ein Bereich über einen Schnitt hinweg wird zu aneinanderliegenden Ausgabe-Intervallen, die verschmelzen (keine Delle an der Naht).
 */
export function rangeFilters(ranges: VoiceRange[], pieces: KeepSpan[]): string[] {
  const out: string[] = []
  for (const r of ranges) {
    if (!r.gainDb) continue
    const iv: Array<[number, number]> = []
    for (const p of pieces) {
      const a = Math.max(r.start, p.src0), b = Math.min(r.end, p.src1)
      if (b <= a) continue
      const o0 = p.out0 + (a - p.src0), o1 = p.out0 + (b - p.src0)
      const last = iv[iv.length - 1]
      if (last && Math.abs(last[1] - o0) < 1e-3) last[1] = o1
      else iv.push([o0, o1])
    }
    const g = dbToGain(r.gainDb).toFixed(5)
    for (const [a, b] of iv) out.push(`volume='1+(${g}-1)*clip(min((t-${a.toFixed(3)})/${RANGE_RAMP},(${b.toFixed(3)}-t)/${RANGE_RAMP}),0,1)':eval=frame`)
  }
  return out
}
