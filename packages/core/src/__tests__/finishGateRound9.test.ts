/**
 * Finish gate, review round 9 (core). Fictional fixtures.
 *
 * B1: a scope verb after "by / for / with / asked" is still the page's
 * claim; only a noun (someone's role) is skipped there. B2: education lines
 * read HSED, dotted G.E.D., "Graduated" and "Completed", combined headings,
 * and never return before the claim readers. S1: the person is the subject
 * of the scope verb itself. S2: a current row covers a plain mention in a
 * sentence; expired, lapsed and permit rows never do. S3: quantities agree.
 * Notes: AED and ESL need a holding word; a member of the CNA staff holds it;
 * education prompts name the credential, not the school.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { getResumeStatus, educationMemoryPrompt } from "../resumeStatus";
import { credentialsToAsk, educationPartOf, educationLineRewrite, isConfirmedEducationLine, liveCredentialCovers, credentialMentionsOf, backstopMentionsOf } from "../credentialMentions";
import { scopeNotTheirs, scopeHits } from "../scopeWords";

const OWN = `Jordan Smith
Toledo, OH | jordan@example.com
Warehouse Associate | Midwest Distribution | 2019 - 2023
I picked orders with a scanner and loaded trucks.`;
const page = (extra: string) => `JORDAN SMITH
Toledo, OH | jordan@example.com

PROFESSIONAL EXPERIENCE
WAREHOUSE ASSOCIATE | Midwest Distribution | 2019 - 2023
- Picked orders with a scanner and loaded trucks.${extra}`;
const summary = (line: string) => page("").replace("PROFESSIONAL EXPERIENCE", `SUMMARY\n${line}\n\nPROFESSIONAL EXPERIENCE`);
const asked = (r: string, own = OWN, rows?: Parameters<typeof credentialsToAsk>[3]) => credentialsToAsk(r, own, new Set(), rows, own);
const names = (r: string, own = OWN, rows?: Parameters<typeof credentialsToAsk>[3]) => asked(r, own, rows).map((m) => m.name);

// ---- R9-B1: a verb after "by / for / with / asked" is still a claim ------------------------

const PICKER = `${OWN}\nI picked orders and loaded trucks. I want a steady warehouse job.`;
const OVERLAP = `${OWN}\nMy lead trained the new hires and supervised the night crew. I picked orders.`;
for (const line of [
  "Asked to train new hires on the scanner",
  "Chosen by the manager to supervise the night crew",
  "Trusted by management to lead the dock team on weekends",
  "Promoted by the owner to manage the stockroom crew",
  "Worked with the lead to train new hires on safety",
  "Stepped in for the supervisor and led the crew on weekends",
  "Recognized by the GM for supervising the night crew",
  "Known for training new hires on the scanner",
  "Tasked with training new associates on safety",
  "Relied on by management for leading the dock crew",
  "I was chosen by my supervisor to train new associates on the scanner.",
]) {
  test(`R9-B1: "${line}" is a scope claim the picker never made`, () => {
    assert.ok(scopeNotTheirs(line, PICKER), line);
    // Their words name someone else doing it: still not theirs.
    assert.ok(scopeNotTheirs(line, OVERLAP), line);
  });
}

for (const line of ["Reported to the shift lead on second shift", "Worked under the head cook on the line", "Supported the training team on inventory days"]) {
  test(`R9-B1 control: someone else's role "${line}" is not a claim`, () => assert.equal(scopeNotTheirs(line, PICKER), undefined, JSON.stringify(scopeHits(line))));
}

test("R9-B1: the resume line is held as scope_unsaid, not settled by an answer", () => {
  const r = page("\n- Chosen by the manager to supervise the night crew");
  const s = getResumeStatus({ resumeText: r, sourceText: PICKER, defendAnswers: [] });
  assert.ok(s.openItems.some((i) => i.kind === "scope_unsaid" && /Chosen by the manager/.test(i.line)), JSON.stringify(s.openItems));
});

// ---- R9-S1: the person is the subject of the scope verb itself -----------------------------

for (const [said, line] of [
  ["I watched him train the new guys on the scanner.", "Trained new hires on the scanner"],
  ["I think Mike trained the new hires on the forklift.", "Trained new hires on the forklift"],
  ["I know he supervised the crew on second shift.", "Supervised the crew on second shift"],
  ["Darnell was in charge of supervising the dock crew.", "Supervised the dock crew"],
  ["Rick was good at managing the kitchen staff.", "Managed the kitchen staff"],
  ["I helped him train the new guys.", "Trained new hires on the scanner"],
  ["I helped Mike train the new guys.", "Trained new hires on the scanner"],
] as const) {
  test(`R9-S1: "${said}" does not source "${line}"`, () => assert.ok(scopeNotTheirs(line, `${OWN}\n${said}`), said));
}

for (const [said, line] of [
  ["I trained the new guys on the scanner.", "Trained new hires on the scanner"],
  ["I would train the new guys on the scanner.", "Trained new hires on the scanner"],
  ["I was in charge of training the new hires.", "Trained new hires on the scanner"],
  ["I supervised the crew on second shift.", "Supervised the crew on second shift"],
] as const) {
  test(`R9-S1 control: "${said}" sources "${line}"`, () => assert.equal(scopeNotTheirs(line, `${OWN}\n${said}`), undefined));
}

// ---- R9-S3: quantities agree ----------------------------------------------------------------

for (const [said, line] of [
  ["I trained one new cook on the grill.", "Trained new cooks on the grill and the fryer"],
  ["I trained a new cook once.", "Trained new cooks on the line"],
  ["I trained the new guys on the scanner.", "Trained and onboarded the whole crew"],
  ["I trained two new guys on the scanner.", "Trained all new hires on the scanner"],
  ["I trained new aides on transfers.", "Trained the entire nursing staff on safe transfers"],
  ["I trained new aides on transfers.", "Trained nursing staff on safe transfers"],
] as const) {
  test(`R9-S3: "${said}" does not source "${line}"`, () => assert.ok(scopeNotTheirs(line, `${OWN}\n${said}`), said));
}

for (const [said, line] of [
  ["I trained the new guys on the scanner.", "Trained new hires on the scanner"],
  // Round 10 (SF-6): "all / whole / every" on the page needs the same word in theirs.
  ["I trained the whole crew on the scanner.", "Trained the whole crew on the scanner"],
  ["I trained all the new guys on the scanner.", "Trained all new hires on the scanner"],
  ["I supervised the two dishwashers on Sundays.", "Supervised the dish crew on Sundays"],
] as const) {
  test(`R9-S3 control: "${said}" sources "${line}"`, () => assert.equal(scopeNotTheirs(line, `${OWN}\n${said}`), undefined));
}

// ---- R9-B2: education ------------------------------------------------------------------------

const NOHS = `${OWN}\nI never finished high school. I quit in 11th grade.`;
const UPLOAD_EDU = `${OWN}\n\nEDUCATION\nToledo Tech, 2019`;
for (const [head, line, name] of [
  ["EDUCATION", "HSED | Milwaukee Area Technical College", "HSED"],
  ["EDUCATION", "HSED, 2015", "HSED"],
  ["EDUCATION", "G.E.D.", "G.E.D"],
  ["EDUCATION", "G.E.D., Toledo Adult Education", "G.E.D"],
  ["EDUCATION", "Scott High School, Toledo, OH | Graduated", "Scott High School"],
  ["EDUCATION", "Graduated from Scott High School", "Scott High School"],
  ["EDUCATION", "Scott High School | Toledo, OH | 2008", "Scott High School"],
  ["EDUCATION", "Completed 12th grade, Scott High School", "12th grade"],
  ["EDUCATION", "Owens Community College | Welding Program | Completed", "Welding Program"],
  ["EDUCATION", "Owens Community College, Welding Technology, 2019", "Welding Technology"],
  ["EDUCATION", "Owens Community College | Associate of Applied Science | 2019", "Associate of Applied Science"],
  ["EDUCATION AND CERTIFICATIONS", "- High School Diploma", "High School Diploma"],
  ["EDUCATION & CERTIFICATIONS", "High School Diploma, 2008", "High School Diploma"],
  ["Education and Certifications", "High School Diploma, 2008", "High School Diploma"],
  ["TRAINING & EDUCATION", "High School Diploma, 2008", "High School Diploma"],
] as const) {
  test(`R9-B2: [${head}] "${line}" is an education prompt naming "${name}"`, () => {
    const m = asked(`${page("")}\n\n${head}\n${line}`, NOHS).find((x) => x.education);
    assert.ok(m, JSON.stringify(asked(`${page("")}\n\n${head}\n${line}`, NOHS)));
    assert.equal(m!.name, name);
  });
}

for (const [line, name] of [
  ["Toledo Tech | Forklift Certified | 2019", "Forklift Certified"],
  ["Toledo Tech, Forklift Certified Operator, 2019", "Forklift Certified"],
  ["Penta Career Center, Cosmetology, State Licensed, 2015", "State Licensed"],
  ["Owens Community College | Welding Program | AWS Certified | 2020", "AWS Certified"],
  ["Owens Community College, Welding, Certified Welder, 2020", "Certified Welder"],
  ["Toledo Tech | Forklift Operator Training | 2019 | OSHA trained", "OSHA trained"],
] as const) {
  test(`R9-B2: a holding claim in an education line falls through to the claim readers: "${line}"`, () => {
    assert.ok(names(`${page("")}\n\nEDUCATION\n${line}`, UPLOAD_EDU).includes(name), JSON.stringify(names(`${page("")}\n\nEDUCATION\n${line}`, UPLOAD_EDU)));
  });
}

test("R9-B2: a GED or diploma in a sentence is an education prompt too", () => {
  assert.ok(asked(summary("Warehouse associate and high school graduate ready for second shift."), NOHS).some((m) => m.education));
  assert.ok(asked(page("\n- Earned my G.E.D. while working nights"), NOHS).some((m) => m.education && m.name === "G.E.D"));
});

test("R9-B2: the person's own education line covers the writer's split of it", () => {
  const own = `${OWN}\n\nEDUCATION\nHigh School Diploma | Lincoln High School | 2022`;
  const r = `${page("")}\n\nEDUCATION\nLincoln High School | 2022\nHigh School Diploma`;
  assert.deepEqual(names(r, own), []);
  // A line of theirs that says not yet covers nothing.
  const notYet = `${OWN}\n\nEDUCATION\nGED | in progress | Toledo Adult Education`;
  assert.ok(names(`${page("")}\n\nEDUCATION\nToledo Adult Education | 2023`, notYet).length > 0);
});

test("R9-N4: education prompts name the credential, and the rewrite keeps the school", () => {
  assert.equal(educationPartOf("Owens Community College | Associate of Applied Science | 2019")?.name, "Associate of Applied Science");
  assert.equal(educationPartOf("High School Equivalency (GED)")?.name, "High School Equivalency");
  // Round 10 (SF-3): the school rides only when the person named it; places and the writer's year come off.
  assert.equal(educationLineRewrite("GED | Toledo Adult Education | 2023", "GED", "GED, in progress", "working on my GED at Toledo Adult Education").line, "GED, in progress | Toledo Adult Education");
  assert.equal(educationLineRewrite("GED | Toledo Adult Education | 2023", "GED", "GED, in progress", "working on my GED").line, "GED, in progress");
  assert.equal(educationLineRewrite("Scott High School, Toledo, OH | Graduated", "Scott High School", "Scott High School, 2008").line, "Scott High School, 2008");
  assert.ok(isConfirmedEducationLine("GED, in progress | Toledo Adult Education", "GED, in progress", "I go to Toledo Adult Education"));
  assert.ok(!isConfirmedEducationLine("GED, in progress | Toledo Adult Education", "GED, in progress", "I am working on my GED"));
  assert.ok(!isConfirmedEducationLine("GED, in progress | Toledo Adult Education | 2023", "GED, in progress"));
  assert.ok(!isConfirmedEducationLine("GED, in progress | Graduated", "GED, in progress"));
  assert.match(educationMemoryPrompt("GED"), /^Do you have a GED\?/);
  assert.match(educationMemoryPrompt("HSED"), /^Do you have an HSED\?/);
  assert.match(educationMemoryPrompt("Scott High School"), /^Did you finish Scott High School\?/);
  assert.match(educationMemoryPrompt("High school graduate"), /^Did you finish high school\?/);
});

// ---- R9-S2: a current row covers plain mentions in sentences ------------------------------

const CNA_OWN = `Tasha Reed
Toledo, OH | tasha@example.com
Certified Nursing Assistant | Meadowbrook Care Center | 2016 - present
helped residents with bathing, dressing and meals`;
const CNA_PAGE = (sum: string, certs = "- CNA certification, current") => `TASHA REED
Toledo, OH | tasha@example.com

CAREER SUMMARY
${sum}

PROFESSIONAL EXPERIENCE
CERTIFIED NURSING ASSISTANT | Meadowbrook Care Center | 2016 - Present
- Helped residents with bathing, dressing and meals

CERTIFICATIONS
${certs}`;
const SUM = "Certified nursing assistant with eight years of resident care in long-term care.";
test("R9-S2: an honest CNA with a current row keeps the summary unasked", () => {
  assert.deepEqual(names(CNA_PAGE(SUM), CNA_OWN, [{ name: "CNA", kind: "certification", when: "current" }]), []);
});
for (const row of [
  { name: "CNA", kind: "certification" as const, when: "expired" },
  { name: "CNA", kind: "certification" as const, when: "lapsed" },
  { name: "CNA", kind: "permit" as const, when: "2024" },
  { name: "CNA", kind: "training course" as const, when: "2016" },
  { name: "CNA", kind: "certification" as const, when: "2016" },
]) {
  test(`R9-S2: a row "${row.name} / ${row.kind} / ${row.when}" never covers the summary`, () => {
    assert.ok(names(CNA_PAGE(SUM, "- CNA"), CNA_OWN, [row]).length > 0);
  });
}
for (const sum of [
  "Former certified nursing assistant with eight years of resident care.",
  "CNA (expired) with eight years of resident care.",
  "CNA license holder with eight years of resident care.",
]) {
  test(`R9-S2: a current certification row does not cover "${sum}"`, () => {
    assert.ok(names(CNA_PAGE(sum), CNA_OWN, [{ name: "CNA", kind: "certification", when: "current" }]).length > 0);
  });
}
test("R9-S2: a list line or a title is never covered by the sentence rule", () => {
  const ms = credentialMentionsOf(CNA_PAGE(SUM, "- CNA"));
  const held = { name: "CNA", kind: "certification", when: "current" };
  assert.ok(ms.filter((m) => m.where === "credentials" || m.title).every((m) => !liveCredentialCovers(m, held)));
  assert.ok(ms.some((m) => m.where === "other" && !m.title && liveCredentialCovers(m, held)));
});

// ---- Notes ------------------------------------------------------------------------------------

test("R9-N3: AED and ESL need a holding word; HACCP rules read three words on", () => {
  const ask = (l: string) => backstopMentionsOf(page(`\n- ${l}`), OWN).map((m) => m.name);
  assert.deepEqual(ask("Used an AED in training drills"), []);
  assert.deepEqual(ask("Completed ESL classes at the library"), []);
  assert.deepEqual(ask("Followed HACCP food safety rules"), []);
  // With a holding word it is a claim, asked like any credential.
  assert.ok(names(page("\n- AED certified through the county")).some((n) => /AED/.test(n)));
  assert.ok(names(page("\n- ESL certificate from the library")).some((n) => /ESL/.test(n)));
});

test("R9-N1: a member of the CNA staff, or moved up to the CDL team, holds it", () => {
  assert.ok(names(page("\n- Member of the CNA staff on the memory care unit")).includes("CNA"));
  assert.ok(names(summary("I moved up to the CDL team after a year.")).includes("CDL"));
  // Someone else's: still not asked.
  assert.ok(!names(page("\n- Worked alongside CDL drivers on local routes")).includes("CDL"));
});
