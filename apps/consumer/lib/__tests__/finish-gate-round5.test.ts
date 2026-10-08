/**
 * Finish gate, review round 5 (consumer). Fictional fixtures.
 *
 * The confirmed line is written only from the confirmation: the writer's
 * type words, status words and years never survive. The letter drops the
 * credential sentence and a following sentence that only carries its status.
 * Two confirmations that may be one credential cannot tell two stories. The
 * licenses-and-training answer is the one exact-match exception.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as gate from "../finish-gate";

const { buildFinishView, applyConfirmation, recordAnswer, cutLine } = gate;
type Input = Parameters<typeof buildFinishView>[0];

const BASE = `Morgan Sample
Toledo, OH | morgan@example.com
Line cook at Harbor Street Diner from 2019 to 2023.
I ran the grill on the breakfast line, prepped vegetables before open, and closed the kitchen at night.
The owner asked me to show new cooks the grill.`;
const HEAD = (extra = "") => `MORGAN SAMPLE
Toledo, OH | morgan@example.com

PROFESSIONAL EXPERIENCE
LINE COOK | Harbor Street Diner | 2019 - 2023
- Ran the grill on the breakfast line.
- Prepped vegetables before open and closed the kitchen at night.${extra}`;
const view = (resumeText: string, extra: Partial<Input> = {}) =>
  buildFinishView({ resumeText, ownWords: BASE, defendAnswers: [], ...extra } as Input);
const GOOD = "I did that at the diner most shifts, the owner can say so.";
const letterOf = (body: string) => `Dear Hiring Manager,\n\n${body}\n\nSincerely,\nMorgan Sample`;

for (const [line, type, when, want] of [
  ["HAZMAT Endorsement, 2021", "training course", "2021", "HAZMAT training course, 2021"],
  ["Licensed Electrician, 2020", "certification", "2020", "Electrician certification, 2020"],
  ["Welding Certification, current", "card", "expired", "Welding card, expired"],
  ["Forklift Certified, current through 2027", "card", "2019-2021", "Forklift card, 2019-2021"],
  ["CDL Class A, valid", "license", "renewed 2024, expires 2027", "CDL Class A license, renewed 2024, expires 2027"],
] as const) {
  test(`Confirmed line comes only from the confirmation: "${line}" -> "${want}"`, () => {
    const r = HEAD(`\n\nCERTIFICATIONS\n- ${line}`);
    const v = view(r, { written: { resume: r, letter: "" } });
    const g = v.groups.find((x) => x.credentialName)!;
    assert.ok(g, JSON.stringify(v.groups));
    const res = applyConfirmation({ resume: r, letter: "" }, g.credentialName!, type, when)!;
    assert.ok(res, `${type} / ${when}`);
    assert.match(res.resume, new RegExp(`CERTIFICATIONS\\n- ${want.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`));
    assert.equal(view(res.resume, { confirmedCredentials: [res.confirm], written: { resume: r, letter: "" } }).state, "finished");
  });
}

test("S4: the letter drops the credential sentence and a following sentence that only carries its status", () => {
  for (const tail of ["It is current and in good standing.", "It is current through 2027.", "This is valid until 2027."]) {
    const letter = letterOf(`I ran the grill at Harbor Street Diner. I hold my ServSafe Manager certification. ${tail} I closed the kitchen at night.`);
    const res = applyConfirmation({ resume: HEAD(), letter }, "ServSafe Manager", "card", "expired")!;
    assert.equal(res.letter.split("\n")[2], "I ran the grill at Harbor Street Diner. I closed the kitchen at night.", tail);
  }
});

test("S4: a letter sentence wrapped across lines goes whole, never leaving half of it", () => {
  const letter = "Dear Hiring Manager,\n\nI ran the grill at Harbor Street Diner and I also hold\na current ServSafe Manager certification, so I am ready to start.\n\nI closed the kitchen at night.\n\nSincerely,\nMorgan Sample";
  const res = applyConfirmation({ resume: HEAD(), letter }, "ServSafe Manager", "card", "expired")!;
  assert.doesNotMatch(res.letter, /also hold|ServSafe/);
  assert.match(res.letter, /I closed the kitchen at night\./);
});

test("S5: two confirmations that may be one credential, told two ways, are held until one is cut", () => {
  for (const [a, b] of [
    ["OSHA 10", "10-hour OSHA card"],
    ["ServSafe Manager", "ServSafe Food Protection Manager certification"],
    ["CDL Class A", "Class A Commercial Driver's License"],
    ["CNA", "Certified Nursing Assistant"],
    ["Food Handler card", "Food Handler's card"],
  ] as const) {
    const r = HEAD(`\n\nCERTIFICATIONS\n- ${a}`);
    const letter = letterOf(`I ran the grill at Harbor Street Diner. I hold a current ${b} and am ready to start.`);
    const written = { resume: r, letter };
    const first = applyConfirmation({ resume: r, letter }, a, "card", "expired")!;
    const g = view(first.resume, { coverLetterText: first.letter, confirmedCredentials: [first.confirm], written }).groups.find((x) => x.credentialName);
    if (!g) continue; // the letter followed the first confirmation: nothing more to ask
    const second = applyConfirmation({ resume: first.resume, letter: first.letter }, g.credentialName!, "certification", "current")!;
    const v = view(second.resume, { coverLetterText: second.letter, confirmedCredentials: [first.confirm, second.confirm], written });
    assert.equal(v.state, "draft", `${a} / ${b}`);
    assert.ok(v.openItems.some((i) => i.kind === "credential_confirmed_conflict"), `${a} / ${b}`);
  }
});

test("S5 (control): two different credentials confirmed differently are not a conflict", () => {
  const r = HEAD("\n\nCERTIFICATIONS\n- OSHA 10\n- OSHA 30");
  const one = applyConfirmation({ resume: r, letter: "" }, "OSHA 10", "card", "2019")!;
  const two = applyConfirmation({ resume: one.resume, letter: "" }, "OSHA 30", "card", "expired")!;
  const v = view(two.resume, { confirmedCredentials: [one.confirm, two.confirm], written: { resume: r, letter: "" } });
  assert.ok(!v.openItems.some((i) => i.kind === "credential_confirmed_conflict"), JSON.stringify(v.openItems));
});

test("Typed exactly: the licenses-and-training answer is the one exception, on the resume and in the letter", () => {
  const r = HEAD("\n\nCERTIFICATIONS\n- Forklift card, expired 2020");
  // The answer is part of the person's own words too (ownWordsFor), so its year is theirs.
  const typed = (t: string) => ({ ownWords: `${BASE}\n\n${t}`, credentialsAnswer: t });
  assert.equal(view(r, typed("forklift card, expired 2020")).state, "finished");
  assert.equal(view(r, typed("forklift card")).state, "draft");
  // Round 6: a whole line of the person's own words (their uploaded resume) counts the same way.
  assert.equal(view(r, { ownWords: `${BASE}\n\nforklift card, expired 2020` }).state, "finished");
  assert.equal(view(r, { ownWords: `${BASE}\n\nforklift card\nexpired 2020` }).state, "finished");
  assert.equal(view(r, { ownWords: `${BASE}\n\nforklift card; never renewed it` }).state, "draft");
  // The letter never borrows the resume's typed line: its own mention is asked.
  const letter = letterOf("I ran the grill at Harbor Street Diner. My forklift card is current.");
  const v = view(r, { coverLetterText: letter, ...typed("forklift card, expired 2020") });
  assert.ok(v.openItems.some((i) => i.target === "letter" && i.kind === "credential_unsaid"), JSON.stringify(v.openItems));
});

test("Scope in the letter and on the resume: an answer never settles it; a cut does", () => {
  const r = HEAD("\n- Supervised the night crew on the breakfast line.");
  const line = "- Supervised the night crew on the breakfast line.";
  for (const ans of [GOOD, "I supervised the two dishwashers on Sundays when the owner was out."]) {
    const v = view(r, { defendAnswers: recordAnswer([], line, ans, "stands") });
    const g = v.groups.find((x) => x.line === line)!;
    assert.ok(g && g.blocking && !g.answerable, ans);
  }
  assert.ok(!view(cutLine(r, line)).groups.some((x) => x.line === line));
});

test("A line that already reads exactly as confirmed still takes the confirmation", () => {
  const r = HEAD("\n\nCERTIFICATIONS\n- Food Handler card, 2020");
  const res = applyConfirmation({ resume: r, letter: "" }, "Food Handler card", "card", "2020");
  assert.ok(res, "the confirmation is not refused as 'nothing changed'");
  assert.equal(res!.resume, r);
  assert.equal(view(res!.resume, { confirmedCredentials: [res!.confirm], written: { resume: r, letter: "" } }).state, "finished");
});
