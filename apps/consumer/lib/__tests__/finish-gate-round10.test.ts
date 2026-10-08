/**
 * Finish gate, review round 10 (consumer). Fictional fixtures.
 *
 * SF-1: every education card has honest exits that work: earned (a year),
 * still working on it, "I went but didn't finish" (the school and the years
 * typed), and "No" (the whole line, cleanly). SF-2: a diploma and a
 * certificate on one line are two cards, each confirmed on its own kind.
 * SF-3: honors, scores, programs and facilities never ride on an education
 * confirmation; a school rides only when the person named it. SF-7: a
 * confirmation never writes a second line for a credential the page already
 * shows. SF-5: phone-typed apostrophes in the person's words.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as gate from "../finish-gate";

const { buildFinishView, applyConfirmation, cutCredentialEverywhere, recordAnswer, ownWordsFor, isConfirmWhen, EDUCATION_KINDS } = gate;
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
const withEdu = (line: string) => `${HEAD}\n\nEDUCATION\n${line}`;
const ownOf = (said: string) => `${ownWordsFor({ resumeText: UPLOAD }, false)}\n\n${said}`;

function view(resumeText: string, said: string, extra: Partial<Input> = {}): View {
  return buildFinishView({ resumeText, ownWords: ownOf(said), defendAnswers: [], coverLetterText: "", written: { resume: resumeText, letter: "" }, ownResumeText: UPLOAD, ...extra } as Input);
}
/** Settle every answerable card with a generic yes. */
function settled(resumeText: string, said: string, extra: Partial<Input>): View {
  let a: ReturnType<typeof recordAnswer> = [];
  for (let k = 0; k < 3; k++) for (const g of view(resumeText, said, { ...extra, defendAnswers: a }).groups) if (g.blocking && g.answerable) a = recordAnswer(a, g.line, GOOD, "stands");
  return view(resumeText, said, { ...extra, defendAnswers: a });
}

// ---- SF-1 -------------------------------------------------------------------------------------

test("SF-1: the education kinds are earned, still working on it, and did not finish", () => {
  assert.deepEqual([...EDUCATION_KINDS], ["earned", "in progress", "did not finish"]);
  assert.ok(isConfirmWhen("did not finish", ""));
  assert.ok(isConfirmWhen("did not finish", "2011 - 2014"));
  assert.ok(isConfirmWhen("did not finish", "2012"));
  assert.ok(!isConfirmWhen("did not finish", "graduated 2014"));
  assert.ok(!isConfirmWhen("did not finish", "11th grade"));
});

test("SF-1: the honest non-graduate keeps the school with their own years and finishes", () => {
  const r = withEdu("Scott High School | Toledo, OH | 2011 - 2014");
  const said = "I went to Scott High but left in 11th grade.";
  const g = view(r, said).groups.find((x) => x.credentialName && x.education)!;
  assert.equal(g.credentialName, "Scott High School");
  const res = applyConfirmation({ resume: r, letter: "" }, g.credentialName!, "did not finish", "2011 - 2014", { personText: said })!;
  assert.match(res.resume, /EDUCATION\nScott High School, attended 2011 - 2014$/);
  const v = settled(res.resume, said, { confirmedCredentials: [res.confirm], written: { resume: r, letter: "" } });
  assert.equal(v.state, "finished", JSON.stringify(v.openItems));
  // With no years typed, none are written.
  const none = applyConfirmation({ resume: r, letter: "" }, g.credentialName!, "did not finish", "", { personText: said })!;
  assert.match(none.resume, /EDUCATION\nScott High School, attended$/);
});

test("SF-1: 'did not finish' on a GED line with no school they named takes the GED off everywhere", () => {
  const r = withEdu("GED | Toledo Adult Education | 2015");
  const letter = "Dear Hiring Manager,\n\nI picked orders at Midwest Distribution. I earned my GED in 2015.\n\nSincerely,\nJordan Smith";
  const res = applyConfirmation({ resume: r, letter }, "GED", "did not finish", "", { personText: "I never got my GED." })!;
  assert.doesNotMatch(res.resume, /GED|Toledo Adult Education/);
  assert.doesNotMatch(res.letter, /GED/);
});

for (const line of ["GED | Toledo Adult Education | 2015", "HSED | Milwaukee Area Technical College | 2015", "High School Diploma | Scott High School | 2008", "Scott High School | Toledo, OH | 2008", "Owens Community College | Welding Program | 2019", "Toledo Tech | 2019"]) {
  test(`SF-1: "No" on "${line}" takes the whole line off, with no placeholder and no second card`, () => {
    const r = withEdu(line);
    const g = view(r, "I never finished high school.").groups.find((x) => x.credentialName && x.education)!;
    const out = cutCredentialEverywhere({ resume: r, letter: "" }, g.credentialName!);
    assert.equal(out.resume.trim(), `${HEAD}\n\nEDUCATION`.trim());
    assert.doesNotMatch(out.resume, /Your job title/);
    assert.ok(!view(out.resume, "I never finished high school.").groups.some((x) => x.credentialName));
  });
}

// ---- SF-2 -------------------------------------------------------------------------------------

