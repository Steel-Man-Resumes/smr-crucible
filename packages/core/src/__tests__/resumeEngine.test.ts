/**
 * Resume engine: one rulebook, the draft/finished status contract, and the
 * defend-step line picker. Fixtures are fictional (fixtures-resume-engine.ts).
 *
 * Run: npm test  (node --import tsx --test, no extra deps)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  RESUME_RULES,
  RESUME_RULES_VERSION,
  resumeRulesBlock,
  rulesFor,
  rulesForStd,
} from "../resumeRules";
import { runMintCheck } from "../resumeMintCheckShared";
import { getResumeStatus, pickDefendLines, questionForFinding, type DefendAnswer } from "../resumeStatus";
import { computeFitPlan } from "../pageFit";
import { THIN, NO_NUMBERS, HELPED_UNDER, CREDENTIAL_NO_STATUS, ONE_BLOCK, TWO_PAGE } from "./fixtures-resume-engine";

/** Answer every defend line in the person's own words (a fixture stand-in for the defend step). */
const answerAll = (resume: string, source: string, answer = "That is what I did, in my words."): DefendAnswer[] =>
  pickDefendLines(resume, source).map((d) => ({ line: d.line, answer }));

// ---- rulebook --------------------------------------------------------------

test("rulebook: versioned, ids unique, every block carries the version", () => {
  assert.match(RESUME_RULES_VERSION, /^resume-rules\/\d{4}-\d{2}-\d{2}\.\d+$/);
  const ids = RESUME_RULES.map((r) => r.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const scope of ["truth", "page", "fix"] as const) {
    const block = resumeRulesBlock(scope);
    assert.ok(block.includes(RESUME_RULES_VERSION), scope);
    for (const r of rulesFor(scope)) assert.ok(block.includes(r.text), r.id);
  }
});

