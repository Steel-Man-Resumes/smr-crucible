/**
 * Finish gate, review round 12 (core). Fictional fixtures.
 *
 * B1: "let me", "asked me to", "got me to" never clear; "had me / made me"
 * clear only past, after a real subject, with no wish, plan or condition, not
 * as the trainee, and not refused. B2: "present", "now", "since", "to date",
 * "ongoing", "still" are statuses; "YEAR - Present" needs a current row.
 * SF-1: "I was in charge of / responsible for". SF-3: the nearest subject.
 * SF-4: typed words for an uncounted group; copies refused. SF-6: present
 * tense with "I"; "with" a tool is not shared; "I made the schedule". SF-7:
 * grammatical shared forms. SF-8/SF-9: typed schools, city words, CDL class.
 * N1: OSHA 10 / 30 never expire.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { scopeAllNotTheirsAnswered, getResumeStatus, type DefendAnswer } from "../resumeStatus";
import { scopeNotTheirs, helpedForm, isOwnLine, typedCoversHit, scopeHits, isScopeCopy } from "../scopeWords";
import { credentialsToAsk, typedSchoolParts, attendedSchoolOf, credentialRowNameProblem, mentionMatchesRow, credentialMentionsOf } from "../credentialMentions";

const OWN = `Jordan Smith
Toledo, OH | jordan@example.com
Warehouse Associate | Midwest Distribution | 2019 - 2023
I picked orders and loaded trucks. I want a lead job.`;
const said = (s: string) => `${OWN}\n${s}`;

// ---- R12-B1 ---------------------------------------------------------------------------------------

for (const [s, line] of [
  ["I hope they let me train new hires.", "Trained new hires on the scanner"],
  ["They'll let me train new hires once I'm off probation.", "Trained new hires on the scanner"],
  ["They might let me supervise the night crew next year.", "Supervised the night crew"],
  ["They said they would let me train new hires.", "Trained new hires on the scanner"],
  ["Hopefully they let me lead the dock crew.", "Led the dock crew"],
  ["My boss asked me to train the new hires but I said no.", "Trained new hires on the scanner"],
  ["They asked me to supervise the night crew and I turned it down.", "Supervised the night crew"],
  ["They wouldnt let me lead the dock crew.", "Led the dock crew"],
  ["They had me train alongside the new hires.", "Trained new hires on the scanner"],
  ["They let me train the new guys.", "Trained new hires on the scanner"],
  ["My boss got me to train the new guys.", "Trained new hires on the scanner"],
  ["They had me train the new hires but I refused.", "Trained new hires on the scanner"],
  ["Once I'm off probation they had me train new hires.", "Trained new hires on the scanner"],
  ["I trained alongside the new hires.", "Trained new hires on the scanner"],
  ["Did I train new hires? Not really.", "Trained new hires on the scanner"],
] as const) {
  test(`R12-B1: "${s}" does not clear "${line}"`, () => assert.ok(scopeNotTheirs(line, said(s)), s));
}
for (const s of ["They had me train the new hires.", "My boss had me train the new guys on the scanner.", "Mike made me train the new guys."]) {
  test(`R12-B1 control: "${s}" clears`, () => assert.equal(scopeNotTheirs("Trained new hires on the scanner", said(s)), undefined));
}

// ---- SF-1, SF-3, SF-6 -----------------------------------------------------------------------------

for (const [s, line] of [
  ["I was responsible for the night crew.", "Responsible for the night crew"],
  ["I was in charge of the dock crew.", "In charge of the dock crew"],
  ["I was in charge of the dock crew.", "Led the dock crew"],
  ["I train new hires.", "Trained new hires on the scanner"],
  ["I supervise the night crew.", "Supervised the night crew"],
  ["I trained new hires with the scanner gun.", "Trained new hires on the scanner"],
  ["I made the schedule for 8 cooks.", "Made the weekly schedule for 8 cooks"],
  ["I was the shift lead and trained new hires.", "Trained new hires on the scanner"],
  ["made the schedule when the manager was out, trained new cashiers, did the truck", "Trained new cashiers on the register"],
] as const) {
  test(`R12: "${s}" clears "${line}"`, () => assert.equal(scopeNotTheirs(line, said(s)), undefined));
}
for (const [s, line] of [
  ["I picked orders and my lead trained the new hires and supervised the night crew.", "Supervised the night crew"],
  ["I loaded trucks, Mike trained new hires and supervised the night crew.", "Supervised the night crew"],
  ["Picked orders while my lead supervised the crew and trained new hires.", "Trained new hires on the scanner"],
  ["I trained new hires with Mike.", "Trained new hires on the scanner"],
  ["I will train new hires.", "Trained new hires on the scanner"],
  ["If they ask, I supervise the night crew.", "Supervised the night crew"],
] as const) {
  test(`R12: "${s}" does not clear "${line}"`, () => assert.ok(scopeNotTheirs(line, said(s)), s));
}
test("R12: a line the person wrote word for word is theirs", () => {
  assert.ok(isOwnLine("- Made the weekly schedule for 8 cooks", "Made the weekly schedule for 8 cooks"));
  assert.equal(scopeNotTheirs("I made the schedule for eight cooks.", said("I made the schedule for eight cooks.")), undefined);
});

// ---- SF-4: typed Yes ------------------------------------------------------------------------------

const yes = (line: string, family: string, typed: string) =>
  scopeAllNotTheirsAnswered(line, OWN, [{ line, answer: typed, kind: "scope_yes", family } as DefendAnswer]).length === 0;
test("SF-4: a count or people word covers an uncounted group; a counted or 'all' line needs the same", () => {
  assert.ok(yes("- Supervised the night crew", "supervise", "about 8 people on nights"));
  assert.ok(yes("- Supervised the night crew", "supervise", "the night crew"));
  assert.ok(yes("- Trained new hires on the scanner", "train", "Marcus and Tia"));
  assert.ok(yes("- Trained new hires on the scanner", "train", "temps from the agency"));
  assert.ok(!yes("- Trained new hires on the scanner", "train", "my cousin"));
  assert.ok(!yes("- Trained all 40 associates on the scanner", "train", "associates"));
  assert.ok(yes("- Trained all 40 associates on the scanner", "train", "all 40 of them"));
  assert.ok(yes("- Supervised the night crew every shift", "supervise", "the night crew"));
  assert.ok(yes("- Responsible for opening and closing the store", "responsible", "opening and closing"));
  assert.ok(yes("- Responsible for the night crew", "responsible", "the night crew"));
  assert.ok(isScopeCopy("Trained all 40 associates on the scanner", "- Trained all 40 associates on the scanner"));
  assert.ok(!isScopeCopy("the night crew", "- Supervised the night crew"));
  const h = scopeHits("Supervised the night crew")[0];
  assert.equal(typedCoversHit(h, "nobody really", "Supervised the night crew"), false);
});

test("R12: one card per line names every claim on it", () => {
  const r = `X\nx@y.com\n\nPROFESSIONAL EXPERIENCE\nCOOK | Riverside Grill | 2015 - 2023\n- Led a team of 8 cooks and managed food costs`;
  const s = getResumeStatus({ resumeText: r, sourceText: OWN, defendAnswers: [] });
  const items = s.openItems.filter((i) => i.kind === "scope_unsaid");
  assert.equal(items.length, 1);
  assert.deepEqual([...(items[0].scopeFamilies ?? [])].sort(), ["lead", "manage"]);
  assert.equal(items[0].helped, undefined);
});

// ---- SF-7 ------------------------------------------------------------------------------------------

test("SF-7: the shared form reads", () => {
  assert.equal(helpedForm("Supervised and trained the night crew", "Supervised"), "Helped supervise and train the night crew");
  assert.equal(helpedForm("In charge of opening the store", "In charge of"), "Helped with opening the store");
  assert.equal(helpedForm("Supervised and trained the night crew", "trained the night crew"), undefined);
});

// ---- R12-B2 and the credentials ---------------------------------------------------------------------

const page = (l: string, where = "CERTIFICATIONS") => `X\nx@y.com\n\n${where}\n${l}`;
const names = (r: string, rows: Parameters<typeof credentialsToAsk>[3]) => credentialsToAsk(r, OWN, new Set(), rows, OWN).map((m) => m.name);
for (const [row, l] of [
  [{ name: "Forklift", kind: "certification", when: "2020" }, "- Forklift Certified, 2020 - present"],
  [{ name: "Forklift", kind: "certification", when: "2020" }, "- Forklift Certification, 2020 – Present"],
  [{ name: "Forklift", kind: "certification", when: "2020" }, "- Forklift Certified, 2020 - Now"],
  [{ name: "CNA", kind: "certification", when: "2016" }, "- CNA, 2016 - Present"],
  [{ name: "ServSafe Food Handler", kind: "card", when: "2021" }, "- ServSafe Food Handler, 2021 - Present"],
] as const) {
  test(`R12-B2: "${l}" is asked with a year-only row`, () => assert.ok(names(page(l), [row as never]).length > 0));
}
test("R12-B2: 'since' and '- present' in the summary need a current row", () => {
  assert.ok(names(page("Forklift certified, 2020 - present.", "SUMMARY"), [{ name: "Forklift", kind: "certification", when: "2020" }] as never).length > 0);
  assert.ok(names(page("Forklift certified since 2019.", "SUMMARY"), [{ name: "Forklift", kind: "certification", when: "2019" }] as never).length > 0);
});
test("N1: OSHA 10 and 30 cards never expire; nothing else, never a trainer", () => {
  const osha = [{ name: "OSHA 10", kind: "card", when: "2018" }] as never;
  assert.deepEqual(names(page("I hold an OSHA 10 card and take safety seriously.", "SUMMARY"), osha), []);
  assert.ok(names(page("OSHA 30 card holder.", "SUMMARY"), osha).length > 0);
  assert.ok(names(page("Trainer, OSHA 10, for new hires.", "SUMMARY"), osha).length > 0);
  assert.ok(names(page("OSHA 10 authorized trainer.", "SUMMARY"), osha).length > 0);
  assert.ok(names(page("I hold a current forklift certification.", "SUMMARY"), [{ name: "Forklift", kind: "certification", when: "2018" }] as never).length > 0);
});
test("SF-9: CDL Class B is the license's class, not a course; endorsements are their own", () => {
  assert.equal(credentialRowNameProblem("CDL Class B", "license"), "");
  const m = credentialMentionsOf(page("- CDL Class B, 2018")).find((x) => x.where === "credentials")!;
  assert.ok(mentionMatchesRow(m, [{ name: "CDL Class B", kind: "license", when: "2018" }]));
  assert.ok(names(page("CDL B driver with tanker and doubles endorsements.", "SUMMARY"), [{ name: "CDL Class B", kind: "license", when: "current" }] as never).length > 0);
});

// ---- SF-8 --------------------------------------------------------------------------------------------

test("SF-8: a typed grade or 'did not graduate' is a status; 'yes' is not a school", () => {
  assert.deepEqual(typedSchoolParts("Scott High (left in 11th grade)"), { school: "Scott High", grade: "11th" });
  assert.deepEqual(typedSchoolParts("Scott High, did not graduate"), { school: "Scott High" });
  assert.equal(typedSchoolParts("yes"), "rejected");
  assert.equal(typedSchoolParts("graduated 2014"), "rejected");
  assert.equal(typedSchoolParts(""), "");
});
test("SF-8: a city from a job line or 'grew up in' never names a school", () => {
  assert.equal(attendedSchoolOf("Toledo High School | 2011 - 2014", "Warehouse Associate | Midwest Distribution | Toledo, OH | 2019 - 2023\nI left school in 11th grade."), undefined);
  assert.equal(attendedSchoolOf("Toledo High School | 2011 - 2014", "I grew up in Toledo and left school in 11th grade."), undefined);
  assert.equal(attendedSchoolOf("Scott High School | 2011 - 2014", "I graduated from Scott High in 2014."), "Scott High School");
});
