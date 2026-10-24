/**
 * Phase 6 lane S2: rewording A (Troy 2026-10-11, "reword freely, facts locked").
 *
 * The rulebook tells every writer it may reword a line into what it means,
 * with numbers, titles, employers, dates, credentials and scope locked; the
 * deterministic scope check reads meaning, not the exact verb; and every
 * known heading spelling is a heading. Fixtures are fictional.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { RESUME_RULES, RESUME_RULES_VERSION, resumeRulesBlock } from "../resumeRules";
import { isSectionHeader } from "../pageFitShared";
import { scopeHitsNotTheirs, skillScopeNotTheirs } from "../scopeWords";

test("rulebook A: reword freely, facts locked; duty phrasing always rewritten", () => {
  assert.match(resumeRulesBlock("truth"), /Supervising people is scope/);
  // Integration L5: the rulebook and the writer prompt say the same thing about "responsible for" a shift.
  assert.match(resumeRulesBlock("truth"), /"Responsible for" a shift or an area is not a people claim by itself/);
  assert.match(resumeRulesBlock("truth"), /"Responsible for" a task or a thing \("the crew's safety gear", "cleaning the kitchen"\) never becomes supervising/);
  assert.doesNotMatch(resumeRulesBlock("truth"), /a shift, area, task or thing is never supervising people/);
  assert.match(resumeRulesBlock("truth"), /never an added size word \(large, heavy, major, daily\)/);
  assert.match(resumeRulesBlock("page"), /dates on every entry, in the form the person gave them/);
  assert.doesNotMatch(resumeRulesBlock("page"), /years on every entry/);
  assert.equal(RESUME_RULES_VERSION, "resume-rules/2026-10-11.1");
  const truth = resumeRulesBlock("truth");
  assert.match(truth, /Reword freely, facts locked/);
  for (const duty of ["responsible for", "duties included", "did", "dealt with", "in charge of"]) {
    assert.ok(truth.includes(`\"${duty}\"`), duty);
  }
  assert.match(truth, /is always rewritten into what the line means/);
  assert.match(truth, /strong, specific action verb and says what was done, in plain words a coworker would use; any amount or size only in the person's own numbers and words/);
  assert.doesNotMatch(truth, /its scale/);
  assert.match(truth, /same numbers, titles, employers, dates, credentials and scope/);
  assert.match(truth, /"helped" never becomes led/);
  assert.match(truth, /Anything new \(a number, a result, a tool, a skill\) is never added; it is asked/);
});

test("rulebook A: dates stay in the form the person gave; no years-only rewrite for gaps", () => {
  const truth = resumeRulesBlock("truth");
  assert.match(truth, /"8\/2021 - 12\/2022" stays "8\/2021 - 12\/2022", never "2021 - 2022"/);
  assert.doesNotMatch(truth, /use years only/i);
  assert.match(truth, /Never explain a gap/);
});

test("rulebook A: no objective ever; headline and a 2 to 4 sentence summary instead", () => {
  const page = resumeRulesBlock("page");
  assert.match(page, /No objective statement, ever/);
  assert.match(page, /headline/);
  assert.match(page, /summary of 2 to 4 plain sentences/);
});

test("rulebook A: soft-skill words never appear as skills", () => {
  const page = resumeRulesBlock("page");
  for (const w of ["hard worker", "team player", "fast learner", "detail oriented", "good communication"]) assert.ok(page.includes(w), w);
  assert.match(page, /never appear as skills, even when the person listed them/);
  assert.ok(RESUME_RULES.some((r) => r.id === "no-objective" && r.scope === "page"));
});

test("headings: every common spelling is a heading, in any case, with and or &", () => {
  for (const h of [
    "Work Experience", "WORK EXPERIENCE", "Experience", "Work History", "Employment", "Employment History",
    "Education", "Skills", "Certifications", "Summary", "Professional Summary", "Licenses and Certifications",
    "Certifications & Licenses", "Education and Training", "Objective", "Profile", "Key Skills", "Volunteer Work",
    "Education:", "work experience",
  ]) {
    assert.ok(isSectionHeader(h), h);
  }
  assert.equal(isSectionHeader("Warehouse Associate | Acme, 2023"), false);
  assert.equal(isSectionHeader("Ran the dish line"), false);
});

// ---- CC rulings H1 (round 2) and r2 (round 3): being over people is scope ---------------------------------

const RULING_FLAGGED: Array<[string, string]> = [
  // r1 reviewer probes.
  ["Supervised the crew.", "Responsible for the crew's safety gear."],
  ["Led the 3rd shift crew.", "Responsible for 3rd shift cleanup."],
  ["Supervised the kitchen.", "Responsible for cleaning the kitchen."],
  ["Oversaw store operations.", "I was responsible for opening the store."],
  ["Directed the department.", "Responsible for the department's trash."],
  ["Oversaw the night shift.", "Responsible for night shift paperwork."],
  ["Supervised residents.", "Responsible for the safety of residents."],
  ["Supervised the register.", "Took over the register when the cashier left."],
  ["Supervised the line crew.", "Ran the line."],
  ["Supervised forklift operators.", "Responsible for the forklift."],
  ["Oversaw forklift operations.", "Responsible for the forklift."],
  ["Supervised the 3rd shift crew.", "Responsible for 3rd shift."],
  ["Led the warehouse crew", "Helped the lead with the warehouse crew."],
  ["Managed the kitchen", "I ran the kitchen at night."],
  ["Trained the shift crew", "In charge of the guys on my shift."],
  ["Supervised the nursing staff", "In charge of the guys on my shift."],
  // r2 H-A: titles never say it, of any kind.
  ["Supervised the abatement crew.", "Lead Abatement Worker | Acme Environmental | 2019 - 2021\nRemoved lead paint from homes."],
  ["Led the paint removal crew in homes.", "Lead Abatement Worker | Acme Environmental | 2019 - 2021\nRemoved lead paint from homes."],
  ["Managed prospects and directed the calling team.", "Lead Generation Specialist | Beta Marketing | 2020 - 2022\nCalled prospects."],
  ["Managed the customer accounts team.", "Account Manager | Gamma Supply | 2018 - 2020\nKept customer accounts current."],
  ["Supervised customer account staff.", "Account Manager | Gamma Supply | 2018 - 2020\nKept customer accounts current."],
  ["Supervised client services staff.", "Case Manager | Delta Services | 2018 - 2020\nMet with clients weekly."],
  ["Supervised the bell staff and carried bags.", "Bell Captain | Hotel Rio | 2017 - 2019\nCarried bags."],
  ["Managed the entire Acme store and all shelf staff.", "Shift Lead | Acme | 2020 - 2022\nStocked shelves at Acme."],
  ["Supervised all Acme store employees.", "Shift Lead | Acme | 2020 - 2022\nStocked shelves at Acme."],
  ["Supervised third-shift production", "Production Supervisor | Acme | 2019 - 2021\nResponsible for 3rd shift."],
  ["Supervised third-shift production", "Machine Operator | Acme | 2019 - 2021\nResponsible for 3rd shift."],
  ["Supervised the press crew.", "Machine Operator | Acme Plant | 2016 - 2019\nRan the press.\nProduction Supervisor | Beta Works | 2019 - 2022\nScheduled orders for the press line."],
  // r2 H-B: "my crew" never says it.
  ["Supervised the crew loading trucks.", "My crew and I loaded trucks."],
  ["Supervised the crew.", "My crew lead trained me on the forklift."],
  ["Supervised the workers.", "I filed my workers' comp claim late."],
  ["Led the crew cleaning the warehouse.", "Me and my crew cleaned the warehouse."],
  ["Supervised the staff.", "I got along with my staff supervisor."],
  ["Supervised the crew", "Me and my crew loaded trucks."],
  // r2 ruling: "ran" is not one of the explicit verbs.
  ["Supervised the crew", "I ran a crew of 4."],
];
const RULING_CLEARED: Array<[string, string]> = [
  ["Supervised the shift crew", "In charge of employees on my shift."],
  ["Supervised the shift crew", "In charge of the guys on my shift."],
  ["Supervised 4 workers.", "I supervised 4 workers."],
  ["Supervised the crew", "I led a crew of 6."],
  ["Led the dock crew", "I was in charge of the dock crew."],
  ["Supervised the new hires", "I managed 5 new hires."],
  // Their own claim, the very same verb: not a rewording.
  ["Ran the store when the manager was out", "I ran the store when the manager was out."],
];

test("r2 ruling: being over people clears only on an explicit verb with people in their own words", () => {
  for (const [line, src] of RULING_FLAGGED) assert.ok(scopeHitsNotTheirs(line, src).length > 0, `should ask: ${line} <= ${src}`);
  for (const [line, src] of RULING_CLEARED) assert.deepEqual(scopeHitsNotTheirs(line, src), [], `should clear: ${line} <= ${src}`);
});

test("r2 ruling: their words for THAT job; another job's supervision never clears this one", () => {
  const two = "Shift Supervisor | Acme | 2019 - 2021\nSupervised 4 workers.\nStocker | Corner Mart | 2016 - 2019\nStocked shelves.";
  assert.deepEqual(scopeHitsNotTheirs("Supervised the workers.", two, { job: "SHIFT SUPERVISOR | Acme | 2019 - 2021" }), []);
  assert.ok(scopeHitsNotTheirs("Supervised the workers.", two, { job: "STOCKER | Corner Mart | 2016 - 2019" }).length > 0);
});

test("r2 ruling: managed a thing is not a people claim; managed people is", async () => {
  const { isPeopleScopeHit, scopeHits } = await import("../scopeWords");
  assert.equal(scopeHits("Managed inventory for the dock.").some(isPeopleScopeHit), false);
  assert.equal(scopeHits("Managed 5 employees.").some(isPeopleScopeHit), true);
  assert.equal(scopeHits("Supervised the shift crew.").some(isPeopleScopeHit), true);
});

test("r2 L-1: 'trained them' is a claim of training people", () => {
  assert.ok(scopeHitsNotTheirs("Supervised the shift crew and trained them.", "In charge of the guys on my shift.").some((h) => h.family === "train"));
});

test("r2 ruling: the one-tap answer settles that line only", async () => {
  const { scopeAllNotTheirsAnswered } = await import("../resumeStatus");
  const { OVER_PEOPLE_YES, ownLineFor } = await import("../scopeWords");
  const src = "Forklift Driver | Northgate | 2019 - 2021\nResponsible for 3rd shift.";
  const line = "- Supervised the 3rd shift crew.";
  assert.ok(scopeAllNotTheirsAnswered(line, src, []).length > 0);
  const yes = [{ line, answer: OVER_PEOPLE_YES, kind: "scope_yes" as const, family: "supervise" }];
  assert.deepEqual(scopeAllNotTheirsAnswered(line, src, yes), []);
  assert.ok(scopeAllNotTheirsAnswered("- Supervised the dock crew.", src, yes).length > 0, "never another line");
  // "No, I did the work" puts their own line back.
  assert.equal(ownLineFor(line, src, { job: "FORKLIFT DRIVER | Northgate | 2019 - 2021" }), "Responsible for 3rd shift.");
  // Round 4 (r3 M3-2): never without knowing the job.
  assert.equal(ownLineFor(line, src), undefined);
});

test("H1: the mint check's skills reading agrees (scope words read the same everywhere)", async () => {
  const { runMintCheck } = await import("../resumeMintCheckShared");
  const page = (skills: string) => `DANA EXAMPLE\n\nSKILLS\n${skills}\n\nPROFESSIONAL EXPERIENCE\nWELDER | Shop | 2019 - 2023\n- Welded steel.`;
  const flagged = (src: string, term: string) =>
    runMintCheck({ output: page(term + ", Welding"), source: `Dana Example\nWelded steel.\n${src}`, kind: "resume" }).findings.some((f) => f.line === term && f.kind === "grid_scope_term");
  assert.ok(flagged("I ran the kitchen at night.", "Kitchen supervision"));
  assert.ok(flagged("Responsible for 3rd shift.", "Shift supervision"));
  // Fix lane check (2026-10-24, Valjean walk defect 3): a skills term names a kind of work, not one job's
  // people, so it is read by the skills-term rule (skillScopeNotTheirs): the person's own explicit claim of
  // the same family over people covers it. The same rule everywhere a skills term is read.
  for (const [src, term] of [["In charge of the guys on my shift.", "Crew supervision"], ["I supervised the crew.", "Crew supervision"]]) {
    assert.equal(flagged(src, term), skillScopeNotTheirs(term, `Dana Example\nWelded steel.\n${src}`).length > 0, term);
  }
  assert.equal(flagged("I supervised the crew.", "Crew supervision"), false, "their own explicit supervision covers the skill");
  assert.equal(flagged("In charge of the guys on my shift.", "Crew supervision"), true, "another family (lead) is still asked");
  assert.equal(flagged("I was a crew supervisor.", "Crew supervision"), true, "a title is never the claim");
  assert.equal(flagged("I want to supervise a crew someday.", "Crew supervision"), true, "a goal is never the claim");
});

// ---- Round 4 (review r3, CC rulings) ------------------------------------------------------------------------

test("r3 H3-1: the same verb clears people scope only with the very same object", () => {
  const asked: Array<[string, string]> = [
    ["I ran the line.", "- Ran the line crew."],
    ["I ran the floor at night.", "- Ran the floor staff at night."],
    ["I ran the store.", "- Ran the store crew."],
    ["I managed the crew's schedule.", "- Managed the crew."],
    ["I directed the crew's trucks into the dock.", "- Directed the crew."],
    ["I led the team's safety huddle.", "- Led the team."],
    ["I supervised the crew's lunch breaks.", "- Supervised the crew."],
    ["I headed up the dock.", "- Headed up the dock crew."],
    ["I ran the kitchen on weekends.", "- Ran the kitchen staff on weekends."],
    ["I ran errands for the crew.", "- Ran the crew."],
    ["I ran the register for the store.", "- Ran the store."],
    ["I managed the night shift.", "- Managed the night shift crew."],
    ["I led stretches for the crew every morning.", "- Led the crew every morning."],
    ["I oversaw the trucks.", "- Oversaw the truck drivers."],
  ];
  for (const [src, line] of asked) assert.ok(scopeHitsNotTheirs(line, src).length > 0, `should ask: ${line} <= ${src}`);
  assert.deepEqual(scopeHitsNotTheirs("- Ran the store.", "I ran the store."), []);
  assert.deepEqual(scopeHitsNotTheirs("- Ran the dock crew on nights", "I basically ran the dock crew on nights."), []);
});

test("r3 M3-1: people scope is asked when the page job is not exactly one of theirs", () => {
  const two = "Production Supervisor | Beta Works | 2019 - 2022\nSupervised 6 press operators.\nMachine Operator | Acme Plant | 2016 - 2019\nRan the press.";
  for (const job of ["MACHINE OPERATOR | Acme Plant | 2016 - 2019", "MACHINE OPERATOR | Acme | 2016 - 2019", "PRESS OPERATOR | Acme Plant | 2016 - 2019", "MACHINE OPERATOR | Acme Plant, Inc. | 2016 - 2019", "FORKLIFT DRIVER | Nowhere | 2010 - 2011"]) {
    assert.ok(scopeHitsNotTheirs("- Supervised the press operators.", two, { job }).length > 0, job);
  }
  assert.deepEqual(scopeHitsNotTheirs("- Supervised the press operators.", two, { job: "PRODUCTION SUPERVISOR | Beta Works | 2019 - 2022" }), []);
  // A rehire: the dates tell the two stints apart; the stint without supervision is asked.
  const same = "Stocker | Corner Mart | 2014 - 2015\nStocked shelves.\nStocker | Corner Mart | 2017 - 2019\nSupervised 3 pickers on nights.";
  assert.ok(scopeHitsNotTheirs("- Supervised the pickers.", same, { job: "STOCKER | Corner Mart | 2014 - 2015" }).length > 0);
  assert.deepEqual(scopeHitsNotTheirs("- Supervised the pickers.", same, { job: "STOCKER | Corner Mart | 2017 - 2019" }), []);
  // The page's own copy of another job's sentence is not theirs for this job.
  assert.ok(scopeHitsNotTheirs("- Supervised 6 press operators.", two, { job: "MACHINE OPERATOR | Acme Plant | 2016 - 2019" }).length > 0);
});

test("r3 M3-2: 'No, I did the work' comes only from the same job, never a people line, never a guess", async () => {
  const { ownLineFor } = await import("../scopeWords");
  const two = "Production Supervisor | Beta Works | 2019 - 2022\nSupervised 6 press operators.\nMachine Operator | Acme Plant | 2016 - 2019\nRan the press.";
  assert.equal(ownLineFor("- Supervised the press operators.", two, { job: "MACHINE OPERATOR | Acme Plant | 2016 - 2019" }), "Ran the press.");
  assert.equal(ownLineFor("- Supervised the press operators.", two, { job: "PRESS OPERATOR | Acme Plant | 2016 - 2019" }), undefined);
  assert.equal(ownLineFor("- Supervised the press operators.", two, { job: "PRODUCTION SUPERVISOR | Beta Works | 2019 - 2022" }), undefined, "never a people line");
  assert.equal(ownLineFor("- Led the crew.", "Laborer | X Co | 2020 - 2021\nDug trenches.", { job: "LABORER | X Co | 2020 - 2021" }), undefined);
});

test("r3 M3-3: one Yes is one line in one job", async () => {
  const { scopeAllNotTheirsAnswered } = await import("../resumeStatus");
  const { OVER_PEOPLE_YES } = await import("../scopeWords");
  const src = "Forklift Driver | Northgate | 2021 - 2022\nDrove forklift.\nCashier | Mart | 2018 - 2020\nRan the register.";
  const a = "FORKLIFT DRIVER | Northgate | 2021 - 2022";
  const b = "CASHIER | Mart | 2018 - 2020";
  const yes = [{ line: "- Supervised the crew.", answer: OVER_PEOPLE_YES, kind: "scope_yes" as const, family: "supervise", job: a }];
  assert.deepEqual(scopeAllNotTheirsAnswered("- Supervised the crew.", src, yes, { job: a }), []);
  assert.ok(scopeAllNotTheirsAnswered("- Supervised the crew.", src, yes, { job: b }).length > 0);
});

test("r3 L3-3: people behind any looking-after verb is a people claim", async () => {
  const { scopeHits, isPeopleScopeHit } = await import("../scopeWords");
  assert.ok(scopeHits("Handled the new hires.").some(isPeopleScopeHit));
  assert.ok(scopeHitsNotTheirs("Handled the new hires.", "Responsible for the new hires.").length > 0);
  assert.deepEqual(scopeHits("Took care of the kitchen.").filter(isPeopleScopeHit), []);
});
