// House build L6: every staff answer is logged as a skill run (106), drafts
// reach the browser, and only a staff member's own click accepts a run.
import { it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseDataStreamPart, callChatApi, shouldResubmitMessages } from "@ai-sdk/ui-utils";
import { recordStaffSkillRun, offeredDrafts, staffAnswerStreamLines, skillRunParticipant, staffSkillLabel, checkStaffDrafts, namedParticipantIds, resolveTypedNames, staffSubjectPrompt } from "../staff-skill-run";
import { checkOrgClaimsDeterministic, type OrgFacts } from "../org-output-verify";
import { skillRunIdOf, staffSkillsFor, staffSkillFromText, STAFF_SKILLS } from "../staff-troy";
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
  assert.deepEqual(seen[0], { skill: "staff-note-from-bullets", participantId: DANA, inputSummary: "Note from my bullets", tools: ["draft_staff_check_in", "offer_staff_draft"], output: "Draft: Met Dana today." });
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
  assert.match(route, /recordStaffSkillRun\(staffActor, \{ skill: staffSkill, focus: staffFocus, calls: staffEvidence\.calls, userText: staffSaid, answer: out \}\)/);
  assert.match(route, /orgAiAssistEnabled\(actor\)/);
  assert.doesNotMatch(route.slice(route.indexOf("const skillRunId")), /content\[0\]/);
});

