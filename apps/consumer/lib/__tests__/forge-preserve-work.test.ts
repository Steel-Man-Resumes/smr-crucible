import { test } from "node:test";
import assert from "node:assert/strict";
import { settleFinishPage } from "../auto-settle";
import { resumeStructureLoss } from "../resume-structure";

const source = `MORGAN SAMPLE
WORK EXPERIENCE
Production Manager\tMarch 2019 - Present
Example Glassworks, Milwaukee, WI
Responsible for managing day-to-day production operations
Supervised production employees and assigned daily work
Handled hiring, training, and scheduling of employees
Production Worker\tJune 2015 - March 2019
Example Lumber, Milwaukee, WI
Operated forklift and hoisting equipment
SKILLS
Forklift, scheduling, training`;
const resume = `MORGAN SAMPLE

Production Manager

CAREER SUMMARY
Production management and material-handling experience.

CORE COMPETENCIES
Forklift, scheduling, training

PROFESSIONAL EXPERIENCE
Production Manager | Example Glassworks | Milwaukee, WI | March 2019 - Present
- Supervise production employees and assign daily work.
- Manage day-to-day production operations.
Production Worker | Example Lumber | Milwaukee, WI | June 2015 - March 2019
- Operated forklift and hoisting equipment.`;

test("uploaded split headers and real supervision survive automatic finishing", async () => {
  const result = await settleFinishPage({ ownWords: source, ownResumeText: source,
    written: { resume, letter: "" }, grounding: { verifierRan: true, verifierRanByDoc: { resume: true }, rewordingA: true, sourceKind: "given" } },
    { resume, letter: "", answers: [], addedTerms: [], keptTerms: [], confirmed: [], remnants: [] }, async () => null);
  assert.match(result.state.resume, /Production Manager \| Example Glassworks/);
  assert.match(result.state.resume, /Supervise production employees/);
  assert.doesNotMatch(result.state.resume, /Helped supervise|Helped manage/i);
  assert.deepEqual(resumeStructureLoss(resume, result.state.resume), []);
});

test("a clean status cannot be bought by erasing whole resume sections", () => {
  assert.ok(resumeStructureLoss(resume, resume.replace("Production Manager | Example Glassworks | Milwaukee, WI | March 2019 - Present", "")).length);
  assert.deepEqual(resumeStructureLoss(resume, resume.replace("CAREER SUMMARY", "")), ["the career summary"]);
});

test("empty summary and skills headings do not count as preserving content", () => {
  assert.deepEqual(resumeStructureLoss(resume, resume.replace("Production management and material-handling experience.", "")), ["the career summary"]);
  assert.deepEqual(resumeStructureLoss(resume, resume.replace("Forklift, scheduling, training", "")), ["the skills section"]);
});
