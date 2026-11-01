// Demo fix T2 round 3 (live 923c517, CODEX-RETEST-R2 item D): Lupe asked
// "Find employers in Lansing that hire people with records" and got only
// "Did this place still check out? Called them lately?" with the listing
// buttons. No employer search result was shown.
import { describe, it } from "node:test";
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
  // No ok nudge result this turn, so the copied line is cut (review R3 S2); the answer stands alone.
  assert.equal(staffAnswerText([{ text: answer, toolCalls: [{}] }, { text: LISTING_NUDGE_LINE, toolCalls: [] }], LISTING_NUDGE_LINE), answer);
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
  assert.match(route, /let answer = replyOrFallback\(staffAnswerText\(generated\.steps, generated\.text\)\);/);
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

it("review R3 S2: the nudge line is cut unless the nudge tool answered ok this turn", async () => {
  const { staffAnswerText } = await import("../staff-answer-text");
  const { LISTING_NUDGE_LINE } = await import("@crucible/core/src/staffRewardsShared");
  const answerStep = { text: "Eastside Fish Fry & Grill, Lansing, carries our mark.", toolCalls: [{}], toolResults: [{ toolName: "find_employers", result: { status: "ok" } }] };
  const quiet = staffAnswerText([answerStep, { text: LISTING_NUDGE_LINE, toolCalls: [{}], toolResults: [{ toolName: "listing_check_nudge", result: { status: "quiet" } }] }], LISTING_NUDGE_LINE);
  assert.ok(!quiet.includes(LISTING_NUDGE_LINE) && quiet.includes("Eastside"));
  const copied = staffAnswerText([{ text: `Here are the listings. ${LISTING_NUDGE_LINE}`, toolCalls: [] }], `Here are the listings. ${LISTING_NUDGE_LINE}`);
  assert.equal(copied, "Here are the listings.");
  const ok = staffAnswerText([answerStep, { text: LISTING_NUDGE_LINE, toolCalls: [{}], toolResults: [{ toolName: "listing_check_nudge", result: { status: "ok" } }] }], LISTING_NUDGE_LINE);
  assert.ok(ok.endsWith(LISTING_NUDGE_LINE) && ok.includes("Eastside"));
});

it("harness TRAP-ACT-02 (2026-10-31): drafts written in an earlier step reach the staff member", async () => {
  const { staffAnswerText } = await import("../staff-answer-text");
  const drafts = "Text message (under 320 characters):\n\nHi Marqus, it's Lupe. Your two saved jobs at Market Square are still open on your list. What help would you like with the next step?\n\nEmail\n\nSubject: Checking in\n\nHi Marqus,\n\nI saw your two saved jobs. What would help most right now?\n\nLupe";
  const note = "I signed both drafts \"Lupe\" because that is the case manager on Marqus's page. This is a draft. Nothing was saved or sent.";
  const out = staffAnswerText([{ text: drafts, toolCalls: [{ toolName: "offer_staff_draft" }], toolResults: [{ toolName: "offer_staff_draft", result: { status: "draft_only", body: "Hi Marqus, it's Lupe." } }] }, { text: note, toolCalls: [] }], note);
  assert.ok(out.startsWith(drafts) && out.endsWith(note), out);
  // A short working line before a tool call stays dropped; a final answer that already repeats the earlier text is not doubled.
  assert.equal(staffAnswerText([{ text: "Looking that up.", toolCalls: [{}] }, { text: note, toolCalls: [] }], note), note);
  assert.equal(staffAnswerText([{ text: drafts, toolCalls: [{ toolName: "offer_staff_draft" }] }, { text: `${drafts}\n\n${note}`, toolCalls: [] }], `${drafts}\n\n${note}`), `${drafts}\n\n${note}`);
});

it("review C1 (2026-11-01): a corrected earlier claim is never resurrected by length", async () => {
  const { staffAnswerText } = await import("../staff-answer-text");
  const claim = "I have opened the participant page and placed the draft there for you. You can now review the check-in on that page before using it. There is no other action required to put it on the page.";
  const fix = "Correction: the navigation tool refused. I did not open a page or place a draft there. The draft is unsaved in this reply.";
  const out = staffAnswerText([{ text: claim, toolCalls: [{ toolName: "open_staff_page" }], toolResults: [{ toolName: "open_staff_page", result: { status: "refused" } }] }, { text: fix, toolCalls: [] }], fix);
  assert.equal(out, fix);
});

