/**
 * Finish gate, review round 12 (consumer). Fictional fixtures.
 *
 * One scope card per line, answered once for every claim on it; a pasted-back
 * line is refused; a Yes survives a number fix; "I helped with it" settles
 * only its own claim; job-title cards confirm or replace only the title and
 * never loop; a typed school keeps the grade they typed; a rejected school is
 * its own message.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as gate from "../finish-gate";

const {
  buildFinishView,
  applyConfirmation,
  recordAnswer,
  recordScopeYes,
  scopeYesResult,
  applyRewrite,
  applyScopeHelped,
  titleYesResult,
  recordTitleYes,
  applyOwnTitle,
  isRejectedSchool,
  ownWordsFor,
} = gate;
type Input = Parameters<typeof buildFinishView>[0];
type View = ReturnType<typeof buildFinishView>;
const GOOD = "Yes, I did that myself at that job, most shifts.";

const UPLOAD = `Jordan Smith
419-555-0100 | jordan.smith@example.com | Toledo, OH

WORK HISTORY

Warehouse Associate | Midwest Distribution | 2019 - 2023
picked orders with a scanner gun, loaded and unloaded trucks, wrapped pallets`;
const head = (title = "WAREHOUSE ASSOCIATE", bullets = "- Picked orders with a scanner gun and wrapped pallets") => `JORDAN SMITH
Toledo, OH | 419-555-0100 | jordan.smith@example.com

PROFESSIONAL EXPERIENCE
${title} | Midwest Distribution | Toledo, OH | 2019 - 2023
${bullets}`;
const SAID = "I picked orders and loaded trucks. I want a lead job.";
const own = (said = SAID) => `${ownWordsFor({ resumeText: UPLOAD }, false)}\n\n${said}`;
const view = (resumeText: string, extra: Partial<Input> = {}, said = SAID): View =>
  buildFinishView({ resumeText, ownWords: own(said), defendAnswers: [], coverLetterText: "", written: { resume: resumeText, letter: "" }, ownResumeText: UPLOAD, ...extra } as Input);
const settleGeneric = (r: string, a: ReturnType<typeof recordAnswer>, said = SAID) => {
  for (let k = 0; k < 3; k++) for (const g of view(r, { defendAnswers: a }, said).groups) if (g.blocking && g.answerable) a = recordAnswer(a, g.line, GOOD, "stands");
  return a;
};

test("R12: one card per line asks about every claim, and one answer must cover each", () => {
  const r = head("WAREHOUSE ASSOCIATE", "- Led the dock crew and trained new hires");
  const g = view(r).groups.find((x) => x.scope)!;
  assert.deepEqual([...g.scope!.families].sort(), ["lead", "train"]);
  assert.equal(g.scope!.question, "Who or what did you lead? Who did you train?");
  assert.equal(g.scope!.helped, undefined);
  const doc = { target: "resume" as const, text: r };
  assert.equal(scopeYesResult(doc, g.line, g.scope!.families, "my cousin", own(), []), "unmatched");
  assert.equal(scopeYesResult(doc, g.line, g.scope!.families, "Led the dock crew and trained new hires", own(), []), "copy");
  assert.equal(scopeYesResult(doc, g.line, g.scope!.families, "the dock crew and the new hires", own(), []), "ok");
  const a = settleGeneric(r, recordScopeYes([], g.line, g.scope!.families, "the dock crew and the new hires"));
  assert.equal(view(r, { defendAnswers: a }).state, "finished");
});

test("R12 (SF-5): a Yes survives a number fix on the same line", () => {
  const r = head("WAREHOUSE ASSOCIATE", "- Trained 15 new hires on the scanner");
  const g = view(r).groups.find((x) => x.scope)!;
  let a = recordScopeYes([], g.line, g.scope!.families, "new hires");
  const fixed = applyRewrite(r, a, g.line, "- Trained 6 new hires on the scanner");
  assert.ok(fixed.changed);
  a = fixed.answers;
  assert.ok(!view(fixed.text, { defendAnswers: a }).openItems.some((i) => i.kind === "scope_unsaid"), "the scope card does not come back");
  // A rewrite that changes the claim does not carry the answer over.
  const changed = applyRewrite(r, recordScopeYes([], g.line, "train", "new hires"), g.line, "- Trained 6 new hires on the forklift and the scanner");
  assert.ok(changed.answers.filter((x) => x.kind === "scope_yes" && x.line === "- Trained 6 new hires on the forklift and the scanner").length <= 1);
});

test("R12 (SF-7): 'I helped with it' settles only its own sentence in the letter", () => {
  const letter = "Dear Hiring Manager,\n\nI trained new hires on the scanner. I also helped lead the night crew.\n\nJordan Smith";
  const r = head();
  const v = view(r, { coverLetterText: letter, written: { resume: r, letter } });
  const g = v.groups.find((x) => x.scope && x.target === "letter")!;
  // Two claims on one paragraph: one card, and no one-tap shared form.
  assert.deepEqual([...g.scope!.families].sort(), ["lead", "train"]);
  assert.equal(g.scope!.helped, undefined);
  const helped = g.line.replace("I trained new hires", "I helped train new hires");
  const res = applyScopeHelped(letter, [], g.line, helped, "train");
  const after = view(r, { coverLetterText: res.text, written: { resume: r, letter }, defendAnswers: res.answers });
  assert.ok(after.openItems.some((i) => i.kind === "scope_unsaid" && i.target === "letter"), "the other sentence is still asked");
});

test("R12 (SF-2): a title card confirms by typing the title, or replaces only the title, and never loops", () => {
  const r = head("SHIFT SUPERVISOR");
  const v = view(r);
  const g = v.groups.find((x) => x.title)!;
  assert.ok(g, JSON.stringify(v.groups.map((x) => x.line)));
  assert.equal(g.scope, undefined, "no Yes / helped buttons on a title");
  assert.equal(titleYesResult(g.line, "shift lead"), "unmatched");
  assert.equal(titleYesResult(g.line, ""), "empty");
  assert.equal(titleYesResult(g.line, "Shift Supervisor"), "ok");
  const yes = recordTitleYes([], g.line, "Shift Supervisor");
  assert.ok(!view(r, { defendAnswers: yes }).groups.some((x) => x.title || (x.line === g.line && x.blocking)), "settled, no loop");
  const mine = applyOwnTitle(r, [], g.line, "Order Picker");
  assert.match(mine.text, /\nOrder Picker \| Midwest Distribution \| Toledo, OH \| 2019 - 2023\n/);
  assert.ok(!view(mine.text, { defendAnswers: mine.answers }).groups.some((x) => x.title), "their title settles it");
});

test("R12 (SF-8): a typed grade stays as 'through 11th grade'; a typed 'yes' is its own message", () => {
  const r = `${head()}\n\nEDUCATION\nLincoln High School | Toledo, OH | 2011 - 2014`;
  const res = applyConfirmation({ resume: r, letter: "" }, "Lincoln High School", "did not finish", "2011 - 2013", { personText: own("I left school."), school: "Scott High (left in 11th grade)" })!;
  assert.match(res.resume, /EDUCATION\nScott High, attended 2011 - 2013, through 11th grade$/);
  const v = view(res.resume, { confirmedCredentials: [res.confirm], written: { resume: r, letter: "" } }, "I left school.");
  assert.ok(!v.groups.some((x) => x.credentialName), JSON.stringify(v.openItems));
  assert.ok(isRejectedSchool("yes"));
  assert.ok(!isRejectedSchool("Scott High, did not graduate"));
  assert.ok(!isRejectedSchool(""));
});
