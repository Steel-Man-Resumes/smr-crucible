/**
 * Finish gate, review round 6 (core). Fictional fixtures.
 *
 * B1/S2: the one exception is a whole line the person wrote (their uploaded
 * resume or their licenses answer), never a piece of one, and a status or
 * "not held" word they wrote must stay. B2: a job title is theirs only as a
 * whole title of theirs; a credential in a title is a memory prompt; no
 * answer settles a title. B3: wider recall, and a backstop for capitals
 * nobody gave. B4: scope is theirs only per claim: active voice, not inside a
 * credential name, the same people. S4: identical keys only. S5, S6: more
 * scope phrases; list wording is not a credential.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { getResumeStatus, type DefendAnswer } from "../resumeStatus";
import { credentialMentionsOf, credentialUnitsOf, credentialsToAsk, credentialKey, personJobTitles } from "../credentialMentions";
import { scopeHits, scopeNotTheirs } from "../scopeWords";
import { runMintCheck } from "../resumeMintCheckShared";

const BASE = `Morgan Sample
Toledo, OH | morgan@example.com
Line cook at Harbor Street Diner from 2019 to 2023.
I ran the grill on the breakfast line, prepped vegetables before open, and closed the kitchen at night.`;
const page = (extra: string, title = "LINE COOK") => `MORGAN SAMPLE
Toledo, OH | morgan@example.com

PROFESSIONAL EXPERIENCE
${title} | Harbor Street Diner | 2019 - 2023
- Ran the grill on the breakfast line.
- Prepped vegetables before open and closed the kitchen at night.${extra}`;
const GOOD = "I did that at the diner most shifts, the owner can say so.";
const answerAll = (r: string, src: string, credentialsAnswer?: string): DefendAnswer[] =>
  getResumeStatus({ resumeText: r, sourceText: src, credentialsAnswer }).openItems.filter((i) => i.severity === "BLOCK").map((i) => ({ line: i.line, answer: GOOD, verdict: "stands" as const }));
const status = (r: string, src: string, credentialsAnswer?: string) =>
  getResumeStatus({ resumeText: r, sourceText: src, defendAnswers: answerAll(r, src, credentialsAnswer), credentialsAnswer });

// ---- B1 ----------------------------------------------------------------------------------

for (const [typed, line] of [
  ["Forklift certified\nexpired in 2020", "Forklift certified"],
  ["CNA; lapsed in 2019", "CNA"],
  ["CNA\nlet it lapse in 2019, need to retake the state test", "CNA"],
  ["CDL; failed the road test twice", "CDL"],
  ["CDL Class A permit; road test in March", "CDL Class A permit"],
  ["OSHA 10\n(card lost, expired)", "OSHA 10"],
  ["HAZMAT endorsement - expired", "HAZMAT endorsement"],
] as const) {
  test(`B1: typed ${JSON.stringify(typed)} never covers "${line}"`, () => {
    const s = status(page(`\n\nCERTIFICATIONS\n- ${line}`), `${BASE}\n\n${typed}`, typed);
    assert.equal(s.state, "draft");
    assert.ok(s.openItems.some((i) => i.kind === "credential_unsaid"), JSON.stringify(s.openItems));
  });
}

test("B1: the same in an experience bullet (the whole-line match)", () => {
  const typed = "Forklift certified since 2019\nexpired 2021";
  const s = status(page("\n- Forklift certified since 2019"), `${BASE}\n\n${typed}`, typed);
  assert.ok(s.openItems.some((i) => i.kind === "credential_unsaid"));
});

for (const [typed, line] of [
  ["OSHA 10, 2019", "OSHA 10, 2019"],
  ["OSHA 10 card 2019", "OSHA 10 card (2019)"],
  ["Forklift certified 2019\nCPR card 2022", "Forklift certified 2019"],
] as const) {
  test(`B1 (control): typed ${JSON.stringify(typed)} covers "${line}"`, () => {
    const s = getResumeStatus({ resumeText: page(`\n\nCERTIFICATIONS\n- ${line}`), sourceText: `${BASE}\n\n${typed}`, credentialsAnswer: typed });
    assert.ok(!s.openItems.some((i) => i.kind === "credential_unsaid"), JSON.stringify(s.openItems));
  });
}

// ---- S2: the person's own uploaded resume line ----------------------------------------

for (const [own, line] of [
  ["Welding Certificate | West Michigan Technical College | 2011", "Welding Certificate | West Michigan Technical College | 2011"],
  ["Forklift Certification | Safety First Training | 2015", "Forklift Certification, Safety First Training, 2015"],
  ["Welding Certificate | West Michigan Technical College | 2011", "Welding Certificate"],
] as const) {
  test(`S2: their own resume line "${own}" covers "${line}"`, () => {
    const src = `${BASE}\n\nCERTIFICATIONS\n${own}`;
    assert.deepEqual(credentialsToAsk(page(`\n\nCERTIFICATIONS\n- ${line}`), src).map((m) => m.name), []);
  });
}

test("S2: a provider name is a detail of the credential, never one of its own", () => {
  assert.deepEqual(credentialUnitsOf("Forklift Certification, Safety First Training, 2015").map((u) => u.part), ["Forklift Certification"]);
  assert.deepEqual(credentialUnitsOf("OSHA 30 Certification, National Safety Council, 2010").map((u) => u.part), ["OSHA 30 Certification"]);
});

// ---- B2: job titles --------------------------------------------------------------------

for (const [title, said, ans] of [
  ["CERTIFIED NURSING ASSISTANT", "I worked as a nursing assistant at Harbor Street Diner from 2019 to 2023. I was never certified, I did not pass the state test.", ""],
  ["LICENSED PRACTICAL NURSE", "I was a practical nursing student and worked as an aide from 2019 to 2023. I am not licensed yet.", ""],
  ["LICENSED ELECTRICIAN", "I was an electrician's helper from 2019 to 2023, not licensed.", ""],
  ["CERTIFIED NURSING ASSISTANT", "I worked as a nurse aide at Harbor Street Diner from 2019 to 2023.", "I worked as a nurse aide there, I helped residents every shift."],
  ["JOURNEYMAN ELECTRICIAN", "I was an electrician's helper from 2019 to 2023.", "I pulled wire for the electricians every day."],
  ["KITCHEN MANAGER", "I was a line cook from 2019 to 2023. I have my ServSafe Manager certification from 2020.", "I was the kitchen manager there."],
] as const) {
  test(`B2: "${title}" for "${said.slice(0, 50)}..." is draft${ans ? " after an honest answer" : " with zero cards"}`, () => {
    const r = page("", title);
    const header = `${title} | Harbor Street Diner | 2019 - 2023`;
    const a: DefendAnswer[] = ans ? [{ line: header, answer: ans, verdict: "stands" }] : [];
    const s = getResumeStatus({ resumeText: r, sourceText: said, defendAnswers: a });
    assert.equal(s.state, "draft");
    assert.ok(s.openItems.some((i) => i.line === header && (i.kind === "title_unsaid" || i.kind === "credential_unsaid")), JSON.stringify(s.openItems));
  });
}

test("B2: a credential in a title is a memory prompt; a confirmation makes only that word theirs", () => {
  const r = page("", "CERTIFIED NURSING ASSISTANT");
  const header = "CERTIFIED NURSING ASSISTANT | Harbor Street Diner | 2019 - 2023";
  const src = "Nursing Assistant | Harbor Street Diner | 2019 - 2023\nI helped residents with meals.";
  const s = getResumeStatus({ resumeText: r, sourceText: src });
  assert.ok(s.openItems.some((i) => i.kind === "credential_unsaid" && i.line === header));
  const key = credentialMentionsOf(r).find((m) => m.title)!.key;
  const after = getResumeStatus({ resumeText: r, sourceText: src, confirmedKeys: [key] });
  assert.ok(!after.openItems.some((i) => i.line === header && (i.kind === "credential_unsaid" || i.kind === "title_unsaid")), JSON.stringify(after.openItems));
});

test("B2 (control): 'LINE COOK' for 'Line cook at Harbor Street Diner' is theirs; titles are whole, never scattered words", () => {
  assert.ok(personJobTitles(BASE).has("line cook"));
  assert.ok(!getResumeStatus({ resumeText: page(""), sourceText: BASE }).openItems.some((i) => i.rule === "STD-C03"));
  assert.ok(!personJobTitles("I worked as a nursing assistant. I was never certified.").has("certified nursing assistant"));
});

// ---- B3: recall and the backstop ---------------------------------------------------------

const SRC_B = `${BASE}\nI also did odd jobs fixing wiring and plumbing for neighbors on weekends.`;
for (const line of [
  "Licensed and bonded electrician for residential repair jobs on weekends",
  "Fully licensed, bonded and insured for weekend residential repair work",
  "Electrician, licensed and bonded, on weekend residential repair jobs",
  "Journeyman electrician on weekend residential repair jobs for neighbors",
  "Master plumber on weekend residential repair jobs for neighbors",
  "Class A driver hauling freight on weekends",
  "Notary public for neighbors on weekends",
  "ASE Master Technician on weekend repair jobs",
  "CompTIA A+ technician fixing neighbors' computers on weekends",
  "NCCCO crane operator on weekend construction jobs",
  "State-credentialed electrician on weekend residential repair jobs",
  "Accredited home inspector for neighbors on weekends",
  "QMA on the weekend shift at the care home",
]) {
  test(`B3: "${line}" is a memory prompt`, () => {
    const s = status(page(`\n- ${line}`), SRC_B);
    assert.ok(s.openItems.some((i) => i.kind === "credential_unsaid"), JSON.stringify(s.openItems));
  });
}

for (const term of ["RN", "MA", "PE", "LVN", "CMA", "Notary Public", "Journeyman Electrician", "Class A driving"]) {
  test(`B3: "${term}" in the skills list is a memory prompt, not a skill to keep`, () => {
    const r = page(`\n\nSKILLS\nGrill cooking, ${term}`);
    assert.ok(getResumeStatus({ resumeText: r, sourceText: BASE }).openItems.some((i) => i.kind === "credential_unsaid" && i.line === term));
    assert.ok(!runMintCheck({ output: r, source: BASE, kind: "resume" }).findings.some((f) => f.line === term && /grid/.test(f.kind ?? "")));
  });
}

test("B3 (control): a capital the person wrote is not asked; 'Boston, MA' in a sentence is not a credential", () => {
  assert.ok(!credentialsToAsk(page("\n- Ran the MIG welder on the night line."), `${BASE}\nI ran the MIG welder.`).length);
  assert.ok(!credentialMentionsOf(page("\n- Moved to Boston, MA for the job.")).some((m) => m.name === "MA"));
});

// ---- B4: scope per claim -----------------------------------------------------------------

for (const [said, line] of [
  ["I have my ServSafe Manager certification from 2020.", "Managed the night crew on the breakfast line"],
  ["I managed the register when the cashier was out.", "Managed the night crew on the breakfast line"],
  ["My station was supervised by the owner.", "Supervised the night crew on the breakfast line"],
  ["I led the safety huddle once when the owner asked.", "Led the night crew on the breakfast line"],
  ["I was trained by the other cooks when I started.", "Trained new cooks on the grill and the fryer"],
  ["I was hired and fired by the same manager.", "Hired and fired kitchen staff"],
  ["The night crew was run by the owner.", "Ran the night crew on weekends"],
] as const) {
  test(`B4: "${said}" never makes "${line}" theirs`, () => {
    assert.ok(scopeNotTheirs(line, `${BASE}\n${said}`), line);
    assert.equal(status(page(`\n- ${line}.`), `${BASE}\n${said}`).state, "draft");
  });
}

test("B4: 'ServSafe Manager' never makes 'KITCHEN MANAGER' theirs", () => {
  const s = getResumeStatus({ resumeText: page("", "KITCHEN MANAGER"), sourceText: `${BASE}\nI have my ServSafe Manager certification from 2020.` });
  assert.ok(s.openItems.some((i) => i.kind === "scope_unsaid" && /KITCHEN MANAGER/.test(i.line)));
});

test("B4 (control): the same claim in their own words, active, about the same people, is theirs", () => {
  assert.equal(scopeNotTheirs("Supervised the dish crew on Sundays.", "On Sundays I supervised the dish crew."), undefined);
  assert.equal(scopeNotTheirs("Supervised a team of 42 operators.", "Supervised a team of forty-two operators across three shifts."), undefined);
  assert.equal(scopeNotTheirs("I supervise forty-two operators.", "Supervised a team of forty-two operators."), undefined);
  assert.equal(scopeNotTheirs("Before that I coordinated freight as a shift lead.", "Shift Lead | Midwest Distribution | 2007 - 2014\nCoordinated inbound freight."), undefined);
  assert.ok(scopeNotTheirs("Supervised the night crew.", "I supervised the two dishwashers on Sundays."), "different people");
});

test("B4: someone else's role on the page is not a claim ('under the store manager')", () => {
  assert.equal(scopeHits("Helped with inventory counts under the store manager.").length, 0);
});

// ---- S5 ----------------------------------------------------------------------------------

for (const line of [
  "Taught new cooks the grill and the fryer",
  "Coached new hires on the grill",
  "Onboarded new hires on the breakfast line",
  "Showed the new guys the ropes on the grill",
  "Handled scheduling for the night crew",
  "Wrote the weekly schedule for the kitchen staff",
  "Point person for the night crew",
  "Crew chief on the night shift",
  "Second in command to the owner",
  "Key holder who opened and closed the store",
  "Wrote up cooks who came in late",
  "Approved time off for the night crew",
  "Was the go-to for new hires on the grill",
  "Ran the floor on weekends",
  "Ran the line on Saturdays",
  "Headed up the breakfast rush",
]) {
  test(`S5: "${line}" is a scope claim`, () => {
    assert.ok(scopeHits(line).length > 0, line);
    assert.equal(status(page(`\n- ${line}.`), BASE).state, "draft");
  });
}

test("S5 (control): the same phrase in their own words is theirs ('I ran the line on Saturdays')", () => {
  assert.equal(scopeNotTheirs("Ran the line on Saturdays.", "I ran the line on Saturdays."), undefined);
  assert.equal(scopeNotTheirs("Ran the floor on weekends.", "I ran the floor on weekends."), undefined);
});

// ---- S4 / S6 / N1 ------------------------------------------------------------------------

test("S4: only identical keys group; 'OSHA 10 Trainer', 'CDL Class A' and 'CPR Instructor' are each asked", () => {
  for (const [a, b] of [["OSHA 10, 2019", "OSHA 10 Trainer, 2021"], ["CDL, 2015", "CDL Class A, 2018"], ["CPR, 2022", "CPR Instructor, 2023"]]) {
    assert.equal(credentialsToAsk(page(`\n\nCERTIFICATIONS\n- ${a}\n- ${b}`)).length, 2, `${a} / ${b}`);
  }
});

test("S6: wording parts are not credentials; a name with 'and' stays whole", () => {
  assert.deepEqual(credentialUnitsOf("Forklift Certified - Advanced Level, OSHA-compliant").map((u) => u.part), ["Forklift Certified"]);
  assert.deepEqual(credentialUnitsOf("Certified Forklift Operator (OSHA)").map((u) => u.part), ["Certified Forklift Operator"]);
  assert.deepEqual(credentialUnitsOf("Certified Welding Inspector and Supervisor Program Graduate Level Three").length, 1);
  assert.deepEqual(credentialUnitsOf("CPR and First Aid, 2021").map((u) => u.part), ["CPR", "First Aid"]);
});

test("N1: 'CDL-A' keeps its letter in the key", () => {
  assert.equal(credentialKey("CDL-A"), credentialKey("CDL Class A"));
  assert.notEqual(credentialKey("CDL-A"), credentialKey("CDL-B"));
  assert.notEqual(credentialKey("CDL-A"), credentialKey("CDL"));
});
