// House build L6: every staff answer is logged as a skill run (106), drafts
// reach the browser, and only a staff member's own click accepts a run.
import { it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseDataStreamPart, callChatApi, shouldResubmitMessages } from "@ai-sdk/ui-utils";
import { recordStaffSkillRun, offeredDrafts, staffAnswerStreamLines, skillRunParticipant, staffSkillLabel } from "../staff-skill-run";
import { skillRunIdOf, staffSkillsFor, staffSkillFromText, STAFF_SKILLS } from "../staff-troy";
import { RECORD_WITHHELD } from "../staff-ai-safety";
import { computeOrgCapabilities } from "@crucible/core/src/authz/capabilities";
import type { OrgActor } from "@crucible/core/src/authz/resolveOrgActor";

const DANA = "00000000-0000-0000-0000-000000000007";
const RUN = "11111111-2222-4333-8444-555555555555";
const actor: OrgActor = { userId: "00000000-0000-0000-0000-000000000001", orgId: "00000000-0000-0000-0000-0000000000a1", orgName: "Test org (Demo)", role: "staff", capabilities: computeOrgCapabilities("staff"), reach: "assigned", viaPlatformAdmin: false };
const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

it("the run is logged with a gated summary, the person, the tools and only a hash input", async () => {
  const seen: unknown[] = [];
  const id = await recordStaffSkillRun(actor, {
    skill: "staff-note-from-bullets", focus: null, userText: "met Dana today, her PO wants pay stubs",
    calls: [{ tool: "draft_staff_check_in", participantId: DANA }, { tool: "offer_staff_draft", participantId: DANA }], answer: "Draft: Met Dana today.",
  }, async () => ({ logSkillRun: async (_a: unknown, input: unknown) => { seen.push(input); return RUN; } }) as never);
  assert.equal(id, RUN);
  assert.deepEqual(seen[0], { skill: "staff-note-from-bullets", participantId: DANA, inputSummary: `Note from my bullets: ${RECORD_WITHHELD}`, tools: ["draft_staff_check_in", "offer_staff_draft"], output: "Draft: Met Dana today." });
  // A failed log never fails the answer.
  assert.equal(await recordStaffSkillRun(actor, { skill: null, focus: null, userText: "hi", calls: [], answer: "x" }, async () => ({ logSkillRun: async () => { throw new Error("relation does not exist"); } }) as never), null);
  assert.equal(skillRunParticipant(DANA, []), DANA);
  assert.equal(skillRunParticipant(null, [{ participantId: null }, { participantId: DANA }]), DANA);
  assert.equal(staffSkillLabel(null), "Question");
});

it("only real drafts are re-emitted: unsaved, unsent, with a body", () => {
  const drafts = offeredDrafts([
    { toolCallId: "c1", toolName: "offer_staff_draft", args: {}, result: { status: "draft_only", saved: false, sent: false, participantId: DANA, purpose: "case_note", body: "Met Dana." } },
    { toolCallId: "c2", toolName: "offer_staff_draft", args: {}, result: { status: "refused" } },
    { toolCallId: "c3", toolName: "read_participant_overview", args: {}, result: { status: "ok", participantId: DANA, body: "x" } },
    { toolCallId: "c4", toolName: "offer_staff_draft", args: {}, result: { status: "draft_only", saved: true, sent: false, participantId: DANA, body: "x" } },
  ]);
  assert.deepEqual(drafts.map((d) => d.toolCallId), ["c1"]);
});

it("the stream is valid protocol; the browser gets the draft as a finished tool call, the text, and the run id, and does not resubmit", async () => {
  const draft = { toolCallId: "c1", args: { clientId: DANA, purpose: "case_note", body: "Met Dana." }, result: { status: "draft_only", saved: false, sent: false, participantId: DANA, purpose: "case_note", body: "Met Dana." } };
  const lines = staffAnswerStreamLines("Here is your draft. Nothing was saved.", [draft], RUN, "m1");
  for (const l of lines) assert.doesNotThrow(() => parseDataStreamPart(l.trim()), l);
  const body = lines.join("");
  let finalMessages: Array<Record<string, unknown>> = [];
  await callChatApi({
    api: "/x", body: {}, streamProtocol: "data", credentials: undefined, headers: undefined, abortController: () => null,
    restoreMessagesOnFailure: () => {}, onResponse: undefined, onToolCall: undefined, generateId: () => "g", lastMessage: undefined, requestType: "generate",
    onUpdate: ({ message }: { message: unknown }) => { finalMessages = [message as never]; },
    onFinish: () => {},
    fetch: (async () => new Response(body, { status: 200, headers: { "Content-Type": "text/plain; charset=utf-8", "x-vercel-ai-data-stream": "v1" } })) as never,
  } as never);
  const msg = finalMessages[0] as { content: string; parts: { type: string; toolInvocation?: { toolName: string; state: string; result: Record<string, unknown> } }[]; annotations?: unknown; toolInvocations?: unknown[] };
  assert.equal(msg.content, "Here is your draft. Nothing was saved.");
  const inv = msg.parts.find((p) => p.type === "tool-invocation")!.toolInvocation!;
  assert.equal(inv.toolName, "offer_staff_draft");
  assert.equal(inv.state, "result");
  assert.equal(inv.result.saved, false);
  assert.equal(skillRunIdOf(msg.annotations), RUN);
  assert.equal(shouldResubmitMessages({ originalMaxToolInvocationStep: undefined, originalMessageCount: 1, maxSteps: 5, messages: [{ id: "u", role: "user", content: "go" }, msg] as never }), false, "the chat does not send the turn back");
  // No draft: text, annotation, finish; no tool parts.
  const plain = staffAnswerStreamLines("Hi", [], null, "m2");
  assert.deepEqual(plain.map((l) => l[0]), ["0", "d"]);
});

