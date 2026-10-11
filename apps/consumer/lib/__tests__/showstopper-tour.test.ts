import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildResumeTour,
  jobCardsFrom,
  limitResetLabel,
  elapsedLabel,
  buildFailure,
  pageLines,
  STRONG_NOTE,
  READ_NOTE,
  TOUR_CAP,
} from "../showstopper-tour";
import { DEMO_SESSION } from "../demo-data";
import { FLAWED_RESUME } from "./fixtures/showstopper-resume";

// Strong on the basics and on SMR quality: a summary with facts only this
// person has, real skills, action bullets, plain headings. Fictional.
const STRONG_RESUME = `Alex Rivera
Bayside, OR | alex.rivera@example.com

SUMMARY
Line cook with two years on the grill at Harbor Grill, cooking for 200 covers a night.

SKILLS
Flat top, char grill, fryer, knife work, food safety

EXPERIENCE
Line Cook | Harbor Grill | Bayside, OR | 2021 - 2023
- Cooked for 200 covers a night.
- Kept the line stocked for the next shift.`;

// The page Troy saw: an Objective, a list of character words, "Responsible
// for" lines. Every flaw here is real on the page. Fictional.
const WEAK_RESUME = `Dana Whitfield
Lakeview, OH | dana.whitfield@example.com

OBJECTIVE
Seeking a position with a growing company where I can use my skills and grow.

WORK EXPERIENCE
Shift Lead | Copperline Foods | Lakeview, OH | 8/2021 - 12/2022
- Responsible for 3rd shift.
- Responsible for training new people.
- Customer service

SKILLS
Hard worker, team player, fast learner, detail oriented

EDUCATION
High school diploma, Lakeview High School, 2018`;

test("no page means no tour (never a fake before)", () => {
  assert.equal(buildResumeTour(""), null);
  assert.equal(buildResumeTour("   \n  \n"), null);
  assert.equal(buildResumeTour(undefined), null);
  assert.equal(buildResumeTour(null), null);
});

test("a genuinely strong page gets the honest strong note and no steps", () => {
  const tour = buildResumeTour(STRONG_RESUME)!;
  assert.ok(tour);
  assert.equal(tour.steps.length, 0);
  assert.equal(tour.strongNote, STRONG_NOTE);
  assert.equal(STRONG_NOTE, "This is already strong. I'll tighten it.");
});

test("the false 'clean on the basics' line is gone for good", () => {
  const src = readFileSync(join(import.meta.dirname, "..", "showstopper-tour.ts"), "utf8");
  assert.doesNotMatch(src, /clean on the basics/i);
  const ui = readFileSync(join(import.meta.dirname, "..", "..", "components", "forge", "showstopper", "OldPageTour.tsx"), "utf8");
  assert.doesNotMatch(ui, /clean on the basics/i);
});

test("a page that is true but weak is never called strong (Troy's preview page)", () => {
  const tour = buildResumeTour(WEAK_RESUME)!;
  assert.equal(tour.strongNote, undefined);
  const flagged = tour.steps.map((s) => s.line.trim());
  assert.ok(flagged.includes("Seeking a position with a growing company where I can use my skills and grow."), "objective");
  assert.ok(flagged.includes("Hard worker, team player, fast learner, detail oriented"), "soft skills");
  assert.ok(flagged.includes("- Responsible for 3rd shift."), "duty line");
  assert.ok(flagged.includes("- Customer service"), "bullet with no action");
  for (const s of tour.steps) assert.equal(s.source, "quality");
  const objective = tour.steps.find((s) => s.line.startsWith("Seeking"))!;
  assert.match(objective.note, /what you want/i);
  const duty = tour.steps.filter((s) => s.line.includes("Responsible for"));
  assert.equal(duty.length, 2);
  assert.notEqual(duty[0].note, duty[1].note, "the second duty line gets the short follow-up");
});

test("truth flaws and quality marks walk the same page together", () => {
  const tour = buildResumeTour(WEAK_RESUME.replace("dana.whitfield@example.com", "[Phone Number] | dana.whitfield@example.com"))!;
  const sources = new Set(tour.steps.map((s) => s.source));
  assert.ok(sources.has("truth") && sources.has("quality"));
});

test("real flaws become steps, anchored to the right raw line", () => {
  const tour = buildResumeTour(FLAWED_RESUME)!;
  assert.ok(tour.steps.length >= 3, `expected at least 3 steps, got ${tour.steps.length}`);
  assert.equal(tour.strongNote, undefined);
  for (const s of tour.steps) {
    assert.equal(tour.lines[s.lineIndex], s.line);
    assert.ok(s.line.trim().length > 0);
  }
  const lines = tour.steps.map((s) => s.line);
  assert.ok(lines.some((l) => l.includes("[Phone Number]")), "placeholder line");
  assert.ok(lines.some((l) => l.startsWith("Dishwasher")), "job with no dates");
  assert.ok(lines.some((l) => l === "N/A"), "empty section");
});

