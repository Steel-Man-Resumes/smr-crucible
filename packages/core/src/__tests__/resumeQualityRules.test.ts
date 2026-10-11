/**
 * Phase 6 S3: the SMR quality rules (what a Steel Man reader marks on a page
 * that is true but weak). Fictional people and places only.
 *
 * Run: npm test (node --import tsx --test)
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { runQualityCheck, QUALITY_RULES, type QualityFinding } from "../resumeQualityRules";

// The kind of page Troy saw on the preview run: an objective, a list of
// character words, duty lines, and job lines that are not bullets.
const WEAK_PAGE = `Dana Whitfield
Lakeview, OH | dana.whitfield@example.com

OBJECTIVE
Seeking a position with a growing company where I can use my skills and grow.

Work Experience
Shift Lead | Copperline Foods | Lakeview, OH | 8/2021 - 12/2022
Responsible for 3rd shift.
Did safety audits.
- Customer service
- Cleaning

Packer | Bluegate Supply | Lakeview, OH | 2019 - 2021
In charge of the packing line and dealt with returns from stores.

SKILLS
Hard worker, team player, fast learner, detail oriented, good communication

EDUCATION
High school diploma, Lakeview High School, 2018`;

// A strong page in the same trade: headline, a summary with facts only this
// person has, real skills, action bullets, plain headings.
const STRONG_PAGE = `Rafael Ocampo
Lakeview, OH | rafael.ocampo@example.com

SUMMARY
Third-shift lead at a food plant with five years on packing and production lines.
Trained new packers and ran the line's safety walk every week.

SKILLS
Pallet jack, case sealer, shrink wrap machine, RF scanner, lockout tagout

EXPERIENCE
Shift Lead | Copperline Foods | Lakeview, OH | 8/2021 - 12/2022
- Supervised a 9-person third-shift packing crew.
- Ran the weekly safety walk and logged what needed fixing.
- Trained 6 new packers on the case sealer.

Packer | Bluegate Supply | Lakeview, OH | 2019 - 2021
- Packed and labeled store orders on a 3-person line.
- Checked returns against the pick sheet and restocked them.

EDUCATION
High school diploma, Lakeview High School, 2018`;

const byRule = (fs: QualityFinding[], rule: string) => fs.filter((f) => f.rule === rule);
const lineOf = (fs: QualityFinding[], rule: string) => byRule(fs, rule).map((f) => f.line);

test("a strong page yields no quality findings", () => {
  assert.deepEqual(runQualityCheck(STRONG_PAGE), []);
});

test("no page, or a fragment, yields nothing", () => {
  assert.deepEqual(runQualityCheck(""), []);
  assert.deepEqual(runQualityCheck("   \n "), []);
  assert.deepEqual(runQualityCheck("Dana Whitfield\nLakeview, OH"), []);
  assert.deepEqual(runQualityCheck(undefined as unknown as string), []);
});

test("the weak page: objective, soft skills, duty lines, weak bullets, heading", () => {
  const fs = runQualityCheck(WEAK_PAGE);
  assert.deepEqual(lineOf(fs, "objective"), ["Seeking a position with a growing company where I can use my skills and grow."]);
  assert.deepEqual(lineOf(fs, "soft_skill_list"), ["Hard worker, team player, fast learner, detail oriented, good communication"]);
  assert.deepEqual(lineOf(fs, "duty_phrasing"), [
    "Responsible for 3rd shift.",
    "Did safety audits.",
    "In charge of the packing line and dealt with returns from stores.",
  ]);
  assert.deepEqual(lineOf(fs, "weak_bullet"), ["- Customer service", "- Cleaning"]);
  assert.deepEqual(lineOf(fs, "heading"), ["Work Experience"], "the one heading styled unlike the rest");
  // An objective already says the top is wrong: no second "no summary" note.
  assert.equal(byRule(fs, "summary").length, 0);
});

test("findings come in page order, one per line, each line exactly as on the page", () => {
  const fs = runQualityCheck(WEAK_PAGE);
  const raw = WEAK_PAGE.split("\n").map((l) => l.trim());
  const idx = fs.map((f) => raw.indexOf(f.line));
  for (const i of idx) assert.ok(i >= 0);
  for (let k = 1; k < idx.length; k++) assert.ok(idx[k] > idx[k - 1], "page order");
  assert.equal(new Set(fs.map((f) => f.line)).size, fs.length);
});

test("every why is plain t.ROY: short, no rule codes, no long dashes, no new digits", () => {
  const fs = [...runQualityCheck(WEAK_PAGE), ...runQualityCheck(NO_HEADING_PAGE), ...runQualityCheck(GENERIC_TOP)];
  assert.ok(fs.length >= 10);
  for (const f of fs) {
    assert.ok((QUALITY_RULES as readonly string[]).includes(f.rule), f.rule);
    assert.ok(f.severity === "weak" || f.severity === "missing");
    assert.ok(f.why.length <= 200, f.why);
    const sentences = f.why.split(/(?<=[.!?])\s+/).filter(Boolean);
    assert.ok(sentences.length >= 1 && sentences.length <= 3, f.why);
    assert.doesNotMatch(f.why, /[\u2013\u2014]|-{2}/, f.why);
    assert.doesNotMatch(f.why, /STD-|\bBLOCK\b|\bFIX\b|\bmint\b/, f.why);
    for (const d of f.why.match(/\d/g) ?? []) assert.ok(f.line.includes(d), `why adds digit ${d}`);
    assert.doesNotMatch(f.why, /\bfelon|ex-con|offender\b/i);
  }
});

const NO_HEADING_PAGE = `Corey Banks
Fairmont, WV | (304) 555-0142

Line Cook, Hilltop Diner, 2020 - 2023
I cooked breakfast and lunch on the flat top and kept the walk-in stocked for the next shift.
Cut and prepped vegetables every morning.

Skills: dependable, reliable, punctual, honest`;

test("jobs with no heading over them; sentences instead of bullets; inline skills label", () => {
  const fs = runQualityCheck(NO_HEADING_PAGE);
  assert.deepEqual(lineOf(fs, "heading"), ["Line Cook, Hilltop Diner, 2020 - 2023"]);
  assert.equal(byRule(fs, "heading")[0].severity, "missing");
  assert.deepEqual(lineOf(fs, "bullets"), ["I cooked breakfast and lunch on the flat top and kept the walk-in stocked for the next shift."]);
  assert.deepEqual(lineOf(fs, "soft_skill_list"), ["Skills: dependable, reliable, punctual, honest"]);
});

test("an unclear heading of the person's own words is named, not called missing", () => {
  const fs = runQualityCheck(`Corey Banks
Fairmont, WV

Places I've Worked:
Line Cook, Hilltop Diner, 2020 - 2023
- Cooked breakfast and lunch on the flat top.`);
  assert.deepEqual(lineOf(fs, "heading"), ["Places I've Worked:"]);
  assert.equal(byRule(fs, "heading")[0].severity, "weak");
});

const GENERIC_TOP = `Mia Torres
Brookside, NM | mia.torres@example.com

SUMMARY
Hard-working, dedicated team player and fast learner with a strong work ethic.

EXPERIENCE
Cashier | Corner Mart | Brookside, NM | 2021 - 2024
- Ran the register on the evening shift.
- Counted the drawer at close and filled out the deposit slip.`;

test("a summary that fits anybody is marked; one with this person's facts is not", () => {
  const fs = runQualityCheck(GENERIC_TOP);
  assert.deepEqual(lineOf(fs, "generic_summary"), ["Hard-working, dedicated team player and fast learner with a strong work ethic."]);
  const ok = GENERIC_TOP.replace(
    "Hard-working, dedicated team player and fast learner with a strong work ethic.",
    "Cashier with three years on the evening shift at Corner Mart, closing the drawer every night."
  );
  assert.deepEqual(runQualityCheck(ok), []);
  // One generic word next to this person's own facts is fine.
  const one = GENERIC_TOP.replace(
    "Hard-working, dedicated team player and fast learner with a strong work ethic.",
    "Dependable cashier who closed the drawer at Corner Mart every night."
  );
  assert.deepEqual(lineOf(runQualityCheck(one), "generic_summary"), []);
});

test("no summary or headline at all is marked as missing, at the first heading", () => {
  const fs = runQualityCheck(GENERIC_TOP.replace(/SUMMARY\n.*\n\n/, ""));
  assert.deepEqual(byRule(fs, "summary"), [
    { rule: "summary", line: "EXPERIENCE", why: byRule(fs, "summary")[0].why, severity: "missing" },
  ]);
  // A one-line headline under the name counts as the top.
  const withHeadline = GENERIC_TOP.replace(/SUMMARY\n.*\n\n/, "").replace(
    "mia.torres@example.com\n",
    "mia.torres@example.com\nCashier and Evening Closer\n"
  );
  assert.deepEqual(byRule(runQualityCheck(withHeadline), "summary"), []);
});

test("an objective sentence under the name is caught without a heading", () => {
  const fs = runQualityCheck(`Lee Park
Ridgeway, KS | lee.park@example.com
Looking for a full-time job where I can grow with the company.

EXPERIENCE
Stocker | Ridge Foods | 2020 - 2022
- Unloaded the truck and stocked the dairy aisle.`);
  assert.deepEqual(lineOf(fs, "objective"), ["Looking for a full-time job where I can grow with the company."]);
});

test("a skills list with one character word among real skills is not marked", () => {
  const page = STRONG_PAGE.replace("lockout tagout", "lockout tagout, dependable");
  assert.deepEqual(runQualityCheck(page), []);
});

test("bullets with an action or a count pass; title and place lines are not sentences", () => {
  const page = `Sam Ortiz
Elm City, TX | sam.ortiz@example.com
Forklift Operator and Shipping Clerk

EXPERIENCE
Forklift Operator
Northgate Distribution, Elm City, TX
2019 - 2023
- Loaded 40 trailers a week.
- Forklift
- Picked and staged orders for morning trucks.
- Swept the dock at close.`;
  const fs = runQualityCheck(page);
  assert.deepEqual(lineOf(fs, "weak_bullet"), ["- Forklift"]);
  assert.deepEqual(lineOf(fs, "bullets"), []);
});

test("rule ids shared with the writer's change list", () => {
  for (const id of ["objective", "duty_phrasing", "soft_skill_list", "heading", "summary"]) {
    assert.ok((QUALITY_RULES as readonly string[]).includes(id), id);
  }
});
