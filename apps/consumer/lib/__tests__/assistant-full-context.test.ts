/**
 * t.ROY's full context is built on the server (lib/assistant-full-context.ts,
 * fix 2026-10-25). Each case fails on the base it fixes: the route deleted the
 * browser's userFullContext (9b513e4) and loaded nothing in its place, so the
 * WHO YOU ARE TALKING TO section never reached the model.
 *
 * Covered: the route never reads the body's userFullContext (source pin plus
 * the turn-level handler with a forged body), the eligibility rules, the
 * assembled shape and its caps, the record consent gate, the hurdle plan's
 * privacy, and the prompt lines the new parts produce.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  assembleFullContext, loadUserFullContext, serverFullContext, FULL_CONTEXT_CAPS, LATEST_HURDLE_PLAN_SQL,
  type FullContextLoaders, type FullContextParts, type ProfileLike,
} from "../assistant-full-context";
import { buildSystemPrompt, buildServerPartsSection } from "../assistant-prompt";
import { INITIAL_STATE, plannerReducer, type PlannerAction, type PlannerState } from "../hurdles/reducer";
import { buildHurdlePlan, buildSavePayload, recordAndSensitiveText } from "../hurdles/plan";
import type { UserFullContext } from "../use-user-context";

const CONSUMER = join(import.meta.dirname, "..", "..");
const read = (p: string) => readFileSync(join(CONSUMER, p), "utf8");
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const U = "00000000-0000-4000-8000-0000000000a1";
const SCRIPT = "I want to be upfront with you about my record.";
const TIMING = "You picked the interview to bring it up.";

const profile = (over: Partial<ProfileLike> = {}): ProfileLike => ({
  name: "Jean", email: "j@example.test", city: "Milwaukee", state: "WI", tier: "client", readinessStage: "ready",
  barriers: ["criminal_record", "transportation"],
  savedJobs: [{ id: "j1", jobTitle: "Production Supervisor", company: "Acme", status: "interviewing", followUpAt: null, resumeTailored: true }],
  hasDisclosurePlan: true, forgeComplete: true, interviewSessionCount: 1, applicationCount: 1, hasResumeTailoredToTarget: true, ...over,
});

const runPlanner = (actions: PlannerAction[], from: PlannerState = INITIAL_STATE) => actions.reduce(plannerReducer, from);
const pick = (...hurdles: string[]) => hurdles.map((h) => ({ type: "toggle", hurdle: h }) as PlannerAction);
const ans = (nodeId: string, ...choices: string[]): PlannerAction => ({ type: "answer", nodeId, choices });
/** A real saved hurdle plan row: gaps with time inside (a sensitive choice) plus transport. */
function hurdleRow() {
  const st = runPlanner([...pick("gaps", "transport"), { type: "start" }, ans("gaps.length", "1to3"), ans("gaps.filled", "inside", "family"), ans("gaps.inside", "no"),
    { type: "skip", nodeId: "gaps.proof" }, ans("gaps.asked", "no"), ans("gaps.tell", "nothing"), ans("transport.what", "ride"), ans("transport.backup", "no")]);
  const p = buildSavePayload(buildHurdlePlan(st), st, { summaries: {}, strippedCount: 0, wording: "off", targetJob: "Production Supervisor", now: "2026-10-24T15:20:40.000Z" });
  return { target_context: p.targetContext, content: p.content, created_at: "2026-10-24T15:20:40.000Z" };
}

