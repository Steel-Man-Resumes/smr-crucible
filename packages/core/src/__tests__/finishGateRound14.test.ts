/**
 * Finish gate, focused re-check round 14 (core). Fictional fixtures.
 *
 * R14-B1: "I'm / I am in charge of", "I'm responsible for" and "I'm the one
 * who" are a present tense: never from the goal box, never under a wish or a
 * frame. "I was in charge of" stays theirs. F1: a title in a target ("seeking
 * a shift supervisor position") is not a claim. F2: rank words never drop
 * ("Assistant Manager" never holds "Manager"); reference lines are not their
 * titles. F4: the jail-school notice only on facility words. F5: a later
 * "when" holds only its own duty. F6: wish frames, goal words, a bare frame
 * in the next sentence. F7: "Held the shift lead role" is their title claim.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { scopeNotTheirs, scopeHits, scopeHitsNotTheirs, markGoalText, titleInOwnHeaders } from "../scopeWords";
import { typedSchoolParts } from "../credentialMentions";

const OWN = `Jordan Smith
Toledo, OH | jordan@example.com
Warehouse Associate | Midwest Distribution | 2019 - 2023
I picked orders and loaded trucks.`;
const upload = (s: string) => `${OWN}\n${s}`;
const goal = (s: string) => `${OWN}\n\n${markGoalText(s)}`;

// ---- R14-B1 ------------------------------------------------------------------------------------------

const B1: Array<[string, string]> = [
  ["A job where I am in charge of the dock crew.", "Led the dock crew"],
  ["A job where I'm in charge of the night crew.", "In charge of the night crew"],
  ["Hopefully I'm in charge of the night crew next year.", "In charge of the night crew"],
  ["I'm in charge of the night crew if they promote me.", "In charge of the night crew"],
  ["A lead job where I'm responsible for the dock crew.", "Responsible for the dock crew"],
  ["I'd like a job where I'm in charge of opening the store.", "In charge of opening the store"],
  ["Somewhere I'm the one who trains the new hires.", "Trained new hires on the scanner"],
  ["A place where I'm in charge of the night crew.", "In charge of the night crew"],
  ["A spot where I'm the one who trains new hires.", "Trained new hires on the scanner"],
  ["I am in charge of the night crew starting Monday.", "In charge of the night crew"],
  ["Someday I'm the one who trains new hires.", "Trained new hires on the scanner"],
  ["I'm in charge of the night crew. Starting next month.", "In charge of the night crew"],
];
for (const [s, line] of B1) {
  test(`R14-B1: "${s}" never clears "${line}" in the goal box`, () => assert.ok(scopeNotTheirs(line, goal(s)), s));
  test(`R14-B1: "${s}" never clears "${line}" in the upload`, () => assert.ok(scopeNotTheirs(line, upload(s)), s));
}
for (const [s, line] of [
  ["I was in charge of the dock crew.", "In charge of the dock crew"],
  ["I was in charge of the dock crew.", "Led the dock crew"],
  ["I was the one who trained new hires.", "Trained new hires on the scanner"],
  ["I was responsible for the night crew.", "Responsible for the night crew"],
  ["I'm in charge of the night crew.", "In charge of the night crew"],
  ["I'm the one who trains new hires.", "Trained new hires on the scanner"],
] as Array<[string, string]>) {
  test(`R14-B1 control: "${s}" in their work words clears "${line}"`, () => assert.equal(scopeNotTheirs(line, upload(s)), undefined));
}
test("R14-B1: a present copula in the goal box never clears, even with no frame", () => {
  assert.ok(scopeNotTheirs("In charge of the night crew", goal("I'm in charge of the night crew.")));
  assert.equal(scopeNotTheirs("In charge of the night crew", goal("I was in charge of the night crew at Midwest.")), undefined);
});

// ---- F1, F7: titles in a target, titles held ---------------------------------------------------------

test("F1: a title in a target is the job they want, not a claim", () => {
  for (const s of ["Warehouse associate seeking a shift supervisor position.", "Hard worker looking to grow into a team lead.", "I am applying for the custodial supervisor position.", "Ready to step into a shift lead role.", "Looking for a lead cook job."]) {
    assert.ok(!scopeHits(s).some((h) => h.role), s);
  }
  assert.ok(scopeHits("Shift supervisor with 4 years of warehouse experience.").some((h) => h.role && h.title === "Shift supervisor"));
  assert.ok(scopeHits("Became the shift lead in 2021.").some((h) => h.role));
});
test("F7: 'held / covered / served as the X role' is their title claim", () => {
  for (const s of ["Held the shift lead role at Midwest Distribution.", "Covered the shift supervisor role at Midwest Distribution.", "Served as the shift lead on nights."]) {
    assert.ok(scopeHits(s).some((h) => h.role && h.title), s);
  }
  assert.ok(!scopeHits("My manager asked me to train the new hires.").some((h) => h.role));
});

// ---- F2: rank words, reference lines --------------------------------------------------------------------

test("F2: a header title never gives up its rank words", () => {
  const h = (t: string) => `${OWN}\n${t} | Kroger | 2015 - 2018`;
  assert.ok(!titleInOwnHeaders("Manager", h("Manager in Training")));
  assert.ok(!titleInOwnHeaders("Manager", h("Assistant Manager")));
  assert.ok(!titleInOwnHeaders("Manager", h("Co-Manager")));
  assert.ok(!titleInOwnHeaders("Manager", h("Asst. Mgr")));
  assert.ok(!titleInOwnHeaders("Supervisor", h("Supervisor Trainee")));
  assert.ok(!titleInOwnHeaders("Store manager", h("Assistant Store Manager")));
  assert.ok(!titleInOwnHeaders("Electrician", h("Apprentice Electrician")));
  assert.ok(!titleInOwnHeaders("Shift supervisor", h("Acting Shift Supervisor")));
  // Round 15 (R15-B1): strict, word for word; a dropped department word is a card too.
  assert.ok(!titleInOwnHeaders("Lead custodian", h("Night Shift Lead Custodian")));
  assert.ok(titleInOwnHeaders("Lead custodian", h("Lead Custodian")));
  assert.ok(titleInOwnHeaders("Assistant manager", h("Assistant Manager")));
  for (const [header, line] of [["Assistant Manager", "Manager at Midwest Distribution."], ["Supervisor Trainee", "Supervisor at Midwest Distribution."], ["Manager in Training", "Manager with 4 years of warehouse experience."]]) {
    assert.ok(scopeHitsNotTheirs(line, h(header)).some((x) => x.role), header);
  }
});
test("F2: a reference line is never their own title", () => {
  const src = `${OWN}\n\nREFERENCES\nMike Jones, Shift Manager | Kroger | 419-555-0199`;
  assert.ok(!titleInOwnHeaders("Shift manager", src));
  assert.ok(!titleInOwnHeaders("Shift manager", `${OWN}\nShift Manager | Kroger | 419-555-0199`));
  assert.ok(scopeHitsNotTheirs("Shift manager with 4 years of warehouse experience.", src).some((x) => x.role));
});

// ---- F4: the jail-school notice ------------------------------------------------------------------------

test("F4: alternative, adult-ed and middle schools are not facilities; named prison school systems are", () => {
  for (const s of ["Pike County Alternative School", "Lucas County Adult Education", "Lucas County Learning Center", "Monroe County Middle School", "County Line High School", "Harris County Department of Education", "Wood County High School"]) {
    const r = typedSchoolParts(s);
    assert.ok(typeof r === "object" && !r.facility, s);
  }
  for (const s of ["Windham School District", "Correctional Education program", "school at the county jail", "Lucas County Youth Center"]) {
    const r = typedSchoolParts(s);
    assert.ok(typeof r === "object" && r.facility, s);
  }
});

// ---- F5: a later "when" holds only its own duty -----------------------------------------------------

test("F5: a later 'when' clause holds only the duty it governs", () => {
  const cc = "I take escalated calls, listen to recorded calls and coach reps on them, help new hires during nesting, cover the queue when we're short";
  assert.deepEqual(scopeHitsNotTheirs("Coach reps using recorded call reviews", cc), []);
  assert.deepEqual(scopeHitsNotTheirs("Trained new hires on the scanner", upload("I train new hires, cover the dock when we're short.")), []);
  assert.ok(scopeNotTheirs("Led the dock crew", upload("I lead the dock crew when I get promoted.")));
  assert.ok(scopeNotTheirs("Led the dock crew", upload("I lead the dock crew, if they promote me.")));
  assert.ok(scopeNotTheirs("Trained new hires on the scanner", upload("I train new hires when they open the new building.")));
});

// ---- F6: wish frames, goal words, the next sentence --------------------------------------------------

for (const s of [
  "I wanna lead the dock crew and train new hires.",
  "I aim to lead the dock crew and train new hires.",
  "I gotta lead the dock crew and train new hires.",
  "I plan on training new hires and I train new hires.",
  "In my dreams I train new hires.",
  "Down the road I train new hires.",
  "Later on I train new hires.",
  "In the future I train new hires.",
  "Given the chance, I train new hires.",
  "Fingers crossed I train new hires.",
  "I train new hires. Starting Monday.",
  "I train new hires. If they promote me.",
  "I train new hires. Not yet though.",
  "I train new hires? I wish.",
  "I train new hires, or so they say.",
]) {
  test(`F6: "${s}" never clears "Trained new hires on the scanner"`, () => assert.ok(scopeNotTheirs("Trained new hires on the scanner", upload(s)), s));
}
for (const s of ["I train new hires. Every shift.", "I currently train new hires.", "I train new hires. I picked orders too."]) {
  test(`F6 control: "${s}" clears`, () => assert.equal(scopeNotTheirs("Trained new hires on the scanner", upload(s)), undefined));
}