it("review C2 (2026-11-01): a short real draft the tool was given reaches the staff member", async () => {
  const { staffAnswerText } = await import("../staff-answer-text");
  const body = "Hi Marqus, want to pick a next step on your saved jobs? Let me know what would help. Lupe";
  const disclaimer = "This is a draft. Nothing was saved or sent.";
  // Written in the draft step: kept by provenance.
  assert.equal(staffAnswerText([{ text: body, toolCalls: [{ toolName: "offer_staff_draft" }], toolResults: [{ toolName: "offer_staff_draft", result: { status: "draft_only", body } }] }, { text: disclaimer, toolCalls: [] }], disclaimer), `${body}\n\n${disclaimer}`);
  // Never written as text at all: the prose is the disclaimer alone; the draft card carries the body
  // (review D2, 2026-11-01: copying bodies into the prose resurfaced a draft the final step withdrew).
  const out = staffAnswerText([{ text: "", toolCalls: [{ toolName: "offer_staff_draft" }], toolResults: [{ toolName: "offer_staff_draft", result: { status: "draft_only", body } }] }, { text: disclaimer, toolCalls: [] }], disclaimer);
  assert.equal(out, disclaimer);
});

describe("review D (2026-11-01): the answer is kept by step kind, never by length or draft provenance", () => {
  const triage = "Jean needs attention first: the STS application says interviewing (Jean's report, updated Oct 24) and the task \"Bring your ID to STS\" has no due date. Marqus is active and has nothing open. Your step: open Jean's page, check the interview details, and remind Jean about the ID yourself.";
  const nav = "You can open Jean from People.";
  const refusedOpen = { toolName: "open_staff_page", result: { status: "refused" } };
  it("D4 / ROOM-10 / DEMO-09: a triage written in the step whose button was refused is kept, the nav note last", async () => {
    const { staffAnswerText } = await import("../staff-answer-text");
    const steps = [
      { text: "Let me look at your caseload.", toolCalls: [{ toolName: "read_caseload_digest" }], toolResults: [{ toolName: "read_caseload_digest", result: { status: "ok" } }] },
      { text: triage, toolCalls: [{ toolName: "open_staff_page" }], toolResults: [refusedOpen] },
      { text: nav, toolCalls: [] },
    ];
    assert.equal(staffAnswerText(steps, nav), `${triage}\n\n${nav}`);
    // The same with the button allowed: kept too, and a successful open changes nothing in the words.
    const okSteps = [steps[0], { text: triage, toolCalls: [{ toolName: "open_staff_page" }], toolResults: [{ toolName: "open_staff_page", result: { status: "ok" } }] }, steps[2]];
    assert.equal(staffAnswerText(okSteps, nav), `${triage}\n\n${nav}`);
  });
  it("read-step words are narration and are dropped, whatever their length", async () => {
    const { staffAnswerText } = await import("../staff-answer-text");
    const long = "I will read the caseload now and then the overview for each person on it so that the triage covers everyone, including the people with nothing open today, before I answer you in full.";
    assert.equal(staffAnswerText([{ text: long, toolCalls: [{ toolName: "read_caseload_digest" }] }, { text: nav, toolCalls: [] }], nav), nav);
    // An action step BEFORE a later read is before the facts too: dropped.
    const steps = [
      { text: "Opening Jean.", toolCalls: [{ toolName: "open_staff_page" }], toolResults: [{ toolName: "open_staff_page", result: { status: "ok" } }] },
      { text: "Now the overview.", toolCalls: [{ toolName: "read_participant_overview" }], toolResults: [{ toolName: "read_participant_overview", result: { status: "ok" } }] },
      { text: triage, toolCalls: [{ toolName: "offer_staff_draft" }], toolResults: [{ toolName: "offer_staff_draft", result: { status: "draft_only", body: "Hi Jean." } }] },
      { text: nav, toolCalls: [] },
    ];
    assert.equal(staffAnswerText(steps, nav), `${triage}\n\n${nav}`);
  });
  it("D1: from a refused action step, only the sentences that say it happened are cut; a refused draft offer keeps its real words", async () => {
    const { staffAnswerText } = await import("../staff-answer-text");
    const words = `${triage} I have opened Jean's page and placed the draft there for you. You can review it on that page.`;
    const note = "The draft is unsaved, in this reply; the page did not open.";
    const out = staffAnswerText([{ text: words, toolCalls: [{ toolName: "offer_staff_draft" }], toolResults: [{ toolName: "offer_staff_draft", result: { status: "refused" } }] }, { text: note, toolCalls: [] }], note);
    // The first-person completion claim is cut; the instruction that mentions the page stays (review E1).
    assert.equal(out, `${triage} You can review it on that page.\n\n${note}`);
    // A final that corrects what came before stands alone (review E5).
    const fix = "Correction: I did not open a page or place a draft. The draft is unsaved, in this reply.";
    assert.equal(staffAnswerText([{ text: words, toolCalls: [{ toolName: "offer_staff_draft" }], toolResults: [{ toolName: "offer_staff_draft", result: { status: "refused" } }] }, { text: fix, toolCalls: [] }], fix), fix);
  });
  it("D2: a draft body the final step withdrew is not copied into the prose", async () => {
    const { staffAnswerText } = await import("../staff-answer-text");
    const body = "Hi Marqus, your supervisor role at Market Square starts Oct 27.";
    const withdraw = "Discard that earlier draft. It used an unsupported fact. No draft should be used.";
    assert.equal(staffAnswerText([{ text: "", toolCalls: [{ toolName: "offer_staff_draft" }], toolResults: [{ toolName: "offer_staff_draft", result: { status: "draft_only", body } }] }, { text: withdraw, toolCalls: [] }], withdraw), withdraw);
  });
  it("D3: a draft offered with no words at all gets a reply that says where the draft is, not the search fallback", async () => {
    const { staffAnswerText, STAFF_DRAFT_ONLY_TEXT, STAFF_TOOLS_NO_TEXT } = await import("../staff-answer-text");
    const steps = [{ text: "", toolCalls: [{ toolName: "offer_staff_draft" }], toolResults: [{ toolName: "offer_staff_draft", result: { status: "draft_only", body: "Hi Jean, it's Lupe." } }] }, { text: "", toolCalls: [] }];
    assert.equal(staffAnswerText(steps, ""), STAFF_DRAFT_ONLY_TEXT);
    assert.equal(staffAnswerText([{ text: "", toolCalls: [{ toolName: "read_caseload_digest" }] }, { text: "", toolCalls: [] }], ""), STAFF_TOOLS_NO_TEXT);
  });
  it("D5 / D6: the header note certifies no earlier read, and the focus refusal keeps one person's facts to that person", () => {
    const tools = read("../tools/assistant-staff-tools.ts");
    assert.doesNotMatch(tools, /come from read_participant_overview earlier in this conversation/);
    assert.match(tools, /A smaller result does not contradict a fuller read of this same person from this conversation/);
    assert.match(tools, /What you read belongs to the person this conversation is about and answers nothing about anyone else/);
  });
});

