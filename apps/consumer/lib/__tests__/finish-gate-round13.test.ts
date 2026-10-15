/**
 * Finish gate, review round 13 (consumer). Fictional fixtures.
 *
 * R13-B1: the goal box never sources a present tense. SF-1: the person's own
 * "crew of 5," keeps its number. SF-2: a cut that empties a section takes its
 * heading too, and the render never prints an empty heading. SF-3: their own
 * "Lead Custodian" header sources the summary's title. SF-4: a title in the
 * summary or letter gets its own title card. SF-5: "Use my title" refuses
 * what is not a title. SF-6: a jail or prison school is the person's choice.
 * SF-9: their short form is "Yes, that was my title".
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as gate from "../finish-gate";
import { parseResume } from "../resume-render/model";

const {
  buildFinishView,
  ownWordsFor,
  recordAnswer,
  recordScopeYes,
  scopeYesResult,
  titleYesResult,
  recordTitleYes,
  applyOwnTitle,
  ownTitleProblem,
  isFacilitySchool,
  cutLine,
  dropEmptySections,
  cutCredentialEverywhere,
} = gate;
type Input = Parameters<typeof buildFinishView>[0];
const GOOD = "Yes, I did that myself at that job, most shifts.";

const UPLOAD = `Jordan Smith
419-555-0100 | jordan.smith@example.com | Toledo, OH

WORK HISTORY

Warehouse Associate | Midwest Distribution | 2019 - 2023
picked orders with a scanner gun, loaded and unloaded trucks, wrapped pallets`;
const page = (bullets: string, summary = "") => `JORDAN SMITH
Toledo, OH | 419-555-0100 | jordan.smith@example.com
${summary ? `\nSUMMARY\n${summary}\n` : ""}
PROFESSIONAL EXPERIENCE
WAREHOUSE ASSOCIATE | Midwest Distribution | Toledo, OH | 2019 - 2023
- Picked orders with a scanner gun and wrapped pallets
${bullets}`;
const view = (resumeText: string, o: { goal?: string; upload?: string; letter?: string; answers?: Parameters<typeof recordAnswer>[0] } = {}) =>
  buildFinishView({
    resumeText,
    ownWords: ownWordsFor({ resumeText: o.upload ?? UPLOAD, goalNarrative: o.goal ?? "I want a lead job." }, false),
    defendAnswers: o.answers ?? [],
    coverLetterText: o.letter ?? "",
    written: { resume: resumeText, letter: o.letter ?? "" },
    ownResumeText: o.upload ?? UPLOAD,
  } as Input);
const scopeLines = (v: ReturnType<typeof view>) => v.openItems.filter((i) => i.kind === "scope_unsaid").map((i) => i.line);

// ---- R13-B1 ------------------------------------------------------------------------------------------

for (const goal of [
  "I'm looking for a lead job where I train new hires.",
  "Hopefully I train new hires soon.",
  "I train new hires starting Monday.",
  "A job where I train new hires.",
  "I train new hires.",
]) {
  test(`R13-B1: the goal box "${goal}" never clears "Trained new hires on the scanner"`, () => {
    assert.ok(scopeLines(view(page("- Trained new hires on the scanner"), { goal })).includes("- Trained new hires on the scanner"));
  });
}
test("R13-B1: the goal box is marked, and the mark never reaches the person's other words", () => {
  const own = ownWordsFor({ resumeText: UPLOAD, goalNarrative: "I want a lead job.", hookNarrative: "Training people." }, false);
  assert.match(own, /⁣\nI want a lead job\.\n⁤/);
  assert.match(own, /⁣\nTraining people\.\n⁤/);
  assert.ok(own.startsWith("Jordan Smith"));
});
test("R13-B1 control: the same present tense in their upload clears", () => {
  const upload = UPLOAD + "\nI train new hires on the scanner gun.";
  assert.ok(!scopeLines(view(page("- Trained new hires on the scanner"), { upload })).length);
});

// ---- SF-1 --------------------------------------------------------------------------------------------

test("SF-1: a writer's number before a comma is asked; the person's own 'crew of 5,' keeps it", () => {
  const v = view(page("- Loaded and unloaded trucks with the dock crew of 8, wrapped pallets"));
  assert.ok(v.openItems.some((i) => i.kind === "added_number" && /crew of 8/.test(i.line)));
  const upload = UPLOAD + "\nnights, I lead a crew of 5, make the cleaning schedule";
  const own = view(page("- Lead a night crew of 5 at a hospital contract site"), { upload });
  assert.ok(!own.openItems.some((i) => i.kind === "added_number"));
});

// ---- SF-2 --------------------------------------------------------------------------------------------

test("SF-2: a cut that empties a section takes its heading, last or before another section", () => {
  const last = `${page("- Loaded trucks")}\n\nEDUCATION\nHigh School Diploma | Lincoln High School | 2014`;
  assert.equal(cutLine(last, "High School Diploma | Lincoln High School | 2014"), page("- Loaded trucks"));
  const before = `${page("- Loaded trucks")}\n\nEDUCATION\nHigh School Diploma | Lincoln High School | 2014\n\nCERTIFICATIONS\n- Forklift Certified, 2020`;
  assert.equal(cutLine(before, "High School Diploma | Lincoln High School | 2014"), `${page("- Loaded trucks")}\n\nCERTIFICATIONS\n- Forklift Certified, 2020`);
  // Every section, not only EDUCATION.
  const summary = page("- Loaded trucks", "Hard worker.");
  assert.doesNotMatch(cutLine(summary, "Hard worker."), /SUMMARY/);
  // "No" on the diploma takes its heading too.
  const r = cutCredentialEverywhere({ resume: before, letter: "" }, "High School Diploma");
  assert.doesNotMatch(r.resume, /EDUCATION/);
  assert.match(r.resume, /CERTIFICATIONS\n- Forklift Certified, 2020$/);
  assert.ok(!r.changes.some((c) => c.before === "EDUCATION"), "the cut preview lists lines, not the heading");
  // A name line or a letter line is never a heading.
  assert.equal(dropEmptySections("JORDAN SMITH\n\nDear Hiring Manager,"), "JORDAN SMITH\n\nDear Hiring Manager,");
});
test("SF-2: the render never prints a heading with nothing under it", () => {
  const m = parseResume(`${page("- Loaded trucks")}\n\nEDUCATION\n\nCERTIFICATIONS\n- Forklift Certified, 2020\n\nSKILLS`);
  const sections = m.blocks.filter((b) => b.kind === "section").map((b) => (b as { text: string }).text);
  assert.deepEqual(sections, ["PROFESSIONAL EXPERIENCE", "CERTIFICATIONS"]);
});

// ---- SF-3 / SF-4: titles -----------------------------------------------------------------------------

const CUST_UP = `Andre Willis
419-555-0177 | andre.willis@example.com | Toledo, OH

WORK HISTORY
Lead Custodian | Maumee Valley Facility Services | 2020 - present
cleaned offices, ran the floor scrubber`;
const CUST = (summary: string) => `ANDRE WILLIS
Toledo, OH | 419-555-0177 | andre.willis@example.com

SUMMARY
${summary}

PROFESSIONAL EXPERIENCE
LEAD CUSTODIAN | Maumee Valley Facility Services | Toledo, OH | 2020 - Present
- Cleaned offices and ran the floor scrubber`;
test("SF-3: their own 'Lead Custodian' header sources the summary's title, with no card", () => {
  const v = view(CUST("Lead custodian with commercial cleaning experience."), { upload: CUST_UP, goal: "I want steady work." });
  assert.ok(!v.openItems.some((i) => i.line.startsWith("Lead custodian") && (i.kind === "scope_unsaid" || i.kind === "title_unsaid")));
});
test("SF-3/SF-4: a title they never had gets a title card, never 'I helped with it'", () => {
  const up = CUST_UP.replace("Lead Custodian |", "Custodian |");
  const v = view(CUST("Lead custodian with commercial cleaning experience.").replace("LEAD CUSTODIAN", "CUSTODIAN"), { upload: up, goal: "I want steady work." });
  const g = v.groups.find((x) => x.line.startsWith("Lead custodian"))!;
  assert.deepEqual(g.title, { current: "Lead custodian", role: true });
  assert.ok(!g.items.some((i) => i.helped));
  assert.ok(!v.groups.some((x) => x.scope?.helped && /Helped lead custodian/.test(x.scope.helped)));
});
test("SF-4: a summary title is settled by its title card, not by a scope Yes", () => {
  const line = "Shift lead who trained new hires on the scanner.";
  const r = page("- Loaded trucks", line);
  const v = view(r);
  const g = v.groups.find((x) => x.line === line)!;
  assert.deepEqual(g.title, { current: "Shift lead", role: true });
  // A Yes on the scope card leaves the title open.
  const yes = recordScopeYes([], line, ["train"], "people");
  assert.ok(view(r, { answers: yes }).openItems.some((i) => i.line === line && i.kind === "title_unsaid"));
  // "Yes, that was my title" typed as theirs settles it; the scope card is its own question.
  assert.equal(titleYesResult(line, "shift lead", "Shift lead"), "ok");
  assert.equal(titleYesResult(line, "team lead", "Shift lead"), "unmatched");
  const both = recordTitleYes(yes, line, "Shift lead");
  assert.ok(!view(r, { answers: both }).openItems.some((i) => i.line === line && (i.kind === "title_unsaid" || i.kind === "scope_unsaid")));
  // "Use my title" changes only the title's words and never loops.
  const own = applyOwnTitle(r, [], line, "Warehouse associate", "Shift lead");
  assert.ok(own.changed);
  assert.match(own.text, /\nWarehouse associate who trained new hires on the scanner\./);
  const after = view(own.text, { answers: own.answers });
  assert.ok(!after.openItems.some((i) => i.kind === "title_unsaid" && /Warehouse associate who/.test(i.line)));
});
test("SF-4: a title in the letter gets its own card and changes in the letter", () => {
  const letter = "Dear Hiring Manager,\n\nAs a shift supervisor I led the dock crew.\n\nSincerely,\nJordan Smith";
  const v = view(page("- Loaded trucks"), { letter });
  const g = v.groups.find((x) => x.target === "letter" && x.title)!;
  assert.deepEqual(g.title, { current: "shift supervisor", role: true });
  // Round 14 (F9): mid-sentence their title keeps the casing they typed.
  const own = applyOwnTitle(letter, [], g.line, "Warehouse Associate", "shift supervisor");
  assert.match(own.text, /As a Warehouse Associate I led the dock crew\./);
});

// ---- SF-5 / SF-9 -------------------------------------------------------------------------------------

test("SF-5: 'Use my title' refuses answers that are not a title; the same title is a Yes", () => {
  for (const t of ["idk", "no", "n/a", "N/A", "none", "I don't remember", "I don't know", "not sure", "ok", "x", "?", "Lead | Acme Corp | 2010 - 2023", "2019"]) {
    assert.equal(ownTitleProblem(t, "SHIFT SUPERVISOR"), "not_a_title", t);
  }
  assert.equal(ownTitleProblem("", "SHIFT SUPERVISOR"), "empty");
  assert.equal(ownTitleProblem("Shift Supervisor", "SHIFT SUPERVISOR"), "same");
  assert.equal(ownTitleProblem("shift sup", "SHIFT SUPERVISOR"), "same");
  assert.equal(ownTitleProblem("Warehouse worker", "SHIFT SUPERVISOR"), undefined);
});
test("SF-9: 'Yes, that was my title' takes their short form", () => {
  const header = "CUSTOMER SERVICE REPRESENTATIVE | Lakeshore Health Billing | Toledo, OH | 2019 - 2022";
  assert.equal(titleYesResult(header, "Customer Service Rep"), "ok");
  assert.equal(titleYesResult("ASSISTANT MANAGER | Kroger | Toledo, OH | 2019 - 2022", "Asst Mgr"), "ok");
  assert.equal(titleYesResult(header, "Team Lead"), "unmatched");
});
test("SF-9: their short form in the upload is their title, with no card", () => {
  const up = UPLOAD.replace("Warehouse Associate | Midwest Distribution", "Customer Service Rep | Midwest Distribution");
  const v = view(page("- Loaded trucks").replace("WAREHOUSE ASSOCIATE", "CUSTOMER SERVICE REPRESENTATIVE"), { upload: up });
  assert.ok(!v.groups.some((g) => g.title));
});

// ---- SF-6 --------------------------------------------------------------------------------------------

test("SF-6: a jail or prison school is flagged for the person to keep or change", () => {
  for (const s of ["Juvenile detention school", "school at the county jail", "Lucas County Correctional school", "the school at Marion prison"]) assert.ok(isFacilitySchool(s), s);
  for (const s of ["Scott High", "Owens Community College", "Lucas County Career Center", ""]) assert.ok(!isFacilitySchool(s), s);
});

// ---- SF-7 on the page --------------------------------------------------------------------------------

test("SF-7: the page refuses a different group and accepts the honest one", () => {
  const r = page("- Led the dock crew");
  const g = view(r).groups.find((x) => x.scope)!;
  const doc = { target: "resume" as const, text: r };
  const source = view(r).source;
  assert.equal(scopeYesResult(doc, g.line, g.scope!.families, "new hires", source, []), "unmatched");
  assert.equal(scopeYesResult(doc, g.line, g.scope!.families, "Never", source, []), "unmatched");
  assert.equal(scopeYesResult(doc, g.line, g.scope!.families, "the guys on the dock", source, []), "ok");
  let a = recordScopeYes([], g.line, g.scope!.families, "the guys on the dock");
  for (let k = 0; k < 3; k++) for (const x of view(r, { answers: a }).groups) if (x.blocking && x.answerable) a = recordAnswer(a, x.line, GOOD, "stands");
  assert.ok(!view(r, { answers: a }).openItems.some((i) => i.kind === "scope_unsaid"));
});