it("the route logs every staff answer and streams through the helpers; the AI switch can turn it off", () => {
  const route = read("../../app/api/assistant/route.ts");
  assert.match(route, /recordStaffSkillRun\(staffActor, \{ skill: staffSkill, focus: staffFocus, calls: staffEvidence\.calls, userText: lastUserText\(messages\), answer: out \}\)/);
  assert.match(route, /staffAnswerStreamLines\(out, drafts, skillRunId,/);
  assert.match(route, /orgAiAssistEnabled\(actor\)/);
  assert.doesNotMatch(route.slice(route.indexOf("const skillRunId")), /content\[0\]/);
});

it("acceptance is the staff member's own click: a saved draft or a copy; never under view-as", () => {
  const clients = read("../../app/api/org/clients/[id]/route.ts");
  assert.match(clients, /if \(res\.ok && body\.draftedByAssistant === true && UUID\.test\(String\(body\.skillRunId \?\? ""\)\)\) \{\s*await acceptSkillRun\(actor, String\(body\.skillRunId\)\)/);
  const accept = read("../../app/api/org/ai-skill-run/route.ts");
  assert.match(accept, /requireOrgCapability\("org\.client\.view_content"\)/);
  assert.match(accept, /\(await effectiveAuth\(\)\)\?\.user\?\.id !== actor\.userId/);
  assert.doesNotMatch(accept, /INSERT|UPDATE|query\(/, "the route runs no SQL of its own");
  const page = read("../../components/org/ClientPage.tsx");
  assert.match(page, /draftedByAssistant: !!draft, skillRunId: draft\?\.skillRunId/);
  const chat = read("../../components/AssistantChat.tsx");
  assert.match(chat, /skillRunId: skillRunId \?\? undefined/);
  assert.match(chat, /JSON\.stringify\(\{ action: "accept", id: skillRunId \}\)/);
  assert.match(chat, /t\.ROY sends nothing\./);
});

it("the panel shows person skills about a person and caseload skills without one; typed words pick the new skills", () => {
  const person = staffSkillsFor(true).map((s) => s.id);
  const caseload = staffSkillsFor(false).map((s) => s.id);
  assert.ok(person.includes("staff-note-from-bullets") && person.includes("staff-timeline-summary") && !person.includes("staff-triage-today"));
  assert.ok(caseload.includes("staff-triage-today") && caseload.includes("staff-funder-narrative") && !caseload.includes("staff-prep-me"));
  assert.ok(person.includes("staff-find-help") && caseload.includes("staff-find-help"), "find help works either way");
  assert.equal(new Set([...person, ...caseload]).size, STAFF_SKILLS.length, "every skill has a home");
  const cases: [string, string][] = [
    ["triage my Today", "staff-triage-today"], ["who needs me first?", "staff-triage-today"],
    ["give me my weekly digest", "staff-caseload-digest"], ["Summarize my caseload", "staff-caseload-digest"],
    ["who is slipping through the cracks", "staff-stale-flags"], ["flag the stale cases", "staff-stale-flags"],
    ["turn my bullets into a case note", "staff-note-from-bullets"], ["Draft a case note for your review", "staff-note-from-bullets"],
    ["summarize Dana's timeline", "staff-timeline-summary"], ["draft a reminder for her interview", "staff-outreach-draft"],
    ["congratulate Dana on the new job", "staff-outreach-draft"], ["draft our funder narrative for Q3", "staff-funder-narrative"],
    ["prep me for Dana", "staff-prep-me"], ["Draft a check-in for you to send", "staff-check-in"],
  ];
  for (const [text, id] of cases) assert.equal(staffSkillFromText(text), id, text);
  assert.equal(staffSkillFromText("how many people are on my list"), null);
  for (const s of STAFF_SKILLS) assert.equal(staffSkillFromText(s.request.replace("{first}", "Dana")), s.id === "staff-find-help" ? "staff-find-help" : s.id, s.id);
});

it("t.ROY is told when the staff member is a volunteer (server-resolved), and never told it sends", async () => {
  const { buildSystemPrompt } = await import("../assistant-prompt");
  const org = { orgName: "Test org (Demo)", role: "staff" as const, reach: "assigned" as const, caseload: 2, stalled: 1, neverStarted: 0, hired: 0, unassigned: 0 };
  const vol = buildSystemPrompt({ currentPage: "dashboard", audience: "org_staff", org: { ...org, volunteer: true } } as never);
  assert.match(vol, /THIS PERSON IS A VOLUNTEER/);
  const cm = buildSystemPrompt({ currentPage: "dashboard", audience: "org_staff", org } as never);
  assert.doesNotMatch(cm, /THIS PERSON IS A VOLUNTEER/);
  assert.doesNotMatch(cm, /sends as written/);
  assert.match(cm, /You never send anything\./);
  assert.match(read("../../app/api/assistant/route.ts"), /volunteer: \(await import\("@crucible\/core"\)\)\.todayIsVolunteer\(actor\.role, actor\.capabilities\)/);
});