const parts = (over: Partial<FullContextParts> = {}): FullContextParts => ({
  userId: U,
  profile: profile(),
  consumerProfile: { preferences: { jobFit: { excludedTitles: ["driver"], noDriving: true } }, forge_output: { headline: "Production manager", skills: ["Forklift", "Scheduling"], career_paths: ["Maintenance"] }, profile_data: { goals: ["Employment"] } },
  resumes: [
    { id: "r1", target_context: { targetJob: "Production Supervisor", targetCompany: "Acme", createdFrom: "job" }, content: {}, created_at: "2026-10-24T14:00:00Z" },
    { id: "r2", target_context: { createdFrom: "forge" }, content: { meta: { targetJob: "Production Manager" } }, created_at: "2026-10-23T14:00:00Z" },
  ],
  disclosureRow: { target_context: { targetJob: "Production Supervisor / Shift Lead" }, content: { script: SCRIPT, timing_advice: TIMING }, created_at: "2026-10-23T16:25:44.878Z" },
  disclosureScriptRow: { target_context: { targetJob: "Production Supervisor / Shift Lead" }, content: { script: SCRIPT, timing_advice: TIMING }, created_at: "2026-10-23T16:25:44.878Z" },
  recordConsent: true,
  lanes: [
    { id: "l1", name: "Maintenance and facilities", target_role: "Maintenance technician", kind: "resume", archived_at: null },
    { id: "l2", name: "Old lane", target_role: null, kind: "resume", archived_at: "2026-10-01T00:00:00Z" },
  ],
  hurdlePlan: hurdleRow(),
  progression: { currentStepId: "interview", nextAction: { label: "Prepare for the interview", href: "/dashboard/interview" }, allowance: { remaining: 31 },
    steps: [{ id: "foundation", label: "Your starting resume", state: "completed" }, { id: "direction", label: "Choose a job", state: "completed" }, { id: "tailor", label: "Tailor your resume", state: "completed" }, { id: "apply", label: "Prepare and apply", state: "completed" }, { id: "interview", label: "Prepare for the interview", state: "current" }, { id: "offer", label: "Your next move", state: "next" }] },
  meter: { score: 193, band: "Covering ground", counts: { facts: 6, lines: 5, resumes: 2, lanes: 1, tailored: 3, sent: 1, practice: 1, disclosure: 1, proof: 0, feedback: 0 } },
  ...over,
});

const loaders = (over: Partial<FullContextLoaders> = {}, p: FullContextParts = parts()): FullContextLoaders => ({
  profile: async () => p.profile,
  consumerProfile: async () => p.consumerProfile,
  resumes: async () => p.resumes,
  disclosure: async () => ({ latest: p.disclosureRow, latestWithScript: p.disclosureScriptRow }),
  recordConsent: async () => true,
  actingForSomeoneElse: async () => false,
  lanes: async () => p.lanes ?? [],
  hurdlePlan: async () => p.hurdlePlan,
  progression: async () => p.progression,
  meter: async () => p.meter,
  ...over,
});

