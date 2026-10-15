/**
 * Finish gate, review round 9 (consumer). Fictional fixtures.
 *
 * B1: "I was chosen by my supervisor to train new associates" in the letter is
 * held as scope, even when the person's words say their lead did the
 * training. B2: education lines with no year (HSED, G.E.D., "Graduated",
 * "Completed") are memory prompts. S2: a current row or a current
 * confirmation keeps "Certified nursing assistant" in the summary and the
 * letter; the no-education fixture finishes with its summary. N4: an
 * education confirmation rewrites only the named part and keeps the school.
 * N5: "earned" needs a year. A confirmation never crosses education and
 * credential kinds.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as gate from "../finish-gate";

const { buildFinishView, applyConfirmation, recordAnswer, ownWordsFor, isConfirmWhen, cutLine, changeLine } = gate;
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
const letterWith = (s: string) => `Dear Hiring Manager,\n\nI picked orders with a scanner gun and wrapped pallets at Midwest Distribution. ${s}\n\nSincerely,\nJordan Smith`;

/** Answer every answerable card with a generic yes, a few times over; return the end state. */
function walk(resumeText: string, coverLetterText: string, said: string, extra: Partial<Input> = {}): { start: View; end: View } {
  const ownWords = `${ownWordsFor({ resumeText: UPLOAD }, false)}\n\n${said}`;
  let a: ReturnType<typeof recordAnswer> = [];
  const mk = () => buildFinishView({ resumeText, ownWords, coverLetterText, written: { resume: resumeText, letter: coverLetterText }, ownResumeText: UPLOAD, defendAnswers: a, ...extra } as Input);
  const start = mk();
  for (let k = 0; k < 4; k++) for (const g of mk().groups) if (g.blocking && g.answerable) a = recordAnswer(a, g.line, GOOD, "stands");
  return { start, end: mk() };
}

// ---- R9-B1 ------------------------------------------------------------------------------------

for (const said of ["I picked orders and loaded trucks. I want a steady warehouse job.", "My lead trained the new hires and supervised the night crew. I picked orders."]) {
  test(`R9-B1: the letter's "chosen by my supervisor to train" is held as scope (said: ${said.slice(0, 30)}...)`, () => {
    const { start, end } = walk(HEAD, letterWith("I was chosen by my supervisor to train new associates on the scanner."), said);
    assert.equal(end.state, "draft");
    assert.ok(start.openItems.some((i) => i.kind === "scope_unsaid" && (i as { target?: string }).target === "letter"), JSON.stringify(start.openItems));
  });
}

for (const line of ["- Chosen by the manager to supervise the night crew", "- Stepped in for the supervisor and led the crew on weekends", "- Known for training new hires on the scanner"]) {
  test(`R9-B1: "${line}" stays a draft after generic answers`, () => {
    const { end } = walk(HEAD.replace("- Loaded and unloaded trucks", line), "", "I picked orders and loaded trucks.");
    assert.equal(end.state, "draft");
    assert.ok(end.openItems.some((i) => i.kind === "scope_unsaid"));
  });
}

// ---- R9-B2 ------------------------------------------------------------------------------------

for (const [said, edu] of [
  ["I am working on my HSED at MATC.", "HSED | Milwaukee Area Technical College"],
  ["I never finished high school.", "G.E.D."],
  ["I never finished high school.", "Scott High School, Toledo, OH | Graduated"],
  ["I took some classes at Owens but did not finish.", "Owens Community College | Welding Program | Completed"],
  ["I never finished high school.", "Graduated from Scott High School"],
] as const) {
  test(`R9-B2: "${edu}" is a memory prompt, never finished by an answer`, () => {
    const { start, end } = walk(`${HEAD}\n\nEDUCATION\n${edu}`, "", said);
    assert.ok(start.groups.some((g) => g.credentialName && g.education), JSON.stringify(start.groups.map((g) => g.line)));
    assert.equal(end.state, "draft");
  });
}

test("R9-B2: forklift certified inside an education line is a credential prompt", () => {
  const { start, end } = walk(`${HEAD}\n\nEDUCATION\nToledo Tech | Forklift Certified | 2019`, "", "I picked orders.");
  assert.ok(start.groups.some((g) => g.credentialName === "Forklift Certified" && !g.education));
  assert.equal(end.state, "draft");
});

// ---- R9-N4 / N5 -------------------------------------------------------------------------------

