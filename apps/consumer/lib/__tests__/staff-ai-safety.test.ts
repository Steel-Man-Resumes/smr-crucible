// House build L6, safety first (review H1): staff-written text that carries a
// record word never reaches the model through a staff tool. The participant
// side's rule is `consent && !actingFor`; a staff session is never the person,
// so on the staff side the gate is closed and the text is withheld whole.
import { it } from "node:test";
import assert from "node:assert/strict";
import { buildStaffTools } from "../tools/assistant-staff-tools";
import {
  withholdRecordSentences, gateStaffMessages, STAFF_INPUT_NOTICE,
  hasStaffRecordWords, withholdRecordText, staffRecordConsent, staffTextGate, RECORD_WITHHELD,
  isSensitiveFieldDef, safeCustomFields, skillRunInputSummary,
} from "../staff-ai-safety";
import { recordAndSensitiveText } from "../hurdles/plan";
import { computeOrgCapabilities } from "@crucible/core/src/authz/capabilities";
import type { OrgActor } from "@crucible/core/src/authz/resolveOrgActor";

const ORG = "00000000-0000-0000-0000-0000000000a1";
const ME = "00000000-0000-0000-0000-000000000001";
const DANA = "00000000-0000-0000-0000-000000000007";
const PLANTED = "Dana has a court date on the felony theft case, DOC #A12345, and sees her PO Tuesday.";
const actor: OrgActor = { userId: ME, orgId: ORG, orgName: "Test org (Demo)", role: "staff", capabilities: computeOrgCapabilities("staff"), reach: "assigned", viaPlatformAdmin: false };

function core() {
  return {
    resolveOrgActor: async () => actor,
    getOne: async () => ({ crm_v2: true }),
    recordStaffAssistantOpen: async () => ({ ok: true, rows: [{ id: "l" }] }),
    listStaffTasks: async () => [
      { id: "t1", title: "Drive Dana to probation check-in", due_on: "2026-10-27", done_at: null, client_user_id: DANA, client_name: "Dana Ray", shared_with_participant: false },
      { id: "t2", title: "Call about the forklift class", due_on: "2026-10-28", done_at: null, client_user_id: DANA, client_name: "Dana Ray", shared_with_participant: false },
    ],
    getClientOverview: async () => ({ ok: true, data: {
      firstName: "Dana", identitySource: "account", joinedAt: "2026-09-02", assignedToYou: true, caseManager: "Pat", stage: 6, progress: null,
      shared: { applications: false, resume: false, documents: false }, awaitingAcknowledgement: false,
      openTasks: [{ title: "Pick up her parole paperwork", dueOn: "2026-10-27", sharedWithParticipant: false }, { title: "Call about the forklift class", dueOn: "2026-10-28", sharedWithParticipant: false }],
      suggestions: [], asks: [{ scope: "resume", status: "pending", reason: "So we can work around her supervision conditions", askedOn: "2026-10-20", answeredOn: null }],
      recentNotes: [
        { kind: "call", on: "2026-10-02", author: "Pat", body: PLANTED, corrected: false, draftedWithTroy: false },
        { kind: "call", on: "2026-10-01", author: "Pat", body: "Talked about the warehouse opening.", corrected: false, draftedWithTroy: false },
      ], notesTotal: 2, applications: null, placements: [],
    } }),
    getClientChanges: async (_a: unknown, _id: string, since: string) => ({ ok: true, data: { firstName: "Dana", from: since, to: "2026-10-24", applicationsRead: false, lastActiveAt: null,
      changes: [{ on: "2026-10-22", kind: "task_added", what: "Task added: Bring the warrant letter to the clerk" }, { on: "2026-10-20", kind: "note", what: "Pat added a call note" }] } }),
  };
}
const run = (t: ReturnType<typeof buildStaffTools>, name: string, args: unknown) => (t[name].execute as (a: unknown, o: unknown) => Promise<Record<string, unknown>>)(args, { toolCallId: "x", messages: [] });
const RECORD_TERMS = /court date|felony|theft|A12345|\bPO\b|probation|parole|supervision|warrant/i;
/** The data in a result, without the fixed system lines (which name what is never read, in words). */
const dataOf = (r: unknown) => JSON.stringify(r, (k, v) => (["dataNote", "withheldNote", "neverRead"].includes(k) ? undefined : v));

