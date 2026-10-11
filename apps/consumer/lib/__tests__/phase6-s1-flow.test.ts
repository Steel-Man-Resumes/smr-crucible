/**
 * Phase 6 lane S1 (plan Q1 + Q3): one path to a real resume, one tap per job.
 *
 * Fixture: a fictional person (Dana Reyes) with a typical weak page: an objective, a soft-skill list, two jobs with
 * "Responsible for" duty lines, and education. The writer's page rewords
 * every line under rewording A (facts locked) and adds one skill term the
 * person never named. No AI, no real person. example.com only.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  JOB_OK_ANSWER,
  applyRewrite,
  buildFinishView,
  cutTerm,
  factsLockedFor,
  jobHeaderLines,
  mainActionLabel,
  optionalNumberPrompts,
  readStoredFinish,
  recordAnswer,
  recordJobOk,
  statusLine,
  FINISH_STATE_VERSION,
  type DefendAnswer,
  type FinishView,
} from "../finish-gate";
import { cleanRevisionInput, computeRevision, gateRevision, type RevisionInput } from "../revision-status";
import { finishState, FIXTURE_CTX } from "./fixtures/revision-run";
import {
  BUILD_WITH_TROY_LABEL,
  CHECK_AND_FINISH_LABEL,
  decisionsToFirstSave,
  rebuildHref,
} from "../lane-task";
import { draftNext, laneHomeNext } from "../../components/lanes/LaneHome";

const read = (p: string) => readFileSync(join(__dirname, "..", "..", p), "utf8");

// The person's own page, as uploaded.
const UPLOAD = `DANA REYES
Springfield, IL | 555-0142 | dana.reyes@example.com

OBJECTIVE
Seeking a position where I can use my skills and grow with a company.

SKILLS
Hard worker, Team player, Good communication, Fast learner

WORK EXPERIENCE
Warehouse Associate | Midstate Distribution | 8/2021 - Present
Responsible for loading trucks
Responsible for 3rd shift inventory counts
Duties included operating pallet jack and moving 40 pallets a night

Line Cook | Corner Diner | 3/2018 - 7/2021
Responsible for prep and grill
Cleaned kitchen at close

EDUCATION
Springfield High School, Diploma, 2017`;

// What the writer returned: every line reworded, facts kept, one skill term she never named.
const WRITTEN = `DANA REYES
Springfield, IL | 555-0142 | dana.reyes@example.com

WAREHOUSE ASSOCIATE
Warehouse associate who loads trucks, counts inventory on 3rd shift and runs a pallet jack, with kitchen prep and grill work before that.

CORE COMPETENCIES
Truck Loading | Inventory Counts | Pallet Jack | Food Prep | Grill | Workplace Safety

PROFESSIONAL EXPERIENCE
Warehouse Associate | Midstate Distribution | 8/2021 - Present
- Load outbound trucks
- Count inventory on 3rd shift
- Operate a pallet jack, moving 40 pallets a night

Line Cook | Corner Diner | 3/2018 - 7/2021
- Prepped food and worked the grill
- Cleaned the kitchen at close

EDUCATION
Diploma | Springfield High School | 2017`;

/** The second check ran on both documents and flagged nothing. */
/** Round 3: rewording A is opt-in; generate-docs stamps a Forge run's own resume text as "given". */
const GROUNDING = { verifierRan: true, verifierRanByDoc: { resume: true, cover_letter: true }, removed: 0, residual: 0, unmatched: 0, outcomes: [], sourceKind: "given", rewordingA: true };

function view(over: Partial<Parameters<typeof buildFinishView>[0]> = {}): FinishView {
  const resumeText = over.resumeText ?? WRITTEN;
  return buildFinishView({
    resumeText,
    ownWords: UPLOAD,
    defendAnswers: [],
    written: { resume: WRITTEN, letter: "" },
    grounding: GROUNDING,
    ownResumeText: UPLOAD,
    ...over,
  });
}

// ---- Q3: the tap count ---------------------------------------------------------------

