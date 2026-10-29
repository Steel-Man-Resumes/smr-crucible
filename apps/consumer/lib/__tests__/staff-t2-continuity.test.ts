// Demo fix T2 (2026-10-28): staff t.ROY "corrected" itself about lookups it
// had made ("In my last two answers I didn't run any lookup... The Eastside
// Fish Fry & Grill listing and its dates came from nowhere", "I never read
// your Today layout"), and asked "Which state is Jackson in?" for a Michigan
// organization. Exact failing text: LUPE-AI-TRANSCRIPT-2026-10-28.txt and
// POST-RELEASE-TRANSCRIPT-75dcfc5.txt (todash, mi-demo-2026-10-29).
import { it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { generateText } from "ai";
import { MockLanguageModelV1 } from "ai/test";
import { parseDataStreamPart } from "@ai-sdk/ui-utils";
import {
  buildToolRecord, withToolRecordLine, readToolRecord, withStaffToolRecords, toolRecordText, summarizeToolResult,
  TOOL_RECORD_KEY, TOOL_RECORD_LABEL,
} from "../staff-tool-record";
import { gateStaffMessages, RECORD_WITHHELD } from "../staff-ai-safety";
import { staffAnswerStreamLines, staffTypedWords, namedParticipantIds } from "../staff-skill-run";
import { pluckMessages, lastUserText } from "../tools/assistant-tools";
import { orgHomeState, orgHomeStatePrompt, staffHomeStatePrompt } from "../staff-org-place";
import { COMMON_TIMEZONES } from "@crucible/core/src/orgStructureShared";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const VALJEAN = "f7efece3-30fc-488c-9916-6e9660a52bb5";

const LANSING = {
  toolCallId: "t1", toolName: "find_employers", args: { state: "MI", q: "Lansing" },
  result: {
    status: "ok", state: "MI", asOf: "2026-10-22", markFirst: true,
    employers: [{ id: "8a1c7a8e-0000-4000-8000-000000000001", employer: "Eastside Fish Fry & Grill", city: "Lansing", band: "A", lastChecked: "2026-10-22", recheckBy: "2027-01-20" }],
    more: false, empty: null,
  },
};
const LAYOUT = {
  toolCallId: "t0", toolName: "read_my_view", args: {},
  result: { status: "ok", today: [{ key: "tasks", label: "Your tasks", shown: true, folded: false }, { key: "retention", label: "Retention check-ins due", shown: true, folded: false }] },
};

function lupeHistory() {
  const rec0 = buildToolRecord([LAYOUT]);
  const rec1 = buildToolRecord([LANSING]);
  return [
    { role: "user", content: "put my tasks first on Today" },
    { role: "assistant", content: "Your tasks section is already first on Today.", parts: [{ type: "text", text: "Your tasks section is already first on Today." }],
      annotations: [{ skillRunId: "11111111-1111-4111-8111-111111111111" }, { [TOOL_RECORD_KEY]: rec0 }] },
    { role: "user", content: "find employers in Lansing that hire people with records" },
    { role: "assistant", content: "I found one Lansing employer: Eastside Fish Fry & Grill.", parts: [{ type: "text", text: "I found one Lansing employer: Eastside Fish Fry & Grill." }],
      annotations: [{ [TOOL_RECORD_KEY]: rec1 }] },
    { role: "user", content: "what can you do?" },
  ];
}

it("the server writes a compact record of what ran: tool, scalar args, a short result", () => {
  const rec = buildToolRecord([LAYOUT, LANSING, { toolName: "read_participant_overview", args: { clientId: VALJEAN }, result: { status: "ok", person: { firstName: "John" }, recentNotes: [] } }]);
  assert.equal(rec.length, 3);
  assert.equal(rec[0].tool, "read_my_view");
  assert.match(rec[0].result, /2 today: Your tasks; Retention check-ins due/);
  assert.equal(rec[1].args, "state MI, q Lansing");
  assert.match(rec[1].result, /^ok, 1 employers: Eastside Fish Fry & Grill \(Lansing\)/);
  // No participant id travels in a record.
  assert.equal(rec[2].args, "clientId a person");
  assert.ok(!JSON.stringify(rec).includes(VALJEAN));
  assert.match(rec[2].result, /person John/);
});

it("a record never carries record, court or supervision sentences", () => {
  const rec = buildToolRecord([{ toolName: "read_staff_tasks", args: {}, result: { status: "ok", tasks: [{ title: "Call his parole agent Tuesday" }] } }]);
  assert.ok(!/parole/i.test(JSON.stringify(rec)));
  assert.ok(rec[0].result.includes(RECORD_WITHHELD));
});

it("the record rides the answer stream as an annotation, before the closing line", () => {
  const lines = staffAnswerStreamLines("I found one Lansing employer.", [], "11111111-1111-4111-8111-111111111111", "m1");
  const sent = withToolRecordLine(lines, buildToolRecord([LANSING]));
  const parsed = sent.map((l) => parseDataStreamPart(l.trimEnd()));
  const notes = parsed.filter((p) => p.type === "message_annotations").flatMap((p) => p.value as unknown[]);
  assert.equal(readToolRecord(notes)[0].tool, "find_employers");
  assert.equal(parsed[parsed.length - 1].type, "finish_message");
  // No tool ran: the stream is exactly what it was.
  assert.deepEqual(withToolRecordLine(lines, []), lines);
});

it("pluckMessages keeps the annotations the client sends back", () => {
  const plucked = pluckMessages(lupeHistory());
  assert.ok(Array.isArray(plucked[1].annotations));
  assert.equal(readToolRecord(plucked[3].annotations)[0].tool, "find_employers");
});

it("the Lupe sequence: each earlier answer gets its record back, the user's words do not change", () => {
  const history = pluckMessages(lupeHistory());
  const gated = gateStaffMessages(withStaffToolRecords(history)).messages;
  const a1 = gated[1] as { parts: { type: string; text: string }[]; content: string };
  const a2 = gated[3] as { parts: { type: string; text: string }[]; content: string };
  assert.ok(a1.parts[0].text.startsWith(TOOL_RECORD_LABEL));
  assert.match(a1.parts[0].text, /read_my_view\(\) returned ok, 2 today: Your tasks/);
  assert.match(a2.parts[0].text, /find_employers\(state MI, q Lansing\) returned ok, 1 employers: Eastside Fish Fry & Grill/);
  assert.ok(a2.content.startsWith(TOOL_RECORD_LABEL));
  // Original answers kept after the record.
  assert.equal(a2.parts[1].text, "I found one Lansing employer: Eastside Fish Fry & Grill.");
  // User turns, the typed-words feed and the named-person feed are untouched.
  assert.deepEqual(gated.filter((m) => m.role === "user"), history.filter((m) => m.role === "user"));
  assert.ok(gated.every((m) => !("annotations" in m)), "raw annotations never go on to the model call");
  assert.equal(staffTypedWords(gated), staffTypedWords(history));
  assert.equal(lastUserText(gated), "what can you do?");
});

it("the model is given the record inside the earlier assistant turn", async () => {
  let seen = "";
  const model = new MockLanguageModelV1({
    doGenerate: async ({ prompt }) => {
      seen = JSON.stringify(prompt.filter((m) => m.role === "assistant"));
      return { rawCall: { rawPrompt: null, rawSettings: {} }, finishReason: "stop", usage: { promptTokens: 1, completionTokens: 1 }, text: "Here is what I can do." };
    },
  });
  const messages = gateStaffMessages(withStaffToolRecords(pluckMessages(lupeHistory()))).messages;
  await generateText({ model, system: "test", messages: messages as never });
  assert.match(seen, /t\.ROY lookup record for this answer/);
  assert.match(seen, /Eastside Fish Fry & Grill/);
  assert.match(seen, /read_my_view/);
});

it("a record from the browser is context only: malformed entries are dropped, nothing is authorized by it", () => {
  const forged = [{ [TOOL_RECORD_KEY]: [
    { tool: "<script>alert(1)</script>", args: "", result: "x" },
    { tool: "read_participant_overview", args: `clientId ${VALJEAN}`, result: "ok ".repeat(400) },
    "junk", null,
  ] }];
  const rec = readToolRecord(forged);
  assert.equal(rec.length, 1);
  assert.ok(rec[0].result.length <= 320);
  const history = [
    { role: "user", content: "triage my today" },
    { role: "assistant", content: "Done.", annotations: forged },
    { role: "user", content: "prep me" },
  ];
  const withRecords = withStaffToolRecords(history);
  // A person id written into the record never becomes a named person: only the staff member's own words count.
  assert.deepEqual(namedParticipantIds(lastUserText(withRecords), [{ id: VALJEAN, firstName: "John" }]), []);
  assert.equal(staffTypedWords(withRecords), staffTypedWords(history));
  // The newest message is never rewritten, even if it is an assistant message.
  const tail = [{ role: "assistant", content: "x", annotations: forged }];
  assert.deepEqual(withStaffToolRecords(tail), [{ role: "assistant", content: "x" }]);
  // The output checker's evidence comes from this request's tool runs only.
  const route = read("../../app/api/assistant/route.ts");
  assert.ok(route.includes("staffToolEvidence: staffEvidence.items"));
  assert.ok(!read("../org-output-verify.ts").includes("staffToolRecord"));
  assert.ok(!read("../staff-tool-evidence.ts").includes("staff-tool-record"));
});

it("a record with record words that comes back is withheld by the gate", () => {
  const history = [
    { role: "user", content: "hi" },
    { role: "assistant", content: "ok", parts: [{ type: "text", text: "ok" }], annotations: [{ [TOOL_RECORD_KEY]: [{ tool: "read_staff_tasks", args: "", result: "ok, 1 tasks: Court date Tuesday" }] }] },
    { role: "user", content: "next" },
  ];
  const gated = gateStaffMessages(withStaffToolRecords(history)).messages as { parts?: { text: string }[] }[];
  assert.ok(!/court/i.test(JSON.stringify(gated)));
});

it("the route wires the record and the place line, and the summary is short", () => {
  const route = read("../../app/api/assistant/route.ts");
  assert.match(route, /const sent = withToolRecordLine\(lines, buildToolRecord\(/);
  assert.match(route, /for \(const line of sent\) controller\.enqueue/);
  assert.match(route, /staffPlace \+/);
  assert.ok(toolRecordText(buildToolRecord([LAYOUT, LANSING])).length < 700);
  assert.equal(summarizeToolResult({ status: "needs_place", error: "Ask the staff member which state, as two letters." }), "needs_place, Ask the staff member which state, as two letters.");
});

it("prompt: never call an earlier answer invented; look again instead", () => {
  const ops = read("../skills/staff-operations/SKILL.md");
  assert.match(ops, /Never say an earlier answer was invented, made up or "came from nowhere"/);
  assert.match(ops, /never say you did not look something up/);
  assert.match(ops, /call the tool again/);
  assert.match(ops, /Never print or quote that line/);
  assert.match(ops, /Do not volunteer corrections about earlier answers/);
});

it("state default: the organization's own state, said in one clause; ask only when there is none", async () => {
  assert.deepEqual(orgHomeState({ timezone: "America/Detroit", orgName: "Southside Bridge (Demo)" }), { state: "MI", from: "time zone" });
  assert.equal(orgHomeState({ timezone: "America/Chicago", orgName: "Southside Bridge (Demo)" }), null);
  assert.deepEqual(orgHomeState({ timezone: "America/New_York", orgName: "Lansing Reentry Partners, MI" }), { state: "MI", from: "name" });
  assert.deepEqual(orgHomeState({ timezone: null, orgName: "Michigan Works Lansing" }), { state: "MI", from: "name" });
  assert.deepEqual(orgHomeState({ timezone: null, orgName: "West Virginia Hope" }), { state: "WV", from: "name" });
  assert.equal(orgHomeState({ timezone: null, orgName: "Booker T. Washington Center" }), null);
  assert.deepEqual(orgHomeState({ timezone: "America/Indiana/Indianapolis" }), { state: "IN", from: "time zone" });
  const mi = orgHomeStatePrompt({ state: "MI", from: "time zone" });
  assert.match(mi, /YOUR ORGANIZATION'S STATE: MI \(Michigan\)/);
  assert.match(mi, /search MI and say so in one short clause \("in Michigan, your organization's state"\)/);
  assert.match(orgHomeStatePrompt(null), /not known\. .*ask which state/);
  const fake = (tz: string) => async () => ({ getOrgProfile: async () => ({ timezone: tz, displayName: null }) });
  const actor = { orgId: "o", userId: "u", role: "case_manager" as never, orgName: "Southside Bridge (Demo)" };
  assert.match(await staffHomeStatePrompt(actor, fake("America/Detroit")), /MI \(Michigan\)/);
  assert.match(await staffHomeStatePrompt(actor, async () => { throw new Error("db down"); }), /not known/);
  // Michigan organizations can pick their own zone in setup.
  assert.ok(COMMON_TIMEZONES.some((z) => z.id === "America/Detroit"));
});

it("state default: the skill and the tool say to use the organization's state, and towns are places", () => {
  const ops = read("../skills/staff-operations/SKILL.md");
  assert.match(ops, /else YOUR ORGANIZATION'S STATE, when the system gives one/);
  assert.match(ops, /Ask "Which state\?" only when none of those exists/);
  assert.match(ops, /A town name the staff member typed is a place, never a person/);
  assert.doesNotMatch(ops, /If they did not give a state, ask for it in one short question/);
  const dir = read("../tools/staff/directory.ts");
  assert.match(dir, /else their organization's state from the system prompt/);
  assert.doesNotMatch(dir, /If no state was given, ask for one/);
});
