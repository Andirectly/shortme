// Modell-Plätze (Testlab): Katalog aus resources/models-catalog.json + Zustand auf dem Rechner des Nutzers.

export type ModelStatus = 'aktiv' | 'test' | 'entfernen' | 'kandidat'

export interface CatalogSlot { id: string; name: string }
export interface CatalogModel {
  id: string
  slot: string
  /** Status laut Katalog-Datei (Grundzustand). */
  status: ModelStatus
  /** Im Code eingebunden und im Testlab wählbar. */
  integrated?: boolean
  /** Modell-Manager-IDs der benötigten Dateien (fehlt = mitgeliefert). */
  assets?: string[]
  name: string
  short: string
  pros: string[]
  cons: string[]
  size: string
  license: string
  bestFor: string
}

/** Auf dem eigenen Rechner gemessen (Testlab); hat Vorrang vor den Katalogwerten. */
export interface Measured {
  runtimeSec: number
  vramPeakMb: number
  /** Anteil der Sprechzeit (VAD) mit erkanntem Gesicht, 0..1. */
  speechFaceShare: number | null
  /** Testclip, an dem gemessen wurde. */
  clip: string
  at: string
}

export interface ModelView extends CatalogModel {
  /** Wirksamer Status (Katalog + Entscheidungen im Testlab). */
  effective: ModelStatus
  measured?: Measured
  /** Alle benötigten Dateien sind geladen. */
  installed: boolean
}

export interface ModelsView { slots: CatalogSlot[]; models: ModelView[]; active: Record<string, string> }

/** Pro Platz: ein aktives Modell und höchstens zwei integrierte Alternativen. */
export const MAX_ALTERNATIVES = 2

// --- Testlab-Vergleich ----------------------------------------------------------------------------

export interface LabSource { id: string; label: string; path: string; durationSec: number; width: number; height: number; kind: 'test' | 'project' }

export interface LabTrack {
  id: number
  /** Zeit (s, relativ zum Testclip) der ersten Probe und Schrittweite. */
  t0: number
  dt: number
  /** Je Probe [x1, y1, x2, y2] normiert. */
  boxes: Array<[number, number, number, number]>
  /** ASD-Logit je Probe. */
  scores: number[]
}

export interface LabResult {
  version: 1
  model: string
  slot: string
  source: string
  start: number
  dur: number
  runtimeSec: number
  vramPeakMb: number
  speechFaceShare: number | null
  speechSec: number
  /** Geschätzte ID-Wechsel: neue Spur beginnt kurz nach dem Ende einer anderen an gleicher Stelle (gleiche Einstellung). */
  idSwitches: number
  /** Aktive Modelle der anderen Plätze beim Test (Face/Tracker), damit nur das getestete Modell den Unterschied macht. */
  context: string
  /** Probenraster (Hz) der Spuren/Sprecher. */
  hz: number
  tracks: LabTrack[]
  /** Aktive Sprecher-Spur je Probe (null = keiner). */
  active: Array<number | null>
  shots: Array<{ start: number; end: number; layout: string; cx: number; cx2?: number; zoom: number }>
}

export interface LabRunRequest { slot: string; modelA: string; modelB: string; source: string; start: number; dur: number }
