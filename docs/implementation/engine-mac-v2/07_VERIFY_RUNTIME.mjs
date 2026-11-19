import assert from "node:assert/strict";
import {
  candidateLimits, mayRequestInspection,
  decideExtraInvestigation, estimateRemainingSeconds
} from "./06_RUNTIME_POLICY.ts";
let n = 0;
function check(name, test) { test(); n++; console.log("PASS " + name); }
check("40-minute example with six requested clips has bounded investigation", () => {
  assert.deepEqual(candidateLimits(6, 100), { initialMaximum: 12, totalMaximum: 16 });
});
check("available good event groups are not invented to fill a quota", () => {
  assert.deepEqual(candidateLimits(6, 3), { initialMaximum: 3, totalMaximum: 3 });
});
check("context and schema retry cannot multiply inspection requests", () => {
  assert.equal(mayRequestInspection({ initial: 1, context: 1, schemaRetries: 0 }), false);
  assert.equal(mayRequestInspection({ initial: 1, context: 0, schemaRetries: 1 }), false);
});
check("one remaining inspection request can resolve a specific question", () => {
  assert.equal(mayRequestInspection({ initial: 1, context: 0, schemaRetries: 0 }), true);
});
const budget = {
  elapsedMs: 20 * 60000, softBudgetMs: 30 * 60000,
  nextTaskEstimateMs: 30000, reservedCompletionMs: 5 * 60000,
  startedCandidates: 12, maximumCandidates: 16
};
check("extra investigation fits only after reserving completion time", () => {
  assert.equal(decideExtraInvestigation(budget).start, true);
  assert.equal(decideExtraInvestigation({ ...budget, elapsedMs: 28 * 60000 }).start, false);
});
check("missing future QA estimate is not treated as free", () => {
  assert.equal(decideExtraInvestigation({ ...budget, reservedCompletionMs: null }).start, false);
});
check("candidate limit applies even without a wall-clock budget", () => {
  assert.equal(decideExtraInvestigation({
    ...budget, softBudgetMs: null, startedCandidates: 16
  }).start, false);
});
check("ETA counts real media packets and render work separately", () => {
  assert.equal(estimateRemainingSeconds([
    { units: 4, measuredSecondsPerUnit: 25, setupSeconds: 4 },
    { units: 2, measuredSecondsPerUnit: 40 }
  ]), 184);
});
check("unknown future rendering duration makes total ETA unknown", () => {
  assert.equal(estimateRemainingSeconds([
    { units: 4, measuredSecondsPerUnit: 25 },
    { units: 2, measuredSecondsPerUnit: null }
  ]), null);
});
check("finished queues have no remaining work", () => {
  assert.equal(estimateRemainingSeconds([]), 0);
  assert.equal(estimateRemainingSeconds([{ units: 0, measuredSecondsPerUnit: null }]), 0);
});
check("long candidates can receive all required initial packets", () => {
  assert.equal(mayRequestInspection({ initial: 1, context: 0, schemaRetries: 0 }, "initial", 3), true);
  assert.equal(mayRequestInspection({ initial: 3, context: 0, schemaRetries: 0 }, "initial", 3), false);
  assert.equal(mayRequestInspection({ initial: 3, context: 0, schemaRetries: 0 }, "context", 3), true);
  assert.equal(mayRequestInspection({ initial: 3, context: 1, schemaRetries: 0 }, "schemaRetry", 3), false);
});
console.log(n + " runtime-policy checks passed. Worker cancellation and Mac throughput were not tested.");
