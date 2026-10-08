/**
 * Finish gate, review round 10 (core). Fictional fixtures.
 *
 * B1: "I can / could / will", "would have" and wish or plan frames never make
 * the person the subject of a past claim; habitual "would" does. SF-4:
 * "the training of / supervision of / leadership of" people after "tasked
 * with / chosen for / trusted with" is a claim. SF-5: honest aspect frames,
 * curly apostrophes, comma-list duty lines. SF-6: two shifts need both; "all
 * / every" needs all or every. SF-9: coworkers, teammates, colleagues. SF-1:
 * education prompts never name a status or a city. SF-2: one finding per
 * credential, with its own name and kind. SF-3: only a school the person
 * named rides on an education confirmation. SF-7: welding processes need a
 * holding word; "OSHA 10 trained" is the OSHA 10 card. SF-8: "I finished high
 * school" is the diploma. Q2: a year-only row covers a plain mention with no
 * status and no year, or the same year.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { getResumeStatus, educationMemoryPrompt } from "../resumeStatus";
import {
  credentialsToAsk,
  credentialMentionsOf,
  credentialKey,
  educationPartOf,
  educationLineRewrite,
  educationAttendedLine,
  isConfirmedAttendedLine,
  schoolUsedBy,
  withoutEducationPart,
  backstopMentionsOf,
} from "../credentialMentions";
import { scopeNotTheirs, straightQuotes } from "../scopeWords";

const OWN = `Jordan Smith
Toledo, OH | jordan@example.com
Warehouse Associate | Midwest Distribution | 2019 - 2023
I picked orders with a scanner and loaded trucks.`;
const said = (s: string) => `${OWN}\n${s}`;
const page = (extra: string) => `JORDAN SMITH
Toledo, OH | jordan@example.com

PROFESSIONAL EXPERIENCE
WAREHOUSE ASSOCIATE | Midwest Distribution | 2019 - 2023
- Picked orders with a scanner and loaded trucks.${extra}`;
const names = (r: string, own = OWN, rows?: Parameters<typeof credentialsToAsk>[3]) => credentialsToAsk(r, own, new Set(), rows, own).map((m) => m.name);

// ---- R10-B1 ---------------------------------------------------------------------------------

for (const [s, line] of [
  ["I know I can train new people and I could run a crew.", "Trained new hires on the scanner"],
  ["I will train new hires if they need me to.", "Trained new hires on the scanner"],
  ["I could lead the night crew, I know the work.", "Led the night crew"],
  ["I never trained anyone but I can train new hires.", "Trained new hires on the scanner"],
  ["I would have trained the new guys but they never asked.", "Trained new hires on the scanner"],
  ["I can supervise the night crew.", "Supervised the night crew"],
  ["I would like to train new hires one day.", "Trained new hires on the scanner"],
  ["I would love to supervise the night crew.", "Supervised the night crew"],
  ["I want to train the new guys.", "Trained new hires on the scanner"],
  ["I am going to lead the night crew.", "Led the night crew"],
  ["I am gonna train the new guys.", "Trained new hires on the scanner"],
  ["I am ready to supervise the night crew.", "Supervised the night crew"],
  ["I am able to train new hires.", "Trained new hires on the scanner"],
  ["I am willing to supervise the night crew.", "Supervised the night crew"],
  ["I plan to train new hires.", "Trained new hires on the scanner"],
  ["I hope to supervise the night crew someday.", "Supervised the night crew"],
] as const) {
  test(`R10-B1: "${s}" does not source "${line}"`, () => assert.ok(scopeNotTheirs(line, said(s)), s));
}
for (const s of ["I would train the new guys every Monday.", "I would always train the new guys.", "I'd train the new guys on the scanner."]) {
  test(`R10-B1 control: habitual "${s}" sources "Trained new hires"`, () => assert.equal(scopeNotTheirs("Trained new hires on the scanner", said(s)), undefined));
}

// ---- SF-4: nominal claims ---------------------------------------------------------------------

const PICKER = said("I picked orders and loaded trucks.");
for (const line of [
  "Tasked with the training of all new hires",
  "Trusted with supervision of the night crew",
  "Entrusted with oversight of the loading dock crew",
  "Chosen for the management of the stockroom crew",
  "Commended by management for leadership of the night crew",
  "Assigned to the training of new associates",
  "I was chosen for the training of new associates on the scanner.",
]) {
  test(`SF-4: "${line}" is a scope claim`, () => assert.ok(scopeNotTheirs(line, PICKER), line));
}
test("SF-4 control: under the supervision of the shift lead is someone else's", () => assert.equal(scopeNotTheirs("Worked under the supervision of the shift lead", PICKER), undefined));

// ---- SF-5: honest frames, curly apostrophes, comma lists -----------------------------------------

for (const [s, line] of [
  ["I was put in charge of the night crew in 2021.", "In charge of the night crew"],
  ["I basically ran the dock crew on nights.", "Ran the dock crew on nights"],
  ["I got to train the new guys on the scanner.", "Trained new hires on the scanner"],
  ["I pretty much trained all the new guys.", "Trained all new hires on the scanner"],
  ["I wound up supervising the night crew.", "Supervised the night crew"],
  ["I mainly trained the new guys.", "Trained new hires on the scanner"],
  ["I started training the new guys after my first year.", "Trained new hires on the scanner"],
  ["I’ve trained the new guys on the scanner.", "Trained new hires on the scanner"],
  ["I’m the one who trains the new hires.", "Trained new hires on the scanner"],
  ["trained new guys, ran the dock crew on nights", "Ran the dock crew on nights"],
] as const) {
  test(`SF-5: "${s}" sources "${line}"`, () => assert.equal(scopeNotTheirs(line, said(s)), undefined));
}
test("SF-5: straight quotes keep positions", () => assert.equal(straightQuotes("I’ve trained"), "I've trained"));

// ---- SF-6 / SF-9 ------------------------------------------------------------------------------

for (const [s, line] of [
  ["I supervised the night shift.", "Supervised day and night shifts"],
  ["I supervised the night shift.", "Supervised both shifts"],
  ["I trained employees on the scanner.", "Trained all employees on the scanner"],
  ["I trained the new guys on the scanner.", "Trained every new hire on the scanner"],
  ["I trained guys on the forklift.", "Trained all new hires on the forklift"],
  ["I picked orders.", "Trained coworkers on the forklift"],
  ["I picked orders.", "Taught teammates safe lifting"],
  ["I picked orders.", "Trained colleagues on the scanner"],
  ["I picked orders.", "Trained new co-workers on RF scanners"],
] as const) {
  test(`SF-6/9: "${s}" does not source "${line}"`, () => assert.ok(scopeNotTheirs(line, said(s)), line));
}
for (const [s, line] of [
  ["I supervised the day and night shifts.", "Supervised day and night shifts"],
  ["I trained all the employees on the scanner.", "Trained all employees on the scanner"],
  ["I trained my coworkers on the forklift.", "Trained coworkers on the forklift"],
] as const) {
  test(`SF-6/9 control: "${s}" sources "${line}"`, () => assert.equal(scopeNotTheirs(line, said(s)), undefined));
}

// ---- SF-1: education prompts name the school, never a status or a city --------------------------

for (const [line, name] of [
  ["Scott High School | Toledo, OH | Attended 2004 - 2007", "Scott High School"],
  ["Scott High School, Toledo, OH (attended through 11th grade)", "Scott High School"],
  ["Coursework completed through 11th grade, Scott High School", "Scott High School"],
  ["Scott High School | Toledo | 2008", "Scott High School"],
  ["Toledo, OH | 2008", "this school"],
  ["Penta Career Center | Welding | 2015", "Welding"],
] as const) {
  test(`SF-1: "${line}" is asked about "${name}"`, () => assert.equal(educationPartOf(line)?.name, name));
}
test("SF-1: 'I went but didn't finish' keeps the school and only the years typed", () => {
  assert.equal(educationAttendedLine("Scott High School | Toledo, OH | 2011 - 2014", "Scott High School", "Scott High School", "2011 - 2014"), "Scott High School, attended 2011 - 2014");
  assert.equal(educationAttendedLine("Scott High School | Toledo, OH | Graduated 2014", "Scott High School", "Scott High School", ""), "Scott High School, attended");
  // A GED line with a school the person never named has nothing to keep.
  assert.equal(educationAttendedLine("GED | Toledo Adult Education | 2015", "GED", "GED", "", "I never got a GED"), "");
  assert.equal(educationAttendedLine("GED | Toledo Adult Education | 2015", "GED", "GED", "2014", "I went to Toledo Adult Education for a while"), "Toledo Adult Education, attended 2014");
  assert.ok(isConfirmedAttendedLine("Scott High School, attended 2011 - 2014", "Scott High School", "2011 - 2014"));
  assert.ok(!isConfirmedAttendedLine("Scott High School, attended 2011 - 2015", "Scott High School", "2011 - 2014"));
  assert.ok(!isConfirmedAttendedLine("Scott High School, graduated", "Scott High School", ""));
  assert.match(educationMemoryPrompt("this school"), /^Did you finish this school\?/);
});

// ---- SF-2: one finding per credential, each with its own name and kind --------------------------

test("SF-2: a diploma and a certificate on one line are two findings with their own kinds", () => {
  const r = `${page("")}\n\nEDUCATION\nHigh School Diploma | Penta Career Center | Welding Certificate | 2015`;
  const s = getResumeStatus({ resumeText: r, sourceText: OWN, defendAnswers: [] });
  const cred = s.openItems.filter((i) => i.kind === "credential_unsaid");
  assert.equal(cred.length, 2, JSON.stringify(cred));
  const diploma = cred.find((i) => i.subject === "High School Diploma")!;
  const cert = cred.find((i) => i.subject === "Welding Certificate")!;
  assert.ok(diploma.education && /^Do you have a High School Diploma\?/.test(diploma.question));
  assert.ok(!cert.education && /^Do you hold Welding Certificate\?/.test(cert.question));
  assert.equal(withoutEducationPart("High School Diploma | Penta Career Center | Welding Certificate | 2015", "Welding Certificate"), "High School Diploma | Penta Career Center | 2015");
});

// ---- SF-3: what rides on an education confirmation ----------------------------------------------

test("SF-3: only the confirmed credential and a school the person named ride; the rest moves to its own line", () => {
  const r = educationLineRewrite("GED | Toledo Adult Education | Honor Roll | 2015", "GED", "GED, 2015", "I got my GED at Toledo Adult Education in 2015");
  assert.deepEqual(r, { line: "GED, 2015 | Toledo Adult Education", rest: "Honor Roll" });
  assert.deepEqual(educationLineRewrite("GED | Toledo Adult Education | GPA 3.9 | 2015", "GED", "GED, 2015", "I got my GED in 2015"), { line: "GED, 2015", rest: "GPA 3.9" });
  assert.deepEqual(educationLineRewrite("GED | Lucas County Jail Education Program | 2015", "GED", "GED, 2015", "I got my GED in 2015 at Lucas County Jail Education Program"), {
    line: "GED, 2015",
    rest: "Lucas County Jail Education Program",
  });
  assert.equal(educationLineRewrite("GED | Toledo Adult Education | Forklift Operator Training | 2015", "GED", "GED, 2015", "I got my GED").rest, "Forklift Operator Training");
  assert.ok(schoolUsedBy("Scott High School", "I went to Scott High but left in 11th grade."));
  assert.ok(!schoolUsedBy("Scott High School", "I never finished high school."));
  assert.ok(!schoolUsedBy("High School", "I went to high school."));
});

// ---- SF-7 / SF-8 / Q2 ---------------------------------------------------------------------------

test("SF-7: welding processes need a holding word; 'OSHA 10 trained' is the OSHA 10 card", () => {
  const skills = (l: string) => backstopMentionsOf(`${page("")}\n\nSKILLS\n${l}`, OWN).map((m) => m.name);
  assert.deepEqual(skills("MIG Welding | Stick (SMAW) Welding | GTAW | FCAW"), []);
  assert.ok(names(page("\n- SMAW certified through the union hall")).some((n) => /SMAW/.test(n)));
  assert.equal(credentialKey("OSHA 10 trained"), credentialKey("OSHA 10 card"));
});

test("SF-8: finishing high school in a letter or summary is the diploma, asked as education", () => {
  for (const l of ["I finished high school and went straight to work.", "Graduated high school and started at the warehouse.", "High school grad with a steady record."]) {
    const ms = credentialMentionsOf(`x\n${l}`);
    assert.ok(ms.some((m) => m.education && m.name === "High school diploma"), l);
  }
});

const WELD_OWN = `Marcus Hill
Toledo, OH | marcus@example.com
Welder | Toledo Steel Fab | 2018 - 2023
MIG and stick welding on structural steel`;
const weldSummary = (s: string) => `MARCUS HILL
Toledo, OH | marcus@example.com

SUMMARY
${s}

PROFESSIONAL EXPERIENCE
WELDER | Toledo Steel Fab | 2018 - 2023
- MIG and stick welding on structural steel`;
const AWS_ROW = [{ name: "AWS D1.1", kind: "certification" as const, when: "2019" }];
test("Q2: a year-only row covers a plain mention with no status and no year, or the same year", () => {
  assert.deepEqual(names(weldSummary("AWS-certified structural welder with MIG and stick experience."), WELD_OWN, AWS_ROW), []);
  assert.deepEqual(names(weldSummary("AWS D1.1 certified in 2019, structural welder."), WELD_OWN, AWS_ROW), []);
  assert.ok(names(weldSummary("AWS D1.1 certified since 2015, structural welder."), WELD_OWN, AWS_ROW).length > 0);
  assert.ok(names(weldSummary("Currently AWS-certified structural welder."), WELD_OWN, AWS_ROW).length > 0);
  assert.ok(names(weldSummary("AWS-certified structural welder."), WELD_OWN, [{ name: "AWS D1.1", kind: "certification", when: "expired" }]).length > 0);
  assert.ok(names(weldSummary("AWS-certified structural welder."), WELD_OWN, [{ name: "AWS D1.1", kind: "training course", when: "2019" }]).length > 0);
});
