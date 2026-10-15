import { test } from "node:test";
import assert from "node:assert/strict";
import { cutUnsupportedExtraSentences, repairForgeResume } from "../forge-auto-repair";
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

test("Forge cuts unsupported extra sentences while keeping the useful summary and letter", () => {
  const source = `MORGAN SAMPLE\nToledo, OH | morgan@example.com\nWORK EXPERIENCE\nWarehouse Associate | Midstate Distribution | 8/2021 - Present\nLoaded outbound trucks and moved 40 pallets a night with a pallet jack.\nWarehouse Clerk | Riverbend Supply | 6/2018 - 7/2021\nChecked shipments and entered inventory counts.\nEDUCATION\nHigh School Diploma | Toledo, OH | 2018`;
  const resume = `MORGAN SAMPLE\nToledo, OH | morgan@example.com\nCAREER SUMMARY\nWarehouse associate who loaded outbound trucks. High school diploma earned in 2018.\nPROFESSIONAL EXPERIENCE\nWarehouse Associate | Midstate Distribution | 8/2021 - Present\n- Loaded outbound trucks and moved 40 pallets a night with a pallet jack.\nWarehouse Clerk | Riverbend Supply | 6/2018 - 7/2021\n- Checked shipments and entered inventory counts.\nEDUCATION\nHigh School Diploma | Toledo, OH | 2018`;
  const letter = `Dear [Hiring Manager],\n\nI loaded outbound trucks and moved 40 pallets a night with a pallet jack. Between the two jobs, I handled both ends of the work.\n\nSincerely,\nMorgan Sample`;
  const first = buildFinishView({ resumeText: resume, ownWords: source, ownResumeText: source, defendAnswers: [], coverLetterText: letter, written: { resume, letter }, grounding });
  assert.ok(first.openItems.some((item) => item.kind === "credential_unsaid"));
  assert.ok(first.openItems.some((item) => item.rule === "STD-T02" && item.target === "letter"));
  const fixedResume = cutUnsupportedExtraSentences(resume, first.openItems, "resume", source);
  const fixedLetter = cutUnsupportedExtraSentences(letter, first.openItems, "letter", source);
  assert.equal(fixedResume.repairs.length, 1);
  assert.equal(fixedLetter.repairs.length, 1);
  assert.match(fixedResume.text, /Warehouse associate who loaded outbound trucks\./);
  assert.doesNotMatch(fixedResume.text, /diploma earned/);
  assert.match(fixedLetter.text, /I loaded outbound trucks and moved 40 pallets/);
  assert.doesNotMatch(fixedLetter.text, /Between the two jobs/);
  const final = buildFinishView({ resumeText: fixedResume.text, ownWords: source, ownResumeText: source, defendAnswers: [], coverLetterText: fixedLetter.text, written: { resume: fixedResume.text, letter: fixedLetter.text }, grounding });
  assert.equal(final.state, "finished", JSON.stringify(final.openItems));
});

test("Forge leaves a single disputed sentence for the person to answer", () => {
  const disputed = "High school diploma earned in 2018.";
  const result = cutUnsupportedExtraSentences(disputed, [{ rule: "STD-T03", severity: "BLOCK", line: disputed,
    why: "Status not given", question: "Did you earn it?", kind: "credential_unsaid", subject: "High school diploma",
    education: true, target: "resume" }], "resume", own);
  assert.equal(result.text, disputed);
  assert.deepEqual(result.repairs, []);
});

test("Forge uses an actual role headline and puts current volunteer work before older paid work", () => {
  const source = `RILEY EXAMPLE\nMadison, WI | riley@example.com\nWORK EXPERIENCE\nCashier | Elm Market | 2023 - 2024\nHelped customers and handled cash.\nVOLUNTEER EXPERIENCE\nFood Pantry Helper | Community Pantry | 2025 - Present\nSorted donated food and packed grocery bags.`;
  const draft = `RILEY EXAMPLE\nMadison, WI | riley@example.com\n\nRetail and warehouse support worker with customer and pantry experience\n\nCAREER SUMMARY\nHelped customers and sorted donated food.\n\nPROFESSIONAL EXPERIENCE\n\nCashier | Elm Market | 2023 - 2024\n- Helped customers and handled cash.\n\nFood Pantry Helper | Community Pantry | 2025 - Present\n- Sorts donated food and packs grocery bags.`;
  const result = repairForgeResume(draft, source, source);
  assert.match(result.text, /\nFood Pantry Helper\n\nCAREER SUMMARY/);
  assert.ok(result.text.indexOf("Food Pantry Helper | Community Pantry") < result.text.indexOf("Cashier | Elm Market"));
  assert.deepEqual(result.repairs.map((r) => r.kind), ["headline", "order"]);
  const view = buildFinishView({ resumeText: result.text, ownWords: source, ownResumeText: source, defendAnswers: [], written: { resume: result.text, letter: "" }, grounding });
  assert.equal(view.state, "finished", JSON.stringify(view.openItems));
});
