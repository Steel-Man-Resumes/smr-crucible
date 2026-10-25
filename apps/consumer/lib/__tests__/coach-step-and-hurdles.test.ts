/**
 * The Refinery coach's step and hurdle plan (production proof 2026-10-25,
 * fix lane coach-step-hurdles). Each case fails on 9b57f9b:
 *
 *  1. The coach said "Choose a job" while the Overview said Interview. Its
 *     progression tools fed the RESOLVED selection (the lane resume's
 *     artifactId) back into getProgression, and an explicit document hides
 *     the priority interview (assistant-work-context). The dashboard sends
 *     the browser pick. The coach now does too, read-only.
 *  2. The coach knew a hurdle plan existed (profile flag) and could not say
 *     what it covered. It now gets the same server-built summary t.ROY gets,
 *     in the prompt and in get_my_live_status, from one function.
 *  3. The coach called it "your disclosure plan". The station is Plan what
 *     to say and the artifact is a hurdle plan.
 *
 * Fictional ids and names. The pure assembleProgression is the body of
 * getProgression, so the step asserted here is the step the Overview shows.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { assembleProgression, progressionStepLabel, type ProgressionAllowanceLike, type ProgressionWork } from "../progression-server";
import { resolveSelectedWork, type WorkContextStore } from "../assistant-work-context";
import { summarizeHurdlePlan, summarizeProgression } from "../assistant-full-context";
import { loadCoachServerParts, coachServerPartsPrompt, COACH_RECORD_POINTER, type CoachServerLoaders } from "../coach-server-context";
import { buildHandsSection, buildAssistantTools } from "../tools/assistant-tools";
import { TOUR_TARGETS } from "../tools/assistant-tool-defs";
import { coachPagePrompt } from "../assistant-page-context";
import { buildCoachSystemPrompt, computeCurrentBlock, buildBlockSection, buildWhatsNewSection } from "@crucible/core";
import { INITIAL_STATE, plannerReducer, type PlannerAction, type PlannerState } from "../hurdles/reducer";
import { buildHurdlePlan, buildSavePayload, recordAndSensitiveText } from "../hurdles/plan";

const CONSUMER = join(import.meta.dirname, "..", "..");
const read = (p: string) => readFileSync(join(CONSUMER, p), "utf8");
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const U = "00000000-0000-4000-8000-0000000000a1";
const LANE = "00000000-0000-4000-8000-0000000000l1".replace("l", "e");
const RESUME = "00000000-0000-4000-8000-0000000000b1";
const APP = "00000000-0000-4000-8000-0000000000d1";

const allow: ProgressionAllowanceLike = { account: { existing: false }, snapshot: { metrics: { forgeComplete: true, savedJobs: 8, resumeTailored: true, applicationsSent: 2 } }, base: 12, bonus: 0, used: 3, bonusUsed: 0 };
const finished = { id: "00000000-0000-4000-8000-0000000000c1", artifactId: RESUME, number: 3, status: "finished" as const, fromWriter: true, resumeText: "Text", openItems: [], createdAt: "2026-10-22T23:20:00.000Z" };
const interviewing = { id: APP, job_title: "Production Supervisor", company: "Acme Staffing" };
/** The Overview on /dashboard: focus lane, the lane's finished resume, an interviewing application as the priority, no document picked. */
const dashboardWork = (over: Partial<ProgressionWork> = {}): ProgressionWork => ({
  selection: { laneId: LANE, artifactId: RESUME, revisionId: finished.id }, revision: finished, laneDocument: null, application: null,
  priorityApplication: interviewing, applicationResumeSnapshot: null, task: null, lane: { id: LANE, name: "Maintenance and facilities", target: "Maintenance technician", kind: "resume", path: null, cvType: null }, ...over,
} as ProgressionWork);

