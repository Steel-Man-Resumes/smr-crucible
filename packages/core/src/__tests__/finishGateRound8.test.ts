/**
 * Finish gate, review round 8 (core). Fictional fixtures.
 *
 * B1: someone else's credential only before a plural people word or "on
 * duty", or after "to the" and the like; the person's own "CDL driver" is
 * asked. B2: a work acronym next to a training or holding word is asked;
 * OSHA, HACCP, GED and MA are not skipped. B3: a row keeps its name as
 * typed, refuses a status in the name, and has a permit kind. B4: a job
 * title covers the title only, never a dead credential. B5: education lines
 * are memory prompts. S1/S2/S3: scope needs the person as the subject, every
 * people class covered, and shared work stays shared.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { getResumeStatus } from "../resumeStatus";
import { credentialsToAsk, credentialRowText, credentialRowNameProblem, isCompleteCredentialRow, CREDENTIAL_KINDS } from "../credentialMentions";
import { scopeNotTheirs } from "../scopeWords";

const OWN = `Jordan Smith
Toledo, OH | jordan@example.com
Warehouse Associate | Midwest Distribution | 2019 - 2023
I picked orders with a scanner and wrapped pallets.`;
const page = (extra: string, title = "WAREHOUSE ASSOCIATE") => `JORDAN SMITH
Toledo, OH | jordan@example.com

PROFESSIONAL EXPERIENCE
${title} | Midwest Distribution | 2019 - 2023
- Picked orders with a scanner and wrapped pallets.${extra}`;
const summary = (line: string) => page("").replace("PROFESSIONAL EXPERIENCE", `SUMMARY\n${line}\n\nPROFESSIONAL EXPERIENCE`);
const asked = (r: string, own = OWN, rows?: Parameters<typeof credentialsToAsk>[3]) => credentialsToAsk(r, own, new Set(), rows, own).map((m) => m.name);

// ---- B1 ----------------------------------------------------------------------------------

for (const line of [
  "Class A CDL driver ready for regional routes.",
  "Warehouse associate with CDL and forklift experience.",
  "Line cook with ServSafe and four years in busy kitchens.",
  "Warehouse associate with OSHA 10 and four years on the dock.",
]) {
  test(`B1: the person's own "${line}" is a memory prompt`, () => assert.ok(asked(summary(line)).length > 0, line));
}
test("B1: 'as a CDL driver' and the letter's 'I am a CDL driver' are the person's", () => {
  assert.ok(asked(page("\n- Drove local routes as a CDL driver")).includes("CDL"));
  assert.ok(asked(`Dear Hiring Manager,\n\nI am a CDL driver and I can start right away.\n\nJordan Smith`).includes("CDL"));
});
test("B1 (control): someone else's credential is not asked", () => {
  assert.deepEqual(asked(page("\n- Loaded trailers for CDL drivers on the night shift")), []);
  assert.deepEqual(asked(page("\n- Reported changes to the RN on duty")), []);
});

// ---- B2 ----------------------------------------------------------------------------------

for (const line of [
  "- OSHA trained in safe lifting and forklift operation",
  "- OSHA-trained in safe lifting",
  "- Completed OSHA safety training",
  "- HACCP-trained and kept temperature logs every shift",
  "- Trained in HACCP food safety principles",
  "- GMP trained for food production work",
  "- LOTO authorized for conveyor maintenance",
  "- Forklift trained and safety minded",
]) {
  test(`B2: "${line}" is a memory prompt`, () => assert.ok(asked(page(`\n${line}`)).length > 0, line));
}
test("B2: MA is asked, except as a state after a city; skills terms with OSHA are asked too", () => {
  assert.ok(asked(summary("MA with front office and patient intake experience.")).includes("MA"));
  assert.deepEqual(asked(page("\n- Moved to Boston, MA for the job")), []);
  assert.ok(asked(page("\n\nSKILLS\nOSHA Trained | Forklift Operation | Pallet Jack")).length > 0);
});
test("B2 (control): a rule word after a work acronym is the rules, not a card", () => {
  assert.deepEqual(asked(page("\n- Operated the forklift in compliance with OSHA standards")), []);
  assert.deepEqual(asked(page("\n- Followed HACCP rules on every shift")), []);
  assert.deepEqual(asked(page("\n- Grew qualified pipeline by account-based campaigns")), []);
});

// ---- B3 ----------------------------------------------------------------------------------

test("B3: a row keeps its name as typed; a permit is a permit, never a license", () => {
  assert.ok((CREDENTIAL_KINDS as readonly string[]).includes("permit"));
  assert.equal(credentialRowText({ name: "CDL", kind: "permit", when: "2024" }), "CDL permit, 2024");
  assert.equal(credentialRowText({ name: "CDL permit", kind: "permit", when: "2024" }), "CDL permit, 2024");
  assert.equal(credentialRowText({ name: "Forklift", kind: "card", when: "2021" }), "Forklift card, 2021");
  assert.equal(credentialRowNameProblem("CDL permit", "license"), "permit");
  assert.equal(isCompleteCredentialRow({ name: "CDL permit", kind: "license", when: "2024" }), false);
  const rows = [{ name: "CDL", kind: "permit" as const, when: "2024" }];
  assert.ok(asked(page("\n\nCERTIFICATIONS\n- CDL license, 2024"), OWN, rows).length > 0);
  assert.deepEqual(asked(page("\n\nCERTIFICATIONS\n- CDL permit, 2024"), OWN, rows), []);
});
for (const name of ["CNA (lapsed)", "CNA, expired 2019", "Forklift - expired", "Driver's license (suspended)", "CDL suspended", "OSHA 10 card (lost)"]) {
  test(`B3: a status in the name box ("${name}") is refused`, () => {
    assert.equal(credentialRowNameProblem(name), "status");
    assert.equal(isCompleteCredentialRow({ name, kind: "certification", when: "2016" }), false);
  });
}

// ---- B4 ----------------------------------------------------------------------------------

const CNA_OWN = "Morgan Lee\nWORK HISTORY\nCNA | Meadowbrook Care Center | 2014 - 2017\nhelped residents with meals\nDishwasher | Harbor Diner | 2019 - 2023";
for (const [extra, title] of [
  ["\n\nCERTIFICATIONS\n- CNA", "DISHWASHER"],
  ["\n\nCERTIFICATIONS\n- Certified Nursing Assistant (CNA)", "DISHWASHER"],
  ["\n\nSKILLS\nCertified Nursing Assistant | Patient Care", "DISHWASHER"],
] as const) {
  test(`B4: their old job title never covers "${extra.trim().replace(/\n/g, " / ")}"`, () => {
    assert.ok(asked(page(extra, title), CNA_OWN).length > 0);
    assert.ok(asked(page(extra, title), CNA_OWN, [{ name: "CNA", kind: "certification", when: "expired" }]).length > 0);
  });
}
test("B4: the title itself is covered by their own header, unless their row says it lapsed", () => {
  const r = page("", "CNA").replace("Midwest Distribution", "Meadowbrook Care Center").replace("2019 - 2023", "2014 - 2017");
  assert.deepEqual(asked(r, CNA_OWN), []);
  assert.ok(asked(r, CNA_OWN, [{ name: "CNA", kind: "certification", when: "lapsed" }]).length > 0);
});

// ---- B5 ----------------------------------------------------------------------------------

for (const [said, line] of [
  ["I am working on my GED.", "GED, 2023"],
  ["I am working on my GED.", "GED"],
  ["I am working on my GED.", "GED | Toledo Adult Education | 2023"],
  ["I am working on my GED.", "High School Diploma"],
  ["I never finished high school.", "High School Equivalency (GED)"],
] as const) {
  test(`B5: "${said}" never makes the education line "${line}" finished`, () => {
    const s = getResumeStatus({ resumeText: `${page("")}\n\nEDUCATION\n${line}`, sourceText: `${OWN}\n${said}` });
    assert.equal(s.state, "draft");
    const item = s.openItems.find((i) => i.kind === "credential_unsaid");
    assert.ok(item && item.education, JSON.stringify(s.openItems));
  });
}
test("B5 (control): their own resume line covers the same education line; a school name alone is not a credential", () => {
  const own = `${OWN}\nEDUCATION\nHigh School Diploma | Lincoln High School | 2016`;
  assert.ok(!getResumeStatus({ resumeText: `${page("")}\n\nEDUCATION\nHigh School Diploma`, sourceText: own, ownResumeText: own }).openItems.some((i) => i.kind === "credential_unsaid"));
  assert.ok(!getResumeStatus({ resumeText: `${page("")}\n\nEDUCATION\nLincoln High School | 2016`, sourceText: own, ownResumeText: own }).openItems.some((i) => i.kind === "credential_unsaid"));
});

// ---- S1 / S2 / S3 ------------------------------------------------------------------------

for (const [said, line] of [
  ["The shift lead trained all the new hires on the forklift.", "Trained new hires on the forklift"],
  ["Our lead supervised the crew on second shift.", "Supervised the crew on second shift"],
  ["The owner managed the kitchen staff.", "Managed the kitchen staff"],
  ["Mike ran the dock crew and I loaded trucks for him.", "Ran the dock crew"],
  ["I trained new aides on safe transfers.", "Trained new nurses on safe transfers"],
  ["I trained one new cook on the grill.", "Trained all kitchen staff on food safety"],
  ["I supervised volunteers at my church food pantry.", "Supervised the night crew at Midwest Distribution"],
  ["I supervised the two dishwashers on Sundays.", "Supervised dishwashers and line cooks on Sundays"],
  ["I helped manage the stockroom.", "Managed the stockroom"],
  ["I helped supervise the dock crew.", "Supervised the dock crew"],
] as const) {
  test(`S1/S2/S3: "${said}" never makes "${line}" theirs`, () => assert.ok(scopeNotTheirs(line, said), line));
}
for (const [said, line] of [
  ["I trained the new guys on the scanner.", "Trained new hires on the scanner"],
  // Round 11: "my lead and I" is shared work; it sources the shared line, not the solo one.
  ["My lead and I trained the new guys on the scanner.", "Helped train new hires on the scanner"],
  ["I supervised the two dishwashers on Sundays.", "Supervised the dish crew on Sundays"],
  // Round 11: resume-style "Proven record of leading" is not one of the strict shapes; their past verb is.
  ["Led large teams across three shifts.", "Leads large teams across three production shifts"],
] as const) {
  test(`S1/S2 (control): "${said}" makes "${line}" theirs`, () => assert.equal(scopeNotTheirs(line, said), undefined));
}