test("the tour is capped and has one step per line", () => {
  const tour = buildResumeTour(FLAWED_RESUME)!;
  assert.ok(tour.steps.length <= TOUR_CAP);
  assert.equal(new Set(tour.steps.map((s) => s.lineIndex)).size, tour.steps.length);
  const capped = buildResumeTour(FLAWED_RESUME, 2)!;
  assert.equal(capped.steps.length, 2);
});

test("the walk goes top to bottom, in page order", () => {
  for (const text of [FLAWED_RESUME, WEAK_RESUME]) {
    const tour = buildResumeTour(text)!;
    for (let i = 1; i < tour.steps.length; i++) {
      assert.ok(tour.steps[i - 1].lineIndex < tour.steps[i].lineIndex, `step ${i} out of order`);
    }
  }
});

test("when the cap bites, problems that block come first", () => {
  const tour = buildResumeTour(FLAWED_RESUME, 2)!;
  for (const s of tour.steps) assert.equal(s.severity, "BLOCK");
});

test("the cap picks one of each kind of flaw before repeats", () => {
  const many = `Pat Lee
WORK EXPERIENCE
Cook | Cafe One | 2019 – 2020
Cook | Cafe Two | 2020 – 2021
Cook | Cafe Three | 2021 – 2022
Cook | Cafe Four | 2022 – 2023
Server | Cafe Five
EDUCATION
N/A`;
  const tour = buildResumeTour(many, 3)!;
  const lines = tour.steps.map((s) => s.line);
  assert.ok(lines.includes("Server | Cafe Five"), "the no-dates job is not crowded out by dashes");
  assert.ok(lines.includes("N/A"), "the empty section is not crowded out by dashes");
});

test("no rule codes or checker jargon in what t.ROY says", () => {
  const steps = [...buildResumeTour(FLAWED_RESUME)!.steps, ...buildResumeTour(WEAK_RESUME)!.steps];
  for (const s of steps) {
    assert.doesNotMatch(s.note, /STD-|\b[A-Z]{3}-[A-Z]\d|\bBLOCK\b|\bFIX\b|mint|rule/i, s.note);
    assert.doesNotMatch(s.note, /[–—]|--/, "no long dashes in notes");
  }
});

test("a note never brings in a digit the line does not carry", () => {
  for (const text of [FLAWED_RESUME, WEAK_RESUME, DEMO_SESSION.resumeText!]) {
    const tour = buildResumeTour(text)!;
    for (const s of [...tour.steps]) {
      for (const d of s.note.match(/\d/g) ?? []) {
        assert.ok(s.line.includes(d), `note adds digit ${d}: ${s.note}`);
      }
    }
  }
});

test("notes are short: one to three sentences", () => {
  for (const s of [...buildResumeTour(FLAWED_RESUME)!.steps, ...buildResumeTour(WEAK_RESUME)!.steps]) {
    const sentences = s.note.split(/(?<=[.!?])\s+/).filter(Boolean);
    assert.ok(sentences.length >= 1 && sentences.length <= 3, s.note);
    assert.ok(s.note.length <= 200, s.note);
  }
});

test("a repeated kind of flaw gets the short follow-up note", () => {
  const two = `Pat Lee
WORK EXPERIENCE
Cook | Cafe One
- Made food
Server | Cafe Two
- Served food
EDUCATION
GED 2015`;
  const tour = buildResumeTour(two)!;
  // The page also has no summary (a true quality mark); the two dateless jobs are the pair.
  const truth = tour.steps.filter((s) => s.source === "truth");
  assert.equal(truth.length, 2);
  assert.notEqual(truth[0].note, truth[1].note);
  assert.match(truth[1].note, /either|same/i);
});

test("a job whose dates sit on the next line is not called dateless", () => {
  // The checker reads "June 2021 - Present (3 years)" as not a date line.
  const tour = buildResumeTour(DEMO_SESSION.resumeText)!;
  assert.ok(!tour.steps.some((s) => s.line.startsWith("Warehouse Associate")), "demo job has dates on the line below");
});

test("the demo resume still gets a tour or the strong note", () => {
  const tour = buildResumeTour(DEMO_SESSION.resumeText)!;
  assert.ok(tour.steps.length > 0 || tour.strongNote === STRONG_NOTE);
});

test("job cards come from what was entered, nothing added", () => {
  const cards = jobCardsFrom(
    [
      { title: "Forklift Operator", company: "Northside Supply", startDate: "2016", endDate: "" },
      { title: "Prep Cook", company: "", startDate: "", endDate: "" },
      { title: "", company: "", startDate: "2010", endDate: "2011" },
    ],
    undefined
  );
  assert.deepEqual(cards, [
    { title: "Forklift Operator", company: "Northside Supply", dates: "2016 - Present" },
    { title: "Prep Cook", company: "", dates: "" },
  ]);
  const carried = jobCardsFrom(undefined, [
    { kind: "kitchen", title: "Line cook", yearStarted: 2014, yearApprox: true, yearEnded: 2016 },
    { kind: "warehouse", yearStarted: null, yearApprox: false },
  ]);
  assert.deepEqual(carried, [
    { title: "Line cook", company: "", dates: "about 2014 - 2016" },
    { title: "warehouse", company: "", dates: "" },
  ]);
  assert.deepEqual(jobCardsFrom([], []), []);
});