it("a record word planted in a case note never reaches the overview result; the clean note does", async () => {
  const t = buildStaffTools(actor, undefined, { focusClientId: DANA, core: async () => core() as never });
  const r = await run(t, "read_participant_overview", { clientId: DANA });
  assert.equal(r.status, "ok");
  const blob = dataOf(r);
  assert.doesNotMatch(blob, RECORD_TERMS, "no record word anywhere in what the model gets");
  const notes = r.recentNotes as { body: string }[];
  assert.equal(notes[0].body, RECORD_WITHHELD, "withheld whole, not word by word");
  assert.equal(notes[1].body, "Talked about the warehouse opening.");
  assert.equal((r.openTasks as { title: string }[])[0].title, RECORD_WITHHELD, "task titles too");
  assert.equal((r.openTasks as { title: string }[])[1].title, "Call about the forklift class");
  assert.equal((r.asks as { reason: string }[])[0].reason, RECORD_WITHHELD, "ask reasons too");
  assert.equal(r.recordWithheld, 3);
  assert.match(String(r.withheldNote), /Do not guess what it said/);
});

it("task titles in read_staff_tasks and change lines in read_recent_changes pass the same gate", async () => {
  const t = buildStaffTools(actor, undefined, { core: async () => core() as never });
  const tasks = await run(t, "read_staff_tasks", {});
  assert.doesNotMatch(dataOf(tasks), RECORD_TERMS);
  assert.equal((tasks.tasks as { title: string }[])[0].title, RECORD_WITHHELD);
  assert.equal((tasks.tasks as { title: string }[])[1].title, "Call about the forklift class");
  const t2 = buildStaffTools(actor, undefined, { core: async () => core() as never });
  const changes = await run(t2, "read_recent_changes", { clientId: DANA });
  assert.doesNotMatch(dataOf(changes), RECORD_TERMS);
  assert.deepEqual((changes.changes as { what: string }[]).map((c) => c.what), [RECORD_WITHHELD, "Pat added a call note"]);
});

it("the staff gate is closed: the participant's record yes never opens it", () => {
  assert.equal(staffRecordConsent(), false);
  assert.equal(withholdRecordText(PLANTED, { recordConsent: false }), RECORD_WITHHELD);
  // The gate's open position exists only to mirror the participant rule; staff code never passes true.
  assert.equal(withholdRecordText(PLANTED, { recordConsent: true }), PLANTED);
  const gate = staffTextGate();
  assert.equal(gate.pass("Out on parole since May"), RECORD_WITHHELD);
  assert.equal(gate.pass(null), null);
  assert.equal(gate.withheld, 1);
});

it("detects record, court, custody and supervision words and identifiers; leaves ordinary notes alone", () => {
  for (const s of [
    "Released from county jail last month", "Her probation officer called", "Court-ordered classes on Mondays", "He was convicted in 2019",
    "Two misdemeanors on file", "Pending case in district court", "Case # 24-CF-1182", "DOC number 448812", "Meets his PO on Fridays",
    "On supervision until March", "Some of the gap was time inside", "Warrant cleared", "Lives at a halfway house", "Whether you are on supervision",
    "Your conditions touch work", "Arrested in June", "Keep the job after his release date", "Since she got out in May", "Got her record expunged", "DUI in 2021", "custody hearing next week",
  ]) assert.ok(hasStaffRecordWords(s), s);
  for (const s of [
    "Talked about the warehouse opening.", "Wants a forklift certificate", "Needs a ride to the interview Thursday", "Updated her resume summary",
    "Sent the doc to the employer", "Ordered steel-toe boots", "Mailed it to the PO Box", "Wrote one sentence about the job", "Asked about supervision of the night crew",
    "In an interview, she practiced the first question", "Background check form signed for the warehouse job",
  ]) assert.ok(!hasStaffRecordWords(s), s);
});

