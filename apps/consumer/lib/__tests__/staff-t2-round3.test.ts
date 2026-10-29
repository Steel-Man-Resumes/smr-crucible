// Demo fix T2 round 3 (live 923c517, CODEX-RETEST-R2 item D): Lupe asked
// "Find employers in Lansing that hire people with records" and got only
// "Did this place still check out? Called them lately?" with the listing
// buttons. No employer search result was shown.
import { it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { generateText } from "ai";
import { MockLanguageModelV1 } from "ai/test";
import { buildStaffTools } from "../tools/assistant-staff-tools";
import { directoryListingIds, DIRECTORY_READ_TOOLS } from "../tools/staff/contribute-tools";
import { staffAnswerText, STAFF_TOOLS_NO_TEXT } from "../staff-answer-text";
import { TROY_EMPTY_REPLY } from "../ai/troy-chat";
import { LISTING_NUDGE_LINE } from "@crucible/core/src/staffRewardsShared";
import type { OrgActor } from "@crucible/core/src/authz/resolveOrgActor";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const EASTSIDE = "8a1c7a8e-0000-4000-8000-000000000001";
const OTHER = "8a1c7a8e-0000-4000-8000-000000000002";
const staff: OrgActor = {
  userId: "00000000-0000-4000-8000-000000000001", orgId: "00000000-0000-4000-8000-000000000002", orgName: "Southside Bridge (Demo)",
  role: "staff", capabilities: new Set(["org.cohort.view"]), reach: "assigned", viaPlatformAdmin: false,
} as OrgActor;

function fakeCore() {
  return {
    resolveOrgActor: async () => staff,
    incrementUserUsage: async () => 1, incrementIpUsage: async () => 1,
    searchVerifiedEmployers: async () => ({ status: "ok", asOf: "2026-10-22", data: [{ id: EASTSIDE, name: "Eastside Fish Fry & Grill", industry: "restaurant", city: "Lansing", location: "Lansing, MI", band: "A", checkedAt: "2026-10-22", expiresAt: "2027-01-20", roleTypes: [], evidence: "Owner's words", caveats: null, applyUrl: null, sourceUrl: null }] }),
    getStaffPrefs: async () => ({ effective: { suggestions: true } }),
    claimListingNudge: async () => true,
    getVerifiedEmployer: async (id: string) => ({ status: "ok", data: { id } }),
    getVerifiedResource: async (id: string) => ({ status: "ok", data: { service_id: id } }),
  };
}
const call = (tools: ReturnType<typeof buildStaffTools>, name: string, args: unknown) =>
  (tools[name].execute as (a: unknown, o: unknown) => Promise<Record<string, unknown>>)(args, { toolCallId: name, messages: [] });

it("a nudge is never the first tool of a turn: quiet until a directory read returned that listing", async () => {
  const tools = buildStaffTools(staff, undefined, { core: async () => fakeCore() as never });
  assert.equal((await call(tools, "listing_check_nudge", { kind: "employer", listingId: EASTSIDE })).status, "quiet", "first tool of the turn");
  const found = await call(tools, "find_employers", { state: "MI", q: "Lansing" });
  assert.equal(found.status, "ok");
  assert.equal((await call(tools, "listing_check_nudge", { kind: "employer", listingId: OTHER })).status, "quiet", "a listing the search did not return");
  const nudge = await call(tools, "listing_check_nudge", { kind: "employer", listingId: EASTSIDE.toUpperCase() });
  assert.equal(nudge.status, "ok");
  assert.equal(nudge.line, LISTING_NUDGE_LINE);
});

it("listing ids come only from ok directory reads", () => {
  assert.deepEqual([...DIRECTORY_READ_TOOLS].sort(), ["find_employers", "find_local_help", "find_missed_connections"]);
  assert.deepEqual(directoryListingIds("find_employers", { status: "ok", employers: [{ id: EASTSIDE }, { id: "not-an-id" }] }), [EASTSIDE]);
  assert.deepEqual(directoryListingIds("find_local_help", { status: "ok", listings: [{ id: OTHER }] }), [OTHER]);
  assert.deepEqual(directoryListingIds("find_missed_connections", { status: "ok", employers: [{ employerId: EASTSIDE }], resources: [{ resourceId: OTHER }] }), [EASTSIDE, OTHER]);
  assert.deepEqual(directoryListingIds("find_employers", { status: "limited", employers: [{ id: EASTSIDE }] }), []);
  assert.deepEqual(directoryListingIds("read_today_queue", { status: "ok", items: [{ id: EASTSIDE }] }), []);
});

it("the answer is every step's words, never a card line alone", () => {
  const answer = "I found one Lansing employer: Eastside Fish Fry & Grill, in Michigan, your organization's state.";
  // The live shape: answer written alongside the tool call, the last step only the nudge line.
  assert.equal(staffAnswerText([{ text: answer, toolCalls: [{}] }, { text: LISTING_NUDGE_LINE, toolCalls: [] }], LISTING_NUDGE_LINE), `${answer}\n\n${LISTING_NUDGE_LINE}`);
  // A normal answer in the last step is used as is (no preamble added).
  assert.equal(staffAnswerText([{ text: "Let me look.", toolCalls: [{}] }, { text: answer, toolCalls: [] }], answer), answer);
  // Nothing said at all after tools ran: a plain line, never only a card.
  assert.equal(staffAnswerText([{ text: "", toolCalls: [{}] }, { text: "", toolCalls: [] }], ""), STAFF_TOOLS_NO_TEXT);
  assert.equal(staffAnswerText([{ text: "", toolCalls: [{}] }, { text: LISTING_NUDGE_LINE, toolCalls: [] }], LISTING_NUDGE_LINE), STAFF_TOOLS_NO_TEXT);
  assert.equal(staffAnswerText([{ text: "" }], ""), TROY_EMPTY_REPLY);
});

it("through the model loop: a search answered in the tool step still reaches the staff member", async () => {
  let n = 0;
  const answer = "I found one Lansing employer: Eastside Fish Fry & Grill.";
  const model = new MockLanguageModelV1({
    doGenerate: async () => {
      n++;
      if (n === 1) return { rawCall: { rawPrompt: null, rawSettings: {} }, finishReason: "tool-calls", usage: { promptTokens: 1, completionTokens: 1 }, text: answer,
        toolCalls: [{ toolCallType: "function", toolCallId: "c1", toolName: "find_employers", args: JSON.stringify({ state: "MI", q: "Lansing" }) }] };
      return { rawCall: { rawPrompt: null, rawSettings: {} }, finishReason: "stop", usage: { promptTokens: 1, completionTokens: 1 }, text: LISTING_NUDGE_LINE };
    },
  });
  const tools = buildStaffTools(staff, undefined, { core: async () => fakeCore() as never });
  const generated = await generateText({ model, system: "t", messages: [{ role: "user", content: "Find employers in Lansing that hire people with records" }], tools, maxSteps: 3 });
  assert.equal(generated.text, LISTING_NUDGE_LINE, "the SDK's text is the last step only: the bug");
  assert.ok(staffAnswerText(generated.steps, generated.text).startsWith(answer));
});

it("the route uses every step's words; the skill and the tool say search first, nudge last", () => {
  const route = read("../../app/api/assistant/route.ts");
  assert.match(route, /const answer = replyOrFallback\(staffAnswerText\(generated\.steps, generated\.text\)\);/);
  const ops = read("../skills/staff-operations/SKILL.md");
  assert.match(ops, /A search request is always answered with the search results first\. Never answer a search with a question about a listing\./);
  assert.match(ops, /call find_employers with the state from the rule above and q set to the town/);
  assert.match(ops, /Never call listing_check_nudge for a search request\./);
  assert.match(ops, /add that line at the very end, word for word, after the answer/);
  const contribute = read("../tools/staff/contribute-tools.ts");
  assert.match(contribute, /NEVER for a search request/);
  assert.match(contribute, /only for a listing a directory search in this same answer returned/);
  assert.match(read("../tools/staff/directory.ts"), /else their organization's state from the system prompt/);
});