it("acceptance is the staff member's own click: a saved draft or a copy; never under view-as", () => {
  const clients = read("../../app/api/org/clients/[id]/route.ts");
  assert.match(clients, /if \(res\.ok && body\.draftedByAssistant === true && UUID\.test\(String\(body\.skillRunId \?\? ""\)\)\) \{\s*await acceptSkillRun\(actor, String\(body\.skillRunId\)\)/);
  const accept = read("../../app/api/org/ai-skill-run/route.ts");
  assert.match(accept, /requireOrgCapability\("org\.client\.view_content", \{ request \}\)/);
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

it("B3: a draft that claims it was sent, or names a wage nobody gave, is held back with the reason shown", () => {
  const facts: OrgFacts = { caseload: 1, stalled: 0, neverStarted: 0, hired: 0, unassigned: 0, visibleNames: ["Dana"], staffNames: ["Pat"], orgName: "Test org (Demo)" };
  const mk = (id: string, body: string) => ({ toolCallId: id, args: {}, result: { status: "draft_only", saved: false, sent: false, participantId: DANA, purpose: "case_note", body } });
  const check = (body: string) => checkOrgClaimsDeterministic(body, facts, "she starts Monday at the mill");
  const r = checkStaffDrafts([mk("a", "I've sent this to Dana already."), mk("b", "Dana starts Monday at $18.50 an hour."), mk("c", "Dana starts Monday at the mill.")], check);
  assert.deepEqual(r.kept.map((d) => d.toolCallId), ["c"]);
  assert.match(r.notice, /A draft for their page was held back/);
  assert.match(r.notice, /cannot send, save or book/);
  assert.match(r.notice, /\$18\.50/);
  // The same wage the staff member typed passes.
  assert.equal(checkStaffDrafts([mk("d", "Dana starts at $18.50 an hour.")], (b) => checkOrgClaimsDeterministic(b, facts, "hired at $18.50 an hour")).kept.length, 1);
  const route = read("../../app/api/assistant/route.ts");
  assert.match(route, /checkStaffDrafts\(\s*offeredDrafts\(/);
  assert.match(route, /staffAnswerStreamLines\(out, draftCheck\.kept, skillRunId,/);
});

it("fix round 1: the route sends gated staff words to the models and tells the staff member", () => {
  const route = read("../../app/api/assistant/route.ts");
  assert.match(route, /const staffInput = staffActor \? gateStaffMessages\(messages\) : null;/);
  assert.match(route, /messages: \(staffInput\?\.messages \?\? messages\) as never,/);
  assert.match(route, /verifyOrgOutput\(answer, facts, userSaid \|\| undefined\)/);
  assert.match(route, /if \(staffInput\?\.withheld\) out \+= `\\n\\n_\$\{STAFF_INPUT_NOTICE\}_`;/);
});

it("fix round 1: named participants come only from the staff member's own words", () => {
  const sel = [{ id: DANA, firstName: "Dana" }, { id: "00000000-0000-0000-0000-000000000008", firstName: "Lee" }];
  assert.deepEqual(namedParticipantIds("prep me for dana please", sel), [DANA]);
  assert.deepEqual(namedParticipantIds("Danae and Leeland", sel), [], "whole words only");
  assert.deepEqual(namedParticipantIds("look at 00000000-0000-0000-0000-000000000009", sel), ["00000000-0000-0000-0000-000000000009"]);
});

// Demo walk W08 (2026-10-27): on Jean Valjean's page, "Valjean" was answered
// with "not on your list" because the model only sees first names.
it("W08: a surname or name part typed on a person's page resolves to that person", () => {
  const JEAN = "00000000-0000-0000-0000-00000000000a";
  const MARQUS = "00000000-0000-0000-0000-00000000000b";
  const JEANNE = "00000000-0000-0000-0000-00000000000c";
  const people = [{ id: JEAN, name: "Jean Valjean" }, { id: MARQUS, name: "Marqus Relly" }];
  // On his page, any case.
  assert.deepEqual(resolveTypedNames("prep me for valjean", people, JEAN), [{ word: "valjean", id: JEAN, firstName: "Jean" }]);
  // No page open: a capitalized surname that fits exactly one person.
  assert.deepEqual(resolveTypedNames("Prep me for Relly", people, null), [{ word: "Relly", id: MARQUS, firstName: "Marqus" }]);
  // Whole name parts only, and ordinary words are not names.
  assert.deepEqual(resolveTypedNames("Prep me for Valj and Rel", people, null), []);
  // Two people share a name part: the open page decides; with no page, nothing (never guess).
  const two = [...people, { id: JEANNE, name: "Jean Okafor" }];
  assert.deepEqual(resolveTypedNames("Prep me for Jean", two, JEAN).map((r) => r.id), [JEAN]);
  assert.deepEqual(resolveTypedNames("Prep me for Jean", two, null), []);
  // Someone outside reach is never in the list, so nothing resolves to them.
  assert.deepEqual(resolveTypedNames("Prep me for Michael Shaw", people, JEAN), []);
});

it("W08: the prompt names the open page's person and the resolved words, never an untyped surname", () => {
  const JEAN = "00000000-0000-0000-0000-00000000000a";
  const people = [{ id: JEAN, name: "Jean Valjean" }];
  const bare = staffSubjectPrompt(JEAN, people, []);
  assert.match(bare, /ABOUT ONE PARTICIPANT, id 00000000-0000-0000-0000-00000000000a \(first name Jean\), the person whose page the staff member has open/);
  assert.ok(!bare.includes("Valjean"), "a surname the staff member did not type never reaches the model");
  const typed = staffSubjectPrompt(JEAN, people, resolveTypedNames("Valjean", people, JEAN));
  assert.match(typed, /"word":"Valjean","id":"00000000-0000-0000-0000-00000000000a","firstName":"Jean","pageOpen":true/);
  assert.match(typed, /Never say that person is not on their list/);
  assert.equal(staffSubjectPrompt(null, people, []), "");
  const route = read("../../app/api/assistant/route.ts");
  assert.match(route, /const staffResolved = staffActor \? resolveTypedNames\(staffSaid, staffPeople, staffFocus\) : \[\];/);
  assert.match(route, /\(staffActor \? staffSubjectPrompt\(staffFocus, staffPeople, staffResolved\) : ""\) \+/);
  assert.match(route, /resolvedNames: staffResolved\.map\(\(r\) => r\.word\),/);
});

// W08 review round 2 (2026-10-28): S1 split names, S3 possessive, S4 lowercase
// ordinary words and middle names, S5 job words, S1 prompt wording.
it("W08 round 2: a typed full name resolves only if every part fits one person", () => {
  const MJ = "00000000-0000-0000-0000-00000000001a";
  const AS = "00000000-0000-0000-0000-00000000001b";
  const JEAN = "00000000-0000-0000-0000-00000000001c";
  const people = [{ id: MJ, name: "Michael Jones" }, { id: AS, name: "Ann Shaw" }, { id: JEAN, name: "Jean Valjean" }];
  // S1: "Michael Shaw" is one name and fits nobody: nothing, on or off a page.
  assert.deepEqual(resolveTypedNames("Prep me for Michael Shaw", people, null), []);
  assert.deepEqual(resolveTypedNames("Prep me for Michael Shaw", people, MJ), []);
  assert.deepEqual(resolveTypedNames("Did Michael Jones call?", people, null).map((r) => [r.word, r.id]), [["Michael", MJ], ["Jones", MJ]]);
  // S3: a possessive still resolves on his page.
  assert.deepEqual(resolveTypedNames("Prep me for Valjean's interview", people, JEAN), [{ word: "Valjean", id: JEAN, firstName: "Jean" }]);
  assert.deepEqual(resolveTypedNames("Prep me for Valjean’s interview", people, JEAN).map((r) => r.word), ["Valjean"]);
});

it("W08 round 2: lowercase ordinary words, middle names and job words never resolve", () => {
  const JGV = "00000000-0000-0000-0000-00000000002a";
  const MD = "00000000-0000-0000-0000-00000000002b";
  const people = [{ id: JGV, name: "Jean Grant Valjean" }, { id: MD, name: "Minnie Driver" }];
  // S4: an English word on the page is not the person, and the middle name is never matched.
  assert.deepEqual(resolveTypedNames("She wants a grant for training", people, JGV), []);
  // Round 3: a CAPITALIZED word the staff member typed may match a middle name (they typed it).
  assert.deepEqual(resolveTypedNames("Ask Grant about it", people, JGV).map((r) => r.id), [JGV]);
  assert.deepEqual(resolveTypedNames("ask grant about it", people, JGV), [], "a lowercase word never matches a middle name");
  assert.deepEqual(resolveTypedNames("prep me for valjean", people, JGV).map((r) => r.word), ["valjean"]);
  assert.deepEqual(resolveTypedNames("prep me for valjean", people, null), [], "lowercase only for the open page");
  // S5: a job title is not a person named Driver, on or off a page.
  assert.deepEqual(resolveTypedNames("Is the Forklift Driver opening still up?", people, null), []);
  assert.deepEqual(resolveTypedNames("Is the Forklift Driver opening still up?", people, MD), []);
  assert.deepEqual(resolveTypedNames("Will he take the Driver job?", people, null), []);
  // A capitalized surname on its own still resolves.
  assert.deepEqual(resolveTypedNames("How is Valjean doing?", people, null).map((r) => r.id), [JGV]);
});

it("W08 round 2: only the open page's person gets 'never say not on their list'", () => {
  const JEAN = "00000000-0000-0000-0000-00000000003a";
  const MARQUS = "00000000-0000-0000-0000-00000000003b";
  const people = [{ id: JEAN, name: "Jean Valjean" }, { id: MARQUS, name: "Marqus Relly" }];
  const other = staffSubjectPrompt(null, people, resolveTypedNames("Prep me for Relly", people, null));
  assert.match(other, /"word":"Relly"/);
  assert.ok(!other.includes("Never say"), "a match off the page is data only");
  const onPage = staffSubjectPrompt(JEAN, people, resolveTypedNames("Prep me for Valjean", people, JEAN));
  assert.match(onPage, /pageOpen true is part of the name of the person whose page is open: it means that person\. Never say that person is not on their list\./);
});

// Round 3 (review R2, S1 and S2): trailing words, honorifics, suffixes, any name part.
it("W08 round 3: trailing words do not sink the name on his page", () => {
  const JEAN = "00000000-0000-0000-0000-00000000004a";
  const people = [{ id: JEAN, name: "Jean Valjean" }];
  for (const said of ["Is Valjean OK?", "Prep me for Valjean ASAP", "Prep Valjean For Interview"]) {
    assert.deepEqual(resolveTypedNames(said, people, JEAN).map((r) => [r.word, r.id]), [["Valjean", JEAN]], said);
  }
});

it("W08 round 3: honorifics and suffixes are dropped; a capitalized word matches any name part", () => {
  const CECI = "00000000-0000-0000-0000-00000000005a";
  const MARQUS = "00000000-0000-0000-0000-00000000005b";
  const people = [{ id: CECI, name: "Circe Ayala Solano" }, { id: MARQUS, name: "Marqus Relly Jr." }];
  assert.deepEqual(resolveTypedNames("Prep me for Ms. Ayala", people, CECI).map((r) => [r.word, r.id]), [["Ayala", CECI]]);
  assert.deepEqual(resolveTypedNames("Prep me for Ms. Ayala", people, null), [], "round 4: a middle name matches only the open page's person");
  assert.deepEqual(resolveTypedNames("How is Relly doing?", people, MARQUS).map((r) => [r.word, r.id]), [["Relly", MARQUS]]);
  assert.deepEqual(resolveTypedNames("prep me for relly", people, MARQUS).map((r) => r.word), ["relly"], "lowercase surname on his page, past the suffix");
  assert.deepEqual(resolveTypedNames("Is Dr Relly Jr in?", people, null).map((r) => r.word), ["Relly"]);
  // Still never a guess: a lowercase middle name, or a name part nobody in reach has.
  assert.deepEqual(resolveTypedNames("she said ayala", people, CECI), []);
  assert.deepEqual(resolveTypedNames("Prep me for Ms. Shaw", people, CECI), []);
});

// Round 4 (review R3, S3): a first or last name on anyone in reach beats the
// open page person's middle name, and a middle-name match never gets the
// "never say not on their list" line.
it("W08 round 4: 'Ask Grant about it' is Grant Miller, not Jean Grant Valjean's middle name", () => {
  const JGV = "00000000-0000-0000-0000-00000000006a";
  const GM = "00000000-0000-0000-0000-00000000006b";
  const people = [{ id: JGV, name: "Jean Grant Valjean" }, { id: GM, name: "Grant Miller" }];
  assert.deepEqual(resolveTypedNames("Ask Grant about it", people, JGV).map((r) => [r.word, r.id]), [["Grant", GM]]);
  assert.deepEqual(resolveTypedNames("Is Grant ready?", people, null).map((r) => r.id), [GM]);
  const prompt = staffSubjectPrompt(JGV, people, resolveTypedNames("Ask Grant about it", people, JGV));
  assert.ok(!prompt.includes("Never say"), "the open page's person was not matched on first or last name");
  // Without Grant Miller, the page person's middle name matches, but still no "never say" line.
  const solo = [{ id: JGV, name: "Jean Grant Valjean" }];
  const r = resolveTypedNames("Ask Grant about it", solo, JGV);
  assert.deepEqual(r.map((x) => [x.word, x.id, x.middle]), [["Grant", JGV, true]]);
  assert.ok(!staffSubjectPrompt(JGV, solo, r).includes("Never say"));
  assert.ok(staffSubjectPrompt(JGV, solo, resolveTypedNames("Prep me for Valjean", solo, JGV)).includes("Never say"));
});
