/**
 * Troy 2026-10-20: the Forge finishes its own page. Bad in, good out, no draft
 * mark. These cases run the real gate: after the settle pass the page is
 * finished, nothing was added, and what came off is listed. Fictional person.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { settleFinishPage, type SettleInput, type SettleState } from "../auto-settle";
import { buildFinishView } from "../finish-gate";

const UPLOAD = `DANA REYES
Springfield, IL | 555-0142 | dana.reyes@example.com

OBJECTIVE
Seeking a position where I can use my skills and grow with a company.

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

const GROUNDING = { verifierRan: true, verifierRanByDoc: { resume: true, cover_letter: true }, removed: 0, residual: 0, unmatched: 0, outcomes: [], sourceKind: "given", rewordingA: true };

// The writer's page, with things the person never said added on top of a clean rewording.
const WRITTEN = `DANA REYES
Springfield, IL | 555-0142 | dana.reyes@example.com

SENIOR WAREHOUSE LEAD
Warehouse associate who loads trucks and counts inventory on 3rd shift, with kitchen prep and grill work before that.

CORE COMPETENCIES
Truck Loading | Inventory Counts | Pallet Jack | Forklift Operation | Workplace Safety

PROFESSIONAL EXPERIENCE
Warehouse Associate | Midstate Distribution | 8/2021 - Present
- Load outbound trucks
- Count inventory on 3rd shift
- Led a team of 12 loaders and trained all new hires
- Operate a pallet jack, moving 40 pallets a night
- Certified forklift operator

Line Cook | Corner Diner | 3/2018 - 7/2021
- Prepped food and worked the grill
- Cleaned the kitchen at close

EDUCATION
Diploma | Springfield High School | 2017`;

const input: SettleInput = { ownWords: UPLOAD, written: { resume: WRITTEN, letter: "" }, grounding: GROUNDING, ownResumeText: UPLOAD };
const start: SettleState = { resume: WRITTEN, letter: "", answers: [], addedTerms: [], keptTerms: [], confirmed: [], remnants: [] };

test("settle: a page with things the person never said ends finished, with no draft mark, and nothing added", async () => {
  const before = buildFinishView({ ...input, resumeText: WRITTEN, defendAnswers: [] });
  assert.ok(before.groups.length > 0, "the fixture really has cards");
  const r = await settleFinishPage(input, start, async () => null);
  assert.equal(r.view.state, "finished", JSON.stringify(r.view.openItems.map((i) => `${i.rule} ${i.line}`)));
  assert.equal(r.finished, true);
  // Nothing the person never said is on the page.
  assert.doesNotMatch(r.state.resume, /team of 12|trained all new hires|Certified forklift/i);
  // Every real line of theirs stays.
  assert.match(r.state.resume, /Load outbound trucks/);
  assert.match(r.state.resume, /Prepped food and worked the grill/);
  assert.match(r.state.resume, /moving 40 pallets a night/);
  // It says what it took off.
  assert.ok(r.notes.some((n) => n.kind === "removed"));
});

test("settle: no words are added to the page (every line is the writer's or the person's)", async () => {
  const r = await settleFinishPage(input, start, async () => null);
  const words = new Set((WRITTEN + "\n" + UPLOAD).toLowerCase().match(/[a-z0-9$%/.-]+/g));
  for (const w of r.state.resume.toLowerCase().match(/[a-z0-9$%/.-]+/g) ?? []) assert.ok(words.has(w), `new word: ${w}`);
});

test("settle: a verified draft is used when there is one", async () => {
  const r = await settleFinishPage(input, start, async (g) => (/Led a team of 12/.test(g.line) ? "Worked with a crew of loaders on 3rd shift" : null));
  assert.equal(r.view.state, "finished");
});

test("settle: an already-clean page is only confirmed, nothing removed", async () => {
  const clean = WRITTEN.split("\n").filter((l) => !/Led a team|Certified forklift|SENIOR|Forklift Operation/.test(l)).join("\n").replace("Pallet Jack | Forklift Operation |", "Pallet Jack |");
  const s2 = { ...start, resume: clean };
  const r = await settleFinishPage({ ...input, written: { resume: clean, letter: "" } }, s2, async () => null);
  assert.equal(r.view.state, "finished");
  assert.ok(!r.notes.some((n) => n.kind === "removed" && /Load outbound|Prepped/.test(n.line)));
});

test("a source fallback keeps explicit management in current tense without restoring duty phrasing", async () => {
  const own = `MORGAN SAMPLE\nWORK EXPERIENCE\nProduction Manager | Example Workshop | 2019 - Present\nResponsible for managing day-to-day production operations.`;
  const written = `MORGAN SAMPLE\nCAREER SUMMARY\nProduction operations experience.\nPROFESSIONAL EXPERIENCE\nProduction Manager | Example Workshop | 2019 - Present\n- Supervised day-to-day production operations.`;
  const r = await settleFinishPage({ ownWords: own, ownResumeText: own,
    written: { resume: written, letter: "" }, grounding: GROUNDING },
    { ...start, resume: written }, async () => null);
  assert.match(r.state.resume, /- Manage day-to-day production operations\./);
  assert.doesNotMatch(r.state.resume, /Responsible for|Supervised|Helped manage/);
  assert.match(r.state.resume, /Production Manager \| Example Workshop \| 2019 - Present/);
});