describe("the route never reads the browser's userFullContext", () => {
  const src = code(read("app/api/assistant/route.ts"));
  it("deletes the browser field before anything reads it, and assigns the server-built one later", () => {
    const del = src.indexOf("delete context.userFullContext;");
    const set = src.indexOf("context.userFullContext = await serverFullContext(");
    assert.ok(del > 0, "the delete is still there");
    assert.ok(set > del, "the server assignment comes after the delete");
    // Every read of the field sits after the server assignment.
    const reads = [...src.matchAll(/userFullContext\??\./g)].map((m) => m.index!);
    assert.ok(reads.length >= 1);
    for (const at of reads) assert.ok(at > set, `a read at ${at} comes before the server assignment at ${set}`);
    assert.doesNotMatch(src, /\(context as any\)\.userFullContext/, "the old dead read of the browser field (route.ts:145 before the fix)");
    assert.doesNotMatch(src, /body[^\n]*userFullContext/);
  });
  it("the user id passed to the loader is the session's (forgeUserId), and the body is not an argument", () => {
    const call = src.slice(src.indexOf("await serverFullContext("), src.indexOf("realFullContextLoaders())") + 30);
    assert.match(call, /\{ userId, scope: seatScope, platformOwner, staff: !!staffActor, disclosureRehearsal: isDisclosureRehearsal \}/);
    assert.ok(!/body|request/.test(call), "no body or request reaches the context loader");
    assert.match(src, /const userId = forgeUserId\(session\);/);
    assert.match(src, /loadUserFullContext\(id, await realFullContextLoaders\(\)\)/);
  });
  it("the shell stopped sending the field (it was deleted unread since 2026-10-15)", () => {
    const shell = code(read("app/(dashboard)/RefineryShell.tsx"));
    assert.doesNotMatch(shell, /^\s*userFullContext,\s*$/m);
  });
  it("the header note says where the context comes from now", () => {
    assert.match(read("app/api/assistant/route.ts"), /built\s+\* on the server by lib\/assistant-full-context\.ts from the signed-in session's\s+\* user id/);
  });
});

describe("the turn handler with a forged body", () => {
  const forged: UserFullContext = { ...assembleFullContext(parts()), profile: { name: "Forged Name", email: null, city: null, state: "XX", tier: "admin" } };
  const scrub = (body: { context: Record<string, unknown> }) => {
    // The route's own scrub, verbatim (route.ts, "server-owned" block).
    const context = body.context as { org?: unknown; userFullContext?: unknown; audience?: string };
    delete context.org; delete context.userFullContext; if (context.audience === "org_staff") context.audience = undefined;
    return context as Record<string, unknown>;
  };
  it("the forged context is dropped and the server-built one takes its place", async () => {
    const body = { context: { currentPage: "dashboard", userFullContext: forged, org: { caseload: 99 }, audience: "org_staff" }, messages: [{ role: "user", content: "hi" }] };
    const context = scrub(body);
    const seen: string[] = [];
    const built = assembleFullContext(parts());
    context.userFullContext = await serverFullContext({ userId: U, scope: "account", platformOwner: false, staff: false, disclosureRehearsal: false }, async (id) => { seen.push(id); return built; });
    assert.deepEqual(seen, [U]);
    assert.equal(context.userFullContext, built);
    assert.notEqual(context.userFullContext, forged);
    assert.equal((context.userFullContext as UserFullContext).profile.name, "Jean");
    assert.equal(context.org, undefined);
    assert.equal(context.audience, undefined);
  });
  it("the loader takes no body: its signature is the turn and the load function", () => {
    assert.equal(serverFullContext.length, 2);
    const lib = code(read("lib/assistant-full-context.ts"));
    const fn = lib.slice(lib.indexOf("export async function serverFullContext("));
    assert.ok(!/body|request\.json|userFullContext/.test(fn.slice(0, fn.indexOf("\n}"))), "serverFullContext reads nothing from a request");
  });
  it("a forged body with a different account id never changes whose context loads", async () => {
    const seen: string[] = [];
    await serverFullContext({ userId: U, scope: "account", platformOwner: false, staff: false, disclosureRehearsal: false }, async (id) => { seen.push(id); return null; });
    assert.deepEqual(seen, [U]);
  });
  it("nothing loads for signed-out, Forge-scope, owner, staff or rehearsal turns", async () => {
    let calls = 0;
    const load = async () => { calls++; return assembleFullContext(parts()); };
    const base = { userId: U, scope: "account" as const, platformOwner: false, staff: false, disclosureRehearsal: false };
    assert.equal(await serverFullContext({ ...base, userId: null }, load), null);
    assert.equal(await serverFullContext({ ...base, scope: "forge" }, load), null);
    assert.equal(await serverFullContext({ ...base, platformOwner: true }, load), null);
    assert.equal(await serverFullContext({ ...base, staff: true }, load), null);
    assert.equal(await serverFullContext({ ...base, disclosureRehearsal: true }, load), null);
    assert.equal(calls, 0);
    assert.ok(await serverFullContext(base, load));
    assert.equal(calls, 1);
  });
  it("a loader failure leaves the chat working from page signals (null, no throw)", async () => {
    const out = await serverFullContext({ userId: U, scope: "account", platformOwner: false, staff: false, disclosureRehearsal: false }, async () => { throw new Error("db down"); });
    assert.equal(out, null);
    assert.match(buildSystemPrompt({ currentPage: "dashboard", userFullContext: out }), /No full context loaded/);
  });
});

describe("the server-built context carries lanes, resumes, progression, hurdle plan and meter", () => {
  const ctx = assembleFullContext(parts());
  it("maps every part into the shape the prompt reads", () => {
    assert.equal(ctx.accountId, U);
    assert.equal(ctx.resumes.length, 2);
    assert.deepEqual(ctx.resumes.map((r) => r.targetJob), ["Production Supervisor", "Production Manager"]);
    assert.equal(ctx.journey.onboardingState, "full_access");
    assert.equal(ctx.forge?.hasCriminalRecord, true);
    assert.deepEqual(ctx.forge?.barriers, ["transportation"]);
    assert.deepEqual(ctx.workPreferences?.excludedTitles, ["driver"]);
    assert.deepEqual(ctx.lanes, { total: 2, open: 1, items: [{ id: "l1", name: "Maintenance and facilities", target: "Maintenance technician", kind: "resume" }] });
    assert.equal(ctx.progression?.currentStep, "interview");
    assert.equal(ctx.progression?.currentLabel, "Prepare for the interview");
    assert.deepEqual(ctx.progression?.completed, ["foundation", "direction", "tailor", "apply"]);
    assert.equal(ctx.progression?.remaining, 31);
    assert.equal(ctx.meter?.score, 193);
    assert.equal(ctx.hurdlePlan?.exists, true);
    assert.equal(ctx.hurdlePlan?.targetJob, "Production Supervisor");
    assert.equal(ctx.hurdlePlan?.hurdleCount, 2);
    assert.deepEqual(ctx.hurdlePlan?.hurdles?.map((h) => h.label).sort(), ["Gaps in my work history", "Getting to work"].sort());
    assert.deepEqual(ctx.applications.map((a) => a.company), ["Acme"]);
  });
  it("the prompt section names the lane, the step, the meter and the hurdle plan", () => {
    const prompt = buildSystemPrompt({ currentPage: "dashboard", userFullContext: ctx });
    for (const line of ["## WHO YOU ARE TALKING TO RIGHT NOW", "Name: Jean", "### LANES", '"Maintenance and facilities", aiming at Maintenance technician', "(1 archived)",
      "### HURDLE PLAN (saved 2026-10-24, for Production Supervisor)", "### WHERE THEY ARE IN THE PROCESS", "Current step: Prepare for the interview (interview)", "Completed: foundation, direction, tailor, apply",
      "AI actions left today: 31", '### STEEL MAN METER', 'Score 193, band "Covering ground"', "facts 6, lines 5, resumes 2", "Resumes: 2 total, 1 job-targeted", "Acme (Production Supervisor): interviewing, resume tailored"]) {
      assert.ok(prompt.includes(line), `prompt has: ${line}`);
    }
    assert.ok(!prompt.includes("No full context loaded"));
  });
  it("parts that did not load are left out, and the rest still prints", () => {
    const c = assembleFullContext(parts({ lanes: null, progression: null, meter: null, hurdlePlan: null }));
    assert.equal(c.lanes, null);
    assert.deepEqual(c.hurdlePlan, { exists: false });
    const lines = buildServerPartsSection(c);
    assert.deepEqual(lines, []);
    const prompt = buildSystemPrompt({ currentPage: "dashboard", userFullContext: c });
    assert.ok(prompt.includes("Name: Jean"));
    assert.ok(!prompt.includes("### LANES") && !prompt.includes("### STEEL MAN METER"));
  });
  it("an empty lane list says so instead of inventing lanes", () => {
    const lines = buildServerPartsSection(assembleFullContext(parts({ lanes: [], hurdlePlan: null, progression: null, meter: null })));
    assert.deepEqual(lines, ["\n### LANES (kinds of work they aim at)", "Only the main lane so far."]);
  });
  it("lists are capped with counts so the prompt cannot grow with the account", () => {
    const many = parts({
      lanes: Array.from({ length: 9 }, (_, i) => ({ id: `l${i}`, name: `Lane ${i}`, target_role: null, kind: "resume", archived_at: null })),
      resumes: Array.from({ length: 12 }, (_, i) => ({ id: `r${i}`, target_context: { targetJob: `Job ${i}` }, content: {}, created_at: "2026-10-24T00:00:00Z" })),
      profile: profile({ savedJobs: Array.from({ length: 14 }, (_, i) => ({ id: `j${i}`, jobTitle: `Role ${i}`, company: `Co ${i}`, status: "saved", followUpAt: null, resumeTailored: false })) }),
      hurdlePlan: { target_context: {}, content: { hurdlePlan: { hurdles: Array.from({ length: 6 }, (_, i) => ({ label: `H${i}`, known: ["a", "b", "c", "d"], open: [], doNow: ["x".repeat(500)], tell: null })) } }, created_at: "2026-10-24T00:00:00Z" },
    });
    const c = assembleFullContext(many);
    assert.equal(c.lanes?.items.length, FULL_CONTEXT_CAPS.lanes);
    assert.equal(c.resumes.length, FULL_CONTEXT_CAPS.resumes);
    assert.equal(c.applications.length, FULL_CONTEXT_CAPS.applications);
    assert.equal(c.hurdlePlan?.hurdles?.length, FULL_CONTEXT_CAPS.hurdles);
    assert.equal(c.hurdlePlan?.hurdles?.[0].known.length, FULL_CONTEXT_CAPS.hurdleLines);
    assert.ok(c.hurdlePlan!.hurdles![0].doNow[0].length <= 160);
    const lines = buildServerPartsSection(c).join("\n");
    assert.ok(lines.includes("  - and 4 more\n"), "lanes beyond the cap are counted");
    assert.ok(lines.includes("and 3 more hurdles"));
    assert.ok(lines.length < 2500, `section stays small: ${lines.length}`);
  });
});

describe("the record consent gate holds in the server-built context", () => {
  it("no record script or timing without the current consent; the plan still shows as existing", () => {
    const withheld = assembleFullContext(parts({ recordConsent: false }));
    assert.equal(withheld.disclosurePlan.exists, true);
    assert.equal(withheld.disclosurePlan.scriptExcerpt, null);
    assert.equal(withheld.disclosurePlan.timingAdvice, null);
    assert.equal(withheld.disclosurePlan.wordsWithheld, true);
    const prompt = buildSystemPrompt({ currentPage: "dashboard", userFullContext: withheld });
    assert.ok(!prompt.includes(SCRIPT) && !prompt.includes(TIMING));
    assert.ok(prompt.includes("### DISCLOSURE PLAN"));
    const shared = buildSystemPrompt({ currentPage: "dashboard", userFullContext: assembleFullContext(parts()) });
    assert.ok(shared.includes(SCRIPT.slice(0, 40)) && shared.includes(TIMING));
  });
  it("the loader combines consent AND nobody acting for the person, and fails closed", async () => {
    const words = async (over: Partial<FullContextLoaders>) => (await loadUserFullContext(U, loaders(over)))!.disclosurePlan.scriptExcerpt;
    assert.equal(await words({}), SCRIPT);
    assert.equal(await words({ recordConsent: async () => false }), null);
    assert.equal(await words({ actingForSomeoneElse: async () => true }), null);
    assert.equal(await words({ recordConsent: async () => { throw new Error("consent table unreachable"); } }), null);
    assert.equal(await words({ actingForSomeoneElse: async () => { throw new Error("no cookie store"); } }), null);
  });
  it("the real loaders read the consent at the current text version, as the consent module does", () => {
    const lib = read("lib/assistant-full-context.ts");
    assert.match(lib, /recordConsent: async \(userId\) => \(await recordPlannerConsent\(userId\)\)\.granted/);
    assert.match(lib, /actingForSomeoneElse: \(\) => actingForSomeoneElse\(\)/);
    assert.match(lib, /recordConsent: consent && !actingFor/);
    assert.match(read("lib/hurdles/consent-server.ts"), /consent_text_version === RECORD_PLANNER_CONSENT_VERSION/);
  });
});

describe("the saved hurdle plan reaches t.ROY without any record or sensitive text", () => {
  it("the generated forbidden set has zero hits in the section, and the record part is pointed at DISCLOSURE PLAN", () => {
    const section = buildServerPartsSection(assembleFullContext(parts())).join("\n").toLowerCase();
    assert.ok(recordAndSensitiveText().length > 40);
    const hits = recordAndSensitiveText().filter((line) => section.includes(line.toLowerCase()));
    assert.deepEqual(hits, []);
    assert.ok(!section.includes("time inside"));
    assert.ok(section.includes("getting to work"));
    assert.ok(section.includes("the record part of any plan is never saved here"));
  });
  it("the hurdle plan query reads both saved kinds, only rows with saved hurdles, never examples", () => {
    assert.match(LATEST_HURDLE_PLAN_SQL, /artifact_type IN \('hurdle_plan', 'disclosure_plan'\)/);
    assert.match(LATEST_HURDLE_PLAN_SQL, /jsonb_typeof\(content->'hurdlePlan'->'hurdles'\) = 'array'/);
    assert.match(LATEST_HURDLE_PLAN_SQL, /is_demo = false/);
    assert.match(LATEST_HURDLE_PLAN_SQL, /user_id = \$1/);
  });
});

describe("loadUserFullContext", () => {
  it("no profile means no context; one failing part never drops the rest", async () => {
    assert.equal(await loadUserFullContext(U, loaders({ profile: async () => null })), null);
    const c = await loadUserFullContext(U, loaders({ lanes: async () => { throw new Error("lanes down"); }, meter: async () => { throw new Error("meter down"); } }));
    assert.ok(c);
    assert.equal(c.lanes, null);
    assert.equal(c.meter, null);
    assert.equal(c.progression?.currentStep, "interview");
    assert.equal(c.resumes.length, 2);
  });
  it("the real loaders read progression read-only and the lanes as the person", () => {
    const lib = read("lib/assistant-full-context.ts");
    assert.match(lib, /getProgression\(userId, \{\}, true\)/);
    assert.match(lib, /core\.listLanes\(userId, \{ includeArchived: true \}\)/);
    assert.match(lib, /core\.queryAsUser<ResumeRow>\(userId, core\.RECENT_RESUMES_FOR_CONTEXT_SQL/);
    assert.match(lib, /core\.getOneAsUser<HurdlePlanRow>\(userId, LATEST_HURDLE_PLAN_SQL/);
    assert.doesNotMatch(code(lib), /\bquery\(|\bgetOne\(|\bqueryAsUser\(/, "no unscoped read");
  });
});
