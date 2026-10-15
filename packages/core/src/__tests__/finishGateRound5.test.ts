/**
 * Finish gate, review round 5 (core). Fictional fixtures.
 *
 * The design change: the gate never reads the person's free text to decide
 * that they "said" a credential, its kind, its status or a scope claim.
 * - Every credential on the page is a memory prompt (D4). The one exception
 *   is a line exactly as the person typed it in the licenses-and-training
 *   answer (whitespace, case and punctuation aside).
 * - No answer ever settles a credential's status.
 * - A scope claim the person never made is settled only by their own rewrite
 *   or a cut, never by an answer.
 * - A credentials line is read part by part; no part is dropped.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { getResumeStatus, type DefendAnswer } from "../resumeStatus";
import { credentialMentionsOf, credentialUnitsOf, credentialsToAsk, typedCredentialEntries } from "../credentialMentions";
import { isStrictCredentialWhen } from "../credentialStatus";
import { scopeHits, scopeNotTheirs } from "../scopeWords";

const BASE = `Morgan Sample
Toledo, OH | morgan@example.com
Line cook at Harbor Street Diner from 2019 to 2023.
I ran the grill on the breakfast line, prepped vegetables before open, and closed the kitchen at night.
The owner asked me to show new cooks the grill.`;
const page = (extra: string, title = "LINE COOK") => `MORGAN SAMPLE
Toledo, OH | morgan@example.com

PROFESSIONAL EXPERIENCE
${title} | Harbor Street Diner | 2019 - 2023
- Ran the grill on the breakfast line.
- Prepped vegetables before open and closed the kitchen at night.${extra}`;
const GOOD = "I did that at the diner most shifts, the owner can say so.";
const TYPE_ANSWER = "It is a card from the county job center, it is current, I keep it in my wallet.";

/** Every open item answered, three times over, with `ans` (a type-and-status answer for credentials). */
function walk(r: string, src: string, ans: (q: string) => string = (q) => (/hold|license|certification/.test(q) ? TYPE_ANSWER : GOOD), credentialsAnswer?: string) {
  let a: DefendAnswer[] = [];
  for (let k = 0; k < 3; k++) {
    const s = getResumeStatus({ resumeText: r, sourceText: src, defendAnswers: a, credentialsAnswer });
    for (const i of s.openItems) if (i.severity === "BLOCK" && !a.some((x) => x.line === i.line)) a.push({ line: i.line, answer: ans(i.question), verdict: "stands" });
  }
  return getResumeStatus({ resumeText: r, sourceText: src, defendAnswers: a, credentialsAnswer });
}

// ---- B1: a course, a permit, a school certificate or a failed test never becomes a held credential ----

const B1_ROWS: Array<[string, string]> = [
  ["I did HAZMAT training at the warehouse in 2021.", "HAZMAT Endorsement, 2021"],
  ["I went through the CNA training program at the Red Cross in 2016 but never took the state exam.", "CNA, 2016"],
  ["I went through the CNA training program at the Red Cross in 2016 but never took the state exam.", "Certified Nursing Assistant (CNA), 2016"],
  ["I took CDL training at the truck school in 2022 but did not pass the road test.", "CDL, 2022"],
  ["I took a ServSafe class in 2020.", "ServSafe Certified, 2020"],
  ["I sat through an EMT course in 2018.", "EMT, 2018"],
  ["I started the OSHA 30 course in 2024 but did not finish it.", "OSHA 30, 2024"],
  ["I did Six Sigma training at the plant in 2020.", "Six Sigma Certified, 2020"],
  ["I got my CDL permit in 2023 and I am studying for the road test.", "CDL, 2023"],
  ["I failed the CDL road test in 2022.", "CDL, 2022"],
  ["I failed the OSHA 30 test in 2024.", "OSHA 30, 2024"],
  ["I never got my forklift card, I only took the class in 2019.", "Forklift card, 2019"],
  ["I got my electrician certificate from the tech college in 2020.", "Licensed Electrician, 2020"],
  ["I got my welding certificate from the tech college in 2011.", "Welding Certification, current"],
];
for (const [said, line] of B1_ROWS) {
  test(`B1: "${said}" never makes "${line}" finished: a memory prompt no answer settles`, () => {
    const s = walk(page(`\n\nCERTIFICATIONS\n- ${line}`), `${BASE}\n${said}`);
    assert.equal(s.state, "draft");
    assert.ok(s.openItems.some((i) => i.kind === "credential_unsaid" && i.severity === "BLOCK"), JSON.stringify(s.openItems));
  });
}

