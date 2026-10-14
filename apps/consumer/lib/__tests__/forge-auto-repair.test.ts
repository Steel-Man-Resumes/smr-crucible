import { test } from "node:test";
import assert from "node:assert/strict";
import { repairForgeResume } from "../forge-auto-repair";
import { buildFinishView } from "../finish-gate";
import { buildForgeResumePrompts } from "../forge-resume-prompt";

const own = `MORGAN SAMPLE
Toledo, OH | morgan@example.com

WORK EXPERIENCE
Warehouse Associate | Midstate Distribution | 8/2021 - Present
Loaded outbound trucks and used a pallet jack.`;
const page = `MORGAN SAMPLE
Toledo, OH | morgan@example.com

CAREER SUMMARY
Warehouse work loading trucks and using a pallet jack.

CORE COMPETENCIES
Pallet Jack, Workplace Safety

PROFESSIONAL EXPERIENCE
Warehouse Associate | Midstate Distribution | 3/2021 - Present
- Loaded outbound trucks and used a pallet jack.`;
const grounding = { rewordingA: true, sourceKind: "given", forgeAssisted: true, verifierRan: true, verifierRanByDoc: { resume: true, cover_letter: true } };

test("Forge repairs a unique changed date and removes a skill absent from the person's words", () => {
  const result = repairForgeResume(page, own, own);
  assert.match(result.text, /Warehouse Associate \| Midstate Distribution \| 8\/2021 - Present/);
  assert.doesNotMatch(result.text, /Workplace Safety/);
  assert.match(result.text, /Pallet Jack/);
  assert.deepEqual(result.repairs.map((r) => r.kind), ["job", "skill"]);
  const view = buildFinishView({ resumeText: result.text, ownWords: own, ownResumeText: own, defendAnswers: [], written: { resume: result.text, letter: "" }, grounding });
  assert.equal(view.groups.some((g) => g.items.some((i) => i.kind === "job_confirm" || i.kind === "job_changed" || i.kind === "grid_term")), false);
  assert.equal(view.state, "finished", JSON.stringify(view.openItems));
});

test("a repeated job with ambiguous dates is not silently repaired or approved", () => {
  const source = `MORGAN SAMPLE
WORK EXPERIENCE
Machine Operator | Acme Mill | 2012 - 2014
Ran the press.
Machine Operator | Acme Mill | 2019 - Present
Ran the saw.`;
  const draft = `MORGAN SAMPLE
PROFESSIONAL EXPERIENCE
Machine Operator | Acme Mill | 2012 - Present
- Ran the press.`;
  const result = repairForgeResume(draft, source, source);
  assert.equal(result.text, draft);
  assert.deepEqual(result.repairs, []);
  const view = buildFinishView({ resumeText: draft, ownWords: source, ownResumeText: source, defendAnswers: [], written: { resume: draft, letter: "" }, grounding });
  assert.equal(view.state, "draft");
  assert.ok(view.groups.some((g) => g.items.some((i) => i.kind === "job_changed")));
});

test("older and unchecked documents retain the job confirmation gate", () => {
  const fixed = repairForgeResume(page, own, own).text;
  for (const g of [{ ...grounding, forgeAssisted: false }, { ...grounding, verifierRan: false }]) {
    const view = buildFinishView({ resumeText: fixed, ownWords: own, ownResumeText: own, defendAnswers: [], written: { resume: fixed, letter: "" }, grounding: g });
    if (g.verifierRan) assert.ok(view.groups.some((group) => group.items.some((i) => i.kind === "job_confirm")));
    else assert.equal(view.state, "draft");
  }
});

test("the Forge writer stays general even if a job posting is supplied", () => {
  const prompt = buildForgeResumePrompts({ resumeText: own, jobPosting: "UNIQUE-POSTING-ONLY-TERM" } as Parameters<typeof buildForgeResumePrompts>[0]);
  assert.doesNotMatch(prompt.user, /UNIQUE-POSTING-ONLY-TERM/);
});
