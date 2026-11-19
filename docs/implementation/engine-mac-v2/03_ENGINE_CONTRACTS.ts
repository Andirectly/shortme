/**
 * Shortme Mac: reusable policy helpers, not a complete engine.
 * Adapt to the repository's existing types and run its schema validation first.
 * Context registers and coverage are host/worker data, never model assertions.
 * Model inference, rendering, semantic interpretation and interval coverage
 * measurement belong to the real adapters, not this module.
 */

export type ClipRole = "main" | "coldOpen";
export type AuditStatus = "pass" | "fail" | "unknown" | "notApplicable";

export interface CutEdge {
  id: string;
  sourceMediaId: string;
  timebaseId: string;
  pts: string;
  measured: boolean;
  wordSafe: boolean;
}

export interface ClipSegment {
  role: ClipRole;
  startEdgeId: string;
  endEdgeId: string;
}

export interface ClipPlan {
  candidateId: string;
  title: string;
  segments: ClipSegment[];
  requiredFactIds: string[];
}

export interface PlanContext {
  sourceMediaId: string;
  timebaseId: string;
  sourceStartPts: string;
  sourceEndPts: string;
  allowedCandidateIds: readonly string[];
  edges: readonly CutEdge[];
  allowedFactIds: readonly string[];
  coldOpenTargetMs: number;
}

function pts(value: string): bigint | undefined {
  if (!/^-?\d+$/.test(value)) return undefined;
  try { return BigInt(value); } catch { return undefined; }
}

/** Validates references after structural JSON/schema validation. */
export function validateClipPlan(plan: ClipPlan, context: PlanContext): string[] {
  const issues: string[] = [];
  const sourceStart = pts(context.sourceStartPts);
  const sourceEnd = pts(context.sourceEndPts);
  if (sourceStart === undefined || sourceEnd === undefined || sourceStart >= sourceEnd) {
    return ["invalid-source-span"];
  }
  if (!Number.isInteger(context.coldOpenTargetMs) ||
      context.coldOpenTargetMs < 0 || context.coldOpenTargetMs > 5000) {
    issues.push("invalid-cold-open-setting");
  }
  if (!context.allowedCandidateIds.includes(plan.candidateId)) {
    issues.push("unknown-candidate");
  }
  const title = plan.title.trim();
  if (!title || /^(kurzer deutscher titel|short german title)$/i.test(title)) {
    issues.push("missing-or-placeholder-title");
  }
  const edgeById = new Map(context.edges.map(edge => [edge.id, edge]));
  if (edgeById.size !== context.edges.length) issues.push("duplicate-host-edge-id");
  const facts = new Set(context.allowedFactIds);
  if (!plan.requiredFactIds.length) issues.push("missing-content-evidence");
  for (const id of plan.requiredFactIds) {
    if (!facts.has(id)) issues.push("unknown-fact:" + id);
  }

  const ranges: Array<{ role: ClipRole; start: bigint; end: bigint }> = [];
  let coldCount = 0;
  let mainCount = 0;
  plan.segments.forEach((segment, index) => {
    if (segment.role === "coldOpen") {
      coldCount++;
      if (index !== 0) issues.push("cold-open-must-be-first");
      if (context.coldOpenTargetMs === 0) issues.push("cold-open-disabled");
    } else if (segment.role === "main") {
      mainCount++;
    } else {
      issues.push("unknown-segment-role");
      return;
    }
    const startEdge = edgeById.get(segment.startEdgeId);
    const endEdge = edgeById.get(segment.endEdgeId);
    if (!startEdge || !endEdge) {
      issues.push("unknown-cut-edge:" + index);
      return;
    }
    if ([startEdge, endEdge].some(edge =>
      edge.sourceMediaId !== context.sourceMediaId ||
      edge.timebaseId !== context.timebaseId)) {
      issues.push("wrong-source-or-timebase:" + index);
      return;
    }
    if ([startEdge, endEdge].some(edge => !edge.measured || !edge.wordSafe)) {
      issues.push("unmeasured-or-unsafe-edge:" + index);
      return;
    }
    const start = pts(startEdge.pts);
    const end = pts(endEdge.pts);
    if (start === undefined || end === undefined || start >= end) {
      issues.push("invalid-cut-order:" + index);
      return;
    }
    if (start < sourceStart || end > sourceEnd) {
      issues.push("cut-outside-source:" + index);
      return;
    }
    ranges.push({ role: segment.role, start, end });
  });
  if (!mainCount) issues.push("missing-main-segment");
  if (coldCount > 1) issues.push("multiple-cold-open-segments");

  const mainRanges = ranges.filter(range => range.role === "main");
  for (let index = 1; index < mainRanges.length; index++) {
    if (mainRanges[index].start < mainRanges[index - 1].end) {
      issues.push("main-segments-not-chronological");
    }
  }
  for (const hook of ranges.filter(range => range.role === "coldOpen")) {
    // Repeated source time is intentional here; do not apply cross-clip dedupe.
    if (!mainRanges.some(main => hook.start >= main.start && hook.end <= main.end)) {
      issues.push("cold-open-outside-main-clip");
    }
  }
  return [...new Set(issues)];
}

