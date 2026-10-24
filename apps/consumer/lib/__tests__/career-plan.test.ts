import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { INITIAL_PLANNER_STATE, QUESTION_ORDER, nextQuestion, plannerReducer, progressOf, readPlanAnswers, type PlannerState, type PlanAnswers } from "../career-plan/questions";
import { buildSavedFacts, cleanLink, todayFacts, verifyQuotes, type CareerFact } from "../career-plan/facts";
import { CAREER_DIRECTIONS } from "../career-plan/catalog";
import { allowedDirections, assemblePlan, buildPlanNote, parseModelPlan, PAY_NOTE, STRIPPED_NOTE, LINK_DROPPED_NOTE, SUPPORT_TRAINING_HREF, RESUME_LANE_HREF } from "../career-plan/plan";
import { chooseCareerDirection } from "../career-plan/handoff";

const root = join(import.meta.dirname, "..", "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const run = (actions: Parameters<typeof plannerReducer>[1][], start: PlannerState = INITIAL_PLANNER_STATE) => actions.reduce(plannerReducer, start);

/* ------------------------------------------------------------- the reducer -- */

test("question flow starts from the person's own work and walks one question at a time", () => {
  assert.equal(nextQuestion(INITIAL_PLANNER_STATE)?.id, "liked");
  const s = run([{ type: "answer", id: "liked", value: { factIds: ["m1"], text: "" } }, { type: "answer", id: "goodAt", value: "calming people down" }]);
  assert.equal(nextQuestion(s)?.id, "soon", "proud is only asked when nothing came back");
  assert.deepEqual(s.asked, ["liked", "goodAt"]);
});

test("adaptive: the proud-moment question comes up only when liked and good-at are both empty", () => {
  const s = run([{ type: "skip", id: "liked" }, { type: "skip", id: "goodAt" }]);
  assert.equal(nextQuestion(s)?.id, "proud");
  const typed = run([{ type: "answer", id: "liked", value: { factIds: [], text: "fixing the line when it jammed" } }]);
  assert.notEqual(nextQuestion(run([{ type: "skip", id: "goodAt" }], typed))?.id, "proud");
});

test("adaptive: needing money this week skips the training question; back undoes and reopens it", () => {
  const base = run([{ type: "skip", id: "liked" }, { type: "answer", id: "goodAt", value: "cooking" }]);
  const now = run([{ type: "answer", id: "soon", value: "this_week" }], base);
  assert.equal(nextQuestion(now)?.id, "schedule");
  const later = run([{ type: "back" }, { type: "answer", id: "soon", value: "months" }], now);
  assert.equal(nextQuestion(later)?.id, "training");
  // Changing to this_week after answering training drops the training answer.
  const trained = run([{ type: "answer", id: "training", value: "long" }], later);
  const changed = run([{ type: "back" }, { type: "back" }, { type: "answer", id: "soon", value: "this_week" }], trained);
  assert.equal(changed.answers.training, undefined);
  assert.ok(!changed.asked.includes("training"));
});

test("the reducer rejects values off the list, bounds text, and finishes after the last question", () => {
  let s = run([{ type: "answer", id: "soon", value: "yesterday" }]);
  assert.equal(s.answers.soon, undefined);
  assert.equal(s.asked.length, 0);
  s = run([{ type: "answer", id: "goodAt", value: "x".repeat(2000) }]);
  assert.equal(s.answers.goodAt!.length, 400);
  s = run([{ type: "answer", id: "payFloor", value: "$17.50" }]);
  assert.equal(s.answers.payFloor, 17.5);
  const all = QUESTION_ORDER.map((id) => ({ type: "skip" as const, id }));
  const done = run(all);
  assert.equal(nextQuestion(done), null);
  assert.deepEqual(progressOf(done), { done: 10, total: 10 });
  assert.deepEqual(run([{ type: "reset" }], done), INITIAL_PLANNER_STATE);
});

test("server answer reader drops unknown keys and bad values", () => {
  const a = readPlanAnswers({ soon: "month", physical: "flying", savedFacts: ["Invented license"], liked: { factIds: ["m1", "../x", "m1"], text: " a  b " } });
  assert.deepEqual(a, { soon: "month", liked: { factIds: ["m1"], text: "a b" } });
  assert.equal(readPlanAnswers([]), null);
});

/* ------------------------------------------------------ the fact-check stripper -- */

const facts: CareerFact[] = [
  { id: "m1", text: "Ran the grill on Friday nights at a diner", source: "master" },
  { id: "k1", text: "Forklift operation", source: "forge_skill" },
  { id: "t-good", text: "keeping track of money for my uncle's shop", source: "today" },
];

test("quotes survive only when they appear word for word in the person's facts", () => {
  const r = verifyQuotes([
    { factId: "m1", quote: "Ran the grill on Friday nights" },
    { factId: "m1", quote: "Managed a team of 12 cooks" },
    { factId: "k1", quote: "keeping track of money" },
    { factId: "zz", quote: "Forklift operation." },
    { factId: "m1", quote: "a" },
    "not even an object",
  ], facts);
  assert.deepEqual(r.kept.map((k) => [k.factId, k.source]), [["m1", "master"], ["t-good", "today"], ["k1", "forge_skill"]]);
  assert.equal(r.stripped, 3, "invented, too short and malformed quotes are counted");
});

test("an all-invented model plan is stripped to nothing about the person, with a visible note", () => {
  const model = parseModelPlan('Sure! {"directions":[{"id":"cooking","quotes":[{"factId":"m1","quote":"Head chef for 5 years"}],"link":"You worked as a chef for years."},{"id":"made-up","quotes":[]},{"id":"bookkeeping","quotes":[{"factId":"t-good","quote":"keeping track of money"}],"link":"This work is about keeping the numbers straight."}]}');
  const plan = assemblePlan({ facts, answers: {}, location: "Example City, MT", model });
  assert.equal(plan.method, "ai");
  assert.deepEqual(plan.directions.map((d) => d.id).slice(0, 2), ["cooking", "bookkeeping"], "an id not in the catalogue is ignored");
  assert.equal(plan.directions.length, 3, "the rules fill the third");
  assert.deepEqual(plan.directions[0].quotes.map((q) => q.quote), ["Ran the grill on Friday nights at a diner"], "stripped quotes fall back to the person's own matching fact");
  assert.equal(plan.directions[0].link, null, "no model link without a verified model quote");
  assert.equal(plan.directions[1].link, "This work is about keeping the numbers straight.");
  assert.ok(plan.notes.includes(STRIPPED_NOTE(1)));
  assert.equal(STRIPPED_NOTE(2).includes("2 things"), true);
});

test("the link line may talk about the work but never claim a fact, a number or pay", () => {
  assert.equal(cleanLink("Kitchens run on the same calm you described.").text, "Kitchens run on the same calm you described.");
  for (const bad of ["You managed a crew before.", "Starts around 18 an hour.", "Pays $40k a year.", "You have a CDL already."]) assert.equal(cleanLink(bad).dropped, true, bad);
  const plan = assemblePlan({ facts, answers: {}, location: "", model: [{ id: "cooking", quotes: [{ factId: "m1", quote: "Ran the grill" }], link: "You led the kitchen for 3 years." }] });
  assert.ok(plan.notes.includes(LINK_DROPPED_NOTE));
});

test("no pay is ever shown without a wired source; every direction names its record note and dated source", () => {
  const plan = assemblePlan({ facts, answers: {}, location: "" });
  assert.equal(plan.method, "rules");
  for (const d of plan.directions) {
    assert.equal(d.pay, null);
    assert.equal(d.payNote, PAY_NOTE);
    assert.ok(d.record.label && d.record.note && /not legal advice/i.test(d.record.footer));
    assert.equal(new URL(d.source.url).hostname, "www.bls.gov");
    assert.match(d.source.reviewedAt, /^2026-10-2[23]$/);
    for (const q of d.quotes) assert.ok(facts.some((f) => f.id === q.factId && f.text.includes(q.quote)), "rules quotes are slices of the facts");
  }
  assert.equal(plan.directions[0].id, "bookkeeping", "what the person said today weighs most");
  assert.ok(plan.directions.some((d) => d.id === "cooking"), "the grill fact brings cooking in");
});

test("everyday words tie a person's own fact to the work", () => {
  const plan = assemblePlan({ facts: [{ id: "m1", text: "Fixed the walk-in cooler door with the owner", source: "master" }], answers: {}, location: "" });
  assert.equal(plan.directions[0].id, "maintenance");
  assert.equal(plan.directions[0].quotes[0].quote, "Fixed the walk-in cooler door with the owner");
});

test("constraints filter the catalogue before anything is picked", () => {
  const ids = (a: PlanAnswers) => allowedDirections(a).map((d) => d.id);
  assert.ok(!ids({ transport: "no_license" }).includes("truck-driving"));
  assert.ok(!ids({ licensing: "avoid" }).some((id) => ["personal-care", "electrical", "truck-driving"].includes(id)));
  assert.ok(!ids({ physical: "no_heavy" }).some((id) => CAREER_DIRECTIONS.find((d) => d.id === id)!.heavyLifting));
  assert.ok(!ids({ soon: "this_week" }).some((id) => CAREER_DIRECTIONS.find((d) => d.id === id)!.preparation === "extended"));
  const tight = assemblePlan({ facts: [], answers: { physical: "both", licensing: "avoid", transport: "no_license", soon: "this_week" }, location: "" });
  assert.equal(tight.directions.length, 3);
  assert.ok(tight.ruledOut > 0);
  assert.ok(tight.notes.some((n) => /Master Draft/.test(n)), "no facts says so instead of pretending to match");
});

test("first moves: on-the-job work opens a job search, long training opens school and training, the rest a resume lane", () => {
  const plan = (id: string, answers: PlanAnswers = {}) => assemblePlan({ facts: [], answers, location: "Libby, MT", model: [{ id, quotes: [], link: null }] }).directions[0];
  const jobs = plan("cooking");
  assert.equal(jobs.firstMove.kind, "jobs");
  assert.equal(jobs.firstMove.task, "job");
  const url = new URL(jobs.firstMove.href, "https://x.test");
  assert.equal(url.pathname, "/dashboard/jobs");
  assert.equal(url.searchParams.get("q"), "Prep cook");
  assert.equal(url.searchParams.get("location"), "Libby, MT");
  const school = plan("electrical", { soon: "months", training: "long" });
  assert.deepEqual([school.firstMove.kind, school.firstMove.href, school.firstMove.task], ["training", SUPPORT_TRAINING_HREF, "explore"]);
  const resume = plan("administrative", { soon: "months" });
  assert.deepEqual([resume.firstMove.kind, resume.firstMove.href, resume.firstMove.task], ["resume", RESUME_LANE_HREF, "resume"]);
});

/* ------------------------------------------------------------- facts source -- */

test("saved facts come from server rows only, with their source marked", () => {
  const f = buildSavedFacts({
    master: { facts: [{ id: "a", text: "Trained new hires on the line", status: "confirmed" }, { id: "b", text: "Drove a forklift", status: "needs_check" }] },
    skills: [{ name: "Inventory" }, "Inventory", 7],
    forgeOutput: { strengths: [{ title: "x", evidence: "Kept the stock room in order" }] },
  });
  assert.deepEqual(f.map((x) => [x.id, x.source]), [["m1", "master"], ["m2", "master_unchecked"], ["s1", "forge_strength"], ["k1", "forge_skill"]]);
  assert.deepEqual(todayFacts({ goodAt: "  fixing bikes ", proud: "" }), [{ id: "t-good", text: "fixing bikes", source: "today" }]);
  const ui = read("components/paths/CareerPlanner.tsx");
  assert.ok(!/localStorage|sessionStorage/.test(ui), "the planner never reads facts from the browser");
  assert.match(ui, /fetch\("\/api\/career-plan"/);
});

/* --------------------------------------------------------- still deciding -- */

test("a still-deciding note keeps catalogue directions and choices only, never the person's free text", () => {
  const note = buildPlanNote({ id: "00000000-0000-4000-8000-000000000001", now: new Date("2026-10-23T12:00:00Z"), directionIds: ["cooking", "nope", "cooking", "welding"], answers: { soon: "month", goodAt: "a private story", liked: { factIds: [], text: "secret words" }, payFloor: 18 } });
  assert.ok(note);
  assert.deepEqual(note!.directions.map((d) => d.id), ["cooking", "welding"]);
  const saved = JSON.stringify(note);
  assert.ok(!saved.includes("private story") && !saved.includes("secret words"));
  assert.ok(note!.choices.includes("needs money within a month"));
  assert.match(note!.nextStep, /prep cook postings/);
  assert.equal(buildPlanNote({ id: "x", now: new Date(), directionIds: ["nope"], answers: {} }), null);
  const route = read("app/api/career-plan/notes/route.ts");
  assert.match(route, /queryAsUser\(/, "notes go through row-level security");
  assert.ok(!/\bquery\(|getOne\(/.test(route.replace(/queryAsUser\(|getOneAsUser\(/g, "")));
});

/* ---------------------------------------------------- direction-to-lane handoff -- */

const reply = (data: unknown, ok = true) => ({ ok, async json() { return data; } });

test("choosing a direction creates its lane, saves the focus task of its first move, and returns the move with the lane", async () => {
  const d = assemblePlan({ facts: [], answers: {}, location: "Libby, MT", model: [{ id: "cooking", quotes: [], link: null }] }).directions[0];
  const calls: { url: string; body?: unknown }[] = [];
  const lane = { id: "11111111-1111-4111-8111-111111111111", target_role: "Cook", kind: "resume" };
  const result = await chooseCareerDirection(d, {
    laneAtStart: "main", currentLane: () => "main", location: "Libby, MT",
    fetcher: async (url, init) => {
      calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (url === "/api/lanes" && !init?.method) return reply({ lanes: [] });
      if (url === "/api/lanes") return reply({ lane });
      return reply({ focus: { laneId: lane.id } });
    },
  });
  assert.deepEqual(calls.map((c) => c.url), ["/api/lanes", "/api/lanes", "/api/lane-focus"]);
  assert.deepEqual(calls[1].body, { name: "Cook", targetRole: "Cook", kind: "resume" });
  assert.deepEqual(calls[2].body, { task: "job", laneId: lane.id, target: "Cook" });
  assert.equal(result.task, "job");
  const url = new URL(result.href, "https://x.test");
  assert.equal(url.searchParams.get("laneId"), lane.id);
  assert.equal(url.searchParams.get("q"), "Prep cook");
});

test("handoff reuses an existing lane and refuses when the active lane changed mid-choice", async () => {
  const d = assemblePlan({ facts: [], answers: { soon: "months", training: "long" }, location: "", model: [{ id: "electrical", quotes: [], link: null }] }).directions[0];
  const lane = { id: "22222222-2222-4222-8222-222222222222", target_role: "Electrician apprentice", kind: "resume" };
  const posts: string[] = [];
  const result = await chooseCareerDirection(d, { laneAtStart: "main", currentLane: () => "main", location: "", fetcher: async (url, init) => {
    if (init?.method) posts.push(url);
    return url === "/api/lanes" ? reply({ lanes: [lane] }) : reply({ focus: { laneId: lane.id } });
  } });
  assert.deepEqual(posts, ["/api/lane-focus"], "no new lane when one matches");
  assert.equal(result.href, SUPPORT_TRAINING_HREF);
  assert.equal(result.task, "explore");
  let lane2 = "main";
  await assert.rejects(chooseCareerDirection(d, { laneAtStart: "main", currentLane: () => lane2, location: "", fetcher: async () => { lane2 = "other"; return reply({ lanes: [] }); } }), /active lane changed/);
});

/* ---------------------------------------------------------------- wiring -- */

test("the planner's AI call goes through admission, the router and failover; copy carries no dashes", () => {
  const route = read("app/api/career-plan/route.ts");
  assert.match(route, /withRateLimit\(/);
  assert.match(route, /endpoint: ENDPOINT/);
  assert.match(route, /callAI\(PLAN_SYSTEM/);
  assert.match(read("lib/ai-operation-policy.ts"), /'career-plan'/);
  assert.match(read("lib/ai-call.ts"), /\.find\(\(b: \{ type\?: string \}\) => b\.type === "text"\)/);
  for (const p of ["components/paths/CareerPlanner.tsx", "lib/career-plan/questions.ts", "lib/career-plan/catalog.ts", "lib/career-plan/plan.ts"]) {
    const src = read(p);
    assert.ok(!src.includes("—"), `${p} has an em dash`);
  }
});