test("Q3 target: a typical weak page finishes with one 'Looks right' per job plus at most 3 other taps", () => {
  const jobs = jobHeaderLines(WRITTEN);
  assert.equal(jobs.length, 2);
  const v0 = view();
  assert.equal(v0.state, "draft");
  // Exactly: one job card per job, and the one keep-or-cut skills card (D3). No line asked
  // because it was reworded, no title typed, no number asked.
  const jobCards = v0.groups.filter((g) => g.job);
  const others = v0.groups.filter((g) => !g.job);
  assert.equal(jobCards.length, 2, JSON.stringify(v0.groups.map((g) => g.line)));
  assert.deepEqual(jobCards.map((g) => g.line), jobs);
  assert.deepEqual(others.map((g) => g.target), ["skillset"]);
  assert.deepEqual(others[0].terms, ["Workplace Safety"]);
  assert.equal(v0.general.length, 0);
  assert.equal(v0.status.defendLines.length, 0, "a reworded line whose facts trace back is not asked about");
  assert.ok(!v0.groups.some((g) => g.title), "no title card: her titles are on her own page");
  assert.equal(v0.jobsOpen, 2);

  // The person taps.
  let taps = 0;
  let answers: DefendAnswer[] = [];
  for (const g of jobCards) {
    answers = recordJobOk(answers, g.line);
    taps++;
  }
  const looksRightTaps = taps;
  // The skills card: one tap per term (she cuts the one she never said).
  const resumeText = cutTerm(WRITTEN, "Workplace Safety");
  taps++;
  const done = view({ resumeText, defendAnswers: answers });
  assert.equal(done.state, "finished", JSON.stringify(done.openItems.map((i) => `${i.rule} ${i.kind} ${i.line}`)));
  assert.equal(looksRightTaps, jobs.length);
  assert.ok(taps - looksRightTaps <= 3, `other taps: ${taps - looksRightTaps}`);

  // Numbers stay optional (D2): prompts are offered, never required to finish.
  const prompts = optionalNumberPrompts(resumeText, done.groups.map((g) => g.line));
  assert.ok(prompts.length >= 1 && prompts.length <= 3);
  for (const p of prompts) assert.doesNotMatch(p.count, /\d/, "a prompt names what to count, never a figure");
  assert.ok(!done.openItems.some((i) => /number/i.test(i.question) && i.kind !== "added_number"));
});

test("Q3: the server's gate agrees (cleaned through the same filter, the writer's receipt matched)", () => {
  let answers: DefendAnswer[] = [];
  for (const h of jobHeaderLines(WRITTEN)) answers = recordJobOk(answers, h);
  const state = finishState({
    resumeText: WRITTEN,
    coverLetterText: "",
    written: { resume: WRITTEN, letter: "" },
    grounding: GROUNDING,
    ownWords: UPLOAD,
    ownResumeText: UPLOAD,
    defendAnswers: answers,
    keptTerms: ["Workplace Safety"],
  });
  const c = cleanRevisionInput(state, { receipt: FIXTURE_CTX });
  assert.ok(c.ok, c.ok ? "" : c.reason);
  assert.equal(c.input.defendAnswers.filter((a) => a.kind === "job_ok").length, 2, "the save keeps the job taps");
  assert.equal(computeRevision(c.input).status, "finished");
  // Without the taps the same version is a draft, and the to-do page says which jobs.
  const bare = cleanRevisionInput({ ...state, defendAnswers: [] }, { receipt: FIXTURE_CTX });
  assert.ok(bare.ok);
  const v = computeRevision(bare.input);
  assert.equal(v.status, "draft");
  assert.ok(v.openItems.some((i) => i.includes("Midstate Distribution") && i.includes("Is this job right?")), v.openItems.join(" | "));
});

test("Q3 copy: only job taps left says so plainly", () => {
  const v = view({ resumeText: cutTerm(WRITTEN, "Workplace Safety") });
  assert.equal(v.fixCount, 2);
  assert.equal(statusLine(v), "Check your two jobs, one tap each, and it's ready.");
  assert.equal(mainActionLabel(v), "Check your 2 jobs");
  const ui = read("components/forge/finish/DefendPanel.tsx");
  assert.match(ui, /Looks right/);
  assert.match(ui, /Fix this/);
  assert.match(ui, /data-job-card="true"/);
  assert.match(ui, /Optional: add a number\?/);
  for (const copy of [ui, read("lib/finish-copy.ts")]) assert.doesNotMatch(copy, /\u2014|--(?!>)/, "no dashes in what a person reads");
});

// ---- Q3: every fact stays locked ---------------------------------------------------------

/** Every card except the job taps. */
const nonJob = (v: FinishView) => v.groups.filter((g) => !g.job);

