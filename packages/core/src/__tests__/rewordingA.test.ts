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
import { scopeHitsNotTheirs } from "../scopeWords";

test("rulebook A: reword freely, facts locked; duty phrasing always rewritten", () => {
  assert.match(resumeRulesBlock("truth"), /Supervising people is scope/);
  assert.match(resumeRulesBlock("truth"), /"Responsible for\" a shift, area, task or thing is never supervising people|Responsible for" a shift, area, task or thing is never supervising people/);
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

// ---- CC ruling H1 (round 2): supervising people is scope ------------------------------------------

const RULING_FLAGGED: Array<[string, string]> = [
  // Reviewer probes: each was flagged at base and must stay flagged.
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
  // The ruling's own cases.
  ["Supervised third-shift production", "Machine Operator | Acme | 2019 - 2021\nResponsible for 3rd shift."],
  ["Supervised the 3rd shift crew.", "Responsible for 3rd shift."],
  ["Led the warehouse crew", "Helped the lead with the warehouse crew."],
  ["Managed the kitchen", "I ran the kitchen at night."],
  ["Trained the shift crew", "In charge of the guys on my shift."],
  ["Supervised the nursing staff", "In charge of the guys on my shift."],
];
const RULING_CLEARED: Array<[string, string]> = [
  ["Supervised the shift crew", "In charge of employees on my shift."],
  ["Supervised the shift crew", "In charge of the guys on my shift."],
  ["Supervised the crew", "I ran a crew of 4."],
  ["Supervised the crew", "Me and my crew loaded trucks."],
  ["Supervised third-shift production", "Production Supervisor | Acme | 2019 - 2021\nResponsible for 3rd shift."],
  ["Supervised 4 workers.", "I supervised 4 workers."],
];

test("H1: supervising people needs people in their words or a supervisor title on that job", () => {
  for (const [line, src] of RULING_FLAGGED) assert.ok(scopeHitsNotTheirs(line, src).length > 0, `should flag: ${line} <= ${src}`);
  for (const [line, src] of RULING_CLEARED) assert.deepEqual(scopeHitsNotTheirs(line, src), [], `should clear: ${line} <= ${src}`);
});

test("H1: the title path is per job; a line that could belong to a non-supervisor job is never cleared", () => {
  const two = "Production Supervisor | Acme | 2019 - 2021\nResponsible for 3rd shift.\nMachine Operator | Beta Works | 2016 - 2019\nRan the press on 3rd shift.";
  assert.ok(scopeHitsNotTheirs("Supervised third-shift production", two).length > 0, "shift is in both jobs: ambiguous");
  assert.deepEqual(scopeHitsNotTheirs("Supervised production for Acme", two), []);
  assert.ok(scopeHitsNotTheirs("Supervised press operators at Beta Works", two).length > 0);
  assert.ok(scopeHitsNotTheirs("Supervised production", "Supervisor Trainee | Acme | 2019 - 2021\nProduction work.").length > 0, "a trainee title is not over people");
});

test("H1: the mint check's skills reading agrees (scope words read the same everywhere)", async () => {
  const { runMintCheck } = await import("../resumeMintCheckShared");
  const page = (skills: string) => `DANA EXAMPLE\n\nSKILLS\n${skills}\n\nPROFESSIONAL EXPERIENCE\nWELDER | Shop | 2019 - 2023\n- Welded steel.`;
  const flagged = (src: string, term: string) =>
    runMintCheck({ output: page(term + ", Welding"), source: `Dana Example\nWelded steel.\n${src}`, kind: "resume" }).findings.some((f) => f.line === term && f.kind === "grid_scope_term");
  assert.ok(flagged("I ran the kitchen at night.", "Kitchen supervision"));
  assert.ok(flagged("Responsible for 3rd shift.", "Shift supervision"));
  for (const [src, term] of [["In charge of the guys on my shift.", "Crew supervision"], ["I supervised the crew.", "Crew supervision"]]) {
    assert.equal(flagged(src, term), scopeHitsNotTheirs(term, `Dana Example\nWelded steel.\n${src}`).length > 0, term);
  }
});
