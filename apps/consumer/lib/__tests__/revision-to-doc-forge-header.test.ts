import { test } from "node:test";
import assert from "node:assert/strict";
import { resumeTextToDocument } from "../revision-to-doc";

// The Forge writer's own page shape (lib/forge-resume-prompt.ts): name, one contact line, a blank, one
// headline line, a blank, then the sections. Seen on the 2026-11-04 production run: the headline landed in
// the summary and the city with a ZIP was dropped from the contact block.
const FORGE_PAGE = [
  "MARQUS RELLY",
  "Milwaukee, WI 53206 | (414) 555-0126 | marqus.relly@marqus-relly.example.invalid",
  "",
  "Warehouse Shift Lead and Forklift Operator",
  "",
  "CAREER SUMMARY",
  "Warehouse worker who ran second shift at Northgate Parts Distribution for four years.",
  "",
  "CORE COMPETENCIES",
  "Forklift operation, order picking, RF scanner",
  "",
  "PROFESSIONAL EXPERIENCE",
  "Shift Lead | Northgate Parts Distribution | Milwaukee, WI | 2012 - 2016",
  "- Ran second shift for four years.",
  "",
  "EDUCATION",
  "High School Diploma | Milwaukee, WI | 2003",
].join("\n");

test("the headline after the blank line is the document headline, not the start of the summary", () => {
  const doc = resumeTextToDocument(FORGE_PAGE);
  assert.equal(doc.headline, "Warehouse Shift Lead and Forklift Operator");
  assert.equal(doc.summary, "Warehouse worker who ran second shift at Northgate Parts Distribution for four years.");
  assert.equal(doc.experience.length, 1);
  assert.equal(doc.experience[0].title, "Shift Lead");
  assert.deepEqual(doc.skills, ["Forklift operation", "order picking", "RF scanner"]);
});

test("a city line with a ZIP still fills city and state", () => {
  const doc = resumeTextToDocument(FORGE_PAGE);
  assert.equal(doc.contact.name, "Marqus Relly");
  assert.equal(doc.contact.city, "Milwaukee");
  assert.equal(doc.contact.state, "WI");
  assert.equal(doc.contact.phone, "(414) 555-0126");
  assert.equal(doc.contact.email, "marqus.relly@marqus-relly.example.invalid");
});

test("a page with the headline inside the header block is unchanged", () => {
  const doc = resumeTextToDocument("JANE TESTER\nCertified Welder\nMilwaukee, WI | (555) 010-0100\n\nSUMMARY\nHello there.\n");
  assert.equal(doc.headline, "Certified Welder");
  assert.equal(doc.summary, "Hello there.");
  assert.equal(doc.contact.city, "Milwaukee");
});

test("a sentence after the blank line stays in the body", () => {
  const doc = resumeTextToDocument("JANE TESTER\nMilwaukee, WI\n\nI weld pipe and I show up.\n\nSUMMARY\nHello there.\n");
  assert.equal(doc.headline, undefined);
  assert.match(JSON.stringify(doc), /I weld pipe and I show up\./);
});
