import assert from "node:assert/strict";
import { validateClipPlan, decideRenderAudit } from "./03_ENGINE_CONTRACTS.ts";

let count = 0;
function check(name, test) {
  test();
  count++;
  console.log("PASS " + name);
}
function clone(value) { return structuredClone(value); }

const edge = (id, value) => ({
  id, sourceMediaId: "source-1", timebaseId: "tb-1", pts: String(value),
  measured: true, wordSafe: true
});
const planContext = {
  sourceMediaId: "source-1", timebaseId: "tb-1",
  sourceStartPts: "0", sourceEndPts: "120000",
  allowedCandidateIds: ["candidate-1"],
  edges: [edge("start", 10000), edge("end", 70000),
          edge("hook-start", 45000), edge("hook-end", 48000),
          edge("outside", 90000)],
  allowedFactIds: ["fact-1"], coldOpenTargetMs: 0
};
const plan = {
  candidateId: "candidate-1", title: "Ein konkreter Clip-Titel",
  segments: [{ role: "main", startEdgeId: "start", endEdgeId: "end" }],
  requiredFactIds: ["fact-1"]
};

check("normal measured clip is valid", () => {
  assert.deepEqual(validateClipPlan(plan, planContext), []);
});
check("hallucinated cut edge is rejected", () => {
  const value = clone(plan);
  value.segments[0].startEdgeId = "invented";
  assert.ok(validateClipPlan(value, planContext).some(x => x.startsWith("unknown-cut-edge")));
});
check("reversed cut cannot pass", () => {
  const value = clone(plan);
  value.segments[0].startEdgeId = "end";
  value.segments[0].endEdgeId = "start";
  assert.ok(validateClipPlan(value, planContext).some(x => x.startsWith("invalid-cut-order")));
});
check("word-unsafe edge is rejected", () => {
  const context = clone(planContext);
  context.edges[0].wordSafe = false;
  assert.ok(validateClipPlan(plan, context).some(x => x.startsWith("unmeasured-or-unsafe-edge")));
});
check("cold opener stays off at zero", () => {
  const value = clone(plan);
  value.segments.unshift({ role: "coldOpen", startEdgeId: "hook-start", endEdgeId: "hook-end" });
  assert.ok(validateClipPlan(value, planContext).includes("cold-open-disabled"));
});
check("intended hook repetition inside main clip is allowed", () => {
  const value = clone(plan);
  value.segments.unshift({ role: "coldOpen", startEdgeId: "hook-start", endEdgeId: "hook-end" });
  assert.deepEqual(validateClipPlan(value, { ...planContext, coldOpenTargetMs: 3000 }), []);
});
check("hook taken outside selected main clip is rejected", () => {
  const value = clone(plan);
  value.segments.unshift({ role: "coldOpen", startEdgeId: "hook-end", endEdgeId: "outside" });
  assert.ok(validateClipPlan(value, { ...planContext, coldOpenTargetMs: 3000 })
    .includes("cold-open-outside-main-clip"));
});
check("wrong source timebase is rejected", () => {
  const context = clone(planContext);
  context.edges[0].timebaseId = "wrong-timebase";
  assert.ok(validateClipPlan(plan, context).some(x => x.startsWith("wrong-source-or-timebase")));
});
check("copied title placeholder is rejected", () => {
  assert.ok(validateClipPlan({ ...plan, title: "Kurzer deutscher Titel" }, planContext)
    .includes("missing-or-placeholder-title"));
});

const hash = "a".repeat(64);
const auditContext = {
  expectedRenderedSha256: hash,
  requiredPacketIds: ["audio-0-30", "audio-29-60", "frames"],
  allowedPacketIds: ["audio-0-30", "audio-29-60", "frames"],
  requiredCheckIds: ["entry", "closure", "technical"],
  allowedCheckIds: ["entry", "closure", "technical"],
  allowedNotApplicableIds: [],
  allowedEvidenceIds: ["output-word-1", "output-frame-1", "measurement-1"]
};
const report = {
  renderedSha256: hash,
  coveredPacketIds: ["audio-0-30", "audio-29-60", "frames"],
  criteria: [
    { id: "entry", status: "pass", reason: "Belegter Einstieg.", evidenceIds: ["output-word-1"] },
    { id: "closure", status: "pass", reason: "Belegter Abschluss.", evidenceIds: ["output-word-1"] },
    { id: "technical", status: "pass", reason: "Gemessene Kriterien erfüllt.", evidenceIds: ["measurement-1"] }
  ],
  conflicts: []
};
check("complete evidenced audit is accepted", () => {
  assert.equal(decideRenderAudit(report, auditContext).status, "accepted");
});
check("a missing second audio chunk never passes a 60-second clip", () => {
  const value = clone(report);
  value.coveredPacketIds = ["audio-0-30", "frames"];
  assert.equal(decideRenderAudit(value, auditContext).status, "review");
});
check("unknown conclusion is not accepted", () => {
  const value = clone(report);
  value.criteria[1].status = "unknown";
  assert.equal(decideRenderAudit(value, auditContext).status, "review");
});
check("specific failure requests repair", () => {
  const value = clone(report);
  value.criteria[1].status = "fail";
  assert.equal(decideRenderAudit(value, auditContext).status, "repair");
});
check("audit for a different rendered file cannot pass", () => {
  assert.equal(decideRenderAudit({ ...report, renderedSha256: "b".repeat(64) }, auditContext)
    .status, "review");
});
check("a missing required criterion cannot pass", () => {
  const value = clone(report);
  value.criteria.pop();
  assert.equal(decideRenderAudit(value, auditContext).status, "review");
});
check("contradictory findings cannot pass", () => {
  assert.equal(decideRenderAudit({ ...report, conflicts: ["closure disagrees"] }, auditContext)
    .status, "review");
});
check("invented evidence cannot support a pass", () => {
  const value = clone(report);
  value.criteria[0].evidenceIds = ["invented"];
  assert.equal(decideRenderAudit(value, auditContext).status, "review");
});
check("not applicable requires explicit host permission", () => {
  const value = clone(report);
  value.criteria[1].status = "notApplicable";
  assert.equal(decideRenderAudit(value, auditContext).status, "review");
});
check("bare positive criterion without evidence cannot pass", () => {
  const value = clone(report);
  value.criteria[0].evidenceIds = [];
  assert.equal(decideRenderAudit(value, auditContext).status, "review");
});
console.log(count + " policy checks passed. No model inference or Mac benchmark was run.");
