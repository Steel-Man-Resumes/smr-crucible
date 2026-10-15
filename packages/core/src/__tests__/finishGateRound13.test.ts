/**
 * Finish gate, review round 13 (core). Fictional fixtures.
 *
 * R13-B1: a present tense ("I train new hires") clears only from work-history
 * text, never from the goal box, and never with a future, condition, goal or
 * reported-speech word before or after the verb. SF-1: a number before a
 * comma is read. SF-3: a "Lead X" title in their own job header is theirs.
 * SF-4: a title in the summary or letter is settled only by its title card.
 * SF-6: school statuses, jail or prison schools, employer names. SF-7: a typed
 * Yes that names a different group is refused; common words are not names.
 * SF-8: "when the manager was out they had me lead". SF-9: short title forms.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { scopeAllNotTheirsAnswered, type DefendAnswer } from "../resumeStatus";
import { scopeNotTheirs, scopeHits, scopeHitsNotTheirs, typedCoversHit, markGoalText, sameTitle, titleInOwnHeaders, helpedForm } from "../scopeWords";
import { numberTokens } from "../numberRead";
import { typedSchoolParts, attendedSchoolOf, titleIsTheirs } from "../credentialMentions";

const OWN = `Jordan Smith
Toledo, OH | jordan@example.com
Warehouse Associate | Midwest Distribution | 2019 - 2023
I picked orders and loaded trucks.`;
const raw = (s: string) => `${OWN}\n\n${s}`;
const goal = (s: string) => `${OWN}\n\n${markGoalText(s)}`;
const T = "Trained new hires on the scanner";
const S = "Supervised the night crew";
const L = "Led the dock crew";

// ---- R13-B1: the five review rows, their variants, in the goal box and in plain text ----------------

const HELD: Array<[string, string]> = [
  ["I'm looking for a lead job where I train new hires.", T],
  ["Hopefully I train new hires soon.", T],
  ["I lead the dock crew if they promote me.", L],
  ["In five years I lead the dock crew.", L],
  ["I train new hires starting Monday.", T],
  ["Looking for a job where I lead the dock crew.", L],
  ["I need a job where I train new hires.", T],
  ["I'm interested in a role where I supervise the night crew.", S],
  ["My dream job is one where I train new hires.", T],
  ["The ideal job is where I supervise the night crew.", S],
  ["Starting Monday I train new hires.", T],
  ["After probation I train new hires.", T],
  ["I supervise the night crew next year.", S],
  ["I supervise the night crew in my next job.", S],
  ["At my new job I supervise the night crew.", S],
  ["I lead the dock crew when I get promoted.", L],
  ["I train new hires as soon as I get certified.", T],
  ["I'm hoping I train new hires this year.", T],
  ["Maybe I train new hires next year.", T],
  ["Eventually I lead the dock crew.", L],
  ["One day I lead the dock crew.", L],
  ["Long term I supervise the night crew.", S],
  ["Someday I train new hires.", T],
  ["In a lead role I supervise the night crew and train new hires.", S],
  ["As a lead I supervise the night crew.", S],
  ["My goal: I supervise the night crew.", S],
  ["Hire me and I lead the dock crew the right way.", L],
  ["Give me a chance and I train new hires right.", T],
  ["I wouldn't say I train new hires.", T],
  ["They say I train new hires but I don't.", T],
  ["My boss thinks I lead the dock crew.", L],
  ["I pretend I train new hires.", T],
  ["I'd love a job where I train new hires.", T],
  ["Somewhere I lead the dock crew and get paid fair.", L],
  ["Lead job. I train new hires, I run the dock crew.", T],
  ["I'm looking for a lead job. I train new hires and keep the crew safe.", T],
  ["I will train new hires.", T],
  ["I'll supervise the night crew.", S],
  ["I would lead the dock crew.", L],
];
for (const [s, line] of HELD) {
  test(`R13-B1: "${s}" never clears "${line}" (plain text)`, () => assert.ok(scopeNotTheirs(line, raw(s)), s));
}
// The goal box never clears a present tense, however it is worded, and every row above is held there too.
for (const [s, line] of [...HELD, ["I train new hires.", T], ["I supervise the night crew now.", S], ["I lead the dock crew.", L]] as Array<[string, string]>) {
  test(`R13-B1: in the goal box "${s}" never clears "${line}"`, () => assert.ok(scopeNotTheirs(line, goal(s)), s));
}
// Controls: current work in their own words still clears, and a past tense in the goal box is history.
for (const [s, line] of [
  ["I train new hires.", T],
  ["I supervise the night crew now.", S],
  ["I'm a shift lead. I supervise the night crew.", S],
  ["I still train new hires sometimes.", T],
] as Array<[string, string]>) {
  test(`R13-B1 control: "${s}" in their work words clears "${line}"`, () => assert.equal(scopeNotTheirs(line, raw(s)), undefined));
}
test("R13-B1 control: a past tense in the goal box is still their history", () => {
  assert.equal(scopeNotTheirs(T, goal("I trained new hires at Midwest and want to keep doing it.")), undefined);
});
test("R13-B1: a goal sentence on its own line does not hold their work lines", () => {
  assert.equal(scopeNotTheirs(T, `${OWN}\nI want a lead job.\nI train new hires.`), undefined);
});

// ---- R13 present-tense duty lists in their work history --------------------------------------------

test("R13: their own present-tense duty list counts in work history, never in the goal box", () => {
  const work = "night shift at the hospital contract, I lead a crew of 5, make the cleaning schedule, show new people the floor machines";
  assert.deepEqual(scopeHitsNotTheirs("- Make the cleaning schedule", work), []);
  assert.deepEqual(scopeHitsNotTheirs("Coach reps", "I take escalated calls, listen to recorded calls and coach reps on them"), []);
  assert.ok(scopeHitsNotTheirs("- Make the cleaning schedule", markGoalText(work)).length > 0);
  assert.ok(scopeHitsNotTheirs("Coach reps", "I want to take escalated calls and coach reps").length > 0);
});

// ---- SF-1: a number before a comma ------------------------------------------------------------------

test("SF-1: a number right before a comma, period, semicolon or paren is read", () => {
  const v = (t: string) => numberTokens(t).map((x) => x.value);
  assert.deepEqual(v("Loaded trucks with the dock crew of 8, wrapped pallets"), ["8"]);
  assert.deepEqual(v("I lead a crew of 5, make the cleaning schedule"), ["5"]);
  assert.deepEqual(v("Supervised a crew of 12; kept the dock on schedule"), ["12"]);
  assert.deepEqual(v("a team (of 8) on nights."), ["8"]);
  assert.deepEqual(v("crew of 5."), ["5"]);
  assert.deepEqual(v("saved $12,000 a year, moved 1,000, then 2,500 boxes"), ["12000", "1000", "2500"]);
  assert.deepEqual(v("1,234.5 units"), ["1234.5"]);
});

// ---- SF-3: "Lead X" titles in their own job header ---------------------------------------------------

const CUST = `Andre Willis
419-555-0177 | andre.willis@example.com | Toledo, OH
Lead Custodian | Maumee Valley Facility Services | 2020 - present
cleaned offices, ran the floor scrubber`;
test("SF-3: a 'Lead X' title in their own header is theirs in the summary; never 'I helped with it' for a title", () => {
  assert.ok(titleInOwnHeaders("Lead custodian", CUST));
  assert.deepEqual(scopeHitsNotTheirs("Lead custodian with commercial cleaning experience.", CUST), []);
  assert.deepEqual(scopeHitsNotTheirs("Reliable lead custodian.", CUST), []);
  // Not their title: a custodian whose header never said lead.
  assert.ok(scopeHitsNotTheirs("Lead custodian with commercial cleaning experience.", CUST.replace("Lead Custodian |", "Custodian |")).length > 0);
  const hit = scopeHits("Lead cook with high-volume diner experience.")[0];
  assert.ok(hit.role && hit.title === "Lead cook");
  // A verb is still a verb.
  assert.ok(!scopeHits("Lead a night crew of 5 custodians")[0].role);
  assert.ok(!scopeHits("Lead safety meetings every week")[0].role);
  assert.equal(helpedForm("Lead a night crew of 5 custodians", "Lead"), "Helped lead a night crew of 5 custodians");
});

// ---- SF-4: titles are settled only by their title card --------------------------------------------

test("SF-4: a role in the summary is never cleared by a scope Yes; its title card settles it", () => {
  const line = "Shift lead who trained new hires on the scanner.";
  const yes = (answer: string) => [{ line, answer, kind: "scope_yes", family: "train" } as DefendAnswer];
  for (const a of ["people", "Marcus and Tia", "the night shift", "the team"]) {
    const open = scopeAllNotTheirsAnswered(line, OWN, yes(a));
    assert.ok(open.some((h) => h.role && h.title === "Shift lead"), a);
    assert.ok(!open.some((h) => !h.role), a);
  }
  const both = [...yes("new hires"), { line, answer: "shift lead", kind: "title_yes" } as DefendAnswer];
  assert.deepEqual(scopeAllNotTheirsAnswered(line, OWN, both), []);
  const letter = "As a shift supervisor I led the dock crew.";
  const open = scopeAllNotTheirsAnswered(letter, OWN, [{ line: letter, answer: "people", kind: "scope_yes", family: "lead" } as DefendAnswer]);
  assert.deepEqual(open.map((h) => h.title), ["shift supervisor"]);
  // Someone else's role is not a title of theirs.
  assert.ok(!scopeHits("My manager asked me to train the new hires.").some((h) => h.role));
  assert.ok(!scopeHits("I led the night crew when the lead was out.").some((h) => h.role));
});

// ---- SF-6: typed schools ---------------------------------------------------------------------------

test("SF-6: dropped out, left and didn't finish are statuses; a jail or prison school is flagged", () => {
  assert.deepEqual(typedSchoolParts("Scott High (dropped out)"), { school: "Scott High" });
  assert.deepEqual(typedSchoolParts("Scott High (left)"), { school: "Scott High" });
  assert.deepEqual(typedSchoolParts("Scott High (didn't finish)"), { school: "Scott High" });
  assert.deepEqual(typedSchoolParts("Scott High (dropped out"), { school: "Scott High" });
  assert.deepEqual(typedSchoolParts("Lincoln High — left in 11th grade"), { school: "Lincoln High", grade: "11th" });
  assert.deepEqual(typedSchoolParts("Lincoln High -- dropped out"), { school: "Lincoln High" });
  assert.deepEqual(typedSchoolParts("I went to Libbey"), { school: "Libbey" });
  assert.deepEqual(typedSchoolParts("Juvenile detention school"), { school: "Juvenile detention school", facility: true });
  assert.deepEqual(typedSchoolParts("school at the county jail"), { school: "school at the county jail", facility: true });
  assert.deepEqual(typedSchoolParts("Lucas County Juvenile Hall school"), { school: "Lucas County Juvenile Hall school", facility: true });
  assert.deepEqual(typedSchoolParts("Lucas County Community College"), { school: "Lucas County Community College" });
});
test("SF-6: employer and city names never make a guessed school theirs; their words about school do", () => {
  const line = "Toledo High School | 2011 - 2014";
  for (const s of ["I worked at the Toledo Zoo. I left school in 11th grade.", "I worked for Toledo Public Schools as a custodian. I left school in 11th grade.", "Toledo born and raised. I left school in 11th grade.", "I went to Toledo Tech for a year.", "I'm from Toledo, left school in 11th grade.", "I grew up in Toledo and left school in 11th grade.", "I went to school in Toledo but left in 11th grade."]) {
    assert.equal(attendedSchoolOf(line, s), undefined, s);
  }
  assert.equal(attendedSchoolOf(line, "I left Toledo High in 11th grade."), "Toledo High School");
  assert.equal(attendedSchoolOf("Penta Career Center | Welding Technology Program | 2015", "I took some welding classes at Penta."), "Penta Career Center");
});

// ---- SF-7: typed Yes ---------------------------------------------------------------------------------

const yesOn = (line: string, typed: string) => typedCoversHit(scopeHits(line)[0], typed, line, new Set(["midwest", "distribution"]));
test("SF-7: a typed group that names a different group is refused", () => {
  assert.equal(yesOn(L, "new hires"), false);
  assert.equal(yesOn(L, "temps"), false);
  assert.equal(yesOn(S, "cashiers"), false);
  assert.equal(yesOn(S, "the day crew"), false);
  assert.equal(yesOn(S, "new hires"), false);
});
test("SF-7: shared group words, a count, names or a generic people word are accepted", () => {
  for (const t of ["the dock crew", "my crew", "the guys on the dock", "about 8 people", "people", "everybody", "Marcus and Tia", "Marcus", "the team", "staff", "workers"]) {
    assert.equal(yesOn(L, t), true, t);
  }
  assert.equal(yesOn(S, "about 8 people on nights"), true);
  assert.equal(yesOn(S, "nights"), true);
  assert.equal(yesOn("Supervised store associates during shifts", "the cashiers and stockers on my shift"), true);
  assert.equal(yesOn("Lead a team of 9 billing representatives", "9 reps on the billing line"), true);
});
test("SF-7: a capitalized common word or their employer is not a name", () => {
  for (const t of ["Never", "Nah", "No", "Yes", "None", "Nobody", "Maybe", "Myself", "Supervisor", "Midwest"]) assert.equal(yesOn(L, t), false, t);
});
test("SF-7: on a combined card each claim needs its own group", () => {
  const line = "Trained new hires and supervised the night crew";
  const fams = ["train", "supervise"];
  const settle = (typed: string) => scopeAllNotTheirsAnswered(line, OWN, fams.map((family) => ({ line, answer: typed, kind: "scope_yes", family }) as DefendAnswer)).length === 0;
  assert.ok(!settle("new hires"));
  assert.ok(settle("new hires and the night crew"));
  assert.ok(settle("people"));
});

// ---- SF-8: "had me" ----------------------------------------------------------------------------------

for (const s of ["When the manager was out they had me lead the dock crew.", "When the manager was out, they had me lead the dock crew.", "He always had me lead the dock crew."]) {
  test(`SF-8: "${s}" clears`, () => assert.equal(scopeNotTheirs(L, raw(s)), undefined));
}
for (const s of ["Wishing they had me lead the dock crew instead of picking.", "I wished they had me lead the dock crew.", "If the manager was out they had me lead the dock crew next time."]) {
  test(`SF-8: "${s}" stays held`, () => assert.ok(scopeNotTheirs(L, raw(s))));
}

// ---- SF-9: short title forms -------------------------------------------------------------------------

test("SF-9: a short form or common abbreviation is the same title", () => {
  assert.ok(sameTitle("Customer Service Rep", "CUSTOMER SERVICE REPRESENTATIVE"));
  assert.ok(sameTitle("Asst Mgr", "Assistant Manager"));
  assert.ok(sameTitle("Shift Sup", "Shift Supervisor"));
  assert.ok(sameTitle("Program Coord", "Program Coordinator"));
  assert.ok(!sameTitle("Shift Lead", "Shift Supervisor"));
  assert.ok(titleIsTheirs("CUSTOMER SERVICE REPRESENTATIVE", "Customer Service Rep | Lakeshore Health Billing | 2019 - 2022"));
});
