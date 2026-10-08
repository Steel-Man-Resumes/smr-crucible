/**
 * Finish gate, review round 11 (consumer). Fictional fixtures.
 *
 * The one-tap scope card: "Yes, I did this" with who in the person's words
 * (refused when empty or when the words do not cover the line), "I helped
 * with it" (the shared form), "Take it off" (in the letter, the whole
 * sentence). SF-3: "I went but didn't finish" keeps only a school the person
 * named or typed. SF-4: on a mixed line, another credential keeps its own
 * card under CERTIFICATIONS. SF-5: a letter sentence about schooling goes
 * whole. SF-9: a confirmation never writes a second line beside one that
 * already shows it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as gate from "../finish-gate";

const {
  buildFinishView,
  applyConfirmation,
  cutCredentialEverywhere,
  recordAnswer,
  recordScopeYes,
  scopeYesResult,
  applyScopeHelped,
  cutScopeSentences,
  ownWordsFor,
  readStoredFinish,
  FINISH_STATE_VERSION,
} = gate;
type Input = Parameters<typeof buildFinishView>[0];
type View = ReturnType<typeof buildFinishView>;
const GOOD = "Yes, I did that myself at that job, most shifts.";

const UPLOAD = `Jordan Smith
419-555-0100 | jordan.smith@example.com | Toledo, OH

WORK HISTORY

Warehouse Associate | Midwest Distribution | 2019 - 2023
picked orders with a scanner gun, loaded and unloaded trucks, wrapped pallets`;
const HEAD = `JORDAN SMITH
Toledo, OH | 419-555-0100 | jordan.smith@example.com

PROFESSIONAL EXPERIENCE
WAREHOUSE ASSOCIATE | Midwest Distribution | Toledo, OH | 2019 - 2023
- Picked orders with a scanner gun and wrapped pallets
- Loaded and unloaded trucks`;
const SAID = "I picked orders and loaded trucks. I want a lead job.";
const own = (said = SAID) => `${ownWordsFor({ resumeText: UPLOAD }, false)}\n\n${said}`;
const view = (resumeText: string, extra: Partial<Input> = {}, said = SAID): View =>
  buildFinishView({ resumeText, ownWords: own(said), defendAnswers: [], coverLetterText: "", written: { resume: resumeText, letter: extra.coverLetterText ?? "" }, ownResumeText: UPLOAD, ...extra } as Input);
const scopeGroup = (v: View) => v.groups.find((g) => g.scope);

// ---- the one-tap scope card -----------------------------------------------------------------------

test("R11 card: the scope card asks who, takes their words for that line, and the line finishes", () => {
  const r = HEAD.replace("- Loaded and unloaded trucks", "- Trained new hires on the scanner");
  const v = view(r);
  const g = scopeGroup(v)!;
  assert.ok(g, JSON.stringify(v.groups.map((x) => x.line)));
  assert.deepEqual(g.scope, { family: "train", question: "Who did you train?", helped: "- Helped train new hires on the scanner" });
  const doc = { target: "resume" as const, text: r };
  assert.equal(scopeYesResult(doc, g.line, "train", "", v.source, []), "empty");
  assert.equal(scopeYesResult(doc, g.line, "train", "nobody", v.source, []), "empty");
  assert.equal(scopeYesResult(doc, g.line, "train", "my cousin", v.source, []), "unmatched");
  assert.equal(scopeYesResult(doc, g.line, "train", "the new hires on second shift", v.source, []), "ok");
  let a = recordScopeYes([], g.line, "train", "the new hires on second shift");
  // A generic answer to the line's other card never wipes it.
  a = recordAnswer(a, g.line, GOOD, "stands");
  const after = view(r, { defendAnswers: a });
  assert.ok(!after.openItems.some((i) => i.kind === "scope_unsaid"), JSON.stringify(after.openItems));
  assert.equal(after.state, "finished", JSON.stringify(after.openItems));
});

test("R11 card: 'I helped with it' turns the line into its shared form, and it finishes", () => {
  const r = HEAD.replace("- Loaded and unloaded trucks", "- Supervised the night crew");
  const g = scopeGroup(view(r))!;
  const res = applyScopeHelped(r, [], g.line, g.scope!.helped!);
  assert.ok(res.changed);
  assert.match(res.text, /- Helped supervise the night crew/);
  let a = res.answers;
  for (const x of view(res.text, { defendAnswers: a }).groups) if (x.blocking && x.answerable) a = recordAnswer(a, x.line, GOOD, "stands");
  const v = view(res.text, { defendAnswers: a });
  assert.ok(!v.openItems.some((i) => i.kind === "scope_unsaid"), JSON.stringify(v.openItems));
  // The shared form is never added to their words: another solo line is still held.
  const other = view(`${res.text}\n- Supervised the night crew on weekends`, { defendAnswers: a });
  assert.ok(other.openItems.some((i) => i.kind === "scope_unsaid" && /weekends/.test(i.line)));
});

test("R11 card: 'Take it off' in the letter takes the whole sentence, never a fragment", () => {
  const letter = "Dear Hiring Manager,\n\nI picked orders at Midwest Distribution. I was chosen by my supervisor to train new associates on the scanner. I loaded trucks every night.\n\nSincerely,\nJordan Smith";
  const line = letter.split("\n")[2];
  const out = cutScopeSentences(letter, line, own());
  assert.match(out, /I picked orders at Midwest Distribution\. I loaded trucks every night\./);
  assert.doesNotMatch(out, /train|chosen/);
});

test("R11 card: a stored 'Yes, I did this' answer keeps its family", () => {
  const stored = {
    v: FINISH_STATE_VERSION,
    key: "k",
    docs: { resumeText: HEAD, coverLetterText: "" },
    defendAnswers: [{ line: "- Trained new hires", answer: "the new hires", kind: "scope_yes", family: "train" }],
  };
  const r = readStoredFinish(stored, "k")!;
  assert.deepEqual(r.defendAnswers[0], { line: "- Trained new hires", answer: "the new hires", kind: "scope_yes", family: "train" });
});

// ---- SF-3 / SF-4 / SF-5 ---------------------------------------------------------------------------

test("SF-3: a school the writer named never stays on 'didn't finish'; a school they type does", () => {
  const r = `${HEAD}\n\nEDUCATION\nLincoln High School | Toledo, OH | 2011 - 2014`;
  const said = "I left school in 11th grade.";
  const g = view(r, {}, said).groups.find((x) => x.credentialName && x.education)!;
  assert.equal(g.schoolKnown, false);
  const cut = applyConfirmation({ resume: r, letter: "" }, g.credentialName!, "did not finish", "", { personText: own(said) })!;
  assert.doesNotMatch(cut.resume, /Lincoln/);
  const typed = applyConfirmation({ resume: r, letter: "" }, g.credentialName!, "did not finish", "2012 - 2014", { personText: own(said), school: "Waite High School" })!;
  assert.match(typed.resume, /EDUCATION\nWaite High School, attended 2012 - 2014$/);
  const v = view(typed.resume, { confirmedCredentials: [typed.confirm], written: { resume: r, letter: "" } }, said);
  assert.ok(!v.groups.some((x) => x.credentialName), JSON.stringify(v.openItems));
  // A school they named themselves needs no typing.
  const known = view(`${HEAD}\n\nEDUCATION\nScott High School | Toledo, OH | 2011 - 2014`, {}, "I went to Scott High but left in 11th grade.").groups.find((x) => x.education)!;
  assert.equal(known.schoolKnown, true);
});

for (const kind of ["did not finish", "no"] as const) {
  test(`SF-4: '${kind}' on the GED of a mixed line keeps the OSHA 10 card asked, under CERTIFICATIONS`, () => {
    const r = `${HEAD}\n\nEDUCATION\nGED | Toledo Adult Education | OSHA 10 | 2015`;
    const out =
      kind === "no"
        ? cutCredentialEverywhere({ resume: r, letter: "" }, "GED").resume
        : applyConfirmation({ resume: r, letter: "" }, "GED", "did not finish", "", { personText: own("I never got my GED.") })!.resume;
    assert.match(out, /CERTIFICATIONS\n- OSHA 10, 2015/, out);
    assert.doesNotMatch(out, /Toledo Adult Education|GED/);
    const v = view(out);
    assert.ok(v.groups.some((g) => g.credentialName === "OSHA 10" && !g.education), JSON.stringify(v.groups.map((g) => g.credentialName)));
  });
}

test("SF-5: 'No' on schooling takes the letter sentence out whole", () => {
  const r = `${HEAD}\n\nEDUCATION\nHigh School Diploma | Scott High School | 2014`;
  const letter = "Dear Hiring Manager,\n\nI picked orders at Midwest Distribution. I finished high school and went straight to work.\n\nSincerely,\nJordan Smith";
  const out = cutCredentialEverywhere({ resume: r, letter }, "High School Diploma");
  assert.match(out.letter, /I picked orders at Midwest Distribution\.\n/);
  assert.doesNotMatch(out.letter, /went straight to work/);
});

// ---- SF-9 -----------------------------------------------------------------------------------------

test("SF-9: confirming 'ServSafe' beside 'ServSafe Food Handler, 2021' adds no second line", () => {
  const r = `${HEAD.replace("- Loaded and unloaded trucks", "- Kept the line clean, ServSafe certified")}\n\nCERTIFICATIONS\n- ServSafe Food Handler, 2021`;
  const res = applyConfirmation({ resume: r, letter: "" }, "ServSafe", "card", "2021")!;
  assert.ok(res);
  assert.equal((res.resume.match(/ServSafe/g) ?? []).length, 1, res.resume);
});
