// Review (UX-Upgrade 0.47): drei voneinander unabhängige Achsen je Clip
//   Freigabe (Nutzerentscheidung)  offen | freigegeben | zur_pruefung | verworfen      → projects/<hash>/review.json
//   KI-Prüfung (aus den Clipdaten)  nicht_durchgefuehrt | ausstehend | bestanden | bitte_pruefen | fehlgeschlagen
//   Lernbewertung (ratings.json)    stark | mittel | schlecht – NIE als Freigabe deuten
// Rein, ohne DOM/Node – Main und Oberfläche nutzen dieselben Regeln.
import type { EditLog } from './edits'
import type { ShortmeClip } from './shortme'

export type ReviewStatus = 'offen' | 'freigegeben' | 'zur_pruefung' | 'verworfen'
export type QualityStatus = 'nicht_durchgefuehrt' | 'ausstehend' | 'bestanden' | 'bitte_pruefen' | 'fehlgeschlagen'
export type ReviewFilter = 'alle' | 'offen' | 'ki_pruefen' | 'freigegeben' | 'verworfen'

export const REVIEW_STATUSES: ReviewStatus[] = ['offen', 'freigegeben', 'zur_pruefung', 'verworfen']
export const REVIEW_LABEL: Record<ReviewStatus, string> = { offen: 'Offen', freigegeben: 'Freigegeben', zur_pruefung: 'Zur Prüfung', verworfen: 'Verworfen' }
export const QUALITY_LABEL: Record<QualityStatus, string> = { nicht_durchgefuehrt: 'Keine KI-Prüfung', ausstehend: 'Prüfung läuft', bestanden: 'KI: geprüft', bitte_pruefen: 'KI: bitte prüfen', fehlgeschlagen: 'KI: Prüfung fehlgeschlagen' }
export const FILTER_LABEL: Record<ReviewFilter, string> = { alle: 'Alle', offen: 'Offen', ki_pruefen: 'Bitte prüfen (KI)', freigegeben: 'Freigegeben', verworfen: 'Verworfen' }

/** Gespeicherte Nutzerentscheidung je Clip. `approvedRevision` = Bearbeitungsstand bei der Freigabe. */
export interface ReviewEntry { status: ReviewStatus; updatedAt: string; approvedRevision?: string }
export type ReviewFile = Record<string, ReviewEntry>

/** Sicht der Oberfläche: Entscheidung + aktueller Bearbeitungsstand (aus dem Hauptprozess). */
export interface ReviewView extends ReviewEntry { revision: string; /** freigegeben, aber seitdem bearbeitet */ changedSinceApproval: boolean }

/** FNV-1a 32 bit – kurzer, stabiler Fingerabdruck (keine Kryptografie nötig). */
export function fnv1a(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0 }
  return h.toString(16).padStart(8, '0')
}

/** Bearbeitungsstand eines Clips: ursprüngliche Grenzen/Kürzungen + alle wirksamen Operationen (bis zum Undo-Cursor). */
export function clipRevision(clip: Pick<ShortmeClip, 'id' | 'start' | 'end'> & { autoCuts?: ShortmeClip['autoCuts'] }, log: EditLog | null | undefined): string {
  const ops = log && log.clipId === clip.id ? log.ops.slice(0, log.cursor) : []
  return fnv1a(JSON.stringify([clip.id, +clip.start.toFixed(3), +clip.end.toFixed(3), clip.autoCuts ?? [], ops]))
}

/** Neuer Zustand nach einer Entscheidung. Freigabe merkt sich den Bearbeitungsstand; andere Status vergessen ihn. */
export function decide(prev: ReviewEntry | undefined, status: ReviewStatus, revision: string, now = new Date().toISOString()): ReviewEntry {
  if (prev?.status === status && (status !== 'freigegeben' || prev.approvedRevision === revision)) return prev // idempotent
  return status === 'freigegeben' ? { status, updatedAt: now, approvedRevision: revision } : { status, updatedAt: now }
}

/** Alte/kaputte Dateien: nur gültige Einträge übernehmen; fehlende Clips gelten als „offen“ (nie künstlich freigegeben). */
export function sanitizeReviewFile(raw: unknown): ReviewFile {
  const out: ReviewFile = {}
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out
  for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
    const e = v as Partial<ReviewEntry> | null
    if (!e || !REVIEW_STATUSES.includes(e.status as ReviewStatus) || typeof e.updatedAt !== 'string') continue
    out[id] = { status: e.status as ReviewStatus, updatedAt: e.updatedAt, ...(e.status === 'freigegeben' && typeof e.approvedRevision === 'string' ? { approvedRevision: e.approvedRevision } : {}) }
  }
  return out
}

export function reviewView(entry: ReviewEntry | undefined, revision: string): ReviewView {
  const e = entry ?? { status: 'offen' as const, updatedAt: '' }
  return { ...e, revision, changedSinceApproval: e.status === 'freigegeben' && !!e.approvedRevision && e.approvedRevision !== revision }
}

/**
 * KI-Prüfstatus aus den vorhandenen Clipdaten (keine zweite Quelle): Engine 2–4/Mac liefern `v2.verification` + Unsicherheiten,
 * Engine 1 hat keine Prüfung. `edited` = Clip seit der Erzeugung bearbeitet → die Prüfung gilt für eine ältere Fassung.
 */
export function qualityOf(clip: Pick<ShortmeClip, 'v2' | 'pending'>, edited = false): { status: QualityStatus; findings: string[]; stale: boolean } {
  if (clip.pending) return { status: 'ausstehend', findings: [], stale: false }
  const v = clip.v2
  if (!v) return { status: 'nicht_durchgefuehrt', findings: [], stale: false }
  const status: QualityStatus = v.verification === 'verified' ? 'bestanden' : v.verification === 'failed' ? 'fehlgeschlagen' : 'bitte_pruefen'
  return { status, findings: (v.uncertainty ?? []).filter(Boolean).slice(0, 4), stale: edited }
}

export function matchesFilter(review: Pick<ReviewEntry, 'status'>, quality: QualityStatus, filter: ReviewFilter): boolean {
  switch (filter) {
    case 'alle': return true
    case 'offen': return review.status === 'offen' || review.status === 'zur_pruefung'
    case 'ki_pruefen': return quality === 'bitte_pruefen' || quality === 'fehlgeschlagen'
    case 'freigegeben': return review.status === 'freigegeben'
    case 'verworfen': return review.status === 'verworfen'
  }
}

/** Nächster noch nicht entschiedener Clip nach `from` (rundum), sonst null. */
export function nextOpenIndex(statuses: ReviewStatus[], from: number): number | null {
  const n = statuses.length
  for (let k = 1; k <= n; k++) { const i = (from + k) % n; if (statuses[i] === 'offen' || statuses[i] === 'zur_pruefung') return i }
  return null
}