describe("review E (2026-11-01): completed-action claims, supersession, every final path", () => {
  const nav = "You can open Jean from People.";
  it("E1: other people's actions and instructions that mention a page are not cut", async () => {
    const { withoutCompletedClaims, staffAnswerText } = await import("../staff-answer-text");
    const history = "Jean opened the handoff yesterday. His ID task remains open.";
    assert.equal(withoutCompletedClaims(history), history);
    const instruction = "Review the ID task on his page before calling him.";
    assert.equal(withoutCompletedClaims(instruction), instruction);
    const refused = { toolName: "open_staff_page", result: { status: "refused" } };
    assert.equal(staffAnswerText([{ text: history, toolCalls: [{ toolName: "open_staff_page" }], toolResults: [refused] }, { text: nav, toolCalls: [] }], nav), `${history}\n\n${nav}`);
    assert.equal(staffAnswerText([{ text: instruction, toolCalls: [{ toolName: "open_staff_page" }], toolResults: [refused] }, { text: nav, toolCalls: [] }], nav), `${instruction}\n\n${nav}`);
  });
  it("E2: a successful button never opened anything, so 'I opened the page' is cut even on status ok; a view change is a read step", async () => {
    const { staffAnswerText } = await import("../staff-answer-text");
    const ok = { toolName: "open_staff_page", result: { status: "ok", navigated: false, buttonShown: true } };
    const fin = "The button is available; I did not open the page.";
    assert.equal(staffAnswerText([{ text: "I opened the participant page for you. Jean's ID task is open.", toolCalls: [{ toolName: "open_staff_page" }], toolResults: [ok] }, { text: fin, toolCalls: [] }], fin), `Jean's ID task is open.\n\n${fin}`);
    for (const st of ["locked", "refused", "unchanged"]) {
      const fin2 = "Nothing changed: the view is locked by policy.";
      const out = staffAnswerText([{ text: "Your tasks are now first on Today.", toolCalls: [{ toolName: "change_my_view" }], toolResults: [{ toolName: "change_my_view", result: { status: st } }] }, { text: fin2, toolCalls: [] }], fin2);
      assert.equal(out, fin2, st);
    }
  });
  it("E3: the empty-final path applies the same cut", async () => {
    const { staffAnswerText } = await import("../staff-answer-text");
    const out = staffAnswerText([{ text: "I opened the participant page for you. Jean needs a call today.", toolCalls: [{ toolName: "open_staff_page" }], toolResults: [{ toolName: "open_staff_page", result: { status: "refused" } }] }, { text: "", toolCalls: [] }], "");
    assert.equal(out, "Jean needs a call today.");
  });
  it("E4: a later, narrower read does not drop a draft already written in a card step", async () => {
    const { staffAnswerText } = await import("../staff-answer-text");
    const body = "Hi Marqus, want to pick a next step on your saved jobs? Let me know what would help. Lupe";
    const disclaimer = "This is a draft. Nothing was saved or sent.";
    const steps = [
      { text: "", toolCalls: [{ toolName: "read_participant_overview" }], toolResults: [{ toolName: "read_participant_overview", result: { status: "ok" } }] },
      { text: body, toolCalls: [{ toolName: "offer_staff_draft" }], toolResults: [{ toolName: "offer_staff_draft", result: { status: "draft_only", body } }] },
      { text: "", toolCalls: [{ toolName: "draft_staff_check_in" }], toolResults: [{ toolName: "draft_staff_check_in", result: { status: "draft_only" } }] },
      { text: disclaimer, toolCalls: [] },
    ];
    assert.equal(staffAnswerText(steps, disclaimer), `${body}\n\n${disclaimer}`);
  });
  it("E5: a final that withdraws or corrects stands alone", async () => {
    const { staffAnswerText, finalWithdraws } = await import("../staff-answer-text");
    const prose = "Hi Marqus, your supervisor role starts tomorrow.";
    const withdraw = "Discard that draft. No prior supervisor role is established.";
    assert.ok(finalWithdraws(withdraw) && finalWithdraws("I need to correct my last answer: the dates were not in what I read.") && finalWithdraws("Please don't send the earlier draft."));
    assert.ok(!finalWithdraws("You can open Jean from People.") && !finalWithdraws("This is a draft. Nothing was saved or sent."));
    assert.equal(staffAnswerText([{ text: prose, toolCalls: [{ toolName: "offer_staff_draft" }], toolResults: [{ toolName: "offer_staff_draft", result: { status: "draft_only", body: prose } }] }, { text: withdraw, toolCalls: [] }], withdraw), withdraw);
  });
  it("E0: the draft card shows the draft's words, and the route finishes a refusal-shaped answer without tools", () => {
    const chat = read("../../components/AssistantChat.tsx");
    assert.match(chat, /data-staff-draft-body=""[\s\S]{0,400}\{draftFor\.body\}/);
    const route = read("../../app/api/assistant/route.ts");
    assert.match(route, /cardRefused && readOk && answer\.length < 200/);
    assert.match(route, /toolChoice: "none"/);
    assert.match(route, /FINISH_THE_ANSWER = "The button was refused; that is not the answer/);
  });
});

describe("review F (2026-11-01): the finish pass at the SDK boundary, narrower cuts, withdrawn cards", () => {
  // The conversation as the client sends it: UI messages, the last assistant turn carrying a tool invocation.
  const uiHistory = [
    { role: "user", content: "Who on my caseload needs attention?", parts: [{ type: "text", text: "Who on my caseload needs attention?" }] },
    {
      role: "assistant", content: "", parts: [
        { type: "tool-invocation", toolInvocation: { state: "result", toolCallId: "c1", toolName: "read_my_view", args: {}, result: { status: "ok" } } },
        { type: "text", text: "Your view is Today first." },
      ],
    },
    { role: "user", content: "Go on.", parts: [{ type: "text", text: "Go on." }] },
  ];
  // What generateText's response.messages look like after a read and a refused button: CoreMessages, one with role "tool".
  const responseCore = [
    { role: "assistant", content: [{ type: "tool-call", toolCallId: "c2", toolName: "read_today_queue", args: {} }] },
    { role: "tool", content: [{ type: "tool-result", toolCallId: "c2", toolName: "read_today_queue", result: { status: "ok" } }] },
    { role: "assistant", content: [{ type: "tool-call", toolCallId: "c3", toolName: "open_staff_page", args: { participantId: "x" } }] },
    { role: "tool", content: [{ type: "tool-result", toolCallId: "c3", toolName: "open_staff_page", result: { status: "refused" } }] },
    { role: "assistant", content: [{ type: "text", text: "You can open Jean from People." }] },
  ];
  const finish = { role: "user", content: "Answer in full." };
  const model = () => new MockLanguageModelV1({
    doGenerate: async () => ({ rawCall: { rawPrompt: null, rawSettings: {} }, finishReason: "stop", usage: { promptTokens: 1, completionTokens: 1 }, text: "Jean needs a call today: the ID task is open." }),
  });
  it("F1: UI history mixed with the model's CoreMessages throws before the provider; converted first, it runs", async () => {
    await assert.rejects(
      generateText({ model: model(), messages: [...uiHistory, ...responseCore, finish] as never, maxSteps: 1 }),
      (err: Error) => /Unsupported role: tool/.test(err.message),
    );
    const { convertToCoreMessages } = await import("ai");
    const out = await generateText({ model: model(), messages: [...convertToCoreMessages(uiHistory as never), ...responseCore, finish] as never, maxSteps: 1 });
    assert.equal(out.text, "Jean needs a call today: the ID task is open.");
    const route = read("../../app/api/assistant/route.ts");
    assert.match(route, /const history = convertToCoreMessages\(\(staffInput\?\.messages \?\? messages\) as never, \{ tools \}\)/);
    assert.match(route, /messages: \[\.\.\.history, \.\.\.generated\.response\.messages, \{ role: "user", content: FINISH_THE_ANSWER \}\]/);
    // A failure in the finish pass keeps the first answer instead of failing the reply.
    assert.match(route, /finish failed, first answer kept/);
  });
  it("F2: only a card's own object makes a completion claim; qualifier runs and curly apostrophes are matched", async () => {
    const { withoutCompletedClaims } = await import("../staff-answer-text");
    for (const keep of ["I added the source date to this draft.", "I put the two open tasks at the top of this answer.", "Jean opened the handoff yesterday.", "Review the ID task on his page before calling him."]) {
      assert.equal(withoutCompletedClaims(keep), keep, keep);
    }
    for (const cut of ["I've already opened his page.", "I’ve opened his page.", "I have now placed the draft on Jean's page.", "I added Jean to your caseload.", "I invited him.", "I just navigated to the participant page.", "The check-in is now on his page.", "Once I opened the page yesterday, I saw the ID task."]) {
      assert.equal(withoutCompletedClaims(`${cut} Jean needs a call today.`), "Jean needs a call today.", cut);
    }
  });
  it("F3: instructions about the draft are not withdrawals; a wrong-draft correction is", async () => {
    const { finalWithdraws } = await import("../staff-answer-text");
    for (const no of ["Don't forget the draft is unsaved.", "Please do not send this draft until you have reviewed it.", "Ignore the employer's message about parking.", "This is a draft. Nothing was saved or sent."]) {
      assert.equal(finalWithdraws(no), false, no);
    }
    for (const yes of ["That draft was wrong; use this replacement.", "Discard that draft.", "Please don't send the earlier draft.", "Disregard my previous answer.", "Correction: the dates were not in what I read."]) {
      assert.equal(finalWithdraws(yes), true, yes);
    }
  });
  it("F4: the empty-final fallback never restores words a read step wrote before a result that was not ok", async () => {
    const { staffAnswerText, STAFF_TOOLS_NO_TEXT } = await import("../staff-answer-text");
    for (const st of ["locked", "refused", "unchanged", "error"]) {
      const steps = [{ text: "Your tasks are now first on Today.", toolCalls: [{ toolName: "change_my_view" }], toolResults: [{ toolName: "change_my_view", result: { status: st } }] }, { text: "", toolCalls: [] }];
      assert.equal(staffAnswerText(steps, ""), STAFF_TOOLS_NO_TEXT, st);
    }
    // An ok read that carried the answer (the original T2 shape) still reaches the staff member.
    const found = "I found one Lansing employer: Eastside Fish Fry & Grill.";
    assert.equal(staffAnswerText([{ text: found, toolCalls: [{ toolName: "find_employers" }], toolResults: [{ toolName: "find_employers", result: { status: "ok" } }] }, { text: "", toolCalls: [] }], ""), found);
  });
  it("F5: a draft the final step withdrew is no card; with two offers the later one is the replacement", async () => {
    const { draftsAfterFinal } = await import("../staff-answer-text");
    const a = { toolCallId: "a" }, b = { toolCallId: "b" };
    assert.deepEqual(draftsAfterFinal([a], "Discard that draft. I need to correct my answer."), []);
    assert.deepEqual(draftsAfterFinal([a, b], "Discard the earlier draft; the second one stands."), [b]);
    assert.deepEqual(draftsAfterFinal([a, b], "Both drafts are unsaved, in this reply."), [a, b]);
    const route = read("../../app/api/assistant/route.ts");
    assert.match(route, /draftsAfterFinal\(offeredDrafts\([\s\S]{0,200}\), finalWords\)/);
    const chat = read("../../components/AssistantChat.tsx");
    assert.match(chat, /staffDrafts\.map\(\(draftFor, draftIdx\)/);
  });
  it("F6 / F7: only a card tool's refusal starts the finish pass, and the decision log records the answer sent", () => {
    const route = read("../../app/api/assistant/route.ts");
    assert.match(route, /STAFF_CARD_TOOLS\.has\(nameOf\(r\)\) && \/\^\(refused\|unavailable\)\$\/\.test\(statusOf\(r\)\)/);
    assert.match(route, /response_length: answer\.length/);
    assert.match(route, /finish_pass_used: retried/);
  });
});

describe("review G (2026-11-01): withdrawn drafts, the cap after selection, names that are names, the selected answer", () => {
  const a = { toolCallId: "a" }, b = { toolCallId: "b" }, c = { toolCallId: "c" };
  it("G1: a draft the final takes back is never a card; a replacement stays only when nothing took it back", async () => {
    const { draftsAfterFinal, finalWithdraws } = await import("../staff-answer-text");
    // Codex's repros: both withdrawn, neither used, the later one withdrawn.
    assert.deepEqual(draftsAfterFinal([a, b], "Discard the first draft and the second draft."), []);
    assert.deepEqual(draftsAfterFinal([a, b], "Discard both drafts."), []);
    assert.deepEqual(draftsAfterFinal([a, b], "I need to correct my answer. Neither draft should be used."), []);
    assert.deepEqual(draftsAfterFinal([a, b], "Keep the first draft. Discard the revised draft."), [a]);
    assert.deepEqual(draftsAfterFinal([a, b], "Don't use either draft."), []);
    assert.deepEqual(draftsAfterFinal([a, b], "Discard the first draft but keep the second."), [b]);
    // A withdrawal with no draft kept leaves no card, even with two offers (they may be independent).
    assert.deepEqual(draftsAfterFinal([a, b], "I need to correct my answer: the dates were not in what I read."), []);
    assert.deepEqual(draftsAfterFinal([a, b], "That draft was wrong."), []);
    // A real replacement: the earlier one named as withdrawn, or the later one kept.
    assert.deepEqual(draftsAfterFinal([a, b], "Discard the earlier draft; the second one stands."), [b]);
    assert.deepEqual(draftsAfterFinal([a, b], "That draft was wrong; use this replacement."), [b]);
    assert.deepEqual(draftsAfterFinal([a, b, c], "Discard the earlier draft; use this replacement."), [c]);
    // Two independent offers and no withdrawal: both stay.
    assert.deepEqual(draftsAfterFinal([a, b], "Two versions are below, one short and one longer. Both are unsaved."), [a, b]);
    assert.deepEqual(draftsAfterFinal([a, b], "Use whichever reads better; neither is saved or sent."), [a, b]);
    for (const no of ["Don't forget the draft is unsaved.", "Please do not send this draft until you have reviewed it.", "Both drafts are unsaved, in this reply."]) {
      assert.equal(finalWithdraws(no), false, no);
    }
  });
  it("G2: every offer reaches the selector; the card cap comes after it", async () => {
    const { offeredDrafts, MAX_STAFF_DRAFT_CARDS } = await import("../staff-skill-run");
    const { draftsAfterFinal } = await import("../staff-answer-text");
    const P = "11111111-1111-4111-8111-111111111111";
    const offers = ["first", "second", "final-replacement"].map((toolCallId) => ({ toolCallId, toolName: "offer_staff_draft", args: {}, result: { status: "draft_only", saved: false, sent: false, participantId: P, body: toolCallId } }));
    assert.equal(offeredDrafts(offers).length, 3);
    assert.deepEqual(draftsAfterFinal(offeredDrafts(offers), "Discard the earlier draft; use this replacement.").slice(0, MAX_STAFF_DRAFT_CARDS).map((d) => d.toolCallId), ["final-replacement"]);
    assert.deepEqual(draftsAfterFinal(offeredDrafts(offers), "Three drafts, all unsaved.").slice(0, MAX_STAFF_DRAFT_CARDS).map((d) => d.toolCallId), ["first", "second"]);
    const route = read("../../app/api/assistant/route.ts");
    assert.match(route, /draftsAfterFinal\(offeredDrafts\([\s\S]{0,200}\), finalWords\)\.slice\(0, MAX_STAFF_DRAFT_CARDS\)/);
  });
  it("G3: a capitalised word is not a person and a draft below is not on a page; multi-word names are names", async () => {
    const { withoutCompletedClaims } = await import("../staff-answer-text");
    for (const keep of ["I added ID to this checklist.", "I added Monday to the draft.", "I have placed the draft below for you to review.", "I put the draft below.", "I added the source date to this draft.", "I invited feedback in the last line."]) {
      assert.equal(withoutCompletedClaims(keep), keep, keep);
    }
    for (const cut of ["I opened Jean Valjean’s page.", "I opened Jean Valjean's profile.", "The draft is now on Jean’s page.", "The note is in Marqus Relly's record.", "Jean Valjean's page is now open.", "I added Jean Valjean to your caseload.", "I added Circe as a participant.", "I invited Jean Valjean.", "I saved the check-in to his page.", "I've put the note on Jean's page."]) {
      assert.equal(withoutCompletedClaims(`${cut} Jean needs a call today.`), "Jean needs a call today.", cut);
    }
  });
  it("G timing: every cut and the withdrawal reader stay linear on hostile input", async () => {
    const { withoutCompletedClaims, finalWithdraws, draftsAfterFinal } = await import("../staff-answer-text");
    const hostile = [
      "I opened " + "Abc ".repeat(20000) + "page", "I added " + "Jean-Jean'".repeat(10000) + " to", "I" + " just".repeat(20000) + " x",
      "discard " + "the ".repeat(20000) + "x", "discard " + "of the ".repeat(10000) + "x", "The draft is " + " ".repeat(50000) + "on",
      "I opened " + "A’".repeat(20000), "Discard the first draft; ".repeat(5000),
    ];
    for (const v of hostile) {
      const t = performance.now();
      withoutCompletedClaims(v); finalWithdraws(v); draftsAfterFinal([a, b], v);
      assert.ok(performance.now() - t < 250, `${v.slice(0, 30)}... took ${(performance.now() - t).toFixed(0)}ms`);
    }
  });
  it("G4: the card gate reads the answer the staff member sees, finish pass included", () => {
    const route = read("../../app/api/assistant/route.ts");
    assert.match(route, /let finalWords = generated\.text;/);
    assert.match(route, /answer = replyOrFallback\(fuller\); finalWords = fuller; retried = true;/);
    assert.doesNotMatch(route, /draftsAfterFinal\([\s\S]{0,300}generated\.text\)/);
  });
});
