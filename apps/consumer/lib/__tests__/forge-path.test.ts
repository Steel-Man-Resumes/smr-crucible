import { test } from "node:test";
import assert from "node:assert/strict";
import {
  planForgePath,
  questionsFor,
  findQuestion,
  nextPath,
  previousPath,
  remainingScreens,
  progressSteps,
  datedJobs,
  locationFromResume,
  defaultDepth,
  ANSWER_KEY,
  type PathSession,
  type QuestionId,
} from "../forge-path";
import { migrateStoredSession } from "../forge-preferences";

const ids = (s: PathSession) => planForgePath(s).screens.map((x) => x.id);
const qids = (s: PathSession, screen: Parameters<typeof questionsFor>[1]) =>
  questionsFor(planForgePath(s), screen).map((x) => x.id);

// --- R1 / R2: the four readiness answers -------------------------------------

test("ready to go: the light path, essentials first, story offered after preferences", () => {
  const p = planForgePath({ readinessStage: "action" });
  assert.equal(p.depth, "light");
  assert.equal(p.tone, "direct");
  assert.deepEqual(ids({ readinessStage: "action" }), ["resume", "goals", "preferences", "processing", "output"]);
  assert.deepEqual(p.offers, ["story"]);
  // Everything past the goal cards is folded behind "Add more".
  const goals = questionsFor(p, "goals");
  assert.equal(goals[0].id, "goals");
  assert.equal(goals[0].folded, false);
  assert.ok(goals.slice(1).every((x) => x.folded));
});

test("getting ready: the full path, direct wording, the hook prompt folded", () => {
  const p = planForgePath({ readinessStage: "preparation" });
  assert.equal(p.depth, "full");
  assert.equal(p.tone, "direct");
  assert.deepEqual(ids({ readinessStage: "preparation" }), ["resume", "goals", "story", "preferences", "processing", "output"]);
  assert.deepEqual(p.offers, []);
  assert.equal(findQuestion(p, "goals", "hook")?.folded, true);
  assert.equal(findQuestion(p, "goals", "goalNarrative")?.folded, false);
});

test("thinking about it and just exploring: the full path, open wording, the hook prompt open", () => {
  for (const readinessStage of ["contemplation", "precontemplation"]) {
    const p = planForgePath({ readinessStage });
    assert.equal(p.depth, "full");
    assert.equal(p.tone, "open");
    assert.equal(findQuestion(p, "goals", "hook")?.folded, false);
    assert.equal(findQuestion(p, "goals", "goals")?.variant, "open");
    assert.equal(findQuestion(p, "story", "challenges")?.variant, "open");
  }
});

test("the four answers give four different plans, and the person's own pick overrides the default", () => {
  const plans = ["precontemplation", "contemplation", "preparation", "action"].map((r) =>
    JSON.stringify(planForgePath({ readinessStage: r }))
  );
  // exploring and thinking share a plan on purpose (same open tone); the other two each differ
  assert.equal(new Set(plans).size, 3);
  assert.equal(defaultDepth("action"), "light");
  assert.equal(planForgePath({ readinessStage: "action", pathChoice: "full" }).depth, "full");
  assert.equal(planForgePath({ readinessStage: "precontemplation", pathChoice: "light" }).depth, "light");
});

test("the light path with the story asked for puts it after preferences, and never re-asks schedule there", () => {
  const s: PathSession = { readinessStage: "action", pathExtras: ["story"], goals: ["stability"] };
  assert.deepEqual(ids(s), ["resume", "goals", "preferences", "story", "processing", "output"]);
  assert.deepEqual(planForgePath(s).offers, []);
  assert.ok(qids(s, "preferences").includes("schedule"));
  assert.ok(!qids(s, "story").includes("schedule"));
});

// --- R3: with and without a resume -------------------------------------------

test("a saved resume is confirmed, not asked for again; no resume keeps the chooser and guided builder", () => {
  assert.equal(findQuestion(planForgePath({}), "resume", "resume")?.variant, "choose");
  assert.equal(
    findQuestion(planForgePath({ resumeText: "x", resumeMethod: "upload" }), "resume", "resume")?.variant,
    "saved"
  );
  assert.equal(
    findQuestion(planForgePath({ resumeText: "x", resumeMethod: "rush" }), "resume", "resume")?.variant,
    "rush"
  );
});

test("building from scratch means no resume yet, so goals does not ask how strong it is", () => {
  assert.ok(!qids({ resumeMethod: "guided", resumeText: "x" }, "goals").includes("confidence"));
  assert.ok(qids({ resumeMethod: "upload", resumeText: "x" }, "goals").includes("confidence"));
  assert.ok(qids({}, "goals").includes("confidence"));
});