test("the daily limit opens at the next UTC midnight, in the person's clock", () => {
  // 2026-10-06 15:00 UTC is 9:00 AM in Denver; UTC midnight is 6:00 PM there.
  const now = new Date(Date.UTC(2026, 9, 6, 15, 0));
  assert.equal(limitResetLabel(now, "America/Denver"), "6:00 PM today");
  assert.equal(limitResetLabel(now, "UTC"), "12:00 AM tomorrow");
  // 2026-10-07 02:00 UTC is still Oct 6 evening in Denver: reset is 6 PM on Oct 7.
  const late = new Date(Date.UTC(2026, 9, 7, 2, 0));
  assert.equal(limitResetLabel(late, "America/Denver"), "6:00 PM tomorrow");
});

test("elapsed time reads as minutes and seconds", () => {
  assert.equal(elapsedLabel(0), "0:00");
  assert.equal(elapsedLabel(9.7), "0:09");
  assert.equal(elapsedLabel(65), "1:05");
  assert.equal(elapsedLabel(-3), "0:00");
});

test("a 429 says when they can try again and offers no retry", () => {
  const f = buildFailure(429, new Date(Date.UTC(2026, 9, 6, 15, 0)));
  assert.equal(f.kind, "limit");
  assert.match(f.body, /You can try again after \d{1,2}:\d{2} (AM|PM) (today|tomorrow)\./);
  assert.doesNotMatch(f.body, /%/);
});

test("other failures say what happened in plain words", () => {
  assert.equal(buildFailure(500).kind, "retry");
  assert.equal(buildFailure("network").title, "Couldn't reach t.ROY");
  assert.equal(buildFailure("timeout").title, "t.ROY took too long");
  assert.equal(buildFailure(504).title, "t.ROY took too long");
  assert.equal(buildFailure(413).kind, "back");
  for (const c of [500, 502, 413, 504, "network", "timeout", "unreadable"] as const) {
    const f = buildFailure(c);
    assert.doesNotMatch(f.title + f.body, /[–—]|--|error code|exception|\d{3}/i, `${c}: ${f.body}`);
  }
});

// ---- Round 2 (review s3 r1) -----------------------------------------------

test("r1 H1: a page of bare task lines is marked, never called strong", () => {
  const page = `Pat Example
Billings, MT | pat.example@example.com
Cashier and stocker at Safeway for three years.

EXPERIENCE
Cashier at Safeway | 2019 - 2022
Cooking
Cleaning
Register`;
  const tour = buildResumeTour(page)!;
  assert.equal(tour.strongNote, undefined);
  assert.ok(tour.steps.some((s) => s.line === "Cooking"));
});

test("r1 H1: nothing marked but no proof of strength gets a neutral line, not praise", () => {
  const page = `Pat Example
Billings, MT | pat.example@example.com
Cashier

EXPERIENCE
Cashier | Safeway | 2019 - 2022
Cashier | Corner Mart | 2016 - 2019`;
  const tour = buildResumeTour(page)!;
  assert.equal(tour.steps.length, 0);
  assert.equal(tour.strongNote, undefined);
  assert.equal(tour.readNote, READ_NOTE);
  assert.doesNotMatch(READ_NOTE, /strong|great|good|clean/i);
});

test("r1 L4: follow-up notes describe the line, never promise a fix", () => {
  const tour = buildResumeTour(WEAK_RESUME)!;
  const all = tour.steps.map((s) => s.note).join(" ");
  assert.doesNotMatch(all, /\bIt gets\b|gets broken|\bwill be\b|I'll fix|I will fix/i);
  const src = readFileSync(join(import.meta.dirname, "..", "showstopper-tour.ts"), "utf8");
  assert.doesNotMatch(src, /It gets a real verb|gets broken into bullets/);
});

test("r1 L6: a mark lands on the copy of a repeated line it is about", () => {
  const page = `Joy Example
Havre, MT | joy.example@example.com
Clerk

SKILLS
Cleaning

EXPERIENCE
Clerk | Hi-Line Market | Havre, MT | 2020 - 2024
Cleaning
Stocking`;
  const tour = buildResumeTour(page)!;
  const lines = pageLines(page);
  const step = tour.steps.find((s) => s.line === "Cleaning")!;
  assert.ok(step);
  assert.equal(step.lineIndex, lines.lastIndexOf("Cleaning"), "the job copy, not the skills copy");
});
