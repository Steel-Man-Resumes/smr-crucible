/**
 * Finish gate, focused re-check round 14 (consumer). Fictional fixtures.
 *
 * R14-B1 on the page; F1: a target title gets no title card; F3: a job header
 * takes only that job's own title; F8: taking off every competency takes its
 * heading; F9: "Use my title" keeps the casing they typed mid-sentence.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as gate from "../finish-gate";

const { buildFinishView, ownWordsFor, applyOwnTitle, cutTerm } = gate;
type Input = Parameters<typeof buildFinishView>[0];

const UPLOAD = `Jordan Smith
419-555-0100 | jordan.smith@example.com | Toledo, OH

WORK HISTORY

Warehouse Associate | Midwest Distribution | 2019 - 2023
picked orders with a scanner gun, loaded and unloaded trucks, wrapped pallets`;
const page = (bullets: string, summary = "", header = "WAREHOUSE ASSOCIATE | Midwest Distribution | Toledo, OH | 2019 - 2023") => `JORDAN SMITH
Toledo, OH | 419-555-0100 | jordan.smith@example.com
${summary ? `\nSUMMARY\n${summary}\n` : ""}
PROFESSIONAL EXPERIENCE
${header}
- Picked orders with a scanner gun and wrapped pallets
${bullets}`;
const view = (resumeText: string, o: { goal?: string; upload?: string; letter?: string } = {}) =>
  buildFinishView({
    resumeText,
    ownWords: ownWordsFor({ resumeText: o.upload ?? UPLOAD, goalNarrative: o.goal ?? "I want steady work." }, false),
    defendAnswers: [],
    coverLetterText: o.letter ?? "",
    written: { resume: resumeText, letter: o.letter ?? "" },
    ownResumeText: o.upload ?? UPLOAD,
  } as Input);

test("R14-B1: 'a job where I'm in charge of the dock crew' in the goal box never clears the page", () => {
  for (const [goal, line] of [
    ["A job where I am in charge of the dock crew.", "- Led the dock crew"],
    ["Somewhere I'm the one who trains new hires.", "- Trained new hires on the scanner"],
    ["Hopefully I'm in charge of the dock crew next year.", "- Led the dock crew"],
  ]) {
    const v = view(page(line), { goal });
    assert.ok(v.openItems.some((i) => i.kind === "scope_unsaid" && i.line === line), goal);
  }
});

test("F1: a target title in the summary gets no title card", () => {
  for (const s of ["Warehouse associate seeking a shift supervisor position.", "Hard worker looking to grow into a team lead."]) {
    const v = view(page("- Loaded trucks", s));
    assert.ok(!v.groups.some((g) => g.line === s && g.title), s);
    assert.ok(!v.openItems.some((i) => i.line === s && (i.kind === "title_unsaid" || i.kind === "scope_unsaid")), s);
  }
  assert.ok(view(page("- Loaded trucks", "Shift supervisor with warehouse experience.")).groups.some((g) => g.title?.role));
});

test("F3: a job header takes only that job's own title, never another job's", () => {
  const up = `Jordan Smith
419-555-0100 | jordan.smith@example.com | Toledo, OH

WORK HISTORY
Shift Lead | Kroger | 2021 - 2023
Cashier | Dollar General | 2018 - 2021`;
  const r = `JORDAN SMITH
Toledo, OH | 419-555-0100 | jordan.smith@example.com

PROFESSIONAL EXPERIENCE
SHIFT LEAD | Kroger | Toledo, OH | 2021 - 2023
- Ran the register
SHIFT LEAD | Dollar General | Toledo, OH | 2018 - 2021
- Ran the register`;
  const v = view(r, { upload: up });
  const titled = v.groups.filter((g) => g.title).map((g) => g.line);
  assert.deepEqual(titled, ["SHIFT LEAD | Dollar General | Toledo, OH | 2018 - 2021"]);
});

test("F8: taking off every competency takes its heading too", () => {
  const r = `${page("- Loaded trucks")}\n\nCORE COMPETENCIES\nForklift Operation | Cash Handling\n\nEDUCATION\nGED, 2015`;
  const once = cutTerm(r, "Forklift Operation");
  assert.match(once, /CORE COMPETENCIES\nCash Handling/);
  const both = cutTerm(once, "Cash Handling");
  assert.doesNotMatch(both, /CORE COMPETENCIES/);
  assert.match(both, /EDUCATION\nGED, 2015$/);
});

test("F9: 'Use my title' keeps the casing they typed mid-sentence", () => {
  const s = "Reliable shift supervisor with 4 years of warehouse experience.";
  const r = page("- Loaded trucks", s);
  assert.match(applyOwnTitle(r, [], s, "Warehouse Associate", "shift supervisor").text, /Reliable Warehouse Associate with 4 years/);
  assert.match(applyOwnTitle(r, [], s, "warehouse associate", "shift supervisor").text, /Reliable warehouse associate with 4 years/);
  const start = "Shift supervisor with 4 years of warehouse experience.";
  assert.match(applyOwnTitle(page("- Loaded trucks", start), [], start, "warehouse associate", "Shift supervisor").text, /\nWarehouse associate with 4 years/);
});
