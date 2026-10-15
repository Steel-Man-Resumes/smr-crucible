/**
 * Lane 3a, part 1: the free checker (/check). No sign-in, no AI call, nothing stored.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FREE_CHECK_CTA, freeCheckSummary, runFreeCheck } from "../free-check";
import { checkFileKind } from "../text-extraction";

const root = join(import.meta.dirname, "..", "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

describe("the free checker", () => {
  const GOOD = [
    "MORGAN SAMPLE",
    "Toledo, OH | morgan@example.com | 555-555-0100",
    "",
    "EXPERIENCE",
    "Line Cook | Harbor Street Diner | 2019 - 2023",
    "- Ran the grill on the breakfast line.",
    "Prep Cook | Corner Cafe | 2016 - 2019",
    "- Prepped vegetables before open.",
    "",
    "SKILLS",
    "Grill, prep, closing",
  ].join("\n");

  it("a clean resume read from a real text file passes, with no score anywhere", () => {
    const r = runFreeCheck({ text: GOOD, read: "text", now: Date.parse("2026-10-07T00:00:00Z") });
    assert.equal(r.mustFix, 0);
    assert.equal(r.toFix, 0);
    assert.deepEqual(r.sections.map((s) => s.id), ["machine", "rules", "dates"]);
    const all = JSON.stringify(r) + freeCheckSummary(r);
    assert.doesNotMatch(all, /score|%|\/100|out of/i);
    assert.equal(freeCheckSummary(r), "Nothing to fix in the checks we ran.");
  });

  it("a resume with no dates is a fix-first", () => {
    const text = "MORGAN SAMPLE\nmorgan@example.com\nEXPERIENCE\nLine Cook | Harbor Street Diner\n- Ran the grill.\n- Closed at night.";
    const r = runFreeCheck({ text, read: "pasted" });
    assert.ok(r.mustFix >= 1);
    const rules = r.sections.find((s) => s.id === "rules")!;
    assert.ok(rules.items.some((i) => i.verdict === "must-fix" && /dates/i.test(i.detail || "")));
  });

  it("dates and gaps: a gap of a year or more is named, never as an accusation", () => {
    const text = GOOD.replace("Prep Cook | Corner Cafe | 2016 - 2019", "Prep Cook | Corner Cafe | 2012 - 2015");
    const r = runFreeCheck({ text, read: "text" });
    const dates = r.sections.find((s) => s.id === "dates")!;
    assert.ok(dates.items.some((i) => i.verdict === "fix" && /gap/i.test(i.title)));
  });

  it("a picture of text, or no text at all, is a fix-first; pasted text is only a note", () => {
    assert.equal(runFreeCheck({ text: GOOD, read: "picture" }).sections[0].items[0].verdict, "must-fix");
    const none = runFreeCheck({ text: "", read: "none" });
    assert.equal(none.sections.length, 1);
    assert.equal(none.sections[0].items[0].verdict, "must-fix");
    assert.equal(runFreeCheck({ text: GOOD, read: "pasted" }).sections[0].items[0].verdict, "note");
  });

  it("contact line and section names", () => {
    const r = runFreeCheck({ text: "MORGAN SAMPLE\nJOBS\nLine Cook 2019 - 2023", read: "text" });
    const machine = r.sections[0].items.map((i) => i.verdict);
    assert.deepEqual(machine, ["good", "fix", "fix"]);
  });

  it("ends with the sign-in line, and its copy has no dashes or labels", () => {
    assert.equal(FREE_CHECK_CTA, "Sign in free to fix these with t.ROY");
    const page = read("app/(forge)/check/page.tsx");
    const lib = read("lib/free-check.ts");
    for (const src of [page, lib]) {
      assert.doesNotMatch(src.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ""), /[–—]/);
      assert.doesNotMatch(src, /\b(felon|ex-con|offender|inmate)\b/i);
    }
  });

  it("the page runs the checks in the browser and calls no AI route", () => {
    const page = read("app/(forge)/check/page.tsx");
    assert.match(page, /runFreeCheck\(/);
    assert.match(page, /<PageFitLine/);
    // Calls in code only (the header comment names the layout route PageFitLine uses).
    const code = page.replace(/\/\*[\s\S]*?\*\//g, "");
    const apis = code.match(/\/api\/[a-z/-]+/g) || [];
    assert.deepEqual(Array.from(new Set(apis)), ["/api/check/extract"]);
    const route = read("app/api/check/extract/route.ts");
    assert.doesNotMatch(route, /callAI|anthropic|openai|INSERT|query\(/i);
    assert.doesNotMatch(route, /console\.log/);
  });

  it("file kinds", () => {
    assert.equal(checkFileKind("Resume.PDF", ""), "pdf");
    assert.equal(checkFileKind("r.docx", ""), "word");
    assert.equal(checkFileKind("r.doc", "application/msword"), "word");
    assert.equal(checkFileKind("scan.jpg", "image/jpeg"), "image");
    assert.equal(checkFileKind("r.txt", "text/plain"), "text");
    assert.equal(checkFileKind("r.exe", "application/octet-stream"), null);
    assert.equal(checkFileKind("r.html", "text/html"), null);
  });
});