test("datedJobs keeps jobs with a title or employer and a start date, nothing else", () => {
  const jobs = datedJobs([
    { title: "Line Cook", company: "Example Diner", start: "2019", end: "2022" },
    { title: "Warehouse Associate", company: "", start: "", end: "" },
    { title: "", company: "Sample Freight", start: "Mar 2016", end: "" },
    { title: "", company: "", start: "2010", end: "2011" },
  ]);
  assert.deepEqual(
    jobs.map((j) => j.title || j.company),
    ["Line Cook", "Sample Freight"]
  );
  assert.deepEqual(datedJobs(undefined), []);
});

test("a location on the resume is offered to confirm, never asked cold", () => {
  const s: PathSession = { resumeDoc: { contact: { city: "Lansing", state: "mi" } } };
  assert.equal(locationFromResume(s), "Lansing, MI");
  assert.equal(findQuestion(planForgePath(s), "preferences", "location")?.variant, "confirm");
  // Once they saved a location, it is theirs: plain wording again.
  const saved = { ...s, preferences: { location: "Detroit, MI" } };
  assert.equal(findQuestion(planForgePath(saved), "preferences", "location")?.variant, "default");
  assert.equal(locationFromResume({ resumeDoc: { contact: { city: "Lansing", state: "" } } }), null);
});

// --- R4: goals pick and order the story prompts --------------------------------

test("goals bring story prompts in the order the goals were picked", () => {
  const a = planForgePath({ readinessStage: "preparation", goals: ["back_to_my_trade", "stability"] });
  const b = planForgePath({ readinessStage: "preparation", goals: ["stability", "back_to_my_trade"] });
  const tail = (p: ReturnType<typeof planForgePath>) =>
    questionsFor(p, "story").filter((x) => x.id === "schedule" || x.id === "credentials");
  assert.deepEqual(tail(a).map((x) => [x.id, x.variant]), [["credentials", "trade"], ["schedule", "steady"]]);
  assert.deepEqual(tail(b).map((x) => [x.id, x.variant]), [["schedule", "steady"], ["credentials", "trade"]]);
  // the schedule question moved, so preferences does not ask it again
  assert.ok(!questionsFor(a, "preferences").some((x) => x.id === "schedule"));
});

test("growth asks about training, flexibility asks about schedule, other goals add nothing", () => {
  const p = planForgePath({ goals: ["growth", "flexibility"] });
  assert.deepEqual(
    questionsFor(p, "story").filter((x) => ["schedule", "credentials"].includes(x.id)).map((x) => [x.id, x.variant]),
    [["credentials", "growth"], ["schedule", "flexible"]]
  );
  const plain = planForgePath({ goals: ["meaning", "community", "independence", "immediate"] });
  assert.deepEqual(qids({ goals: ["meaning", "community", "independence", "immediate"] }, "story"), [
    "challenges",
    "record",
    "challengeNarratives",
  ]);
  assert.deepEqual(questionsFor(plain, "preferences").map((x) => x.id), ["schedule", "environment", "commute", "location"]);
});

// --- R5: challenges shape preferences ----------------------------------------

test("a transportation challenge brings commute and location to the top, with transit wording", () => {
  const p = planForgePath({ readinessStage: "precontemplation", challenges: ["transportation"] });
  const prefs = questionsFor(p, "preferences");
  assert.deepEqual(prefs.map((x) => x.id), ["commute", "location", "schedule", "environment"]);
  assert.equal(prefs[0].variant, "transit");
});

test("a childcare challenge brings shifts to the top with family wording, also when goals moved schedule", () => {
  const p = planForgePath({ challenges: ["childcare", "transportation"] });
  assert.deepEqual(questionsFor(p, "preferences").map((x) => [x.id, x.variant]), [
    ["schedule", "family"],
    ["commute", "transit"],
    ["location", "default"],
    ["environment", "default"],
  ]);
  const moved = planForgePath({ goals: ["stability"], challenges: ["childcare"] });
  assert.equal(findQuestion(moved, "story", "schedule")?.variant, "family");
  assert.equal(findQuestion(moved, "preferences", "schedule"), undefined);
});

// --- R6: never twice ------------------------------------------------------------