it("every planner line that names a record or supervision is caught by the staff gate", () => {
  const recordLines = recordAndSensitiveText().filter((l) => /record|supervision|pending case|time inside|felony|misdemeanor|conditions/i.test(l));
  assert.ok(recordLines.length >= 8, String(recordLines.length));
  for (const line of recordLines) assert.ok(hasStaffRecordWords(`Staff wrote: ${line}`), line);
});

it("custom fields: sensitive or unmarked fields are never sent, a record subject is sensitive, values pass the gate", () => {
  assert.equal(isSensitiveFieldDef({ key: "shoe_size", label: "Shoe size", sensitive: true }), true);
  assert.equal(isSensitiveFieldDef({ key: "shoe_size", label: "Shoe size", sensitive: null }), true, "unmarked counts as sensitive");
  assert.equal(isSensitiveFieldDef({ key: "release_date", label: "Release date", sensitive: false }), true, "a record subject is sensitive whatever the flag");
  assert.equal(isSensitiveFieldDef({ key: "po_name", label: "PO name", sensitive: false }), true);
  assert.equal(isSensitiveFieldDef({ key: "diagnosis", label: "Diagnosis", sensitive: false }), true);
  assert.equal(isSensitiveFieldDef({ key: "shoe_size", label: "Shoe size", sensitive: false }), false);
  const out = safeCustomFields([
    { def: { key: "shoe_size", label: "Shoe size", type: "text", sensitive: false }, value: "11" },
    { def: { key: "trade_goal", label: "Trade goal", type: "text", sensitive: false }, value: "Welding, after his parole ends" },
    { def: { key: "offense_type", label: "Offense type", type: "single_select", sensitive: false }, value: "Theft" },
    { def: { key: "notes_private", label: "Private notes", type: "long_text", sensitive: true }, value: "Anything" },
    { def: { key: "old_field", label: "Old field", type: "text", sensitive: false, retired_at: "2026-10-01" }, value: "x" },
    { def: { key: "buddy", label: "Buddy", type: "staff_member", sensitive: false }, value: "00000000-0000-0000-0000-000000000002" },
    { def: { key: "langs", label: "Languages", type: "multi_select", sensitive: false }, value: ["English", "Spanish"] },
  ]);
  assert.deepEqual(out, [
    { label: "Shoe size", value: "11" },
    { label: "Languages", value: "English, Spanish" },
  ], "fix round 1: a field whose value carries a record word is dropped whole");
  assert.doesNotMatch(JSON.stringify(out), /Theft|parole|Anything|Private/);
});

it("the skill-run input summary keeps no record words, and draft skills keep only their label", () => {
  assert.equal(skillRunInputSummary("Triage my Today", "anyone with a court date this week?"), `Triage my Today: ${RECORD_WITHHELD}`);
  for (const label of ["Note from my bullets", "Draft a message", "Funder narrative"]) assert.equal(skillRunInputSummary(label, "met dana, talked about the warehouse job"), label);
  assert.equal(skillRunInputSummary("Triage my Today", "who needs me today?"), "Triage my Today: who needs me today?");
  assert.ok(skillRunInputSummary("X", "a".repeat(500)).length <= 200);
});

