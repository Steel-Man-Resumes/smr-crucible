// Batch run of the five staff skills (three for 10/29, two if green by 10/27) with a scripted model (no API key
// needed, the MOCK_AI stand-in for /api/assistant, which has no mock path of
// its own). It proves the wiring, not the model: the chosen skill's doctrine
// reaches the system prompt, the tool calls the skill prescribes run through
// the real staff tool set and turn budget, the evidence they leave lets a
// sourced answer pass layer 1 of the staff answer check, and every tool a
// staff skill names exists. What a real model writes is unverified here.
import { it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { generateText } from "ai";
import { MockLanguageModelV1 } from "ai/test";
import { buildStaffTools } from "../tools/assistant-staff-tools";
import { loadSkillsForContext } from "../skills-loader";
import { createStaffEvidenceCollector } from "../staff-tool-evidence";
import { checkOrgClaimsDeterministic } from "../org-output-verify";
import { computeOrgCapabilities } from "@crucible/core/src/authz/capabilities";

const DANA = "00000000-0000-0000-0000-000000000007";
const actor = { userId: "00000000-0000-0000-0000-000000000001", orgId: "00000000-0000-0000-0000-0000000000a1", orgName: "Riverside Works (Demo)", role: "staff" as const, capabilities: computeOrgCapabilities("staff"), reach: "assigned" as const, viaPlatformAdmin: false };
const core = {
  resolveOrgActor: async () => actor,
  getOne: async () => ({ crm_v2: true }),
  recordStaffAssistantOpen: async () => ({ ok: true, rows: [{ id: "l1" }] }),
  getClientHeader: async () => ({ ok: true, rows: [{ name: "Dana Ray", progress: { nextStepAction: "Follow up on an application", applications: 3, savedJobs: 2, practiceSessions: 1, hasTailoredResume: true, lastActiveAt: "2026-10-21" }, scopes: {} }] }),
  getClientOverview: async () => ({ ok: true, data: { firstName: "Dana", identitySource: "account", joinedAt: "2026-09-02", assignedToYou: true, caseManager: "Pat", stage: 6,
    progress: { nextStepAction: "Follow up on an application", applications: 3, savedJobs: 2, practiceSessions: 1, hasTailoredResume: true, lastActiveAt: "2026-10-21" },
    shared: { applications: true, resume: false, documents: false }, awaitingAcknowledgement: false,
    openTasks: [{ title: "Call about the forklift class", dueOn: "2026-10-27", sharedWithParticipant: false }], suggestions: [], asks: [],
    recentNotes: [{ kind: "call", on: "2026-10-01", author: "Pat", body: "Talked about the warehouse opening.", corrected: false, draftedWithTroy: false }], notesTotal: 1,
    applications: [{ jobTitle: "Warehouse associate", company: "Northside Lumber", location: "Libby, MT", status: "interviewing", statusUpdatedAt: "2026-10-22", appliedAt: "2026-10-15", followUpAt: "2026-10-28", hiredAt: null }], placements: [] } }),
  getClientChanges: async (_a: unknown, _id: string, since: string) => ({ ok: true, data: { firstName: "Dana", from: since, to: "2026-10-24", changes: [{ on: "2026-10-22", kind: "application_status", what: "Warehouse associate at Northside Lumber moved to interviewing" }, { on: "2026-10-20", kind: "note", what: "Pat added a call note" }], applicationsRead: true, lastActiveAt: "2026-10-21" } }),
  searchVerifiedResources: async () => ({ status: "ok", asOf: "2026-10-24", data: [{ service_id: "s1", org_name: "Lincoln County Food Share", service_name: "Food pantry", area_label: "Food", band: "A", last_checked: "2026-09-30", phone: "(406) 293-0000", hours: "Tue 10-2", website: "https://example.org", city: "Libby", county: "Lincoln", eligibility: null, source_url: "https://example.org/src" }] }),
};

/** A model that makes the given tool calls, then says `answer`. */
function scripted(calls: { toolName: string; args: unknown }[], answer: string) {
  let step = 0;
  return new MockLanguageModelV1({
    doGenerate: async () => {
      const usage = { promptTokens: 1, completionTokens: 1 };
      if (step++ === 0 && calls.length) return { rawCall: { rawPrompt: null, rawSettings: {} }, finishReason: "tool-calls", usage, toolCalls: calls.map((c, i) => ({ toolCallType: "function" as const, toolCallId: `c${i}`, toolName: c.toolName, args: JSON.stringify(c.args) })) };
      return { rawCall: { rawPrompt: null, rawSettings: {} }, finishReason: "stop", usage, text: answer };
    },
  });
}

const CASES = [
  { skill: "staff-prep-me", heading: /PREP ME FOR THIS PERSON/, calls: [{ toolName: "read_participant_overview", args: { clientId: DANA } }],
    answer: "Where they are: Dana is at Apply and track, last active Oct 21 (from their shared progress). What is coming: a follow-up with Northside Lumber on Oct 28, from their shared applications. What is open: your task, Call about the forklift class, due Oct 27. What your team wrote last time: Oct 1, Pat, talked about the warehouse opening. Two questions worth asking: What is in the way of the follow-up? What help would make the interview easier?\nRead this before you meet. Nothing was saved or sent." },
  { skill: "staff-check-in", heading: /DRAFT A CHECK-IN/, calls: [{ toolName: "read_participant_overview", args: { clientId: DANA } }, { toolName: "draft_staff_check_in", args: { clientId: DANA } }, { toolName: "offer_staff_draft", args: { clientId: DANA, purpose: "check_in", body: "Hi Dana, your follow-up with Northside Lumber is coming up on Oct 28. Want to go over it together this week? What would help most?" } }],
    answer: "Text message: Hi Dana, your follow-up with Northside Lumber is coming up on Oct 28. Want to go over it together this week? What would help most?\nThis is a draft. Nothing was saved or sent. Send it yourself from your own phone or email, then mark it sent on their page." },
  { skill: "staff-find-help", heading: /FIND LOCAL HELP FOR THIS NEED/, calls: [{ toolName: "find_local_help", args: { place: "Libby, MT", needs: ["food"] } }],
    answer: "Lincoln County Food Share, Food pantry: checked from the organization's own page, last checked Sep 30. Phone (406) 293-0000. Hours Tue 10-2.\nCheck before you send someone: hours and intake change.\nNothing was saved or sent. If one fits, share it with them yourself, by a suggestion on their page or in your own message. Saving it to their list is their choice." },
  { skill: "staff-what-changed", heading: /WHAT CHANGED/, calls: [{ toolName: "read_recent_changes", args: { clientId: DANA, days: 7 } }],
    answer: `${new Date(new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10) + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })} to Oct 24. Oct 22: Warehouse associate at Northside Lumber moved to interviewing, from their shared applications. Oct 20: Pat added a call note.\nNothing was saved or sent. If something here needs a reply, open Dana's page and reach out yourself.` },
  { skill: "staff-outcome-note", heading: /WRITE THE OUTCOME NOTE/, calls: [{ toolName: "read_participant_overview", args: { clientId: DANA } }, { toolName: "offer_staff_draft", args: { clientId: DANA, purpose: "case_note", body: "Dana started as a warehouse associate at Northside Lumber. Known as told to staff by Dana." } }],
    answer: "Draft note: Dana started as a warehouse associate at Northside Lumber. Known as told to staff by Dana.\nNothing was saved. Record the placement yourself in the Outcomes tab, which is the only place that counts it, then save the note." },
];

for (const c of CASES) {
  it(`batch: ${c.skill} runs end to end on the scripted model`, async () => {
    const system = loadSkillsForContext("clients/x", false, "staff", [c.skill]);
    assert.match(system, c.heading, "the chosen skill is in the system prompt");
    assert.match(system, /SCOPED STAFF WORK/, "with the rules for every staff skill");
    const evidence = createStaffEvidenceCollector();
    const tools = buildStaffTools(actor, evidence.record, { focusClientId: DANA, core: async () => core as never, countiesOf: () => ["lincoln"] });
    const out = await generateText({ model: scripted(c.calls, c.answer), system, prompt: "go", tools, maxSteps: 4 });
    const results = out.steps.flatMap((s) => s.toolResults) as { toolName: string; result: Record<string, unknown> }[];
    assert.deepEqual(results.map((r) => r.toolName), c.calls.map((x) => x.toolName));
    for (const r of results) assert.ok(["ok", "draft_only"].includes(String(r.result.status)), `${r.toolName}: ${JSON.stringify(r.result).slice(0, 200)}`);
    for (const r of results.filter((x) => x.result.status === "draft_only")) { assert.equal(r.result.saved, false); assert.equal(r.result.sent, false); }
    const facts = { caseload: 4, stalled: 1, neverStarted: 0, hired: 0, unassigned: 0, visibleNames: ["Dana"], staffNames: ["Pat"], staffToolEvidence: evidence.items, orgName: actor.orgName };
    assert.deepEqual(checkOrgClaimsDeterministic(out.text, facts), [], "a sourced answer passes layer 1");
    assert.match(out.text, /Nothing was saved( or sent)?\./);
  });
}

it("every tool a staff skill names is a real staff tool", () => {
  const names = new Set(Object.keys(buildStaffTools(actor, undefined, { core: async () => core as never })));
  for (const id of ["staff-operations", "staff-prep-me", "staff-check-in", "staff-find-help", "staff-what-changed", "staff-outcome-note"]) {
    const md = readFileSync(join(process.cwd(), "lib", "skills", id, "SKILL.md"), "utf8");
    for (const t of md.match(/\b(?:read|find|draft|offer|search|get|save)_[a-z_]+\b/g) ?? []) assert.ok(names.has(t), `${id} names ${t}, which staff do not have`);
  }
});