test("A, facts locked: a number moved onto another thing is asked again", () => {
  const moved = WRITTEN.replace("- Operate a pallet jack, moving 40 pallets a night", "- Operate a pallet jack, moving 40 trucks a night");
  const v = view({ resumeText: moved, written: { resume: moved, letter: "" } });
  assert.ok(nonJob(v).some((g) => g.line === "- Operate a pallet jack, moving 40 trucks a night"), JSON.stringify(nonJob(v).map((g) => g.line)));
});

test("A, facts locked: a number she never gave is held (STD-T02), and a Looks right never settles it", () => {
  const added = WRITTEN.replace("- Load outbound trucks", "- Load 12 outbound trucks a shift");
  let answers: DefendAnswer[] = [];
  for (const h of jobHeaderLines(added)) answers = recordJobOk(answers, h);
  answers = recordJobOk(answers, "- Load 12 outbound trucks a shift");
  const v = view({ resumeText: added, written: { resume: added, letter: "" }, defendAnswers: answers, keptTerms: ["Workplace Safety"] });
  assert.equal(v.state, "draft");
  assert.ok(v.openItems.some((i) => i.rule === "STD-T02" && i.line === "- Load 12 outbound trucks a shift"));
});

test("A, facts locked: a changed title is a title card on that job, never a one-tap Looks right", () => {
  const changed = WRITTEN.replace("Warehouse Associate | Midstate Distribution", "Warehouse Supervisor | Midstate Distribution");
  const header = "Warehouse Supervisor | Midstate Distribution | 8/2021 - Present";
  const v = view({ resumeText: changed, written: { resume: changed, letter: "" } });
  const g = v.groups.find((x) => x.line === header);
  assert.ok(g && !g.job, "no job tap on a header with a changed fact");
  assert.ok(g!.items.some((i) => i.kind === "title_unsaid" || i.kind === "scope_unsaid"));
  // A Looks right recorded on that header (a forged request) settles nothing.
  const forged = view({ resumeText: changed, written: { resume: changed, letter: "" }, defendAnswers: recordJobOk([], header), keptTerms: ["Workplace Safety"] });
  assert.equal(forged.state, "draft");
  assert.ok(forged.openItems.some((i) => i.line === header && i.kind !== "job_confirm"));
});

test("A, facts locked: a changed employer is held too (a title is hers only at her own employer)", () => {
  const changed = WRITTEN.replace("Line Cook | Corner Diner", "Line Cook | Harbor Grill");
  const v = view({ resumeText: changed, written: { resume: changed, letter: "" } });
  const g = v.groups.find((x) => x.line.startsWith("Line Cook | Harbor Grill"));
  assert.ok(g && !g.job, JSON.stringify(v.groups.map((x) => [x.line, x.items.map((i) => i.kind)])));
});

test("A, facts locked: a year she never gave, a credential she never named, a scope claim she never made", () => {
  const year = WRITTEN.replace("3/2018 - 7/2021", "3/2016 - 7/2021");
  assert.ok(view({ resumeText: year, written: { resume: year, letter: "" } }).openItems.some((i) => i.rule === "STD-T05"));
  const cred = WRITTEN.replace("EDUCATION", "CERTIFICATIONS\nForklift Certification\n\nEDUCATION");
  assert.ok(view({ resumeText: cred, written: { resume: cred, letter: "" } }).groups.some((g) => g.credentialName), "D4 memory prompt");
  const scope = WRITTEN.replace("- Load outbound trucks", "- Supervised the dock crew loading outbound trucks");
  assert.ok(view({ resumeText: scope, written: { resume: scope, letter: "" } }).groups.some((g) => g.scope), "scope card");
});

test("A applies only where the second check ran: otherwise the furthest lines are asked and there are no job taps", () => {
  const off = view({ grounding: { ...GROUNDING, verifierRan: false, verifierRanByDoc: { resume: false, cover_letter: false } } });
  assert.ok(off.status.defendLines.length >= 2);
  assert.ok(!off.groups.some((g) => g.job));
  assert.equal(factsLockedFor({ resume: WRITTEN, letter: "" }, null), false, "no grounding: strict");
  assert.equal(factsLockedFor(null, GROUNDING), false, "no writer's documents: strict");
  assert.equal(factsLockedFor({ resume: WRITTEN, letter: "" }, GROUNDING), true);
});