test("R9-N4: confirming an education line keeps the school and drops the writer's year", () => {
  const r = `${HEAD}\n\nEDUCATION\nGED | Toledo Adult Education | 2023`;
  const said = "I am working on my GED at Toledo Adult Education.";
  const { start } = walk(r, "", said);
  const g = start.groups.find((x) => x.credentialName && x.education)!;
  assert.equal(g.credentialName, "GED");
  // Round 10 (SF-3): the school rides because the person named it.
  const res = applyConfirmation({ resume: r, letter: "" }, g.credentialName!, "in progress", "in progress", { personText: said })!;
  assert.match(res.resume, /EDUCATION\nGED, in progress \| Toledo Adult Education$/);
  assert.equal(res.confirm.line, "GED, in progress | Toledo Adult Education");
  const after = walk(res.resume, "", said, { confirmedCredentials: [res.confirm], written: { resume: r, letter: "" } });
  assert.equal(after.end.state, "finished", JSON.stringify(after.end.openItems));
  // A stored line with the writer's year back on it does not count.
  const forged = { ...res.confirm, line: "GED, in progress | Toledo Adult Education | 2023" };
  const bad = walk(res.resume.replace("GED, in progress | Toledo Adult Education", forged.line), "", said, { confirmedCredentials: [forged], written: { resume: r, letter: "" } });
  assert.equal(bad.end.state, "draft");
});

test("R9-N4: the education prompt names the credential, not the school", () => {
  const { start } = walk(`${HEAD}\n\nEDUCATION\nOwens Community College | Associate of Applied Science | 2019`, "", "I picked orders.");
  const g = start.groups.find((x) => x.credentialName && x.education)!;
  assert.equal(g.credentialName, "Associate of Applied Science");
  assert.match(g.items.find((i) => i.kind === "credential_unsaid")!.question, /^Do you have an Associate of Applied Science\?/);
});

test("R9-N5: 'earned' needs a real year; kinds never cross", () => {
  assert.ok(isConfirmWhen("earned", "2015"));
  assert.ok(!isConfirmWhen("earned", "current"));
  assert.ok(!isConfirmWhen("earned", "valid"));
  assert.ok(isConfirmWhen("in progress", "in progress"));
  assert.ok(isConfirmWhen("certification", "current"));
  const r = `${HEAD}\n\nEDUCATION\nGED, 2023`;
  assert.equal(applyConfirmation({ resume: r, letter: "" }, "GED", "earned", "current"), null);
  assert.equal(applyConfirmation({ resume: r, letter: "" }, "GED", "license", "2023"), null);
  const c = `${HEAD}\n\nCERTIFICATIONS\n- Forklift Certified`;
  assert.equal(applyConfirmation({ resume: c, letter: "" }, "Forklift Certified", "earned", "2019"), null);
  assert.ok(applyConfirmation({ resume: r, letter: "" }, "GED", "earned", "2015"));
});

// ---- R9-S2 ------------------------------------------------------------------------------------

const CNA_UP = `Tasha Reed
419-555-0177 | tasha.reed@example.com | Toledo, OH

WORK HISTORY
Certified Nursing Assistant | Meadowbrook Care Center | 2016 - present
helped residents with bathing, dressing and meals, took vital signs`;
const CNA_PAGE = `TASHA REED
Toledo, OH | 419-555-0177 | tasha.reed@example.com

CAREER SUMMARY
Certified nursing assistant with resident care in long-term care.

PROFESSIONAL EXPERIENCE
CERTIFIED NURSING ASSISTANT | Meadowbrook Care Center | Toledo, OH | 2016 - Present
- Helped residents with bathing, dressing and meals
- Took vital signs

CERTIFICATIONS
- CNA certification, current`;
const CNA_LETTER = `Dear Hiring Manager,\n\nI have worked as a certified nursing assistant at Meadowbrook Care Center since 2016. I help residents with bathing, dressing and meals.\n\nSincerely,\nTasha Reed`;
const cnaView = (resumeText: string, coverLetterText: string, extra: Partial<Input> = {}) =>
  buildFinishView({
    resumeText,
    coverLetterText,
    ownWords: `${ownWordsFor({ resumeText: CNA_UP }, false)}\n\nI want to keep working as a CNA.`,
    written: { resume: CNA_PAGE, letter: CNA_LETTER },
    ownResumeText: CNA_UP,
    defendAnswers: [],
    ...extra,
  } as Input);

test("R9-S2: a current CNA row keeps 'Certified nursing assistant' in the summary and the letter, unasked", () => {
  const rows = { credentialRows: [{ name: "CNA", kind: "certification" as const, when: "current" }], credentialsAnswer: "CNA certification, current" };
  const v = cnaView(CNA_PAGE, CNA_LETTER, rows);
  assert.ok(!v.groups.some((g) => g.credentialName || g.items.some((i) => /credential/.test(i.kind ?? ""))), JSON.stringify(v.groups.map((g) => g.credentialName ?? g.line)));
  // What is left are the ordinary explain-in-your-words cards, which an answer settles.
  let a: ReturnType<typeof recordAnswer> = [];
  for (const g of v.groups) if (g.blocking && g.answerable) a = recordAnswer(a, g.line, GOOD, "stands");
  assert.equal(cnaView(CNA_PAGE, CNA_LETTER, { ...rows, defendAnswers: a }).state, "finished");
});

