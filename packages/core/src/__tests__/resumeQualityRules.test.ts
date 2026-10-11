/**
 * Phase 6 S3: the SMR quality rules (what a Steel Man reader marks on a page
 * that is true but weak). Fictional people and places only.
 *
 * Run: npm test (node --import tsx --test)
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { runQualityCheck, pageLooksStrong, QUALITY_RULES, type QualityFinding } from "../resumeQualityRules";

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
    { rule: "summary", line: "EXPERIENCE", why: byRule(fs, "summary")[0].why, severity: "missing", occurrence: 0 },
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

// ---- Round 2 (review s3 r1): one regression test per finding ---------------
// Fictional pages, most from the reviewer's probes.
const R2: Record<string, string> = {
H1_bare: `Pat Example
Billings, MT | pat.example@example.com
Cashier and Stocker

EXPERIENCE
Cashier at Safeway | 2019 - 2022
Cooking
Cleaning
Register`,
H2_trades: `Rick Example
Great Falls, MT | rick.example@example.com

SUMMARY
Heavy equipment operator with eight years on road and site crews.

EXPERIENCE
Equipment Operator | Ridge Paving | Great Falls, MT | 2016 - 2024
- Ran the roller and paver on county road jobs.
- Loaded and hauled base gravel with a 10-wheel dump truck.

EQUIPMENT
- Skid steer
- Telehandler
- Excavator

SKILLS & CERTIFICATIONS
- Blueprint reading
- Forklift certified

ACCOMPLISHMENTS
- Zero lost-time injuries`,
H3_headers: `Lou Example
Helena, MT | lou.example@example.com
Office Assistant

EXPERIENCE
Office Assistant
Montana Department of Fish, Wildlife and Parks
2020 - 2023
- Answered the front desk phones and routed calls.
- Filed license applications by county.

Cook at the Elks Lodge
2017 - 2020
- Cooked the Friday fish fry for the lodge dinner.
- Kept the walk-in stocked and dated.`,
M1_cna: `Ana Example
Missoula, MT | ana.example@example.com
Certified Nursing Assistant

EXPERIENCE
CNA | Valley Care Center | Missoula, MT | 2019 - 2024
- Helped residents bathe, dress and eat on a 20-bed hall.
- Took and charted vital signs every shift.

SKILLS
Patient care, Patient transfers, Vital signs, CPR`,
M1_design: `Dee Example
Bozeman, MT | dee.example@example.com
Graphic Designer

EXPERIENCE
Designer | Print Shop Co. | Bozeman, MT | 2018 - 2024
- Designed menus and banners for local shops.
- Prepped print files for the large-format printer.

SKILLS
Adobe Creative Cloud, Creative Suite, InDesign, Photoshop`,
M2_cook: `Max Example
Butte, MT | max.example@example.com
Line Cook

EXPERIENCE
Line Cook | Uptown Grill | Butte, MT | 2019 - 2024
- Worked with a 5-cook line to plate 250 covers a night.
- Put in charge of the grill station after 3 months.
- Prepped sauces and proteins before service.`,
M3_headline: `Will Example
Kalispell, MT | will.example@example.com
Certified Welder

EXPERIENCE
Welder | Flathead Fab | Kalispell, MT | 2018 - 2024
- Welded trailer frames with MIG and stick.
- Read shop drawings and cut stock to length.`,
M3_caps: `Will Example
Kalispell, MT | will.example@example.com
WELDER

EXPERIENCE
Welder | Flathead Fab | Kalispell, MT | 2018 - 2024
- Welded trailer frames with MIG and stick.
- Read shop drawings and cut stock to length.`,
M4_vague: `Sam Example
Libby, MT | sam.example@example.com
Warehouse Worker

EXPERIENCE
Warehouse Worker | North Supply | Libby, MT | 2020 - 2024
- Helped out where needed
- Various tasks as assigned
- Loaded trucks for morning delivery.`,
L3_gerund: `Gus Example
Polson, MT | gus.example@example.com
Warehouse Lead

EXPERIENCE
Warehouse Lead | Lake Supply | Polson, MT | 2020 - 2024
- Training new hires on the forklift and dock safety
- Loaded trucks for morning delivery.`,
L6_repeat: `Joy Example
Havre, MT | joy.example@example.com
Clerk

SKILLS
Customer service

EXPERIENCE
Clerk | Hi-Line Market | Havre, MT | 2020 - 2024
- Customer service
- Counted the drawer at close.`,
MIL: `Tom Example
Miles City, MT | tom.example@example.com
Maintenance Technician

EXPERIENCE
Maintenance Technician | Range Foods | Miles City, MT | 2015 - 2024
- Repaired conveyors and packaging machines on two lines.
- Kept the PM log for 40 machines.

MILITARY SERVICE
U.S. Army, Motor Transport Operator, 2010 - 2014
- Drove convoy trucks
- Honorable discharge`,
TITLECASE_RETAIL: `Kim Example
Havre, MT | kim.example@example.com

Summary
Retail clerk with four years at a grocery and a hardware store.

Experience
Clerk | Hi-Line Market | Havre, MT | 2020 - 2024
- Ran the register and closed out the drawer.
- Stocked the dairy and frozen aisles.

Skills
Cash register, inventory counts, forklift`,
THREE_LINE: `Ray Example
Glasgow, MT | ray.example@example.com
Ranch Hand

EXPERIENCE
Ranch Hand
Bar K Ranch
Glasgow, MT
2015 - 2020
- Fixed fence and fed cattle through the winter.
- Ran the swather and baler at haying.

Feed Store Clerk
Valley Feed, Glasgow, MT
2020 - 2024
- Loaded feed and mineral for ranch customers.
- Took phone orders and wrote tickets.`,
};

test("r1 H1: bare task lines under a job are marked, and a weak page is never 'strong'", () => {
  const fs = runQualityCheck(R2.H1_bare);
  assert.deepEqual(lineOf(fs, "bullets"), ["Cooking"], "one mark for the run of bare lines");
  assert.equal(pageLooksStrong(R2.H1_bare), false);
  // Silence alone is not strength: no experience heading, no action bullets.
  const thin = `Pat Example
Billings, MT | pat.example@example.com
Cashier

Cashier | Safeway | 2019 - 2022`;
  assert.equal(pageLooksStrong(thin), false);
  assert.equal(pageLooksStrong(STRONG_PAGE), true);
});

test("r1 H2: lists under headings it does not know (EQUIPMENT, SKILLS & CERTIFICATIONS, ACCOMPLISHMENTS) are not job bullets", () => {
  assert.deepEqual(runQualityCheck(R2.H2_trades), []);
  assert.deepEqual(runQualityCheck(R2.MIL), [], "MILITARY SERVICE closes the job section");
  // An all-caps heading in the person's own words also closes the job section.
  const own = R2.H2_trades.replace("EQUIPMENT\n", "MACHINES I RUN\n");
  assert.deepEqual(runQualityCheck(own), []);
});

test("r1 H3: title and employer lines are not 'a block of words'", () => {
  assert.deepEqual(runQualityCheck(R2.H3_headers), []);
  assert.deepEqual(runQualityCheck(R2.THREE_LINE), [], "title / employer / place / dates header");
  assert.deepEqual(runQualityCheck(R2.TITLECASE_RETAIL), []);
});

test("r1 M1: domain skills that share a word with a character word stay skills", () => {
  assert.deepEqual(runQualityCheck(R2.M1_cna), []);
  assert.deepEqual(runQualityCheck(R2.M1_design), []);
  // The whole-term match still catches the real thing, adjectives and all.
  const soft = R2.M1_cna.replace("Patient care, Patient transfers, Vital signs, CPR", "Excellent communication skills, Strong work ethic, Patient, CPR");
  assert.deepEqual(lineOf(runQualityCheck(soft), "soft_skill_list"), ["Excellent communication skills, Strong work ethic, Patient, CPR"]);
});

test("r1 M2: 'worked with' or 'in charge of' with a count, a second action, or a promotion is real work", () => {
  assert.deepEqual(runQualityCheck(R2.M2_cook), []);
  // The bare duty still reads like the posting.
  const bare = R2.M2_cook.replace("- Prepped sauces and proteins before service.", "- Worked with customers.");
  assert.deepEqual(lineOf(runQualityCheck(bare), "duty_phrasing"), ["- Worked with customers."]);
  // "Responsible for" stays marked even with a number.
  const resp = R2.M2_cook.replace("- Prepped sauces and proteins before service.", "- Responsible for 3 fryers.");
  assert.deepEqual(lineOf(runQualityCheck(resp), "duty_phrasing"), ["- Responsible for 3 fryers."]);
});

test("r1 M3: a one or two word headline counts as the top", () => {
  assert.deepEqual(runQualityCheck(R2.M3_headline), []);
  assert.deepEqual(runQualityCheck(R2.M3_caps), []);
  // A city line under the name is not a headline.
  const city = R2.M3_headline.replace("Kalispell, MT | will.example@example.com\nCertified Welder", "Kalispell, MT\nwill.example@example.com");
  assert.deepEqual(lineOf(runQualityCheck(city), "summary"), ["EXPERIENCE"]);
});

test("r1 M4: vague lines that fit any job are marked", () => {
  const fs = runQualityCheck(R2.M4_vague);
  assert.deepEqual(lineOf(fs, "weak_bullet"), ["- Helped out where needed", "- Various tasks as assigned"]);
  assert.match(byRule(fs, "weak_bullet")[0].why, /any job/);
  assert.equal(pageLooksStrong(R2.M4_vague), false);
});

test("r1 L3: an -ing bullet gets its own reason, not 'names a task'", () => {
  const fs = runQualityCheck(R2.L3_gerund);
  assert.equal(fs.length, 1);
  assert.match(fs[0].why, /-ing word/);
  assert.doesNotMatch(fs[0].why, /names a task/);
});

test("r1 L6: a finding says which copy of a repeated line it is about", () => {
  const page = `Joy Example
Havre, MT | joy.example@example.com
Clerk

SKILLS
Cleaning

EXPERIENCE
Clerk | Hi-Line Market | Havre, MT | 2020 - 2024
Cleaning
Stocking`;
  const fs = runQualityCheck(page);
  assert.deepEqual(fs.map((f) => [f.rule, f.line, f.occurrence]), [["bullets", "Cleaning", 1]]);
});

test("r1: the new reasons are plain t.ROY too", () => {
  const fs = Object.values(R2).flatMap((t) => runQualityCheck(t));
  assert.ok(fs.length >= 5);
  for (const f of fs) {
    assert.ok(f.why.length <= 200, f.why);
    assert.doesNotMatch(f.why, /[\u2013\u2014]|-{2}/, f.why);
    for (const d of f.why.match(/\d/g) ?? []) assert.ok(f.line.includes(d), `why adds digit ${d}`);
  }
});