test("Looks right is one job's own confirmation: never the person's words, never another line's answer", () => {
  let answers: DefendAnswer[] = [];
  for (const h of jobHeaderLines(WRITTEN)) answers = recordJobOk(answers, h);
  const a = view({ defendAnswers: answers });
  const b = view();
  assert.equal(a.source, b.source, "the words checked against do not change");
  assert.ok(!a.source.includes(JOB_OK_ANSWER));
  // Recording it twice keeps one; a defend answer on the same line keeps it.
  const twice = recordJobOk(answers, jobHeaderLines(WRITTEN)[0]);
  assert.equal(twice.filter((x) => x.kind === "job_ok").length, 2);
  const withAnswer = recordAnswer(twice, jobHeaderLines(WRITTEN)[0], "Yes.", "stands");
  assert.equal(withAnswer.filter((x) => x.kind === "job_ok").length, 2);
  // A stored job tap comes back with its fixed words only, whatever was sent.
  const stored = readStoredFinish(
    {
      v: FINISH_STATE_VERSION,
      key: "k",
      docs: { resumeText: WRITTEN, coverLetterText: "", withheldLines: [], keepInsideLines: false, grounding: GROUNDING, written: { resume: WRITTEN, letter: "" } },
      defendAnswers: [{ line: jobHeaderLines(WRITTEN)[0], answer: "I supervised 40 people and hold a CDL", kind: "job_ok" }],
    },
    "k"
  );
  assert.deepEqual(stored!.defendAnswers, [{ line: jobHeaderLines(WRITTEN)[0], answer: JOB_OK_ANSWER, kind: "job_ok" }]);
});

test("Fix this: the job line retyped by the person settles that job; her own typed title is hers", () => {
  const header = jobHeaderLines(WRITTEN)[1];
  const r = applyRewrite(WRITTEN, [], header, "Prep Cook | Corner Diner | 3/2018 - 7/2021");
  assert.ok(r.changed);
  const v = view({ resumeText: r.text, defendAnswers: r.answers });
  assert.ok(!v.groups.some((g) => g.line === "Prep Cook | Corner Diner | 3/2018 - 7/2021"), JSON.stringify(v.groups.map((g) => [g.line, g.items.map((i) => i.kind)])));
  assert.equal(v.jobsOpen, 1);
});

test("D2: a number she adds herself through 'Add a number' finishes; nothing offers a figure", () => {
  let answers: DefendAnswer[] = [];
  for (const h of jobHeaderLines(WRITTEN)) answers = recordJobOk(answers, h);
  const base = cutTerm(WRITTEN, "Workplace Safety");
  const prompt = optionalNumberPrompts(base)[0];
  assert.equal(prompt.line, "- Load outbound trucks");
  const r = applyRewrite(base, answers, prompt.line, "Load 9 outbound trucks a shift");
  assert.ok(r.changed);
  const v = view({ resumeText: r.text, defendAnswers: r.answers });
  assert.equal(v.state, "finished", JSON.stringify(v.openItems.map((i) => `${i.rule} ${i.line}`)));
  // The prompt list never repeats a line with a number, and stops at three.
  assert.ok(!optionalNumberPrompts(r.text).some((p) => p.line === "- Load 9 outbound trucks a shift"));
  const many = `NAME\n\nWORK HISTORY\n${Array.from({ length: 6 }, (_, i) => `Cook | Diner ${i} | 2019 - 2020\n- Cooked on the grill`).join("\n")}`;
  assert.equal(optionalNumberPrompts(many).length, 3);
});

// ---- Q1: one path to a real resume -----------------------------------------------------------

