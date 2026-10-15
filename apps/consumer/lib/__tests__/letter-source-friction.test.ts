import { test } from "node:test";
import assert from "node:assert/strict";
import { buildFinishView } from "../finish-gate";
import { untracedFacts } from "../fact-trace";

const source = "ALEX EXAMPLE\nEXPERIENCE\nPacker | Example Supply | 2021 - 2022\nPacked orders.\nEDUCATION\nHigh school diploma | Example High School | 2020";
const resume = source.replace("Packed orders.", "- Packed orders.");
const checked = (letter: string) => buildFinishView({
  resumeText: resume, coverLetterText: letter, ownWords: source, ownResumeText: source,
  written: { resume, letter }, defendAnswers: [],
  grounding: { rewordingA: true, verifierRan: true, verifierRanByDoc: { resume: true, cover_letter: true }, hasFabrication: false, hasFabricationByDoc: { resume: false, cover_letter: false }, flags: [], outcomes: [] },
});

test("first-person contractions are not invented names; their factual tails are checked", () => {
  for (const sentence of ["I'd like to talk with you about the job.", "I’m looking for work.", "I've packed orders."]) {
    assert.ok(!untracedFacts(sentence, source).some((f) => f.kind === "name"), sentence);
  }
  assert.ok(untracedFacts("I've trained 12 workers.", source).some((f) => f.kind === "number"));
});

test("a checked letter can name the supported placeholder and source-backed diploma", () => {
  const letter = "I packed orders, and I'm interested in work with [Company Name].\nI hold a high school diploma from Example High School.\nI'd like to talk with you about the job.";
  assert.deepEqual(checked(letter).openItems.filter((i) => i.target === "letter"), []);
});

test("placeholder and courtesy do not exempt new facts or upgraded credentials", () => {
  for (const letter of [
    "I'd like to join [Company Name], bringing 12 years of experience.",
    "I've trained 12 workers and would like to talk with [Company Name].",
    "I hold a nursing license and would like to join [Company Name].",
  ]) assert.ok(checked(letter).openItems.some((i) => i.target === "letter"), letter);
});
