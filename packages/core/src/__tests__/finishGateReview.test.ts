/**
 * Gate review fixes (phase 2 review of the finish page). Fictional fixtures.
 *
 * B1: a short headline is skipped only when it claims nothing new.
 * B2: a rewrite counts only for what it introduced (introducedWords).
 * B3: an answer has to explain something; number words are numbers.
 * S4: word numbers and "3x" findings point at the right line.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { getResumeStatus, pickDefendLines, type DefendAnswer } from "../resumeStatus";
import * as status from "../resumeStatus";
import { runMintCheck, numbersIn } from "../resumeMintCheckShared";

const SOURCE = `Morgan Sample
Toledo, OH | morgan@example.com
Line cook at Harbor Street Diner from 2019 to 2023.
I ran the grill on the breakfast line, prepped vegetables before open, and closed the kitchen at night.
I took a forklift training class in 2019.
The owner asked me to show new cooks the grill.`;

const withHeadline = (h: string) => `MORGAN SAMPLE
${h}
Toledo, OH | morgan@example.com

PROFESSIONAL EXPERIENCE
LINE COOK | Harbor Street Diner | 2019 - 2023
- Ran the grill on the breakfast line.
- Prepped vegetables before open and closed the kitchen at night.
- Asked by the owner to show new cooks the grill.`;

const GOOD = "I did that at the diner most shifts, the owner can say so.";
const answerOthers = (resume: string, except: string): DefendAnswer[] =>
  pickDefendLines(resume, SOURCE)
    .filter((d) => d.line !== except)
    .map((d) => ({ line: d.line, answer: GOOD, verdict: "stands" as const }));

// ---- B1 ------------------------------------------------------------------------

for (const h of ["Executive Chef and Team Leader", "Award-winning culinary leader", "Certified Kitchen Manager", "Kitchen Supervisor, ServSafe Certified"]) {
  test(`B1: the headline "${h}" is a defend line and keeps the page in draft`, () => {
    const resume = withHeadline(h);
    // Asked about, or (a credential the person never mentioned) held by a BLOCK only a change or a cut settles.
    assert.ok(pickDefendLines(resume, SOURCE).some((d) => d.line === h) || /ServSafe/.test(h), "asked about");
    const s = getResumeStatus({ resumeText: resume, sourceText: SOURCE, defendAnswers: answerOthers(resume, h) });
    assert.equal(s.state, "draft");
    assert.ok(s.openItems.some((i) => i.line === h && i.severity === "BLOCK"), JSON.stringify(s.openItems));
  });
}

test("B1: a headline naming a job title on the page stays skipped", () => {
  const resume = withHeadline("Line Cook");
  assert.ok(!pickDefendLines(resume, SOURCE).some((d) => d.line === "Line Cook"));
  const s = getResumeStatus({ resumeText: resume, sourceText: SOURCE, defendAnswers: answerOthers(resume, "Line Cook") });
  assert.equal(s.state, "finished", JSON.stringify(s.openItems));
});

// ---- B3 ------------------------------------------------------------------------

const P3 = `MORGAN SAMPLE
Toledo, OH | morgan@example.com

PROFESSIONAL EXPERIENCE
LINE COOK | Harbor Street Diner | 2019 - 2023
- Managed inventory and vendor relationships for the restaurant.
- Coordinated catering events for corporate clients.
- Ran the grill on the breakfast line.`;

for (const ans of ["y", "yes", "true", "ok", "it's true", "correct", "That's right.", "Yes I did"]) {
  test(`B3: the answer "${ans}" does not settle a defend line`, () => {
    const a = pickDefendLines(P3, SOURCE).map((d) => ({ line: d.line, answer: ans, verdict: "stands" as const }));
    const s = getResumeStatus({ resumeText: P3, sourceText: SOURCE, defendAnswers: a });
    assert.equal(s.state, "draft");
    assert.ok(s.openItems.some((i) => i.rule === "STD-C04"));
  });
}

test("B3: pasting the line back is not an answer", () => {
  const a = pickDefendLines(P3, SOURCE).map((d) => ({ line: d.line, answer: d.line.replace(/^- /, ""), verdict: "stands" as const }));
  assert.equal(getResumeStatus({ resumeText: P3, sourceText: SOURCE, defendAnswers: a }).state, "draft");
});

test("B3: a real explanation still settles the line", () => {
  const a = pickDefendLines(P3, SOURCE).map((d) => ({ line: d.line, answer: "I counted the walk-in and called the produce guy every Monday.", verdict: "stands" as const }));
  assert.equal(getResumeStatus({ resumeText: P3, sourceText: SOURCE, defendAnswers: a }).state, "finished");
});

test("B3: number words count as numbers", () => {
  assert.ok(numbersIn("Loaded a dozen trucks a day.").has("12"));
  assert.ok(numbersIn("Fed hundreds of guests.").has("~100s"));
  assert.ok(numbersIn("Loaded fifty trucks.").has("50"));
  assert.equal(numbersIn("Double-checked every order twice.").size, 0, "no false counts");
});

test("B3: 'a dozen' the writer added is an unsourced number, and 'y' does not finish it", () => {
  const resume = P3.replace("Ran the grill on the breakfast line.", "Loaded a dozen trucks a day.");
  const r = runMintCheck({ output: resume, source: SOURCE, kind: "resume" });
  assert.ok(r.findings.some((f) => f.rule === "STD-T02" && f.severity === "BLOCK"));
  const a = pickDefendLines(resume, SOURCE).map((d) => ({ line: d.line, answer: "y", verdict: "stands" as const }));
  assert.equal(getResumeStatus({ resumeText: resume, sourceText: SOURCE, defendAnswers: a }).state, "draft");
});

// ---- S4 ------------------------------------------------------------------------

test("S4: a word number finding names the line with the word, not the bare digit", () => {
  const resume = P3.replace("Ran the grill on the breakfast line.", "Loaded fifty trucks a day.");
  const f = runMintCheck({ output: resume, source: SOURCE, kind: "resume" }).findings.find((x) => x.rule === "STD-T02");
  assert.equal(f?.line, "- Loaded fifty trucks a day.");
});

test("S4: '3x' is found on its own line, not inside a year on the job header", () => {
  const resume = P3.replace("Ran the grill on the breakfast line.", "Served 3x more tables than the other cooks.");
  const f = runMintCheck({ output: resume, source: SOURCE, kind: "resume" }).findings.find((x) => x.rule === "STD-T02");
  assert.equal(f?.line, "- Served 3x more tables than the other cooks.");
});

// ---- B2 ------------------------------------------------------------------------

test("B2: a rewrite introduces only words and numbers that were not in the replaced line", () => {
  const introduced = (status as Record<string, unknown>).introducedWords as ((a: string, b: string) => string) | undefined;
  assert.equal(typeof introduced, "function");
  assert.equal(introduced!("Forklift Certified, 2019.", "Forklift Certified, 2019"), "");
  assert.equal(introduced!("Forklift Certified, 2019 (current)", "Forklift Certified, 2019"), "current");
  // The written 50 typed back is not theirs; only the new word is.
  assert.equal(introduced!("Loaded 50 trucks each day.", "Loaded 50 trucks a day."), "each");
  assert.equal(introduced!("Loaded fifty trucks a day.", "Loaded 50 trucks a day."), "");
  assert.equal(introduced!("Loaded about 30 trucks on Sundays.", "Loaded 50 trucks a day."), "about 30 on Sundays");
});

test("B2: a rewrite stands only when every word of its line is now the person's", () => {
  const line = "- Spearheaded kitchen operations and supervised the culinary team!";
  const rewrite: DefendAnswer = {
    line,
    answer: "Spearheaded kitchen operations and supervised the culinary team!",
    verdict: "stands",
    kind: "rewrite",
    replaced: "- Spearheaded kitchen operations and supervised the culinary team.",
  };
  const resume = P3.replace("- Coordinated catering events for corporate clients.", line);
  const s = getResumeStatus({ resumeText: resume, sourceText: SOURCE, defendAnswers: [rewrite] });
  assert.ok(s.openItems.some((i) => i.line === line && i.rule === "STD-C04"), "a punctuation edit explains nothing");
  // A rewrite with no replaced line is never trusted.
  const own: DefendAnswer = { line: "- Ran the grill on the breakfast line.", answer: "Ran the grill on the breakfast line.", verdict: "stands", kind: "rewrite" };
  assert.equal(status.answerStands(own, own.line, SOURCE), false);
});