test("R9-S2: an expired row never covers the summary", () => {
  const v = cnaView(CNA_PAGE.replace("- CNA certification, current", "- CNA certification, expired"), CNA_LETTER, {
    credentialRows: [{ name: "CNA", kind: "certification", when: "expired" }],
  });
  assert.ok(v.groups.some((g) => g.credentialName && /certified nursing assistant/i.test(g.credentialName)), JSON.stringify(v.groups.map((g) => g.credentialName)));
});

test("R9-S2: confirming it as current keeps the summary and the letter sentence; no remnant, no note", () => {
  const v0 = cnaView(CNA_PAGE, CNA_LETTER);
  const g = v0.groups.find((x) => x.credentialName && /certified nursing assistant/i.test(x.credentialName))!;
  assert.ok(g);
  const res = applyConfirmation({ resume: CNA_PAGE, letter: CNA_LETTER }, g.credentialName!, "certification", "current")!;
  assert.match(res.resume, /CAREER SUMMARY\nCertified nursing assistant with resident care in long-term care\./);
  assert.match(res.letter, /I have worked as a certified nursing assistant at Meadowbrook Care Center since 2016\./);
  assert.deepEqual(res.confirm.remnants, []);
  assert.equal(res.confirm.letterSentenceDropped, false);
  // Confirmed as expired instead, the claim comes out of the sentences as before.
  const dead = applyConfirmation({ resume: CNA_PAGE, letter: CNA_LETTER }, g.credentialName!, "certification", "expired")!;
  assert.doesNotMatch(dead.resume, /CAREER SUMMARY\nCertified nursing assistant/);
  assert.equal(dead.confirm.letterSentenceDropped, true);
});

test("R9-S2: the no-education fixture finishes after one confirmation, with its summary", () => {
  const dir = join(__dirname, "..", "..", "test", "fixtures", "resumes");
  const raw = readFileSync(join(dir, "no-education.txt"), "utf8");
  const resume = `TASHA BROOKS
Racine, WI | 262-555-0199 | tasha.brooks@example.com
Certified Nursing Assistant

CAREER SUMMARY
Certified nursing assistant with hands-on patient care in long-term and residential settings.

PROFESSIONAL EXPERIENCE
CERTIFIED NURSING ASSISTANT | Meadowbrook Care Center | 2017 - Present
- Provided daily living assistance for residents
HOME HEALTH AIDE | Comfort Home Services | 2015 - 2017
- Supported clients with mobility, meals, and medication reminders

CERTIFICATIONS
- Certified Nursing Assistant
- CPR
- First Aid`;
  const ownWords = ownWordsFor({ resumeText: raw }, false);
  const v0 = buildFinishView({ resumeText: resume, ownWords, defendAnswers: [], written: { resume, letter: "" } } as Input);
  const g = v0.groups.find((x) => x.credentialName)!;
  assert.ok(g, JSON.stringify(v0.openItems));
  const res = applyConfirmation({ resume, letter: "" }, g.credentialName!, "certification", "current")!;
  assert.match(res.resume, /CAREER SUMMARY\nCertified nursing assistant with hands-on patient care/);
  assert.match(res.resume, /\nCertified Nursing Assistant\n\nCAREER SUMMARY/, "the headline stays");
  const v1 = buildFinishView({ resumeText: res.resume, ownWords, defendAnswers: [], written: { resume, letter: "" }, confirmedCredentials: [res.confirm] } as Input);
  assert.ok(!v1.groups.some((x) => x.credentialName || x.items.some((i) => /credential/.test(i.kind ?? ""))), JSON.stringify(v1.openItems));
});

// ---- line edits hit the exact line ------------------------------------------------------------

test("R9: cutting or changing a list line never touches a headline with the same words", () => {
  const t = "NAME\nCertified Nursing Assistant\n\nCERTIFICATIONS\n- Certified Nursing Assistant";
  assert.equal(changeLine(t, "- Certified Nursing Assistant", "CNA certification, current"), "NAME\nCertified Nursing Assistant\n\nCERTIFICATIONS\n- CNA certification, current");
  // Round 13 (SF-2): the emptied CERTIFICATIONS heading comes off with its last line.
  assert.equal(cutLine(t, "- Certified Nursing Assistant"), "NAME\nCertified Nursing Assistant");
});
