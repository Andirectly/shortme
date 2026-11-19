// from: docs/implementation/engine-mac-v2/06_RUNTIME_POLICY.ts (Shortme-Engine-Mac-Paket 18.11.2026), unverändert übernommen; vom Scheduler in mac2/index.ts benutzt.
/**
 * Runtime admission helpers for the real Shortme scheduler.
 * Does not cancel workers, measure throughput or replace full output QA.
 */
export interface CandidateLimits {
  initialMaximum: number;
  totalMaximum: number;
}

function count(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

export function candidateLimits(
  desiredClips: number,
  availableEventGroups: number
): CandidateLimits {
  if (!count(desiredClips) || desiredClips < 1 || !count(availableEventGroups)) {
    throw new RangeError("Expected positive desired clips and nonnegative event groups");
  }
  if (desiredClips > Math.floor((Number.MAX_SAFE_INTEGER - 4) / 2)) {
    throw new RangeError("Clip count exceeds safe calculation range");
  }
  return {
    initialMaximum: Math.min(availableEventGroups, 2 * desiredClips),
    totalMaximum: Math.min(availableEventGroups, 2 * desiredClips + 4)
  };
}

export function mayRequestInspection(
  used: { initial: number; context: number; schemaRetries: number },
  requestKind: "initial" | "context" | "schemaRetry" = "context",
  plannedInitialPackets = 1,
  maximumExtraRequests = 1
): boolean {
  if (!count(plannedInitialPackets) || plannedInitialPackets < 1 ||
      !count(maximumExtraRequests)) return false;
  const values = [used.initial, used.context, used.schemaRetries];
  if (!values.every(count)) return false;
  if (used.initial > plannedInitialPackets ||
      used.context + used.schemaRetries > maximumExtraRequests) return false;
  if (requestKind === "initial") return used.initial < plannedInitialPackets;
  if (!["context", "schemaRetry"].includes(requestKind)) return false;
  return used.context + used.schemaRetries < maximumExtraRequests;
}

export interface ExtraInvestigationBudget {
  elapsedMs: number;
  softBudgetMs: number | null;
  nextTaskEstimateMs: number | null;
  reservedCompletionMs: number | null;
  startedCandidates: number;
  maximumCandidates: number;
}

/** Only for EXTRA investigation. Never use this to waive required output QA. */
export function decideExtraInvestigation(
  budget: ExtraInvestigationBudget
): { start: boolean; reason: string } {
  if (!count(budget.startedCandidates) || !count(budget.maximumCandidates) ||
      !Number.isFinite(budget.elapsedMs) || budget.elapsedMs < 0) {
    return { start: false, reason: "invalid-budget" };
  }
  if (budget.startedCandidates >= budget.maximumCandidates) {
    return { start: false, reason: "candidate-limit" };
  }
  if (budget.softBudgetMs === null) return { start: true, reason: "count-budget-only" };
  if (!Number.isFinite(budget.softBudgetMs) || budget.softBudgetMs <= 0) {
    return { start: false, reason: "invalid-budget" };
  }
  const estimates = [budget.nextTaskEstimateMs, budget.reservedCompletionMs];
  if (estimates.some(value => value === null || !Number.isFinite(value) || value < 0)) {
    return { start: false, reason: "completion-estimate-unknown" };
  }
  const projected = budget.elapsedMs + budget.nextTaskEstimateMs! +
    budget.reservedCompletionMs!;
  return projected <= budget.softBudgetMs
    ? { start: true, reason: "within-budget" }
    : { start: false, reason: "reserve-completion-time" };
}

export interface RemainingWork {
  units: number;
  measuredSecondsPerUnit: number | null;
  setupSeconds?: number;
}

/** Unknown estimates remain unknown; zero queued work is zero remaining time. */
export function estimateRemainingSeconds(work: readonly RemainingWork[]): number | null {
  let seconds = 0;
  for (const item of work) {
    if (!count(item.units)) return null;
    if (item.units === 0) continue;
    if (item.measuredSecondsPerUnit === null ||
        !Number.isFinite(item.measuredSecondsPerUnit) ||
        item.measuredSecondsPerUnit <= 0) return null;
    const setup = item.setupSeconds ?? 0;
    if (!Number.isFinite(setup) || setup < 0) return null;
    seconds += item.units * item.measuredSecondsPerUnit + setup;
    if (!Number.isFinite(seconds)) return null;
  }
  return Math.ceil(seconds);
}
