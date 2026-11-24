/**
 * Freigabe-Schranke (Plan V3, Kap. 9/10/12): Nur ein `accepted`-Audit, das exakt zu diesem Render
 * (SHA-256, Attempt, Clipversion) gehört, darf veröffentlicht werden. Import ist idempotent.
 */
import type { ClipImportedAck, ClipResultPublished, ReleaseState } from './protocol'

export interface RenderedClip {
  clipId: string
  clipRevision: string
  renderAttemptId: string
  /** SHA-256 der tatsächlich fertig geschriebenen Datei. */
  renderSha256: string
  /** Datei vollständig geschrieben und per ffprobe lesbar (Streams/Dauer geprüft). */
  fileChecked: boolean
}
export interface AuditResult { status: 'accepted' | 'review' | 'repair'; renderAttemptId: string; clipRevision: string; renderedSha256: string }

export type GateResult = { ok: true } | { ok: false; release: ReleaseState; reason: string }

/** `currentRevision` = aktuelle Clipversion im Projekt (neuere Edits überholen alte Renders). */
export function releaseGate(r: RenderedClip, a: AuditResult | null, currentRevision: string): GateResult {
  if (!r.fileChecked) return { ok: false, release: 'processing', reason: 'Datei nicht vollständig geprüft' }
  if (r.clipRevision !== currentRevision) return { ok: false, release: 'superseded', reason: 'Neuere Bearbeitung vorhanden' }
  if (!a) return { ok: false, release: 'processing', reason: 'Audit fehlt' }
  if (a.renderAttemptId !== r.renderAttemptId || a.clipRevision !== r.clipRevision || a.renderedSha256 !== r.renderSha256)
    return { ok: false, release: 'processing', reason: 'Audit gehört zu einem anderen Render – neues Audit nötig' }
  if (a.status === 'review') return { ok: false, release: 'audit-review', reason: 'Prüfung nötig' }
  if (a.status === 'repair') return { ok: false, release: 'repair-required', reason: 'Reparatur nötig' }
  return { ok: true }
}

/** Client-Seite: dieselben Invarianten erneut prüfen, bevor eine Publikation angenommen wird (Kap. 13). */
export function validPublication(p: ClipResultPublished): boolean {
  return p.audit.decision === 'accepted' && p.audit.renderedSha256 === p.renderSha256 &&
    p.audit.renderAttemptId === p.renderAttemptId && p.audit.clipRevision === p.clipRevision
}

/** Schlüssel für idempotenten Import: gleiche Publikation = gleicher Schlüssel, egal wie oft gesendet. */
export const importKey = (p: Pick<ClipResultPublished, 'jobId' | 'clipId' | 'clipRevision' | 'renderAttemptId'>): string =>
  [p.jobId, p.clipId, p.clipRevision, p.renderAttemptId].join('|')

export type ImportDecision = 'import' | 'already-imported' | 'stale' | 'invalid'

/**
 * Was der Client mit einer Publikation tut. `imported` = bereits importierte Schlüssel;
 * `currentRevision` = aktuelle Clipversion im lokalen Projekt (undefined = Clip neu).
 * Eine alte Revision wird Historie und überschreibt nie die aktuelle Timeline.
 */
export function importDecision(p: ClipResultPublished, imported: ReadonlySet<string>, currentRevision: string | undefined): ImportDecision {
  if (!validPublication(p)) return 'invalid'
  if (imported.has(importKey(p))) return 'already-imported'
  if (currentRevision !== undefined && currentRevision !== p.clipRevision) return 'stale'
  return 'import'
}

/** ACK erst nach verifiziertem Import; quittiert genau diesen Render. */
export function makeAck(p: ClipResultPublished, eventId: string, importedSha256: string, projectRevision: number): ClipImportedAck {
  if (importedSha256 !== p.renderSha256) throw new Error('ASSET_CHECKSUM_FAIL')
  return { eventId, jobId: p.jobId, clipId: p.clipId, clipRevision: p.clipRevision, renderAttemptId: p.renderAttemptId, renderAssetId: p.renderAssetId, importedRenderSha256: importedSha256, projectRevisionAtImport: projectRevision }
}

/** Worker: ACK passt zur Publikation? Sonst bleibt der Outbox-Eintrag bestehen. */
export const ackMatches = (p: ClipResultPublished, a: ClipImportedAck): boolean =>
  a.jobId === p.jobId && a.clipId === p.clipId && a.clipRevision === p.clipRevision && a.renderAttemptId === p.renderAttemptId &&
  a.renderAssetId === p.renderAssetId && a.importedRenderSha256 === p.renderSha256

/** Engine-Urteile auf Audit-Status abbilden (V2 `verification`, Mac2 `decide`). Alles Unklare ist `review`, nie `accepted`. */
export function auditStatusFrom(engineVerdict: string | undefined): 'accepted' | 'review' | 'repair' {
  if (engineVerdict === 'verified' || engineVerdict === 'accept' || engineVerdict === 'accepted') return 'accepted'
  if (engineVerdict === 'failed' || engineVerdict === 'reject' || engineVerdict === 'repair') return 'repair'
  return 'review'
}