export interface AuditCriterion {
  id: string;
  status: AuditStatus;
  reason: string;
  evidenceIds: string[];
}

export interface RenderAudit {
  renderedSha256: string;
  coveredPacketIds: string[];
  criteria: AuditCriterion[];
  conflicts: string[];
}

export interface AuditContext {
  expectedRenderedSha256: string;
  requiredPacketIds: readonly string[];
  allowedPacketIds: readonly string[];
  requiredCheckIds: readonly string[];
  allowedCheckIds: readonly string[];
  allowedNotApplicableIds: readonly string[];
  allowedEvidenceIds: readonly string[];
}

export interface AuditDecision {
  status: "accepted" | "review" | "repair";
  issues: string[];
}

/**
 * Deterministic release gate. Packet IDs must be generated from actual complete
 * audio/frame coverage, including all chunks of a long rendered clip.
 * This function does not infer coverage from a model saying "I heard it all".
 */
export function decideRenderAudit(
  report: RenderAudit,
  context: AuditContext
): AuditDecision {
  const issues: string[] = [];
  let hasFailure = false;
  if (!/^[a-f0-9]{64}$/i.test(context.expectedRenderedSha256) ||
      report.renderedSha256 !== context.expectedRenderedSha256) {
    issues.push("stale-or-invalid-render-hash");
  }
  if (!context.requiredPacketIds.length) issues.push("missing-coverage-policy");
  if (!context.requiredCheckIds.length) issues.push("missing-check-policy");
  const allowedPackets = new Set(context.allowedPacketIds);
  const covered = new Set(report.coveredPacketIds);
  for (const id of report.coveredPacketIds) {
    if (!allowedPackets.has(id)) issues.push("unknown-media-packet:" + id);
  }
  for (const id of context.requiredPacketIds) {
    if (!covered.has(id)) issues.push("uncovered-media-packet:" + id);
  }
  if (report.conflicts.length) issues.push("conflicting-findings");

  const byId = new Map<string, AuditCriterion>();
  const allowedChecks = new Set(context.allowedCheckIds);
  const allowedEvidence = new Set(context.allowedEvidenceIds);
  for (const criterion of report.criteria) {
    if (byId.has(criterion.id)) issues.push("duplicate-check:" + criterion.id);
    byId.set(criterion.id, criterion);
    if (!allowedChecks.has(criterion.id)) issues.push("unknown-check:" + criterion.id);
    if (!criterion.reason.trim()) issues.push("missing-check-reason:" + criterion.id);
    if (!["pass", "fail", "unknown", "notApplicable"].includes(criterion.status)) {
      issues.push("invalid-check-status:" + criterion.id);
    }
    for (const id of criterion.evidenceIds) {
      if (!allowedEvidence.has(id)) issues.push("unknown-evidence:" + id);
    }
    if (criterion.status === "pass" && !criterion.evidenceIds.length) {
      issues.push("unsupported-pass:" + criterion.id);
    }
    if (criterion.status === "fail") {
      hasFailure = true;
      issues.push("failed-check:" + criterion.id);
    }
    if (criterion.status === "unknown") issues.push("unknown-check-result:" + criterion.id);
    if (criterion.status === "notApplicable" &&
        !context.allowedNotApplicableIds.includes(criterion.id)) {
      issues.push("not-applicable-not-allowed:" + criterion.id);
    }
  }
  for (const id of context.requiredCheckIds) {
    if (!byId.has(id)) issues.push("missing-required-check:" + id);
  }
  return {
    status: hasFailure ? "repair" : issues.length ? "review" : "accepted",
    issues: [...new Set(issues)]
  };
}
