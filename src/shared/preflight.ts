// Export-Vorabprüfung (UX-Upgrade): nur messbare Befunde aus Plan, Quelle, Untertiteln und vorhandenen Prüfungen.
// Kein „garantiert gut“: Hinweise blockieren nichts, Warnungen fragen nach, nur ein echter Fehler (Quelle fehlt) verhindert den Export.
import type { PreviewPlan } from './shortme'
import type { QualityStatus, ReviewStatus } from './review'

export interface PreflightIssue {
  id: string
  level: 'fehler' | 'warnung' | 'hinweis'
  text: string
  /** Stelle in der Quelle (Sekunden), zu der die Oberfläche springen kann. */
  at?: number
}

export interface PreflightInput {
  hasSource: boolean
  plan: Pick<PreviewPlan, 'start' | 'duration' | 'shots'> | null
  /** Untertitel-Wörter im exportierten Bereich. */
  words: number
  captions: boolean
  quality?: { status: QualityStatus; findings: string[] }
  review?: { status: ReviewStatus; changedSinceApproval?: boolean }
}

export function preflight(i: PreflightInput): PreflightIssue[] {
  const out: PreflightIssue[] = []
  if (!i.hasSource) out.push({ id: 'source', level: 'fehler', text: 'Das Quellvideo fehlt – der Export ist nicht möglich. Das Video erneut laden oder importieren.' })
  if (!i.plan) { out.push({ id: 'plan', level: 'hinweis', text: 'Der Schnittplan wird noch berechnet.' }); return out }
  const d = i.plan.duration
  if (d < 5) out.push({ id: 'short', level: 'warnung', text: `Sehr kurz (${d.toFixed(1)} s).` })
  if (d > 180) out.push({ id: 'long', level: 'warnung', text: `Länger als 3 Minuten (${Math.round(d)} s) – zu lang für YouTube Shorts.` })
  else if (d > 90) out.push({ id: 'long', level: 'hinweis', text: `Länger als 90 s (${Math.round(d)} s) – prüfen, ob die Plattform das annimmt.` })
  const empty = i.plan.shots.filter((s) => s.auto === 'empty')
  if (empty.length) out.push({ id: 'empty', level: 'warnung', text: `${empty.length === 1 ? 'Eine Einstellung' : `${empty.length} Einstellungen`} ohne Person im Bildausschnitt (automatisch Vollbild).`, at: i.plan.start + empty[0].start })
  if (i.captions && i.words === 0) out.push({ id: 'nocaps', level: 'warnung', text: 'Im Bereich gibt es keine Untertitel-Wörter.' })
  if (i.review?.status === 'verworfen') out.push({ id: 'discarded', level: 'warnung', text: 'Dieser Clip ist im Review als „verworfen“ markiert.' })
  if (i.quality && (i.quality.status === 'bitte_pruefen' || i.quality.status === 'fehlgeschlagen')) out.push({ id: 'ai', level: 'hinweis', text: `KI-Prüfung: ${i.quality.status === 'fehlgeschlagen' ? 'nicht bestanden' : 'bitte ansehen'}${i.quality.findings[0] ? ` – ${i.quality.findings[0]}` : ''}` })
  return out
}

/** Muss vor dem Export nachgefragt werden? (nur bei Warnungen/Fehlern) */
export const needsConfirm = (issues: PreflightIssue[]): boolean => issues.some((x) => x.level !== 'hinweis')
export const blocks = (issues: PreflightIssue[]): boolean => issues.some((x) => x.level === 'fehler')
