import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildResumeTour,
  jobCardsFrom,
  limitResetLabel,
  elapsedLabel,
  buildFailure,
  CLEAN_NOTE,
  TOUR_CAP,
} from "../showstopper-tour";
import { DEMO_SESSION } from "../demo-data";
import { FLAWED_RESUME } from "./fixtures/showstopper-resume";

const CLEAN_RESUME = `Alex Rivera
Line Cook | Harbor Grill | 2021 - 2023
- Cooked for 200 covers a night.
- Kept the line stocked.`;

test("no page means no tour (never a fake before)", () => {
  assert.equal(buildResumeTour(""), null);
  assert.equal(buildResumeTour("   \n  \n"), null);
  assert.equal(buildResumeTour(undefined), null);
  assert.equal(buildResumeTour(null), null);
});

test("a clean page gets the clean note and no steps", () => {
  const tour = buildResumeTour(CLEAN_RESUME)!;
  assert.ok(tour);
  assert.equal(tour.steps.length, 0);
  assert.equal(tour.cleanNote, CLEAN_NOTE);
  assert.equal(CLEAN_NOTE, "Your page is already clean on the basics.");
});

test("real flaws become steps, anchored to the right raw line", () => {
  const tour = buildResumeTour(FLAWED_RESUME)!;
  assert.ok(tour.steps.length >= 3, `expected at least 3 steps, got ${tour.steps.length}`);
  assert.equal(tour.cleanNote, undefined);
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

test("ordered by severity, then by where the line sits on the page", () => {
  const tour = buildResumeTour(FLAWED_RESUME)!;
  const rank = (s: { severity: string }) => (s.severity === "BLOCK" ? 0 : 1);
  for (let i = 1; i < tour.steps.length; i++) {
    const a = tour.steps[i - 1];
    const b = tour.steps[i];
    assert.ok(rank(a) < rank(b) || (rank(a) === rank(b) && a.lineIndex < b.lineIndex), `step ${i} out of order`);
  }
  assert.equal(tour.steps[0].severity, "BLOCK");
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
  const tour = buildResumeTour(FLAWED_RESUME)!;
  for (const s of tour.steps) {
    assert.doesNotMatch(s.note, /STD-|\b[A-Z]{3}-[A-Z]\d|\bBLOCK\b|\bFIX\b|mint|rule/i, s.note);
    assert.doesNotMatch(s.note, /[–—]|--/, "no long dashes in notes");
  }
});

test("a note never brings in a digit the line does not carry", () => {
  for (const text of [FLAWED_RESUME, DEMO_SESSION.resumeText!]) {
    const tour = buildResumeTour(text)!;
    for (const s of [...tour.steps]) {
      for (const d of s.note.match(/\d/g) ?? []) {
        assert.ok(s.line.includes(d), `note adds digit ${d}: ${s.note}`);
      }
    }
  }
});

test("notes are short: one to three sentences", () => {
  const tour = buildResumeTour(FLAWED_RESUME)!;
  for (const s of tour.steps) {
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
  assert.equal(tour.steps.length, 2);
  assert.notEqual(tour.steps[0].note, tour.steps[1].note);
  assert.match(tour.steps[1].note, /either|same/i);
});

test("a job whose dates sit on the next line is not called dateless", () => {
  // The checker reads "June 2021 - Present (3 years)" as not a date line.
  const tour = buildResumeTour(DEMO_SESSION.resumeText)!;
  assert.ok(!tour.steps.some((s) => s.line.startsWith("Warehouse Associate")), "demo job has dates on the line below");
});

test("the demo resume still gets a tour or the clean note", () => {
  const tour = buildResumeTour(DEMO_SESSION.resumeText)!;
  assert.ok(tour.steps.length > 0 || tour.cleanNote === CLEAN_NOTE);
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
