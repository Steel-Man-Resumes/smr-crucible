import { it } from "node:test";
import assert from "node:assert/strict";
import { createStaffEvidenceCollector, projectStaffToolEvidence } from "../staff-tool-evidence";
import { buildOrgVerificationPrompt, checkOrgClaimsDeterministic, type OrgFacts } from "../org-output-verify";
import { assistantStepUsage } from "../ai/assistant-step-usage";
import { readFileSync } from "node:fs";
const base: OrgFacts = { caseload: 3, stalled: 1, neverStarted: 0, hired: 0, unassigned: 1, visibleNames: ["Sam"], staffNames: [] };
it("authorized shared progress supplements checks without replacing cohort totals", () => {
 const collector = createStaffEvidenceCollector();
 collector.record("read_participant_progress", { status: "ok", data: [{ name: "Robin", progress: { applications: 29, savedJobs: 11, practiceSessions: 8, hasTailoredResume: true }, email: "private@example.test", transcript: "private words" }] });
 const facts = { ...base, staffToolEvidence: collector.items };
 assert.deepEqual(checkOrgClaimsDeterministic("For Robin, there are 29 applications.", facts), []);
 assert(checkOrgClaimsDeterministic("For Mallory, there are 99 applications.", facts).length > 0);
 const prompt = buildOrgVerificationPrompt("Robin has 29 applications.", facts);
 assert(prompt.includes('"applications":29')); assert(prompt.includes("caseload is 3"));
 assert(!prompt.includes("private@example.test")); assert(!prompt.includes("private words"));
});
it("failed, unknown and unshared outputs cannot authorize facts", () => {
 const collector = createStaffEvidenceCollector();
 collector.record("read_participant_progress", { ok: false, reason: "not_shared", data: [{ name: "Mallory", progress: { applications: 99 } }] });
 collector.record("unknown", { status: "ok", data: [{ name: "Mallory" }] });
 collector.record("draft_staff_check_in", { status: "draft_only", saved: true, sent: true, source: [{ firstName: "Mallory" }] });
 assert.equal(collector.items.length, 0);
 collector.record("read_participant_progress", { status: "ok", data: [{ name: "Sam", progress: null, applications: 99 }] });
 const prompt = buildOrgVerificationPrompt("", { ...base, staffToolEvidence: collector.items });
 assert(prompt.includes('"sharedProgress":null')); assert(!prompt.includes("99"));
});
it("task evidence retains exact state and count, not an outcome assertion", () => {
 const evidence = projectStaffToolEvidence("read_staff_tasks", { status: "ok", readAt: "2026-10-15T12:00:00Z", tasks: [{ title: "Call Housing Office", participant: "Sam", dueOn: "2026-10-29", doneAt: null, shared: false }], more: false })!;
 const facts = { ...base, staffToolEvidence: [evidence] };
 assert.deepEqual(checkOrgClaimsDeterministic('For Sam, the task is Call Housing Office.', facts), []);
 const prompt = buildOrgVerificationPrompt("", facts);
 assert(prompt.includes('"doneAt":null')); assert(prompt.includes("not proof a contact happened"));
});
it("missing or invalid primary usage stays unpriceable; absent cache is zero", () => {
 for (const value of [undefined, NaN, Infinity, -1]) {
  const usage = assistantStepUsage({ promptTokens: value, completionTokens: value }, undefined);
  assert(Number.isNaN(usage.inputTokens)); assert(Number.isNaN(usage.outputTokens));
  assert.equal(usage.cacheCreationInputTokens, 0); assert.equal(usage.cacheReadInputTokens, 0);
 }
 assert.equal(assistantStepUsage({ promptTokens: 0, completionTokens: 0 }, {}).inputTokens, 0);
});
it("staff accounting occurs per completed step before a later generation can fail", () => {
 const source = readFileSync("app/api/assistant/route.ts", "utf8");
 const generation = source.slice(source.indexOf("const generated = await generateText"), source.indexOf("const answer = replyOrFallback"));
 assert(generation.includes("async onStepFinish")); assert(generation.includes("await recordTokenUsage"));
 assert(!source.includes("for (const step of generated.steps)"));
 assert(source.includes("buildStaffTools(staffActor, staffEvidence.record, { focusClientId: staffFocus, namedClientIds: staffNamed })")); assert(source.includes("staffToolEvidence: staffEvidence.items"));
});