test("B1: the same claim in an experience bullet is a memory prompt too", () => {
  const r = page("\n- Hold a HAZMAT endorsement since 2021 and loaded trucks safely.");
  const s = walk(r, `${BASE}\nI did HAZMAT training at the warehouse in 2021.`);
  assert.equal(s.state, "draft");
  assert.ok(s.openItems.some((i) => i.kind === "credential_unsaid" && /HAZMAT/i.test(i.subject ?? "")));
});

// ---- B2: a class letter in any spelling ------------------------------------------------

for (const [said, line] of [
  ["I have my Class B CDL since 2015.", "Class-A CDL, 2015"],
  ["I have my Class B CDL since 2015.", "CDL (A), 2015"],
  ["I have my CDL Class B since 2015.", "Class-A CDL, 2015"],
  ["I have my CDL Class B since 2015.", "CDL-A, 2015"],
] as const) {
  test(`B2: "${said}" never makes "${line}" finished`, () => {
    assert.equal(walk(page(`\n\nCERTIFICATIONS\n- ${line}`), `${BASE}\n${said}`).state, "draft");
  });
}

test("B2: the class letter stays with the name on the page, whatever its spelling", () => {
  for (const l of ["Class-A CDL", "CDL Class A", "Class A CDL"]) {
    const m = credentialMentionsOf(page(`\n\nCERTIFICATIONS\n- ${l}, 2015`)).find((x) => x.where === "credentials")!;
    assert.match(m.name, /\bA\b/, l);
  }
  const letter = credentialMentionsOf("x\nI ran the grill. I hold a Class A Commercial Driver's License and am ready.")[0];
  assert.equal(letter.name, "Class A Commercial Driver's License");
});

// ---- B3: every part of a credentials line ----------------------------------------------

for (const line of [
  "OSHA 10 (also Forklift Certified)",
  "OSHA 10, Forklift",
  "OSHA 10, Forklift Operation",
  "OSHA 10, Fall Protection Competent Person",
  "OSHA 10, HAZMAT Handling",
  "OSHA 10 (2019), Food Safety",
  "OSHA 10, 2019, Forklift",
  "OSHA 10 • Forklift Certified",
  "OSHA 10 \u2014 Forklift Certified",
  "OSHA 10 + CPR",
  "OSHA 10 & CPR",
  "OSHA 10 with CPR",
  "OSHA 10 plus CPR",
  "OSHA 10\tCPR",
  "OSHA 10   CPR",
  "OSHA 10\u2013CPR",
]) {
  test(`B3: "${JSON.stringify(line)}" is read part by part; the second part is asked`, () => {
    const parts = credentialUnitsOf(line).map((u) => u.part);
    assert.ok(parts.length >= 2, JSON.stringify(parts));
    const r = page(`\n\nCERTIFICATIONS\n- ${line}`);
    const asked = credentialsToAsk(r, "OSHA 10, 2019").map((m) => m.name);
    assert.ok(asked.some((n) => !/^OSHA 10$/.test(n)), JSON.stringify(asked));
    assert.equal(walk(r, `${BASE}\nOSHA 10, 2019`, undefined, "OSHA 10, 2019").state, "draft");
  });
}

test("B3 (control): a year or a status part goes with the part before it; where it was earned is a detail of it", () => {
  assert.deepEqual(credentialUnitsOf("OSHA 10, 2019"), [{ part: "OSHA 10", unit: "OSHA 10, 2019" }]);
  assert.deepEqual(credentialUnitsOf("AWS D1.1 Structural Welding Certification, renewed yearly").length, 1);
  assert.deepEqual(credentialUnitsOf("Forklift training, county job center (2023), passed the driving test").map((u) => u.part), ["Forklift training"]);
  assert.deepEqual(credentialUnitsOf("Certified Nursing Assistant (CNA), 2016").map((u) => u.part), ["Certified Nursing Assistant"]);
  assert.deepEqual(credentialUnitsOf("Commercial Driver's License, Class A").map((u) => u.part), ["Commercial Driver's License Class A"]);
});

// ---- the one exception: typed exactly -------------------------------------------------