it("fix round 1: the reviewer's probes are all withheld", () => {
  for (const s of [
    "Went to court Tuesday", "Drug court graduation", "Treatment court", "His agent visit Monday", "Sentence ends in March",
    "Coyote Ridge Corrections Center", "Moved into the RRC", "Federal BOP release next month", "UA Tuesday", "Was inside 6 years",
    "Max discharge date", "Placed at the reentry center", "Curfew is 9pm", "No-contact order with her ex", "Deferred adjudication",
    "Treatment Court program", "Met with the public defender", "Drug test Friday",
  ]) assert.ok(hasStaffRecordWords(s), s);
  for (const s of ["Made corrections to her resume", "Ordered UAW union info", "Was inside the store when it opened", "Her travel agent called"]) {
    assert.ok(!hasStaffRecordWords(s), s);
  }
});

it("fix round 1: the staff member's own message loses only its record sentences, and they are told", () => {
  const bullets = "- met Dana Tuesday\n- court date moved to Nov 3. she wants forklift work\n- follow up Friday";
  const g = withholdRecordSentences(bullets);
  assert.equal(g.withheld, true);
  assert.equal(g.text, `- met Dana Tuesday\n${RECORD_WITHHELD} she wants forklift work\n- follow up Friday`);
  const msgs = gateStaffMessages([
    { role: "user", content: "Her PO called.", parts: [{ type: "text", text: "Her PO called." }] },
    { role: "assistant", content: "ok" },
    { role: "user", content: "Draft a note: she starts Monday.", parts: [{ type: "text", text: "Draft a note: she starts Monday." }] },
  ]);
  assert.equal(msgs.messages[0].content, RECORD_WITHHELD);
  assert.equal((msgs.messages[0].parts as { text: string }[])[0].text, RECORD_WITHHELD);
  assert.equal(msgs.withheld, false, "the notice speaks to the newest message only");
  assert.equal(gateStaffMessages([{ role: "user", content: "UA Tuesday, then the interview." }]).withheld, true);
  assert.match(STAFF_INPUT_NOTICE, /Add them yourself after\./);
});

it("fix round 2: the reviewer's second probes are withheld; corrections is matched as a facility word", () => {
  for (const s of [
    "PO meeting Tuesday", "Pending charges in Lincoln County", "Revoked last spring", "Violated, went back", "Got out 3 weeks ago",
    "Released Monday from Dodge", "Did 5 years at Waupun", "On paper until 2027", "On EM", "Wears a bracelet", "Back in county last month",
    "coyote ridge corrections center", "department of corrections letter", "Charges dropped in June", "Got out this summer",
  ]) assert.ok(hasStaffRecordWords(s), s);
  // Chosen: lowercase "corrections" counts only as a facility word (center, facility, department, officer, ...) or
  // "department of corrections"; capitalized "Corrections" counts anywhere (a proper name). So resume edits pass.
  for (const s of ["Made corrections to her resume", "Mailed it to the PO Box", "Send the PO number to the vendor", "Emailed her the list"]) {
    assert.ok(!hasStaffRecordWords(s), s);
  }
});

it("fix round 2: assistant turns and tool invocations in the client-sent history are gated too", () => {
  const g = gateStaffMessages([
    { role: "user", content: "prep me" },
    { role: "assistant", content: "Dana is on paper until 2027. She wants forklift work.", parts: [
      { type: "text", text: "Dana is on paper until 2027. She wants forklift work." },
      { type: "tool-invocation", toolInvocation: { toolName: "read_participant_overview", state: "result", args: { clientId: "x" }, result: { recentNotes: [{ body: "PO meeting Tuesday" }] } } },
    ], toolInvocations: [{ toolName: "read_participant_overview", state: "result", result: { recentNotes: [{ body: "Back in county last month" }] } }] },
  ]);
  const a = g.messages[1] as { content: string; parts: Record<string, unknown>[]; toolInvocations: unknown[] };
  assert.equal(a.content, `${RECORD_WITHHELD} She wants forklift work.`);
  assert.doesNotMatch(JSON.stringify(a), /on paper|PO meeting|Back in county/);
  assert.equal(g.withheld, false, "the notice is about the staff member's newest message only");
});