describe("1. the step the coach reports is the step the Overview shows", () => {
  it("fixture: Interview, a finished resume and an interviewing application -> interview, 'Prepare for the interview', the interview next action", () => {
    const p = assembleProgression({ allow, work: dashboardWork(), grants: [], requests: [], anyOffer: false });
    assert.equal(p.currentStepId, "interview");
    assert.equal(progressionStepLabel(p), "Prepare for the interview");
    assert.equal(p.steps.find((s) => s.id === "interview")?.state, "current");
    assert.equal(p.steps.find((s) => s.id === "foundation")?.state, "completed");
    assert.equal(p.nextAction.label, "Prepare for your interview at Acme Staffing");
    // What the coach's prompt and tool derive from it agrees with the board.
    const summary = summarizeProgression(p);
    assert.equal(summary?.currentStep, "interview");
    assert.equal(summary?.currentLabel, "Prepare for the interview");
    assert.equal(summary?.nextAction.label, p.nextAction.label);
  });

  it("the root cause: feeding the resolved selection back drops the priority interview and the step falls to 'Choose a job'", async () => {
    const revisionRow = { id: finished.id, artifact_id: RESUME, revision_number: 3, status: "finished", resume_text: "Text", open_items: [], created_at: finished.createdAt, source: "forge_finish" } as any;
    const store: WorkContextStore = {
      focus: async () => ({ task: "job", laneId: LANE, target: null }),
      lane: async () => ({ id: LANE, name: "Maintenance and facilities", target_role: "Maintenance technician", kind: "resume", archived_at: null } as any),
      application: async () => null, artifact: async (_u, id) => (id === RESUME ? { id: RESUME, lane_id: LANE, artifact_type: "resume", is_demo: false, content: {} } : null),
      laneResume: async () => ({ id: RESUME, lane_id: LANE, artifact_type: "resume", is_demo: false, content: {} }),
      revision: async (_u, id) => (id === finished.id ? revisionRow : null), latest: async () => revisionRow,
      upcomingInterview: async () => interviewing,
    };
    const fromBrowserPick = await resolveSelectedWork(U, { laneId: LANE }, store);
    assert.deepEqual(fromBrowserPick.priorityApplication, interviewing, "the dashboard's pick keeps the priority interview");
    assert.equal(assembleProgression({ allow, work: fromBrowserPick, grants: [], requests: [], anyOffer: false }).currentStepId, "interview");

    const fromResolved = await resolveSelectedWork(U, fromBrowserPick.selection, store);
    assert.equal(fromResolved.priorityApplication, null, "the resolved selection names the lane resume, which hides the priority interview");
    assert.equal(assembleProgression({ allow, work: fromResolved, grants: [], requests: [], anyOffer: false }).currentStepId, "direction", "this is the 'Choose a job' the coach said on production");
  });

  it("the tools read progression from the browser pick, read-only, never from the resolved selection", () => {
    const tools = code(read("lib/tools/assistant-tools.ts"));
    assert.ok(/function progressionForTools\(opts: AssistantToolOptions\) \{\s*return getProgression\(opts\.userId!, opts\.workSelection \?\? \{\}, true\);/.test(tools), "one helper: the browser pick, readOnly");
    assert.equal((tools.match(/progressionForTools\(opts\)/g) ?? []).length, 2, "get_my_progress and get_my_live_status both use it");
    assert.ok(!/getProgression\([^)]*selectedWork\?\.selection/.test(tools), "no progression read from selectedWork.selection remains");
    // Review S1: request_tool_access runs getProgression through requestProgressionAccess; it takes the browser pick too.
    assert.ok(tools.includes("selection:opts.workSelection ?? {}});"), "request_tool_access passes the browser pick");
    const selectionUses = tools.match(/selectedWork\?\.selection/g) ?? [];
    assert.equal(selectionUses.length, 1, "the resolved selection is read once in the tools file");
    assert.ok(tools.includes("const selected = opts.selectedWork?.selection;\n      const href = resolveAssistantPage(page, selected?.applicationId, selected);"), "and only by contextual_handoff, which builds a link to the resolved document");
    assert.ok(tools.includes("currentStep: progress ? { id: progress.currentStepId, label: progressionStepLabel(progress) } : null"), "the live status carries the board's label for the step");
    const coach = code(read("app/api/coach/route.ts"));
    assert.ok(coach.includes("workSelection = readWorkSelection(ctx.selectedWork); selectedWork = await loadSelectedWork(userId, workSelection);"));
    assert.ok(coach.includes("loadCoachServerParts(userId, workSelection, await realCoachServerLoaders())"), "the prompt's progression uses the same pick");
    assert.ok(coach.includes('surface: "refinery" as const, selectedWork, workSelection }'), "and the tools get it too");
    assert.ok(coach.includes("coachServerPartsPrompt(serverParts)"));
    const assistant = code(read("app/api/assistant/route.ts"));
    assert.ok(assistant.includes("toolOptions.workSelection = readWorkSelection(context.selectedWork)"), "t.ROY's tools take the same pick");
    assert.ok(code(read("lib/coach-server-context.ts")).includes("getProgression(userId, selection, true)"), "read-only: no milestone writes in a chat turn");
  });

  it("the Overview's own body still runs through assembleProgression", () => {
    const src = code(read("lib/progression-server.ts"));
    assert.ok(src.includes("return assembleProgression({allow,work,grants,requests,anyOffer:!!anyOffer});"));
  });
});

describe("Valjean item 9: nextAction never says 'Start your resume' when a resume is finished", () => {
  it("a finished resume with no application and the resume task gets the finished-resume action", () => {
    const p = assembleProgression({ allow, work: dashboardWork({ priorityApplication: null, task: "resume" }), grants: [], requests: [], anyOffer: false });
    assert.notEqual(p.nextAction.label, "Start your resume");
    assert.equal(p.nextAction.label, "Find a job to go after");
    assert.equal(p.steps.find((s) => s.id === "foundation")?.state, "completed");
  });
  it("with no task chosen, the step label is the next action, never a resume start", () => {
    const p = assembleProgression({ allow, work: dashboardWork({ priorityApplication: null }), grants: [], requests: [], anyOffer: false });
    assert.equal(p.currentStepId, "direction");
    assert.equal(p.nextAction.label, "Choose a job");
  });
  it("a finished version in a lane whose pick had no version yet is reviewed, and an empty lane starts one", () => {
    const noVersion = assembleProgression({ allow, work: dashboardWork({ priorityApplication: null, task: "resume", revision: null }), grants: [], requests: [], anyOffer: false });
    assert.equal(noVersion.nextAction.label, "Review this resume");
    const empty = assembleProgression({ allow, work: dashboardWork({ priorityApplication: null, task: "resume", revision: null, selection: { laneId: LANE, applicationId: undefined, artifactId: undefined, revisionId: undefined } }), grants: [], requests: [], anyOffer: false });
    assert.equal(empty.nextAction.label, "Start your resume");
    assert.equal(empty.steps.find((s) => s.id === "foundation")?.state, "current", "only an account with no resume at all is told to start one");
  });
});

const runPlanner = (actions: PlannerAction[], from: PlannerState = INITIAL_STATE) => actions.reduce(plannerReducer, from);
const pick = (...hurdles: string[]) => hurdles.map((h) => ({ type: "toggle", hurdle: h }) as PlannerAction);
const ans = (nodeId: string, ...choices: string[]): PlannerAction => ({ type: "answer", nodeId, choices });
/** A real saved hurdle plan row: gaps with time inside (a sensitive choice) plus transport, saved by the planner's own code. */
function hurdleRow() {
  const st = runPlanner([...pick("gaps", "transport"), { type: "start" }, ans("gaps.length", "1to3"), ans("gaps.filled", "inside", "family"), ans("gaps.inside", "no"),
    { type: "skip", nodeId: "gaps.proof" }, ans("gaps.asked", "no"), ans("gaps.tell", "nothing"), ans("transport.what", "ride"), ans("transport.backup", "no")]);
  const p = buildSavePayload(buildHurdlePlan(st), st, { summaries: {}, strippedCount: 0, wording: "off", targetJob: "Production Supervisor", now: "2026-10-24T15:20:40.000Z" });
  return { target_context: p.targetContext, content: p.content, created_at: "2026-10-24T15:20:40.000Z" };
}
/** Review S2: the same plan with gaps.inside skipped instead of answered. Its decision line names the record conversation. */
function skippedInsideRow() {
  const st = runPlanner([...pick("gaps", "transport"), { type: "start" }, ans("gaps.length", "1to3"), ans("gaps.filled", "inside", "family"), { type: "skip", nodeId: "gaps.inside" },
    { type: "skip", nodeId: "gaps.proof" }, ans("gaps.asked", "no"), ans("gaps.tell", "nothing"), ans("transport.what", "ride"), ans("transport.backup", "no")]);
  const p = buildSavePayload(buildHurdlePlan(st), st, { summaries: {}, strippedCount: 0, wording: "off", targetJob: "Production Supervisor", now: "2026-10-24T15:20:40.000Z" });
  return { payload: p, row: { target_context: p.targetContext, content: p.content, created_at: "2026-10-24T15:20:40.000Z" } };
}
const progressionRow = () => assembleProgression({ allow, work: dashboardWork(), grants: [], requests: [], anyOffer: false });
const loaders = (over: Partial<CoachServerLoaders> = {}): CoachServerLoaders => ({ hurdlePlan: async () => hurdleRow(), progression: async () => progressionRow(), ...over });

describe("2. the coach gets the hurdle plan summary the assistant has, with no consent and no record words", () => {
  it("the summary names the job and the hurdles with their lines; one function serves both routes", async () => {
    const parts = await loadCoachServerParts(U, { laneId: LANE }, loaders());
    assert.equal(parts.hurdlePlan?.exists, true);
    assert.equal(parts.hurdlePlan?.targetJob, "Production Supervisor");
    assert.deepEqual(parts.hurdlePlan?.hurdles?.map((h) => h.label).sort(), ["Gaps in my work history", "Getting to work"].sort());
    assert.deepEqual(parts.hurdlePlan, summarizeHurdlePlan(hurdleRow()), "the same summary t.ROY's assembleFullContext uses");
    assert.equal(parts.progression?.currentLabel, "Prepare for the interview");
    // The module takes no consent and no impersonation flag: it has no record words to gate.
    assert.ok(!/consent|impersonat|script|timing_advice/i.test(code(read("lib/coach-server-context.ts"))));
  });

  it("the prompt section carries the plan and the step, and has zero hits from the record and sensitive set", async () => {
    const prompt = coachServerPartsPrompt(await loadCoachServerParts(U, {}, loaders()));
    for (const line of ["## WHAT THE SERVER KNOWS", "### HURDLE PLAN (saved 2026-10-24, for Production Supervisor)", "Getting to work", "Gaps in my work history",
      "### WHERE THEY ARE IN THE PROCESS", "Current step: Prepare for the interview (interview)", "Next action the app shows: Prepare for your interview at Acme Staffing", COACH_RECORD_POINTER,
      "Call the station Plan what to say and the saved work their hurdle plan"]) assert.ok(prompt.includes(line), line);
    const lower = prompt.toLowerCase();
    assert.ok(recordAndSensitiveText().length > 40);
    assert.deepEqual(recordAndSensitiveText().filter((t) => lower.includes(t.toLowerCase())), []);
    assert.ok(!lower.includes("time inside"));
    assert.ok(!lower.includes("disclosure plan"), "the coach's own section never points at a DISCLOSURE PLAN heading it does not have");
  });

  it("review S2: a skipped gaps.inside leaves no decision line in the saved plan, the coach section or t.ROY's summary", async () => {
    const { payload, row } = skippedInsideRow();
    const forbidden = recordAndSensitiveText();
    assert.ok(forbidden.includes("Whether to plan the record conversation too."));
    const saved = JSON.stringify(payload).toLowerCase();
    assert.deepEqual(forbidden.filter((t) => saved.includes(t.toLowerCase())), [], "whole saved payload");
    const prompt = coachServerPartsPrompt(await loadCoachServerParts(U, {}, loaders({ hurdlePlan: async () => row }))).toLowerCase();
    assert.deepEqual(forbidden.filter((t) => prompt.includes(t.toLowerCase())), [], "coach section");
    const section = prompt.slice(prompt.indexOf("### hurdle plan"), prompt.indexOf(COACH_RECORD_POINTER.toLowerCase()));
    assert.ok(section.length > 50 && !section.includes("record conversation") && !section.includes("time inside"), "the plan lines themselves (the pointer line below says the record words stay in Plan what to say)");
    assert.ok(section.includes("gaps in my work history") && section.includes("getting to work"), "the hurdles themselves still show");
    const summary = JSON.stringify(summarizeHurdlePlan(row)).toLowerCase();
    assert.deepEqual(forbidden.filter((t) => summary.includes(t.toLowerCase())), [], "t.ROY's summary, same function");
  });

  it("no plan saved says so; a failed read says nothing about a plan and tells the coach the live check failed", async () => {
    const none = coachServerPartsPrompt(await loadCoachServerParts(U, {}, loaders({ hurdlePlan: async () => null })));
    assert.ok(none.includes("### HURDLE PLAN\nNone saved yet. Plan what to say is where they build one."));
    const failed = coachServerPartsPrompt(await loadCoachServerParts(U, {}, loaders({ hurdlePlan: async () => { throw new Error("db"); }, progression: async () => { throw new Error("db"); } })));
    assert.ok(!failed.includes("### HURDLE PLAN"));
    assert.ok(failed.includes("The hurdle plan did not load this turn. If asked about it, say the live check failed"));
    assert.ok(failed.includes("The progression did not load this turn. Say the live check failed"));
  });

  it("get_my_live_status returns the same summary, by the shared SQL", () => {
    const tools = code(read("lib/tools/assistant-tools.ts"));
    assert.ok(tools.includes("summarizeHurdlePlan(await getOneAsUser<HurdlePlanRow>(userId, LATEST_HURDLE_PLAN_SQL, [userId]))"));
    assert.ok(tools.includes("hurdlePlan,"));
    assert.ok(!tools.includes("hasDisclosurePlan: profile.hasDisclosurePlan"), "the bare flag is replaced by the summary plus recordConversationPlanned");
  });
});

const profile = (over: Record<string, unknown> = {}) => ({
  id: U, name: "Jean", email: null, tier: "client", forgeComplete: true, readinessStage: "ready", topCareerPaths: ["Maintenance"], topSkills: ["Forklift"], barriers: ["criminal_record"],
  currentStage: 5, onboardingComplete: true, onboardingDeferrals: 0, nextStepCache: null, nextStepCachedAt: null,
  coachName: "", coachStyle: "balanced", coachLength: "full", coachFocus: "guide", coachCreativity: 0.5, coachVoice: false, coachPlainLanguage: false, coachLanguage: "en",
  savedJobs: [{ id: APP, jobTitle: "Production Supervisor", company: "Acme Staffing", status: "interviewing", followUpAt: null, resumeTailored: true }], applicationCount: 2, hasResumeTailoredToTarget: true,
  profileComplete: true, city: "Milwaukee", state: "WI", practiceSessionsThisWeek: 3, hasDisclosurePlan: true, interviewSessionCount: 3, ...over,
}) as any;

describe("3. the coach's copy says Plan what to say and hurdle plan, never 'disclosure plan'", () => {
  it("every piece of coach-facing prompt and tool copy", async () => {
    const opts = { userId: U, surface: "refinery" as const, workSelection: {} };
    const tools = buildAssistantTools(opts);
    const descriptions = Object.values(tools).map((t) => JSON.stringify({ d: (t as any).description, p: (t as any).parameters?.jsonSchema ?? null })).join("\n");
    const copy = [
      buildCoachSystemPrompt(profile()), buildCoachSystemPrompt(profile({ forgeComplete: false, hasDisclosurePlan: false })),
      buildCoachSystemPrompt(profile({ hasResumeTailoredToTarget: false })),
      buildHandsSection(opts), coachPagePrompt("disclosure", { pathname: "/dashboard/disclosure", contentVisible: true, loading: false, visibleTargets: [] }),
      coachServerPartsPrompt(await loadCoachServerParts(U, {}, loaders())),
      Object.values(TOUR_TARGETS).join("\n"), descriptions,
      buildBlockSection(computeCurrentBlock({ forgeComplete: false, hasResumeTailoredToTarget: false })), buildBlockSection(computeCurrentBlock({ forgeComplete: true, hasResumeTailoredToTarget: false })), buildWhatsNewSection(),
      read("lib/skills/predictive-next-step/SKILL.md"), read("lib/skills/job-search-doctrine/SKILL.md"), read("lib/skills/rejection-recovery/SKILL.md"), read("lib/skills/stage-adaptation/SKILL.md"),
    ].join("\n");
    assert.ok(copy.length > 5000);
    assert.doesNotMatch(copy, /disclosure plan(ner|ning)?\b/i);
    assert.ok(copy.includes("Plan what to say (/dashboard/disclosure)"));
    assert.ok(copy.includes("Record conversation planned in Plan what to say: yes"));
    assert.ok(copy.includes("Plan what to say link in the sidebar"));
  });
});