test("SF-2: a diploma and a certificate on one line are two cards, each confirmed on its own kind", () => {
  const r = withEdu("High School Diploma | Penta Career Center | Welding Certificate | 2015");
  const said = "I got my diploma and my welding certificate at Penta in 2015.";
  const cards = view(r, said).groups.filter((g) => g.credentialName);
  assert.deepEqual(cards.map((g) => [g.credentialName, !!g.education]), [["High School Diploma", true], ["Welding Certificate", false]]);
  // The certificate first, as a certification: the diploma stays on its line.
  const c = applyConfirmation({ resume: r, letter: "" }, "Welding Certificate", "certification", "2015", { personText: said })!;
  assert.ok(c, "the certificate confirms as a certification");
  assert.match(c.resume, /EDUCATION\nHigh School Diploma \| Penta Career Center \| 2015/);
  assert.match(c.resume, /- Welding certification, 2015/);
  const d = applyConfirmation({ resume: c.resume, letter: "" }, "High School Diploma", "earned", "2015", { personText: said })!;
  assert.ok(d, "the diploma confirms as earned");
  const v = settled(d.resume, said, { confirmedCredentials: [c.confirm, d.confirm], written: { resume: r, letter: "" } });
  assert.equal(v.state, "finished", JSON.stringify(v.openItems));
});

// ---- SF-3 -------------------------------------------------------------------------------------

test("SF-3: an honor, a score or a training never rides on a GED confirmation", () => {
  const said = "I got my GED in 2015.";
  for (const [line, rest] of [
    ["GED | Toledo Adult Education | Honor Roll | 2015", "Honor Roll"],
    ["GED | Toledo Adult Education | GPA 3.9 | 2015", "GPA 3.9"],
    ["GED | Toledo Adult Education | Forklift Operator Training | 2015", "Forklift Operator Training"],
    ["GED | Lucas County Jail Education Program | 2015", "Lucas County Jail Education Program"],
  ] as const) {
    const r = withEdu(line);
    const res = applyConfirmation({ resume: r, letter: "" }, "GED", "earned", "2015", { personText: said })!;
    assert.match(res.resume, new RegExp(`EDUCATION\\nGED, 2015\\n${rest.replace(/\./g, "\\.")}$`), res.resume);
    // The moved part is still on the page and still read by the gate.
    const v = view(res.resume, said, { confirmedCredentials: [res.confirm], written: { resume: r, letter: "" } });
    assert.ok(v.openItems.some((i) => i.line.includes(rest)), `${rest}: ${JSON.stringify(v.openItems)}`);
  }
});

test("SF-3: a confirmed line with a school the person never named does not count", () => {
  const r = withEdu("GED | Toledo Adult Education | 2015");
  const res = applyConfirmation({ resume: r, letter: "" }, "GED", "earned", "2015", { personText: "I got my GED at Toledo Adult Education." })!;
  assert.equal(res.confirm.line, "GED, 2015 | Toledo Adult Education");
  const ok = view(res.resume, "I got my GED at Toledo Adult Education.", { confirmedCredentials: [res.confirm], written: { resume: r, letter: "" } });
  assert.ok(!ok.groups.some((g) => g.credentialName), JSON.stringify(ok.openItems));
  const bad = view(res.resume, "I got my GED.", { confirmedCredentials: [res.confirm], written: { resume: r, letter: "" } });
  assert.ok(bad.groups.some((g) => g.credentialName), JSON.stringify(bad.openItems));
});

// ---- SF-7 -------------------------------------------------------------------------------------

test("SF-7: confirming 'OSHA 10 trained' never adds a second OSHA 10 line", () => {
  const r = `${HEAD.replace("- Loaded and unloaded trucks", "- Loaded and unloaded trucks, OSHA 10 trained")}\n\nCERTIFICATIONS\n- OSHA 10 card, 2018`;
  const g = view(r, "I picked orders.").groups.find((x) => x.credentialName)!;
  assert.ok(g, "asked when there is no row");
  const res = applyConfirmation({ resume: r, letter: "" }, g.credentialName!, "card", "2018")!;
  assert.equal((res.resume.match(/OSHA 10/g) ?? []).length, 1, res.resume);
  assert.match(res.resume, /- OSHA 10 card, 2018$/);
  const v = view(res.resume, "I picked orders.", { confirmedCredentials: [res.confirm], written: { resume: r, letter: "" } });
  assert.ok(!v.groups.some((x) => x.credentialName), JSON.stringify(v.openItems));
});

test("SF-7: confirming 'AWS-certified' never adds 'AWS certification' beside 'AWS D1.1 certification'", () => {
  const r = `${HEAD.replace("- Loaded and unloaded trucks", "- AWS-certified welder on the fab line")}

CERTIFICATIONS
- AWS D1.1 certification, 2019`;
  const g = view(r, "I picked orders.").groups.find((x) => x.credentialName && /AWS certified/i.test(x.credentialName))!;
  assert.ok(g, JSON.stringify(view(r, "I picked orders.").groups.map((x) => x.credentialName)));
  const res = applyConfirmation({ resume: r, letter: "" }, g.credentialName!, "certification", "2019")!;
  assert.doesNotMatch(res.resume, /- AWS certification, 2019/);
  assert.equal(res.confirm.coveredBy, "AWS D1.1 certification, 2019");
  const v = view(res.resume, "I picked orders.", { confirmedCredentials: [res.confirm], written: { resume: r, letter: "" } });
  assert.ok(!v.groups.some((x) => x.credentialName && /^AWS certified/i.test(x.credentialName)), JSON.stringify(v.openItems));
});

// ---- SF-5 -------------------------------------------------------------------------------------

test("SF-5: 'I’ve trained the new guys' typed on a phone sources 'Trained new hires'", () => {
  const r = HEAD.replace("- Loaded and unloaded trucks", "- Trained new hires on the scanner");
  const v = view(r, "I’ve trained the new guys on the scanner.");
  assert.ok(!v.openItems.some((i) => i.kind === "scope_unsaid"), JSON.stringify(v.openItems));
});