test("no question is ever placed twice, across every mix of answers", () => {
  const readiness = [undefined, "precontemplation", "contemplation", "preparation", "action"];
  const goalSets = [[], ["stability"], ["flexibility", "stability"], ["back_to_my_trade", "growth"], ["growth", "stability", "meaning"]];
  const challengeSets = [[], ["transportation"], ["childcare"], ["childcare", "transportation", "criminal_record"]];
  const choices = [undefined, "light", "full"] as const;
  let checked = 0;
  for (const r of readiness)
    for (const goals of goalSets)
      for (const challenges of challengeSets)
        for (const pathChoice of choices)
          for (const pathExtras of [undefined, ["story"]])
            for (const resumeMethod of [undefined, "guided", "upload"]) {
              const p = planForgePath({ readinessStage: r, goals, challenges, pathChoice, pathExtras, resumeMethod });
              const all: QuestionId[] = p.screens.flatMap((x) => x.questions.map((y) => y.id));
              assert.equal(new Set(all).size, all.length, `duplicate in ${JSON.stringify({ r, goals, challenges, pathChoice, pathExtras })}`);
              // the four preference answers are always asked somewhere on the path
              for (const must of ["schedule", "environment", "commute", "location", "goals", "resume"] as QuestionId[]) {
                assert.ok(all.includes(must), `${must} missing`);
              }
              checked++;
            }
  assert.ok(checked > 1000);
});

test("a moved question keeps its storage, so changing goals never loses an answer", () => {
  // schedule lives in preferences.schedule whether it shows on story or preferences
  assert.equal(ANSWER_KEY.schedule, "preferences.schedule");
  assert.equal(ANSWER_KEY.credentials, "challengeNarratives.licenses_and_training");
  // The plan is a function of the answers; it never clears one.
  const before: PathSession = { goals: ["stability"], preferences: { schedule: "full-time, days" } };
  const after: PathSession = { ...before, goals: ["meaning"] };
  planForgePath(before);
  planForgePath(after);
  assert.equal(after.preferences?.schedule, "full-time, days");
  assert.ok(qids(after, "preferences").includes("schedule"));
});

// --- R7: the record never shapes wording -------------------------------------

test("record details never change the plan", () => {
  const base: PathSession & { criminalRecord?: unknown } = {
    readinessStage: "preparation",
    goals: ["stability"],
    challenges: ["criminal_record"],
  };
  const withDetails = {
    ...base,
    criminalRecord: { type: "felony", charge_count: "2-3", most_recent: "1-3 years", supervision: "yes", context: "x" },
  };
  assert.deepEqual(planForgePath(withDetails), planForgePath(base));
});

// --- R8 + old sessions -----------------------------------------------------------

test("demo mode is the fixed full walkthrough", () => {
  const p = planForgePath({ isDemo: true, readinessStage: "action", goals: ["stability"], challenges: ["childcare"] });
  assert.equal(p.depth, "full");
  assert.deepEqual(questionsFor(p, "preferences").map((x) => x.id), ["schedule", "environment", "commute", "location"]);
});

test("an old v1 run (no stamp, old ids, no readiness) loads and gets a full path", () => {
  const stored = {
    goals: ["stability"],
    challenges: ["transportation"],
    preferences: { schedule: "full-time", commute: "bus, drive-short", location: "Milwaukee, WI" },
    resumeText: "old text",
    resumeMethod: "paste",
    _savedAt: 1,
  };
  const { session, migrated } = migrateStoredSession(stored);
  assert.equal(migrated, true);
  const p = planForgePath(session as PathSession);
  assert.equal(p.depth, "full");
  assert.deepEqual(p.screens.map((x) => x.id), ["resume", "goals", "story", "preferences", "processing", "output"]);
  assert.equal(findQuestion(p, "resume", "resume")?.variant, "saved");
  assert.equal(findQuestion(p, "preferences", "commute")?.variant, "transit");
  // junk in the stored fields does not throw
  assert.doesNotThrow(() => planForgePath({ goals: "x" as unknown as string[], challenges: null as unknown as string[] }));
});

// --- navigation and progress ------------------------------------------------------

test("next and back follow the person's path; progress shows their real screens", () => {
  const light = planForgePath({ readinessStage: "action" });
  assert.equal(nextPath(light, "goals"), "/preferences");
  assert.equal(nextPath(light, "preferences"), "/processing");
  assert.equal(previousPath(light, "preferences"), "/goals");
  assert.equal(previousPath(light, "resume"), "/welcome");
  // the offered story screen, opened before opting in, goes back to preferences and on to processing
  assert.equal(previousPath(light, "story"), "/preferences");
  assert.equal(nextPath(light, "story"), "/processing");

  const full = planForgePath({ readinessStage: "precontemplation" });
  assert.equal(nextPath(full, "goals"), "/story");
  assert.equal(previousPath(full, "preferences"), "/story");
  assert.deepEqual(remainingScreens(full, "goals").map((x) => x.label), ["Story", "Preferences", "Build", "Results"]);
  assert.deepEqual(remainingScreens(light, "goals").map((x) => x.label), ["Preferences", "Build", "Results"]);

  const steps = progressSteps(light, "/goals");
  assert.deepEqual(steps?.map((x) => x.state), ["done", "current", "todo", "todo", "todo"]);
  assert.equal(progressSteps(light, "/welcome"), null);
});
