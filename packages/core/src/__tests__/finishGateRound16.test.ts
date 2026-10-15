/**
 * Finish gate, re-check round 16 (core). Fictional fixtures.
 *
 * R16-B1: a job of theirs read without years never settles a header when they
 * have another job at the same employer with a different title (a promotion).
 * "Title at Employer" takes its years from the next line when that line is only
 * a year range. A sentence naming the title settles a header only when it is
 * their only job there, or its years cover the header's years.
 * Follow-up 1: an own-job sentence under a future, plan or condition frame is
 * never their job. Follow-up 2: honest pasted headers in dash, tab,
 * employer-first and two- or three-line shapes are read as their jobs, with the
 * same strictness (employer and years).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { getResumeStatus } from "../resumeStatus";

const C = "Sam Ortiz\n419-555-0177 | sam.ortiz@example.com | Toledo, OH\n\nWORK HISTORY\n";
const PAGE = (...headers: string[]) => `SAM ORTIZ\nToledo, OH | sam.ortiz@example.com\n\nPROFESSIONAL EXPERIENCE\n${headers.map((h) => `${h}\n- Ran the register`).join("\n")}`;
const titledLines = (page: string, src: string) => getResumeStatus({ resumeText: page, sourceText: src }).openItems.filter((i) => i.kind === "title_unsaid").map((i) => i.line);
const titled = (header: string, src: string) => titledLines(PAGE(header), src).length > 0;

const MERGED = "SHIFT LEAD | Kroger | Toledo, OH | 2016 - 2023";
const EARLY = "SHIFT LEAD | Kroger | Toledo, OH | 2016 - 2019";
const LATE = "SHIFT LEAD | Kroger | Toledo, OH | 2019 - 2023";
const CASHIER = "CASHIER | Kroger | Toledo, OH | 2016 - 2019";

test("R16-B1: 'Title at Employer' takes its years from the next line", () => {
  const up = C + "Shift Lead at Kroger\n2019 - 2023\nopened the store, ran the register\n\nCashier at Kroger\n2016 - 2019\nran the register";
  assert.ok(titled(MERGED, up), "merged span");
  assert.deepEqual(titledLines(PAGE(LATE, EARLY), up), [EARLY], "higher title on the earlier years");
  assert.deepEqual(titledLines(PAGE(LATE, CASHIER), up), [], "honest page");
  const months = C + "Shift Lead at Kroger\nJune 2019 - Present\nopened the store\n\nCashier at Kroger\nMarch 2016 - June 2019\nran the register";
  assert.ok(titled(MERGED, months), "month-year lines, merged span");
  assert.ok(titled(EARLY, months), "month-year lines, earlier years");
});

test("R16-B1: a sentence without years never settles a promotion's header", () => {
  const promo = C + "Cashier | Kroger | 2016 - 2019\nran the register\n\nShift Lead | Kroger | 2019 - 2023\nopened the store";
  for (const s of ["I was a shift lead at Kroger.", "My job at Kroger was shift lead.", "I worked as a shift lead at Kroger.", "Shift lead at Kroger."]) {
    assert.ok(titled(MERGED, `${promo}\n${s}`), `merged: ${s}`);
  }
  assert.deepEqual(titledLines(PAGE(LATE, EARLY), `${promo}\nI was the shift lead at Kroger, I opened the store.`), [EARLY]);
  assert.deepEqual(titledLines(PAGE(LATE, CASHIER), `${promo}\nI was a shift lead at Kroger.`), [], "honest page");
  // Neither job dated: two titles there, so neither settles a dated header.
  assert.ok(titled(LATE, C + "Shift Lead at Kroger\nopened the store\n\nCashier at Kroger\nran the register"));
});

test("R16-B1: a sentence settles a header when it is their only job there, or its years cover", () => {
  assert.ok(!titled(LATE, C + "I was a shift lead at Kroger.\nI opened the store."), "their only job at Kroger");
  assert.ok(!titled("SHIFT LEAD | Kroger | 2019 - 2023", C + "Shift Lead | Kroger\n2019 - 2023\nopened the store"), "bar header, years on the next line");
  assert.ok(!titled(MERGED, C + "Cashier | Kroger | 2016 - 2019\nI was a shift lead at Kroger from 2016 to 2023."), "sentence years cover the page");
  assert.ok(titled(MERGED, C + "Cashier | Kroger | 2016 - 2019\nI was a shift lead at Kroger from 2019 to 2023."), "sentence years do not cover");
});

test("R16 follow-up 1: a future, plan or condition frame is never an own job", () => {
  const cashier = C + "Cashier | Kroger | 2016 - 2023\nran the register";
  for (const s of [
    "I am the shift lead at Kroger starting Monday.",
    "Shift lead at Kroger next year hopefully.",
    "I am a shift lead at Kroger once they sign the papers.",
    "I am the shift lead at Kroger if they promote me.",
    "I am the shift lead at Kroger soon.",
    "Shift lead at Kroger someday.",
    "My job at Kroger is shift lead starting next week.",
    "If they promote me I was the shift lead at Kroger.",
    "I worked as a shift lead at Kroger if they count the summer.",
  ]) {
    assert.ok(titled("SHIFT LEAD | Kroger | Toledo, OH | 2016 - 2023", `${cashier}\n${s}`), s);
  }
  // Past sentences keep their own time words, and an employer's name is never a frame.
  assert.ok(!titled("SHIFT LEAD | Kroger | 2019 - 2023", C + "I was a shift lead at Kroger when the store opened."));
  assert.ok(!titled("SHIFT LEAD | Kroger | 2019 - 2023", C + "I was the shift lead at Kroger and would open the store at 5."));
  assert.ok(!titled("CASHIER | Next Level Staffing | 2019 - 2023", C + "Cashier at Next Level Staffing\n2019 - 2023"));
});

test("R16 follow-up 2: honest pasted headers in dash, tab, employer-first and multi-line shapes", () => {
  for (const [label, up] of [
    ["hyphens", "Cashier - Kroger - 2016 - 2019"],
    ["en dashes", "Cashier – Kroger – 2016 – 2019"],
    ["em dashes", "Cashier — Kroger — 2016–2019"],
    ["tabs", "Cashier\tKroger\t2016 - 2019"],
    ["employer first, bars", "Kroger | Cashier | 2016 - 2019"],
    ["employer first, tabs", "Kroger\tCashier\t2016 - 2019"],
    ["three lines", "Cashier\nKroger, Toledo, OH\n2016 - 2019"],
    ["two lines", "Cashier\nKroger, Toledo, OH 2016 - 2019"],
    ["employer line, then title and years", "Kroger, Toledo, OH\nCashier, 2016 - 2019"],
  ] as Array<[string, string]>) {
    const src = `${C}${up}\nran the register`;
    assert.ok(!titled(CASHIER, src), `${label}: their own job`);
    assert.ok(titled("CASHIER | Dollar General | Toledo, OH | 2016 - 2019", src), `${label}: another employer`);
    assert.ok(titled("CASHIER | Kroger | Toledo, OH | 2014 - 2019", src), `${label}: years not covered`);
    assert.ok(titled("SHIFT LEAD | Kroger | Toledo, OH | 2016 - 2019", src), `${label}: another title`);
  }
  // An employer block with two titles, the second under a duty line.
  const block = C + "Kroger\nShift Lead, 2019 - 2023\nopened the store, ran the register\nCashier, 2016 - 2019\nran the register";
  assert.deepEqual(titledLines(PAGE(LATE, CASHIER), block), []);
  assert.deepEqual(titledLines(PAGE(LATE, EARLY), block), [EARLY]);
  // A dash line without years is not a header.
  assert.ok(titled(CASHIER, C + "Cashier - Kroger\nran the register"));
});

test("R16 follow-up 2: a four-job dash-header paste clears an honest page", () => {
  const up =
    C +
    "Warehouse Associate - Midwest Distribution - 2021 - 2023\npicked orders, loaded trucks\n\n" +
    "Shift Lead — Kroger — 2019–2021\nopened the store\n\n" +
    "Cashier — Kroger — 2017–2019\nran the register\n\n" +
    "Dishwasher - Burger Barn - 2015 - 2017\nwashed dishes";
  const page = PAGE(
    "WAREHOUSE ASSOCIATE | Midwest Distribution | Toledo, OH | 2021 - 2023",
    "SHIFT LEAD | Kroger | Toledo, OH | 2019 - 2021",
    "CASHIER | Kroger | Toledo, OH | 2017 - 2019",
    "DISHWASHER | Burger Barn | Toledo, OH | 2015 - 2017",
  );
  assert.deepEqual(titledLines(page, up), []);
  assert.deepEqual(titledLines(PAGE("SHIFT LEAD | Kroger | Toledo, OH | 2017 - 2021"), up), ["SHIFT LEAD | Kroger | Toledo, OH | 2017 - 2021"], "merged promotion");
});

test("R16 follow-up 2: an indented sentence is still read, and a heading ends an employer's block", () => {
  assert.ok(!titled(LATE, `${C}Kroger\n\tI was the shift lead at Kroger from 2019 to 2023.`), "tab-indented sentence");
  // "GED, 2014" under EDUCATION is never a job at the employer above it.
  const src = C + "Kroger\nShift Lead, 2019 - 2023\nopened the store\n\nEDUCATION\nGED, 2014\n\nI was a shift lead at Kroger.";
  assert.ok(!titled("SHIFT LEAD | Kroger | Toledo, OH | 2019 - 2023", src));
  assert.ok(!titled("SHIFT LEAD | Kroger | Toledo, OH", C + "I was a shift lead at Kroger.\n\nEDUCATION\nGED, 2014"));
});