test("rulebook: shared or supervised work keeps its scope; no outright ban on helped", () => {
  const truth = resumeRulesBlock("truth");
  assert.match(truth, /"helped with X under the operator" stays/);
  assert.match(truth, /Never make a shared task a sole one/);
  assert.match(truth, /only when the person's words support that action/);
  assert.doesNotMatch(truth, /never[^.\n]*"helped with"/i);
  assert.doesNotMatch(truth, /never[^.\n]*"assisted in"/i);
});

test("rulebook: skills are one column, never three columns or a grid", () => {
  const page = resumeRulesBlock("page");
  assert.match(page, /one column/i);
  assert.doesNotMatch(page, /3 columns|three columns|columns separated/i);
  for (const r of RESUME_RULES) assert.doesNotMatch(r.text, /3 columns|in \w+ columns separated/i, r.id);
});

test("rulebook: keeps the existing truth rules", () => {
  const truth = resumeRulesBlock("truth");
  assert.match(truth, /Never invent a number/);
  assert.match(truth, /never a dateless functional page/);
  assert.match(truth, /never push for a number/);
  assert.match(truth, /follows the request's own rule/);
  assert.match(truth, /never called current, active, valid or renewable/);
});

test("rulebook: every checker rule id maps back to a rulebook rule", () => {
  for (const std of ["STD-T01", "STD-T02", "STD-T03", "STD-T05", "STD-T07", "STD-F01", "STD-F02", "STD-F05", "STD-C07", "STD-A02"]) {
    assert.ok(rulesForStd(std).length > 0, std);
  }
});

test("mint check reports the rulebook version it graded against", () => {
  const r = runMintCheck({ output: NO_NUMBERS.resume, source: NO_NUMBERS.source, kind: "resume" });
  assert.equal(r.rulesVersion, RESUME_RULES_VERSION);
});

// ---- checker uses the same rules -------------------------------------------

test("checker: a true helped-under-the-operator line passes; the sole-actor rewrite is flagged", () => {
  const ok = runMintCheck({ output: HELPED_UNDER.faithful, source: HELPED_UNDER.source, kind: "resume" });
  assert.ok(!ok.findings.some((f) => f.kind === "sole_actor"), JSON.stringify(ok.findings));
  assert.match(HELPED_UNDER.faithful, /Helped with blowdown under the operator/);

  const bad = runMintCheck({ output: HELPED_UNDER.soleActor, source: HELPED_UNDER.source, kind: "resume" });
  const f = bad.findings.find((x) => x.kind === "sole_actor");
  assert.ok(f, JSON.stringify(bad.findings));
  assert.equal(f!.rule, "STD-T01");
  assert.match(f!.line, /Performed boiler blowdown/);
});

test("checker: one-column skills lines are read term by term, labels and commas included", () => {
  const src = "Drove a forklift and used an RF scanner.";
  const out = `JO EXAMPLE

CORE COMPETENCIES
Equipment: Forklift, RF scanner
Inventory forecasting`;
  const r = runMintCheck({ output: out, source: src, kind: "resume" });
  const terms = r.findings.filter((f) => f.kind === "grid_term").map((f) => f.line);
  assert.deepEqual(terms, ["Inventory forecasting"]);
});

// ---- status contract ---------------------------------------------------------

test("status: one open BLOCK means draft, with a question that adds no fact", () => {
  const s = getResumeStatus({ resumeText: ONE_BLOCK.resume, sourceText: ONE_BLOCK.source, defendAnswers: answerAll(ONE_BLOCK.resume, ONE_BLOCK.source) });
  assert.equal(s.state, "draft");
  const year = s.openItems.find((i) => i.rule === "STD-T05");
  assert.ok(year, JSON.stringify(s.openItems));
  assert.equal(year!.severity, "BLOCK");
  assert.match(year!.question, /What years did you do this, as best you know\?/);
  assert.doesNotMatch(year!.question, /\b(?:19|20)\d{2}\b/, "the question never suggests a year");
  assert.equal(s.rulesVersion, RESUME_RULES_VERSION);
});

test("status: a clean, defended page with no numbers is finished", () => {
  const s = getResumeStatus({ resumeText: NO_NUMBERS.resume, sourceText: NO_NUMBERS.source, defendAnswers: answerAll(NO_NUMBERS.resume, NO_NUMBERS.source) });
  assert.deepEqual(s.openItems.filter((i) => i.severity === "BLOCK"), []);
  assert.equal(s.state, "finished");
});

test("status: before the defend step, the same clean page is a draft with defend questions", () => {
  const s = getResumeStatus({ resumeText: NO_NUMBERS.resume, sourceText: NO_NUMBERS.source });
  assert.equal(s.state, "draft");
  const defend = s.openItems.filter((i) => i.rule === "STD-C04");
  assert.ok(defend.length >= 2);
  for (const d of defend) assert.equal(d.question, "Tell me in one sentence how you'd describe this line.");
});

test("status: requireDefend false skips only the defend items", () => {
  const s = getResumeStatus({ resumeText: NO_NUMBERS.resume, sourceText: NO_NUMBERS.source, requireDefend: false });
  assert.equal(s.state, "finished");
});

test("status: an answer marked cut or unsure keeps the line open", () => {
  const answers = answerAll(NO_NUMBERS.resume, NO_NUMBERS.source);
  answers[0] = { ...answers[0], verdict: "cut" };
  answers[1] = { ...answers[1], verdict: "unsure" };
  const s = getResumeStatus({ resumeText: NO_NUMBERS.resume, sourceText: NO_NUMBERS.source, defendAnswers: answers });
  assert.equal(s.state, "draft");
  const open = s.openItems.filter((i) => i.rule === "STD-C04").map((i) => i.line);
  assert.deepEqual(open, [answers[0].line, answers[1].line]);
  assert.equal(s.openItems.find((i) => i.line === answers[0].line)!.question, "OK to take this line off now?");
});

test("status: a number the person states in the defend step clears the added-number BLOCK", () => {
  const resume = NO_NUMBERS.resume.replace("Ran the grill on the breakfast line.", "Ran the grill for about 80 breakfasts a morning.");
  const before = getResumeStatus({ resumeText: resume, sourceText: NO_NUMBERS.source, defendAnswers: answerAll(resume, NO_NUMBERS.source) });
  const added = before.openItems.find((i) => i.rule === "STD-T02");
  assert.ok(added && added.severity === "BLOCK");
  assert.doesNotMatch(added!.question, /\d/, "the question never shows a number");
  assert.match(added!.question, /If you don't know a number, the line stays true without one/);

  const answers = answerAll(resume, NO_NUMBERS.source).map((a) =>
    /80/.test(a.line) ? { ...a, answer: "Most mornings it was about 80 breakfasts, we counted tickets." } : a
  );
  const after = getResumeStatus({ resumeText: resume, sourceText: NO_NUMBERS.source, defendAnswers: answers });
  assert.equal(after.state, "finished", JSON.stringify(after.openItems));
});

test("status: a credential with no type or status asks about it, without supplying one", () => {
  const s = getResumeStatus({ resumeText: CREDENTIAL_NO_STATUS.resume, sourceText: CREDENTIAL_NO_STATUS.source });
  const cred = s.openItems.find((i) => i.rule === "STD-T03");
  assert.ok(cred, JSON.stringify(s.openItems));
  assert.equal(cred!.severity, "FIX");
  assert.equal(cred!.question, `Was "Forklift Operator" a license, a certification, or a training course? Is it current, expired, or still in progress?`);
  // The defend step asks about it too, and its answer settles the status.
  const answers = answerAll(CREDENTIAL_NO_STATUS.resume, CREDENTIAL_NO_STATUS.source).map((a) =>
    /Forklift Operator$/.test(a.line) ? { ...a, answer: "It was the warehouse's forklift training, passed in 2021, expired now." } : a
  );
  const after = getResumeStatus({ resumeText: CREDENTIAL_NO_STATUS.resume, sourceText: CREDENTIAL_NO_STATUS.source, defendAnswers: answers });
  assert.ok(!after.openItems.some((i) => i.rule === "STD-T03"), JSON.stringify(after.openItems));
});

test("status: thin history with a dated class is not penalized for thinness", () => {
  const s = getResumeStatus({ resumeText: THIN.resume, sourceText: THIN.source, defendAnswers: answerAll(THIN.resume, THIN.source) });
  assert.equal(s.state, "finished", JSON.stringify(s.openItems));
});

test("status: no source or no resume is never finished", () => {
  assert.equal(getResumeStatus({ resumeText: NO_NUMBERS.resume, sourceText: "" }).state, "draft");
  assert.equal(getResumeStatus({ resumeText: "", sourceText: NO_NUMBERS.source }).state, "draft");
});

test("status: BLOCKs come before FIXes", () => {
  const s = getResumeStatus({ resumeText: HELPED_UNDER.soleActor.replace("2018 - 2022", "2017 - 2022"), sourceText: HELPED_UNDER.source });
  const sev = s.openItems.map((i) => i.severity);
  assert.deepEqual(sev, [...sev].sort((a, b) => (a === b ? 0 : a === "BLOCK" ? -1 : 1)));
});

test("questions: every rule the checker raises gets a plain question with no digits", () => {
  for (const rule of ["STD-T01", "STD-T02", "STD-T03", "STD-T05", "STD-T07", "STD-C05", "STD-C07", "STD-F01", "STD-F02", "STD-F05", "STD-F06", "STD-A02", "STD-C03"]) {
    const q = questionForFinding({ rule, line: "Line", why: `"word" here` });
    assert.match(q, /\?/, rule);
    assert.doesNotMatch(q, /\d/, rule);
  }
});

// ---- defend step -------------------------------------------------------------

test("defend: every number and every credential, plus the two lines furthest from the person's words", () => {
  const lines = pickDefendLines(TWO_PAGE.resume, TWO_PAGE.source);
  const numberLines = TWO_PAGE.resume
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => /^- /.test(l) && /\d/.test(l) && !/OSHA/.test(l));
  for (const l of numberLines) {
    assert.ok(lines.some((d) => d.line === l && d.reasons.includes("number")), `missing number line: ${l}`);
  }
  assert.ok(lines.some((d) => /OSHA 10 card/.test(d.line) && d.reasons.includes("credential")));
  const far = lines.filter((d) => d.reasons.includes("far_from_your_words"));
  assert.equal(far.length, 2);
  // The summary is written by the tool, so its lines sit furthest from the person's words.
  assert.ok(far.some((d) => /Delivery driver with warehouse/.test(d.line)), JSON.stringify(far));
});

test("defend: contact digits, years and skills terms are not defend lines", () => {
  const lines = pickDefendLines(TWO_PAGE.resume, TWO_PAGE.source).map((d) => d.line);
  assert.ok(!lines.some((l) => /@example\.com/.test(l)));
  assert.ok(!lines.some((l) => /^[A-Z ]+ \| /.test(l)), "job headers are not asked about");
  assert.ok(!lines.some((l) => /^Box truck, RF scanner/.test(l)));
});

test("defend: a page with fewer lines asks what it has", () => {
  const lines = pickDefendLines(THIN.resume, THIN.source);
  assert.ok(lines.length >= 2);
  assert.ok(lines.some((d) => d.reasons.includes("credential")));
});

test("two-page fixture really runs to two pages and stays finished once defended", () => {
  const plan = computeFitPlan(TWO_PAGE.resume, {});
  assert.equal(plan.result.pageCount, 2);
  const s = getResumeStatus({ resumeText: TWO_PAGE.resume, sourceText: TWO_PAGE.source, defendAnswers: answerAll(TWO_PAGE.resume, TWO_PAGE.source) });
  assert.deepEqual(s.openItems.filter((i) => i.severity === "BLOCK"), []);
  assert.equal(s.state, "finished");
});

test("checker: helping a customer is not shared work", () => {
  const src = "Cashier at Corner Market from 2016 to 2019. I helped customers find items and ran the register.";
  const out = `DANA EXAMPLE

PROFESSIONAL EXPERIENCE
CASHIER | Corner Market | 2016 - 2019
- Ran the register and showed customers where to find items.`;
  const r = runMintCheck({ output: out, source: src, kind: "resume" });
  assert.ok(!r.findings.some((f) => f.kind === "sole_actor"), JSON.stringify(r.findings));
});
