/**
 * Phase 6 (Troy 2026-10-11, rewording A): t.ROY may reword any line; the
 * facts are locked. With `factsLocked`, a reworded line whose facts trace
 * back is not asked about; every fact check still runs. Fictional text only.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { getResumeStatus, numbersInContext } from "../resumeStatus";

const SOURCE = `Jordan Example
Line cook at Lakeside Grill from 2019 to 2023.
I ran the grill, about 40 covers an hour, for 3 years.
I prepped vegetables before open.`;

const PAGE = `JORDAN EXAMPLE

PROFESSIONAL EXPERIENCE
Line Cook | Lakeside Grill | 2019 - 2023
- Worked the grill at 40 covers an hour across 3 years
- Handled vegetable prep ahead of opening`;

test("numbers keep their meaning: the same value counting another thing is a changed fact", () => {
  assert.equal(numbersInContext("- Worked the grill at 40 covers an hour across 3 years", SOURCE), true);
  assert.equal(numbersInContext("- Worked the grill at 3 covers an hour across 40 years", SOURCE), false);
  assert.equal(numbersInContext("- Fed 50 guests", SOURCE), false, "a number she never gave");
  // Her own retype: the number she typed is hers; a written number kept in it is still read in context.
  const typed = { line: "Fed 9 guests a shift", answer: "Fed 9 guests a shift", verdict: "stands" as const, kind: "rewrite" as const, replaced: "- Fed guests" };
  assert.equal(numbersInContext("Fed 9 guests a shift", `${SOURCE}\n\n9`, typed), true);
  const kept = { ...typed, line: "Fed 3 guests", answer: "Fed 3 guests", replaced: "- Fed 3 guests" };
  assert.equal(numbersInContext("Fed 3 guests", SOURCE, kept), false);
});

test("factsLocked: reworded lines are not asked; the strict rule still asks the furthest lines", () => {
  const strict = getResumeStatus({ resumeText: PAGE, sourceText: SOURCE });
  assert.ok(strict.defendLines.length >= 2);
  const locked = getResumeStatus({ resumeText: PAGE, sourceText: SOURCE, factsLocked: true });
  assert.deepEqual(locked.defendLines, []);
  assert.equal(locked.state, "finished");
});

test("factsLocked: every fact check still runs", () => {
  const moved = PAGE.replace("40 covers an hour across 3 years", "3 covers an hour across 40 years");
  assert.ok(getResumeStatus({ resumeText: moved, sourceText: SOURCE, factsLocked: true }).openItems.some((i) => i.rule === "STD-C04" && i.line.includes("3 covers")));
  const year = PAGE.replace("2019 - 2023", "2017 - 2023");
  assert.ok(getResumeStatus({ resumeText: year, sourceText: SOURCE, factsLocked: true }).openItems.some((i) => i.rule === "STD-T05"));
  const title = PAGE.replace("Line Cook | Lakeside Grill", "Kitchen Manager | Lakeside Grill");
  assert.ok(getResumeStatus({ resumeText: title, sourceText: SOURCE, factsLocked: true }).openItems.some((i) => i.kind === "title_unsaid" || i.kind === "scope_unsaid"));
  const number = PAGE.replace("- Handled vegetable prep ahead of opening", "- Handled vegetable prep for 200 plates ahead of opening");
  assert.ok(getResumeStatus({ resumeText: number, sourceText: SOURCE, factsLocked: true }).openItems.some((i) => i.rule === "STD-T02"));
  const scope = PAGE.replace("- Handled vegetable prep ahead of opening", "- Supervised vegetable prep ahead of opening");
  assert.ok(getResumeStatus({ resumeText: scope, sourceText: SOURCE, factsLocked: true }).openItems.some((i) => i.kind === "scope_unsaid"));
});

test("a job tap is never an answer for a line", () => {
  const moved = PAGE.replace("40 covers an hour across 3 years", "3 covers an hour across 40 years");
  const line = "- Worked the grill at 3 covers an hour across 40 years";
  const s = getResumeStatus({ resumeText: moved, sourceText: SOURCE, factsLocked: true, defendAnswers: [{ line, answer: "Looks right", kind: "job_ok" }] });
  assert.ok(s.openItems.some((i) => i.line === line));
});

// ---- round 3 (review r1 M1, L3, unread lines) ----

import { dateTokensOf, datesAsGiven, yearUsedAsCount } from "../resumeStatus";

test("round 3: dates are read as written; a year is never a count", () => {
  assert.deepEqual(dateTokensOf("Cook | Diner | 8/2021 - Present"), ["8/2021", "present"]);
  assert.equal(datesAsGiven("3/2021 - Present", "8/2021 - Present\n3/2018 - 7/2021"), false);
  assert.equal(datesAsGiven("2021 - Present", "8/2021 - Present"), false, "a dropped month is a changed date");
  assert.equal(yearUsedAsCount("- Fed 2019 guests", SOURCE), true);
  assert.equal(yearUsedAsCount("- Worked the grill since 2019", SOURCE), false);
});

test("round 3: under factsLocked, a job header the gate cannot read gets the stricter reading, never zero checks", () => {
  const comma = PAGE.replace("Line Cook | Lakeside Grill | 2019 - 2023", "Line Cook, Harbor Grill Group, 2019 - 2023");
  const s = getResumeStatus({ resumeText: comma, sourceText: SOURCE, factsLocked: true });
  assert.ok(s.defendLines.some((d) => d.line.startsWith("Line Cook, Harbor Grill Group")), JSON.stringify(s.defendLines));
});

test("round 3: under factsLocked, a line the second check never read is asked when it is not in their words", () => {
  const extra = `${PAGE}\n- Ran the fryer station for catering events`;
  const s = getResumeStatus({ resumeText: extra, sourceText: SOURCE, factsLocked: true, checkedText: PAGE });
  assert.ok(s.defendLines.some((d) => d.line === "- Ran the fryer station for catering events"));
  assert.deepEqual(getResumeStatus({ resumeText: PAGE, sourceText: SOURCE, factsLocked: true, checkedText: PAGE }).defendLines, []);
});