test("Typed exactly (round 7): a structured row shown exactly is not asked; the old free-text answer is", () => {
  const r = page("\n\nCERTIFICATIONS\n- OSHA 10 card, 2019");
  const src = `${BASE}\nOSHA 10 card, 2019`;
  // The rows are part of the person's own words too (their year and number are theirs).
  assert.equal(getResumeStatus({ resumeText: r, sourceText: src, credentialRows: [{ name: "OSHA 10", kind: "card", when: "2019" }] }).state, "finished");
  assert.equal(getResumeStatus({ resumeText: r, sourceText: src, credentialRows: [{ name: "OSHA-10", kind: "card", when: "2019" }] }).state, "finished");
  assert.equal(getResumeStatus({ resumeText: r, sourceText: src, credentialsAnswer: "OSHA 10 card, 2019" }).state, "draft");
});

for (const [typed, line] of [
  ["Emergency Medical Technician, 2018", "EMT, 2018"],
  ["EMT, 2018", "Emergency Medical Technician, 2018"],
  ["BLS, 2022", "Basic Life Support, 2022"],
  ["forklift card, expired a while back", "Forklift card"],
  ["OSHA 10", "OSHA 10, current"],
  ["I have my OSHA 10 card from 2019", "OSHA 10, 2019"],
] as const) {
  test(`Typed exactly: "${typed}" does not cover "${line}" (an expansion, a part, or more than was typed is asked)`, () => {
    const s = getResumeStatus({ resumeText: page(`\n\nCERTIFICATIONS\n- ${line}`), sourceText: `${BASE}\n${typed}`, credentialsAnswer: typed });
    assert.ok(s.openItems.some((i) => i.kind === "credential_unsaid"), JSON.stringify(s.openItems));
  });
}

test("Typed exactly: a typed line on the resume does not cover the same credential said differently in a sentence", () => {
  const r = page("\n- Loaded trucks as a current OSHA 10 card holder.\n\nCERTIFICATIONS\n- OSHA 10, 2019");
  const s = getResumeStatus({ resumeText: r, sourceText: BASE, ownResumeText: "OSHA 10, 2019" });
  assert.ok(s.openItems.some((i) => i.kind === "credential_unsaid" && /current OSHA 10/.test(i.line)), JSON.stringify(s.openItems));
  // Round 6: the person's lines stay whole; nothing is cut on a semicolon.
  assert.deepEqual(Array.from(typedCredentialEntries("OSHA 10, 2019\nForklift card; CPR")), ["osha 10 2019", "forklift card cpr"]);
});

// ---- B5: no status from free text ------------------------------------------------------

for (const ans of [
  "It is a card, it is no longer active.",
  "It is a card, I need to get it renewed.",
  "It is a card, it was valid for three years.",
  "It is a card, I am currently looking for work.",
  "It is a card from 2019, it is current.",
]) {
  test(`B5: the answer "${ans}" never settles the writer's "current"`, () => {
    const s = walk(page("\n\nCERTIFICATIONS\n- Forklift card, current"), `${BASE}\nI have my forklift card from the county job center.`, () => ans);
    assert.equal(s.state, "draft");
  });
}

for (const [said, line] of [
  ["I have my forklift card from 2019, it expired in 2022.", "Forklift card, current"],
  ["I have my OSHA 10 card, it is expired.", "OSHA 10, valid"],
  ["I got my welding certificate from the tech college in 2011.", "Welding Certification, current"],
] as const) {
  test(`B5: zero cards no more: "${said}" against "${line}" is asked`, () => {
    const s = getResumeStatus({ resumeText: page(`\n\nCERTIFICATIONS\n- ${line}`), sourceText: `${BASE}\n${said}` });
    assert.equal(s.state, "draft");
    assert.ok(s.openItems.some((i) => i.kind === "credential_unsaid"));
  });
}

test("Status box (N1): one status, with a range or a got-and-expires pair; never two stories or a future year", () => {
  const now = new Date("2026-10-07");
  for (const w of ["2019-2021", "2019 to 2021", "renewed 2024, expires 2027", "got it in 2019 and it is still current", "expired in 2021", "2026"]) assert.equal(isStrictCredentialWhen(w, now), true, w);
  for (const w of ["2021-2019", "2019-2028", "2019 2020", "renewed 2024, current 2027", "expired 2021 renewed", "current, expired", "2030", "current until 2020"]) assert.equal(isStrictCredentialWhen(w, now), false, w);
});

