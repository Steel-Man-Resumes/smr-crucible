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
import { sameScopeMeaning, scopeHitsNotTheirs } from "../scopeWords";

test("rulebook A: reword freely, facts locked; duty phrasing always rewritten", () => {
  assert.equal(RESUME_RULES_VERSION, "resume-rules/2026-10-11.1");
  const truth = resumeRulesBlock("truth");
  assert.match(truth, /Reword freely, facts locked/);
  for (const duty of ["responsible for", "duties included", "did", "dealt with", "in charge of"]) {
    assert.ok(truth.includes(`\"${duty}\"`), duty);
  }
  assert.match(truth, /is always rewritten into what the line means/);
  assert.match(truth, /strong, specific action verb and says what was done and its scale/);
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

test("scope by meaning: in charge of / responsible for people clears supervised, same people", () => {
  assert.equal(sameScopeMeaning("lead", "supervise"), true);
  assert.equal(sameScopeMeaning("responsible", "supervise"), true);
  assert.equal(sameScopeMeaning("lead", "manage"), false);
  assert.equal(sameScopeMeaning("supervise", "train"), false);
  assert.deepEqual(scopeHitsNotTheirs("Supervised the shift crew", "In charge of the guys on my shift."), []);
  assert.deepEqual(scopeHitsNotTheirs("Supervised the 3rd shift crew", "Responsible for 3rd shift."), []);
});

test("scope by meaning: inflation is still caught (helped never becomes led, ran never becomes managed or trained)", () => {
  assert.ok(scopeHitsNotTheirs("Led the warehouse crew", "Helped the lead with the warehouse crew.").length > 0);
  assert.ok(scopeHitsNotTheirs("Managed the kitchen", "I ran the kitchen at night.").length > 0);
  assert.ok(scopeHitsNotTheirs("Trained the shift crew", "In charge of the guys on my shift.").length > 0);
  // The same verb about different people is still not theirs.
  assert.ok(scopeHitsNotTheirs("Supervised the nursing staff", "In charge of the guys on my shift.").length > 0);
});
