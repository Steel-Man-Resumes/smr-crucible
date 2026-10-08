/**
 * Finish gate, review round 11 (core). Fictional fixtures.
 *
 * The scope design change: a strict matcher. Free text clears a scope claim
 * only through "I" + a plain past verb (adverbs between), "used to", "I was /
 * I'm the one who", "they had me", "I was in charge of", or the person's own
 * past-verb lines. "Would", "'d", "started", "kept", "got to", "ended up" and
 * any modal never clear. "We", "<name> and I" and "me and <name>" are shared:
 * they clear only a shared page line. An unmatched claim is a one-tap card;
 * the person's typed "who" settles that one claim only.
 *
 * Also: SF-1 bigger credentials, N1 holding words need a current row, SF-2
 * everyday phrasing, SF-3/SF-7 schools the person named, SF-9 trivial row
 * differences.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { getResumeStatus, scopeNotTheirsAnswered, type DefendAnswer } from "../resumeStatus";
import { scopeNotTheirs, scopeHits, helpedForm, isScopeWhoAnswer, scopeYesText, scopeWhoQuestion } from "../scopeWords";
import { credentialsToAsk, credentialMentionsOf, mentionMatchesRow, credentialKey, schoolPrefixUsed, attendedSchoolOf, educationAttendedLine, typedSchoolName } from "../credentialMentions";

const OWN = `Jordan Smith
Toledo, OH | jordan@example.com
Warehouse Associate | Midwest Distribution | 2019 - 2023
I picked orders and loaded trucks. I want a lead job.`;
const said = (s: string) => `${OWN}\n${s}`;

// ---- R11-B1 and the strict matcher --------------------------------------------------------------

for (const [s, line] of [
  ["I would be a great lead and I would train new hires the right way.", "Trained new hires on the scanner"],
  ["If you hire me I would train your new people.", "Trained new hires on the scanner"],
  ["I would supervise the night crew if given the chance.", "Supervised the night crew"],
  ["I would lead the night crew if they let me.", "Led the night crew"],
  ["Given the chance I'd run the dock crew.", "Led the dock crew"],
  ["My goal is a lead job where I would train new hires.", "Trained new hires on the scanner"],
  ["They said I would train new hires after 90 days.", "Trained new hires on the scanner"],
  ["I'd like to lead a crew and I'd train new hires too.", "Trained new hires on the scanner"],
  ["I start training new hires next week.", "Trained new hires on the scanner"],
  ["I would always train the new guys.", "Trained new hires on the scanner"],
  ["I started training alongside the new hires.", "Trained new hires on the scanner"],
  ["I kept training shifts until they hired me full time.", "Trained new hires on the scanner"],
  ["I got to train the new guys.", "Trained new hires on the scanner"],
  ["I ended up training most of the new hires.", "Trained new hires on the scanner"],
  ["I wish I had trained the new guys.", "Trained new hires on the scanner"],
  ["If I had trained the new hires it would have gone better.", "Trained new hires on the scanner"],
  ["Worked under Mike, trained new hires with him.", "Trained new hires on the scanner"],
] as const) {
  test(`R11-B1: "${s}" does not clear "${line}"`, () => assert.ok(scopeNotTheirs(line, said(s)), s));
}

for (const [s, line] of [
  ["I trained the new guys on the scanner.", "Trained new hires on the scanner"],
  ["I also supervised the night crew.", "Supervised the night crew"],
  ["I pretty much trained all the new guys.", "Trained all new hires on the scanner"],
  ["I used to train the new guys.", "Trained new hires on the scanner"],
  ["I was the one who trained the new hires.", "Trained new hires on the scanner"],
  ["I'm the one who trains the new guys.", "Trained new hires on the scanner"],
  ["They had me train the new hires.", "Trained new hires on the scanner"],
  ["My boss had me train the new guys on the scanner.", "Trained new hires on the scanner"],
  ["I was put in charge of the night crew.", "In charge of the night crew"],
  ["picked orders, loaded trucks, trained new guys on the scanner", "Trained new hires on the scanner"],
  ["I was a shift lead for 3 years and I ran the store when the manager was off.", "Ran the store when the manager was out"],
] as const) {
  test(`R11 strict matcher: "${s}" clears "${line}"`, () => assert.equal(scopeNotTheirs(line, said(s)), undefined));
}

// ---- shared work ----------------------------------------------------------------------------------

for (const s of ["We trained the new guys on the scanner.", "Mike and I trained the new guys.", "My lead and I trained the new hires.", "Me and Mike trained the new guys.", "At Amazon we trained new hires in the first week.", "I helped him train the new guys."]) {
  test(`R11 shared: "${s}" clears only the shared line`, () => {
    assert.ok(scopeNotTheirs("Trained new hires on the scanner", said(s)), "solo line held");
    assert.equal(scopeNotTheirs("Helped train new hires on the scanner", said(s)), undefined, "shared line clears");
    assert.equal(scopeNotTheirs("Trained new hires on the scanner with my lead", said(s)), undefined, "'with my lead' clears");
  });
}
test("R11 shared: '3 years and I' is not a shared subject", () => assert.equal(scopeNotTheirs("Ran the store", said("I was there 3 years and I ran the store.")), undefined));

// ---- the one-tap card ---------------------------------------------------------------------------

test("R11 card: the typed who settles that claim only, on that line only", () => {
  const line = "- Trained new hires on the scanner";
  const yes: DefendAnswer[] = [{ line, answer: "the new hires on second shift", kind: "scope_yes", family: "train" }];
  assert.equal(scopeNotTheirsAnswered(line, OWN, yes), undefined);
  // Never pooled: another line with the same claim is still held.
  assert.ok(scopeNotTheirsAnswered("- Trained new hires on the forklift", OWN, yes));
  // Fewer people than the line: still held.
  assert.ok(scopeNotTheirsAnswered("- Trained all new hires on the scanner", OWN, [{ line: "- Trained all new hires on the scanner", answer: "two new guys", kind: "scope_yes", family: "train" }]));
  // Another family on the same line is still read.
  assert.ok(scopeNotTheirsAnswered("- Trained new hires and supervised the night crew", OWN, [{ line: "- Trained new hires and supervised the night crew", answer: "the new hires", kind: "scope_yes", family: "train" }]));
  // An empty or nobody answer does nothing.
  assert.ok(!isScopeWhoAnswer(""));
  assert.ok(!isScopeWhoAnswer("nobody"));
  assert.ok(!isScopeWhoAnswer("yes"));
  assert.ok(isScopeWhoAnswer("the new guys"));
  assert.ok(isScopeWhoAnswer("the stockroom"));
  assert.equal(scopeYesText("train", "the new guys."), "I trained the new guys.");
  assert.equal(scopeWhoQuestion("train"), "Who did you train?");
});

test("R11 card: a status card carries the family and the shared form", () => {
  const r = `JORDAN SMITH\nToledo, OH | jordan@example.com\n\nPROFESSIONAL EXPERIENCE\nWAREHOUSE ASSOCIATE | Midwest Distribution | 2019 - 2023\n- Trained new hires on the scanner`;
  const s = getResumeStatus({ resumeText: r, sourceText: OWN, defendAnswers: [] });
  const item = s.openItems.find((i) => i.kind === "scope_unsaid")!;
  assert.equal(item.scopeFamily, "train");
  assert.equal(item.helped, "- Helped train new hires on the scanner");
  assert.equal(item.question, "Is this true? An interviewer will ask you about it.");
});

test("R11 card: the shared form of common lines", () => {
  assert.equal(helpedForm("- Supervised the night crew", "Supervised"), "- Helped supervise the night crew");
  assert.equal(helpedForm("Led the dock crew on weekends", "Led"), "Helped lead the dock crew on weekends");
  assert.equal(helpedForm("- Responsible for the dock crew", "Responsible for"), "- Helped with the dock crew");
  assert.equal(helpedForm("I trained the new guys on the scanner.", "trained the new guys"), "I helped train the new guys on the scanner.");
  assert.equal(helpedForm("- Asked to train new hires on the scanner", "train new hires"), "- Asked to help train new hires on the scanner");
});

// ---- SF-2: everyday phrasing ---------------------------------------------------------------------

for (const line of ["Forklift trained warehouse associate.", "OSHA-trained forklift operator.", "Forklift-trained operator with 4 years on the dock.", "Cross-trained team member in receiving and shipping.", "Opened the store when the store manager was late", "I would welcome the chance to help run your store."]) {
  test(`SF-2: "${line}" is not a scope claim`, () => assert.deepEqual(scopeHits(line).map((h) => h.family), []));
}
test("SF-2: 'scheduling and training new cashiers' gives each verb its own object", () => {
  const src = said("made the schedule, trained new cashiers");
  assert.equal(scopeNotTheirs("Experienced in cash handling, scheduling and training new cashiers.", src), undefined);
  assert.equal(scopeNotTheirs("I opened the store, trained new cashiers and ran the store when the manager was off.", said("I trained new cashiers. I ran the store when the manager was off.")), undefined);
});

// ---- SF-1 / N1 / SF-9 ----------------------------------------------------------------------------

const WELD_OWN = `Marcus Hill\nToledo, OH | marcus@example.com\nWelder | Toledo Steel Fab | 2018 - 2023\nMIG and stick welding on structural steel`;
const sum = (s: string) => `MARCUS HILL\nToledo, OH | marcus@example.com\n\nSUMMARY\n${s}\n\nPROFESSIONAL EXPERIENCE\nWELDER | Toledo Steel Fab | 2018 - 2023\n- MIG and stick welding on structural steel`;
const names = (r: string, rows: Parameters<typeof credentialsToAsk>[3], own = WELD_OWN) => credentialsToAsk(r, own, new Set(), rows, own).map((m) => m.name);

for (const [row, s] of [
  [{ name: "OSHA 10", kind: "card", when: "current" }, "OSHA 10 authorized trainer."],
  [{ name: "OSHA 10", kind: "card", when: "2018" }, "OSHA authorized trainer."],
  [{ name: "AWS D1.1", kind: "certification", when: "current" }, "AWS Certified Welding Inspector with structural experience."],
  [{ name: "CPR", kind: "card", when: "current" }, "CPR instructor."],
  [{ name: "CNA", kind: "certification", when: "current" }, "CNA instructor with patient care experience."],
  [{ name: "Forklift", kind: "certification", when: "current" }, "Forklift certified trainer and evaluator."],
] as const) {
  test(`SF-1: a ${row.name} row never covers "${s}"`, () => assert.ok(names(sum(s), [row as never]).length > 0, s));
}
test("SF-1: 'authorized' stays in the key", () => assert.notEqual(credentialKey("OSHA authorized"), credentialKey("OSHA")));

for (const s of ["Forklift-certified warehouse associate.", "Licensed CNA with patient care experience.", "Certified Nursing Assistant with patient care experience.", "Cook with a ServSafe card and 6 years on the line."]) {
  test(`N1: a year-only row never covers the status in "${s}"`, () => {
    const rows = [{ name: "Forklift", kind: "certification", when: "2019" }, { name: "CNA", kind: "certification", when: "2016" }, { name: "ServSafe", kind: "card", when: "2021" }] as never;
    assert.ok(names(sum(s), rows).length > 0, s);
  });
}
test("N1: a year-only row covers the same year, or a history sentence", () => {
  const rows = [{ name: "AWS D1.1", kind: "certification", when: "2019" }] as never;
  assert.deepEqual(names(sum("AWS D1.1 certified in 2019, structural welder."), rows), []);
  assert.deepEqual(names(sum("Passed the AWS D1.1 bend test and welded structural steel."), rows), []);
  assert.deepEqual(names(sum("Safety-focused and OSHA 10 trained."), [{ name: "OSHA 10", kind: "card", when: "2018" }] as never), []);
});

test("SF-9: a credentials line that differs trivially from the row is the row", () => {
  const page = (l: string) => `X\nx@y.com\n\nCERTIFICATIONS\n- ${l}`;
  const m = (l: string) => credentialMentionsOf(page(l)).find((x) => x.where === "credentials")!;
  assert.ok(mentionMatchesRow(m("Forklift Operator Certification, 2023"), [{ name: "Forklift", kind: "certification", when: "2023" }]));
  assert.ok(mentionMatchesRow(m("ServSafe Food Handler, 2021"), [{ name: "ServSafe Food Handler", kind: "card", when: "2021" }]));
  assert.ok(!mentionMatchesRow(m("ServSafe Food Handler, 2019"), [{ name: "ServSafe Food Handler", kind: "card", when: "2021" }]));
  assert.ok(!mentionMatchesRow(m("Forklift Trainer certification, 2023"), [{ name: "Forklift", kind: "certification", when: "2023" }]));
  assert.ok(!mentionMatchesRow(m("Forklift card, 2023"), [{ name: "Forklift", kind: "certification", when: "2023" }]));
});

// ---- SF-3 / SF-7: schools the person named -------------------------------------------------------

test("SF-3/SF-7: a school rides only when the person named it, and only its own words", () => {
  assert.deepEqual(schoolPrefixUsed("Scott High School Welding Lab Supervisor", "I graduated from Scott High in 2014"), { school: "Scott High School", rest: "Welding Lab Supervisor" });
  assert.equal(attendedSchoolOf("Associate of Applied Science, Welding | Owens Community College | 2019", "I did a year at Owens."), "Owens Community College");
  assert.equal(attendedSchoolOf("Lincoln High School | Toledo, OH | 2011 - 2014", "I left school in 11th grade."), undefined);
  // Their contact line never names a school for them.
  assert.equal(attendedSchoolOf("Toledo Tech | 2019", "Jordan Smith\nToledo, OH | jordan@example.com\nI picked orders."), undefined);
  assert.equal(educationAttendedLine("Scott High School | Coursework in Business Management | 2011 - 2014", "Coursework in Business Management", "Coursework in Business Management", "", "went to Scott High in Toledo"), "Scott High School, attended");
  assert.equal(typedSchoolName("Waite High School"), "Waite High School");
  assert.equal(typedSchoolName("graduated 2014"), "");
});
