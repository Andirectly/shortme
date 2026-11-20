/**
 * Shortme UX 0.45 – unverbindlicher Referenzvertrag.
 * NICHT ungeprüft kopieren! API, IPC, Persistenz, IDs, Enums an das reale Repo anpassen.
 * Keine externen Abhängigkeiten, keine Cloud, keine eingebaute Runtime.
 */

export type ReviewStatus = 'offen' | 'freigegeben' | 'zur_pruefung' | 'verworfen';
export type QualityStatus =
  | 'nicht_durchgefuehrt'
  | 'ausstehend'
  | 'bestanden'
  | 'bitte_pruefen'
  | 'fehlgeschlagen';
export type LearningRating = 'unbewertet' | 'stark' | 'mittel' | 'schlecht';
export type ClipLifecycle = 'candidate' | 'preview_ready' | 'quality_checked' | 'render_ready';
export type JobPhase = 'queued' | 'transcribing' | 'analyzing' | 'discovering' | 'finalizing'
  | 'pausing' | 'paused' | 'resuming' | 'stopping' | 'partial_complete'
  | 'completed' | 'canceled' | 'failed';

export interface QualityFinding {
  id: string;
  title: string;
  explanation?: string;
  severity: 'info' | 'warning' | 'error';
  /** Position innerhalb des output clips, sofern bekannt */
  atClipMs?: number;
  evidenceSource?: 'deterministic' | 'model' | 'user';
}

export interface ReviewDecision {
  status: ReviewStatus;
  updatedAtIso: string;
  /** Fingerprint der Segmentliste, Caption-Daten und des verwendeten Outputplans */
  approvedRevision?: string;
}

export interface ClipReviewRecord {
  projectId: string;
  runId: string;
  clipId: string; // stabiler Schlüssel, keine Arrayposition
  sourceStartMs: number;
  sourceEndMs: number;
  title: string;
  durationMs: number;
  score?: number; // nicht als kalibrierte Wahrscheinlichkeit behandeln
  scoreExplanation?: string;
  lifecycle: ClipLifecycle;
  revision: string;
  quality: {
    status: QualityStatus;
    checkedRevision?: string;
    findings: QualityFinding[];
  };
  review: ReviewDecision;
  learning: LearningRating;
}

export interface JobEventBase {
  jobId: string;
  runId: string;
  eventId: string; // idempotent
  sequence: number; // monoton je Job, wichtiger als wall-clock Zeit
  occurredAtIso: string;
}

export type JobEvent =
  | (JobEventBase & { type: 'phase.changed'; phase: JobPhase })
  | (JobEventBase & { type: 'progress.measured'; phase: JobPhase; completed: number; total: number })
  | (JobEventBase & { type: 'candidate.discovered'; clipId: string; sourceStartMs: number; sourceEndMs: number })
  | (JobEventBase & { type: 'preview.ready'; clipId: string; revision: string; previewRef: string })
  | (JobEventBase & { type: 'quality.updated'; clipId: string; revision: string; status: QualityStatus; findings: QualityFinding[] })
  | (JobEventBase & { type: 'job.partial_complete'; persistedClipIds: string[] })
  | (JobEventBase & { type: 'job.completed' | 'job.failed' | 'job.canceled' });

export interface MeasuredProgress {
  completed: number;
  total: number;
}

/** Bei unbekannter Gesamtmenge null, nicht fiktiv 0–100%. */
export function safeProgressPercent(progress?: Partial<MeasuredProgress> | null): number | null {
  if (!progress || !Number.isFinite(progress.total) || !Number.isFinite(progress.completed)) return null;
  const total = progress.total as number;
  const completed = progress.completed as number;
  if (total <= 0 || completed < 0) return null;
  return Math.max(0, Math.min(100, Math.round((completed / total) * 100)));
}

/** Wahr, wenn die letzte KI-Qualitätsprüfung zur angezeigten Ausgabeversion gehört. */
export function hasCurrentQualityCheck(clip: ClipReviewRecord): boolean {
  return clip.quality.checkedRevision === clip.revision
    && clip.quality.status !== 'ausstehend'
    && clip.quality.status !== 'nicht_durchgefuehrt';
}

/** Wahr, wenn eine manuelle Freigabe den aktuellen Edit noch umfasst. */
export function isApprovalCurrent(clip: ClipReviewRecord): boolean {
  return clip.review.status === 'freigegeben' && clip.review.approvedRevision === clip.revision;
}

/**
 * Ein vorhandener User-Review-Status darf bei Qualitätsprüfung nicht zurückgesetzt werden.
 * Persistenz/Migration muss der echte Repo-Store erledigen.
 */
export function applyQualityResult(
  clip: ClipReviewRecord,
  input: { revision: string; status: QualityStatus; findings: QualityFinding[] },
): ClipReviewRecord {
  if (clip.revision !== input.revision) return clip; // stale result
  return {
    ...clip,
    quality: { status: input.status, checkedRevision: input.revision, findings: [...input.findings] },
  };
}

/** Filterung, die KI-Status und Freigabestatus NICHT vermischt. */
export type ReviewFilter = 'alle' | 'offen' | 'ki_pruefen' | 'freigegeben' | 'verworfen';
export function matchesReviewFilter(clip: ClipReviewRecord, filter: ReviewFilter): boolean {
  switch (filter) {
    case 'alle': return true;
    case 'offen': return clip.review.status === 'offen' || clip.review.status === 'zur_pruefung';
    case 'ki_pruefen': return clip.quality.status === 'bitte_pruefen' || clip.quality.status === 'fehlgeschlagen';
    case 'freigegeben': return clip.review.status === 'freigegeben';
    case 'verworfen': return clip.review.status === 'verworfen';
  }
}
