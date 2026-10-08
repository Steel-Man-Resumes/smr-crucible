/**
 * Finish gate, review round 6 (consumer). Fictional fixtures.
 *
 * B5: the letter's sentences are never broken at an abbreviation, and what
 * is kept after a drop is read again. S1: "No, take it off" inside a longer
 * sentence leaves a leftover the gate holds. S3: the conflict guard fires only
 * on one credential told two ways. Titles: a confirmation leaves the job
 * header alone; "No" takes only the credential word off it. N2: "Registered
 * Nurse" stays whole on the confirmed line.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as gate from "../finish-gate";

const { buildFinishView, applyConfirmation, cutCredential, cutCredentialWithRemnant, splitSentences, applyRewrite, cutLine } = gate;
type Input = Parameters<typeof buildFinishView>[0];

const BASE = `Morgan Sample
Toledo, OH | morgan@example.com
Line cook at Harbor Street Diner from 2019 to 2023.
I ran the grill on the breakfast line, prepped vegetables before open, and closed the kitchen at night.`;
const HEAD = (extra = "", title = "LINE COOK") => `MORGAN SAMPLE
Toledo, OH | morgan@example.com

PROFESSIONAL EXPERIENCE
${title} | Harbor Street Diner | 2019 - 2023
- Ran the grill on the breakfast line.
- Prepped vegetables before open and closed the kitchen at night.${extra}`;
const view = (resumeText: string, extra: Partial<Input> = {}) => buildFinishView({ resumeText, ownWords: BASE, defendAnswers: [], ...extra } as Input);
const letterOf = (body: string) => `Dear Hiring Manager,\n\n${body}\n\nSincerely,\nMorgan Sample`;

test("B5: the sentence splitter never breaks at an abbreviation or an initial", () => {
  assert.deepEqual(splitSentences("I earned my OSHA 30 card at the Main St. training hall, and it is still current. I ran the grill."), [
    "I earned my OSHA 30 card at the Main St. training hall, and it is still current.",
    "I ran the grill.",
  ]);
  for (const s of ["Acme Staffing Inc. is current.", "The U.S. DOT program ran it.", "Acme Co. paid in 2020.", "A current O.S.H.A. 10 card.", "Dr. Lee and J. Smith hired me.", "No. 4 dock was mine."]) {
    assert.equal(splitSentences(`I started. ${s}`).length, 2, s);
  }
});

for (const sent of [
  "I earned my OSHA 30 card at the Main St. training hall, and it is still current.",
  "I hold a CDL Class A from the U.S. DOT program and it is current and clean.",
  "My forklift card from Acme Staffing Inc. is current, so I can start on the dock right away.",
  "I earned my ServSafe Manager certification through Acme Co. in 2020 and it is current.",
  "I also hold a current O.S.H.A. 10 certification and am ready to start.",
]) {
  test(`B5: "${sent.slice(0, 50)}..." goes whole when the credential is confirmed`, () => {
    const letter = letterOf(`I ran the grill at Harbor Street Diner. ${sent}`);
    const v0 = view(HEAD(), { coverLetterText: letter, written: { resume: HEAD(), letter } });
    const g = v0.groups.find((x) => x.credentialName)!;
    assert.ok(g, JSON.stringify(v0.openItems));
    const res = applyConfirmation({ resume: HEAD(), letter }, g.credentialName!, "card", "expired 2020")!;
    assert.equal(res.letter.split("\n")[2], "I ran the grill at Harbor Street Diner.", res.letter);
  });
}

test("B5: what a drop leaves in a letter paragraph is read again; a status with no credential is held", () => {
  const letter = letterOf("I ran the grill at Harbor Street Diner. I hold my ServSafe Manager certification. Mine is current and I keep it on me.");
  const res = applyConfirmation({ resume: HEAD(), letter }, "ServSafe Manager", "card", "expired")!;
  const v = view(res.resume, { coverLetterText: res.letter, confirmedCredentials: [res.confirm], written: { resume: HEAD(), letter } });
  if (/current/.test(res.letter)) assert.ok(v.openItems.some((i) => i.kind === "credential_remnant" && i.target === "letter"), res.letter);
});

test("S1: 'No, take it off' inside a sentence leaves a leftover the gate holds until reworded or cut", () => {
  const line = "- Held a HAZMAT endorsement that let me haul fuel tankers across Ohio for Acme Freight";
  const r = HEAD(`\n${line}`);
  const cut = cutCredentialWithRemnant(r, line, false, "HAZMAT endorsement");
  assert.ok(cut.remnant, JSON.stringify(cut));
  const v = view(cut.text, { credentialCutRemnants: [cut.remnant!] });
  const g = v.groups.find((x) => x.line === cut.remnant)!;
  assert.ok(g && g.blocking && !g.answerable, JSON.stringify(v.openItems));
  assert.ok(!view(cutLine(cut.text, cut.remnant!), { credentialCutRemnants: [cut.remnant!] }).openItems.some((i) => i.kind === "credential_remnant"));
  const rw = applyRewrite(cut.text, [], cut.remnant!, "Hauled freight across Ohio for Acme");
  assert.ok(!view(rw.text, { credentialCutRemnants: [cut.remnant!], defendAnswers: rw.answers }).openItems.some((i) => i.kind === "credential_remnant"));
  // With nowhere to keep the leftover, the whole line goes.
  assert.ok(!cutCredential(r, line, false, "HAZMAT endorsement").includes("fuel tankers"));
});

test("S3: different credentials confirmed differently stand side by side; one credential told two ways is held", () => {
  for (const [a, b] of [["Welding certificate, 2011", "Welding Inspector certification, 2020"], ["Forklift card, 2019", "Forklift Instructor certification, 2021"], ["First Aid, 2022", "Wilderness First Aid, 2023"]]) {
    const r = HEAD(`\n\nCERTIFICATIONS\n- ${a}\n- ${b}`);
    const n1 = view(r).groups.filter((x) => x.credentialName).map((x) => x.credentialName!);
    const one = applyConfirmation({ resume: r, letter: "" }, n1[0], "card", "2019")!;
    const two = applyConfirmation({ resume: one.resume, letter: "" }, n1[1], "certification", "2021")!;
    const v = view(two.resume, { confirmedCredentials: [one.confirm, two.confirm], written: { resume: r, letter: "" } });
    assert.ok(!v.openItems.some((i) => i.kind === "credential_confirmed_conflict"), `${a} / ${b}`);
  }
  const r = HEAD("\n\nCERTIFICATIONS\n- OSHA 10\n- 10-hour OSHA card");
  const one = applyConfirmation({ resume: r, letter: "" }, "OSHA 10", "card", "expired")!;
  const two = applyConfirmation({ resume: one.resume, letter: "" }, "10-hour OSHA card", "certification", "current")!;
  assert.ok(view(two.resume, { confirmedCredentials: [one.confirm, two.confirm], written: { resume: r, letter: "" } }).openItems.some((i) => i.kind === "credential_confirmed_conflict"));
});

test("Titles: a confirmation leaves the job header alone; 'No' takes only the credential word off", () => {
  const r = HEAD("", "CERTIFIED NURSING ASSISTANT");
  const header = "CERTIFIED NURSING ASSISTANT | Harbor Street Diner | 2019 - 2023";
  const own = "Nursing Assistant | Harbor Street Diner | 2019 - 2023\nI helped residents with meals.";
  const v = view(r, { ownWords: own, written: { resume: r, letter: "" } });
  assert.ok(v.groups.some((g) => g.line === header && g.credentialName));
  const res = applyConfirmation({ resume: r, letter: "" }, "CERTIFIED NURSING ASSISTANT", "certification", "2019")!;
  assert.ok(res.resume.includes(header), "the header is not replaced");
  assert.match(res.resume, /CERTIFICATIONS\n- CERTIFIED NURSING ASSISTANT certification, 2019$/);
  const after = view(res.resume, { ownWords: own, confirmedCredentials: [res.confirm], written: { resume: r, letter: "" } });
  assert.ok(!after.openItems.some((i) => i.line === header), JSON.stringify(after.openItems));
  assert.ok(cutCredential(r, header, false, "CERTIFIED NURSING ASSISTANT").includes("NURSING ASSISTANT | Harbor Street Diner | 2019 - 2023"));
  assert.ok(!cutCredential(r, header, false, "CERTIFIED NURSING ASSISTANT").includes("CERTIFIED"));
});

test("N2: 'Registered Nurse' stays whole on the confirmed line", () => {
  const r = HEAD("\n\nCERTIFICATIONS\n- Registered Nurse, 2015");
  const res = applyConfirmation({ resume: r, letter: "" }, "Registered Nurse", "license", "2015")!;
  assert.match(res.resume, /- Registered Nurse license, 2015$/);
});