// ---- B4 / S2 / S3: scope ---------------------------------------------------------------

for (const [line, ans] of [
  ["Supervised the night crew on the breakfast line", "I trained the new cooks on the grill most shifts, the owner can say so."],
  ["Supervised the night crew on the breakfast line", "I coordinated tickets with the servers on the night crew most shifts."],
  ["Supervised the night crew on the breakfast line", "I was the lead on the grill at night, the owner can say so."],
  ["Supervised the night crew on the breakfast line", "I managed my own station on the night crew, nobody reported to me."],
  ["Supervised the night crew on the breakfast line", "I never trained anyone, but I ran the night crew grill."],
  ["Managed the night crew on the breakfast line", "I directed customers to their tables when the night crew was short."],
  ["Managed the night crew on the breakfast line", "I managed the grill on the night crew at the diner most shifts."],
  ["Directed the night crew on the breakfast line", "I mentored one new cook on the night crew, the owner asked me to."],
  ["Supervised the dish crew on Sundays", "I supervised the two dishwashers on Sundays."],
] as const) {
  test(`B4: "${line}" is never settled by an answer ("${ans}")`, () => {
    const r = page(`\n- ${line}.`);
    const a = [{ line: `- ${line}.`, answer: ans, verdict: "stands" as const }];
    const s = getResumeStatus({ resumeText: r, sourceText: BASE, defendAnswers: a });
    assert.equal(s.state, "draft");
    assert.ok(s.openItems.some((i) => i.kind === "scope_unsaid" && i.line === `- ${line}.`), JSON.stringify(s.openItems));
  });
}

test("B4 (control): the person's own scope words are theirs; a denial is not", () => {
  const r = page("\n- Supervised the dish crew on Sundays.");
  assert.equal(getResumeStatus({ resumeText: r, sourceText: `${BASE}\nOn Sundays I supervised the dish crew.` }).openItems.some((i) => i.kind === "scope_unsaid"), false);
  assert.equal(getResumeStatus({ resumeText: r, sourceText: `${BASE}\nI never supervised anyone.` }).openItems.some((i) => i.kind === "scope_unsaid"), true);
});

for (const line of [
  "Responsible for the night crew",
  "Delegated tasks to the night crew",
  "Assigned stations to the night crew",
  "Took over the night crew",
  "Scheduled the night crew",
  "Captained the night crew",
  "Ran point on the night crew",
  "Organized the night crew",
  "Kept the night crew on task",
  "Night crew head",
  "Hired and fired kitchen staff",
  "Evaluated cook performance",
  "Trained all of the new hires",
  "Trained a group of new hires",
  "Ran the entire overnight dish washing crew",
  "Owner/operator of a lawn care business",
]) {
  test(`S2: "${line}" is a scope claim only a rewrite or a cut settles`, () => {
    assert.ok(scopeHits(line).length > 0, line);
    const r = page(`\n- ${line}.`);
    const a = [{ line: `- ${line}.`, answer: GOOD, verdict: "stands" as const }];
    assert.equal(getResumeStatus({ resumeText: r, sourceText: BASE, defendAnswers: a }).state, "draft");
  });
}

test("S2 (control): ordinary work is not a scope claim", () => {
  // Round 6: "ran the line" and "ran the floor" are scope claims now (theirs only when they used the same phrase).
  for (const l of ["Ran the grill on the breakfast line.", "Trained on the new store register.", "Worked the line on weekends."]) assert.equal(scopeHits(l).length, 0, l);
});

test("S3: the person's own words are read loosely: 'Trained and mentored twelve new team leads' covers 'trained new team leads'", () => {
  assert.equal(scopeNotTheirs("I trained new team leads on safety.", "Trained and mentored twelve new team leads at the plant."), undefined);
  assert.ok(scopeNotTheirs("I trained new team leads on safety.", "I trained on the new line at the plant."));
});

test("A job title that claims scope the person never had is held for a rewrite", () => {
  const s = getResumeStatus({ resumeText: page("", "SHIFT SUPERVISOR"), sourceText: BASE, defendAnswers: [{ line: "SHIFT SUPERVISOR | Harbor Street Diner | 2019 - 2023", answer: GOOD, verdict: "stands" }] });
  assert.ok(s.openItems.some((i) => i.kind === "scope_unsaid" && /SHIFT SUPERVISOR/.test(i.line)), JSON.stringify(s.openItems));
});