test("Q1: 'I have one' goes to the writer; nothing is saved as the resume before it", () => {
  const comp = read("components/forge/lanes/FirstSave.tsx");
  const reward = comp.slice(comp.indexOf("export function FirstReward"), comp.indexOf("const EMPTY: FirstSection"));
  assert.ok(reward.length > 200);
  assert.doesNotMatch(reward, /useFirstSave|\/api\/lane-first|\/api\/revisions|saver\./, "no raw-upload revision is saved");
  assert.match(reward, /onBuild/);
  assert.match(reward, /updateSession\(\{ resumeText: next/, "the fix goes into the writer's source");
  const page = read("app/(forge)/resume/page.tsx");
  assert.match(page, /onBuild=\{\(\) => continueWith\(/);
  // The lanes path after the resume screen is the writer: processing, then output.
  const steps = decisionsToFirstSave("resume", "have_one");
  assert.ok(steps.length <= 3);
  assert.match(steps[2].options.join(" "), /build my resume/);
});

test("Q1: the lane home never sends a page saved as given into check mode; the writer builds it", () => {
  const raw = { status: "draft" as const, artifactId: "a1" };
  assert.deepEqual(laneHomeNext("resume", raw), { label: BUILD_WITH_TROY_LABEL, href: "/resume?rebuild=a1" });
  assert.deepEqual(laneHomeNext("resume", { ...raw, fromWriter: true }), { label: CHECK_AND_FINISH_LABEL, href: "/output?check=a1&cards=1" });
  assert.deepEqual(draftNext({ artifactId: "a b", fromWriter: false }).href, "/resume?rebuild=a%20b");
  assert.equal(rebuildHref("x"), "/resume?rebuild=x");
  // Round 3 (review r1 H1): the server says whether the writer made it (lib/source-kind.ts, tested in phase6-s1-rebuild).
  const home = read("components/lanes/LaneHome.tsx");
  assert.match(home, /fromWriter: r\.fromWriter === true/);
  assert.match(home, /draftNext\(rev\)\.href/);
});

test("Q1: a saved resume opens for the writer as the person's own, read as them, and the build runs", () => {
  const page = read("app/(forge)/resume/page.tsx");
  const block = page.slice(page.indexOf("const [rebuild, setRebuild]"), page.indexOf("// Phase 6 (Q1): opening a saved resume for the writer."));
  assert.match(block, /fetch\(`\/api\/revisions\/rebuild\?artifactId=\$\{encodeURIComponent\(rebuild\.id\)\}`/);
  // Round 3 (review r1 M3): the run's own resume text is never touched; the page is shown and is the starting text.
  assert.match(block, /updateSession\(\{\s+originalResumeText: page,\s+rebuild: \{ id: rebuild\.id, page, resumeAt: session\.resumeText \?\? "" \},/);
  const write = block.slice(block.indexOf("// A new build from that page"), block.indexOf('router.replace("/processing")'));
  assert.ok(write.length > 50);
  assert.doesNotMatch(write, /\bresumeText: /, "the run's (and the account's) resume text is not written");
  assert.match(block, /if \(!signedIn\)/);
  assert.match(block, /forgeOutput: undefined,\s+forgeFinish: undefined/);
  assert.match(block, /router\.replace\("\/processing"\)/);
  // The read is an owner-only revision route.
  assert.match(read("app/api/revisions/rebuild/route.ts"), /revisionCaller/);
});

test("Q1: check mode's main action is the writer; checking it as it is comes second", () => {
  const page = read("app/(forge)/output/page.tsx");
  const choice = page.slice(page.indexOf('data-testid="check-choice"'), page.indexOf('data-testid="check-as-is"'));
  assert.match(choice, /router\.push\(rebuildHref\(checkId\)\)/);
  assert.ok(choice.indexOf("REWRITE_WITH_TROY_LABEL") < choice.indexOf("setCheckAsIs(true)"), "rewrite is first");
  assert.match(page, /if \(checkChoosing && checkId\) \{/);
  assert.match(page, /useState\(\(\) => searchParams\.get\(CARDS_PARAM\) === "1"\)/, "the writer's own draft opens on its cards");
  assert.match(page, /onJobOk: \(group\) => setDefendAnswers\(\(a\) => recordJobOk\(a, group\.line\)\)/);
});

test("the checker version moved with the gate", () => {
  assert.match(read("lib/revision-status.ts"), /CHECKER_VERSION = "finish-gate-3\+pages-1\+receipt-1"/);
});

// gateRevision is the pure server gate; a version without the writer's receipt never finishes, taps or not.
test("taps never stand in for the writer's receipt", () => {
  let answers: DefendAnswer[] = [];
  for (const h of jobHeaderLines(WRITTEN)) answers = recordJobOk(answers, h);
  const input: RevisionInput = {
    docKind: "resume",
    lengthChoice: "auto",
    resumeText: cutTerm(WRITTEN, "Workplace Safety"),
    letterText: "",
    defendAnswers: answers,
    keptTerms: [],
    confirmedCredentials: [],
    evidence: {
      ownWords: UPLOAD,
      written: null,
      grounding: null,
      withheldLines: [],
      keepInsideLines: false,
      addedTerms: [],
      credentialCutRemnants: [],
      credentialsAnswer: "",
      credentialRows: [],
      ownResumeText: UPLOAD,
      writerReceipt: "",
      writerVerified: false,
    },
  };
  assert.equal(gateRevision(input, 1).status, "draft");
});
