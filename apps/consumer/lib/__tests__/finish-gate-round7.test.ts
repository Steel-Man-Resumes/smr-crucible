/**
 * Finish gate, review round 7 (consumer). Fictional fixtures.
 *
 * The structured licenses-and-training rows (the one typed exception), "No,
 * take it off" everywhere at once, hyphenated claims moved and cut, one
 * key per OSHA, CDL and CPR family for the conflict guard, the letter
 * splitter's new abbreviations, and an honest title rewrite.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as gate from "../finish-gate";
import {
  completeCredentialRows,
  credentialRowNeeds,
  credentialRowsAsText,
  readCredentialRows,
  emptyCredentialRow,
} from "../credential-rows";

const { buildFinishView, applyConfirmation, applyRewrite, cutCredentialEverywhere, splitSentences } = gate;
type Input = Parameters<typeof buildFinishView>[0];

const OWN = `Jordan Smith
Toledo, OH | jordan@example.com
Warehouse Associate | Midwest Distribution | 2019 - 2023
I picked orders with a scanner and wrapped pallets.`;
const HEAD = (extra = "", title = "WAREHOUSE ASSOCIATE") => `JORDAN SMITH
Toledo, OH | jordan@example.com

PROFESSIONAL EXPERIENCE
${title} | Midwest Distribution | 2019 - 2023
- Picked orders with a scanner and wrapped pallets.${extra}`;
const view = (resumeText: string, extra: Partial<Input> = {}) => buildFinishView({ resumeText, ownWords: OWN, defendAnswers: [], ...extra } as Input);
const letterOf = (body: string) => `Dear Hiring Manager,\n\n${body}\n\nSincerely,\nJordan Smith`;

test("Rows: complete only with a name, a kind and a year or status the strict parser takes", () => {
  const drafts = [
    { name: "Forklift", kind: "certification" as const, when: "2020" },
    { name: "CNA", kind: "license" as const, when: "a while back" },
    { name: "OSHA 10", kind: "" as const, when: "2019" },
    { name: "", kind: "card" as const, when: "2021" },
  ];
  assert.deepEqual(completeCredentialRows(drafts), [{ name: "Forklift", kind: "certification", when: "2020" }]);
  assert.deepEqual(drafts.map(credentialRowNeeds), ["", "when", "kind", ""]);
  assert.equal(credentialRowsAsText(drafts), "Forklift certification, 2020\nCNA, license, a while back\nOSHA 10, 2019");
  assert.deepEqual(readCredentialRows([{ name: "Forklift", kind: "bogus", when: 3 }, null, "x"]), [{ name: "Forklift", kind: "", when: "" }]);
  assert.deepEqual(emptyCredentialRow(), { name: "", kind: "", when: "" });
});

test("Rows: the page line that shows a complete row exactly is not asked; the free-text answer never is the exception", () => {
  const rows = completeCredentialRows([{ name: "Forklift", kind: "certification", when: "2020" }]);
  const text = credentialRowsAsText(rows);
  const r = HEAD(`\n\nCERTIFICATIONS\n- ${text}`);
  const own = `${OWN}\n\n${text}`;
  assert.equal(view(r, { ownWords: own, credentialsAnswer: text, credentialRows: rows }).state, "finished");
  assert.equal(view(r, { ownWords: own, credentialsAnswer: text }).state, "draft");
  // Their own uploaded resume line still counts as a whole line.
  assert.equal(view(r, { ownWords: own, ownResumeText: `${OWN}\n${text}` }).state, "finished");
});

test("S4: 'No, take it off' takes every mention off both pages, so it is never asked twice", () => {
  const r = HEAD("\n- Moved freight as a forklift-certified operator on second shift\n\nSKILLS\nPallet jack, Forklift Certified, Scanner\n\nCERTIFICATIONS\n- Forklift Certified, 2020");
  const letter = letterOf("I picked orders at Midwest Distribution. I am forklift certified and ready to start.");
  const out = cutCredentialEverywhere({ resume: r, letter }, "Forklift Certified");
  assert.doesNotMatch(out.resume, /forklift[- ]certified/i, out.resume);
  assert.doesNotMatch(out.letter, /forklift/i);
  assert.match(out.resume, /Pallet jack, Scanner/, "a list item goes alone, never its neighbours");
  assert.ok(out.remnants.some((x) => /Moved freight as operator on second shift/.test(x)), JSON.stringify(out.remnants));
  const v = view(out.resume, { coverLetterText: out.letter, credentialCutRemnants: out.remnants });
  assert.ok(!v.groups.some((g) => g.credentialName), JSON.stringify(v.groups.map((g) => g.credentialName)));
  assert.ok(v.openItems.some((i) => i.kind === "credential_remnant"));
});

test("B2: a hyphenated claim moves out of a sentence and out of the letter on confirmation", () => {
  const r = HEAD("\n- Moved freight as a forklift-certified operator on second shift");
  const letter = letterOf("I picked orders at Midwest Distribution. I am forklift-certified and ready to start on second shift.");
  const res = applyConfirmation({ resume: r, letter }, "forklift certified", "certification", "2020")!;
  assert.ok(res, "confirmed");
  assert.doesNotMatch(res.resume.replace(/CERTIFICATIONS[\s\S]*/, ""), /certified/i);
  assert.equal(res.letter.split("\n")[2], "I picked orders at Midwest Distribution.");
});

test("Conflict guard: one key per OSHA, CDL and CPR family", () => {
  for (const [a, b] of [["OSHA 10", "OSHA 10-Hour Construction Safety card"], ["CPR", "Red Cross CPR card"], ["CDL Class A", "Class A Commercial Driver's License"]]) {
    const r = HEAD(`\n\nCERTIFICATIONS\n- ${a}\n- ${b}`);
    const one = applyConfirmation({ resume: r, letter: "" }, a, "card", "expired")!;
    const name2 = view(one.resume, { confirmedCredentials: [one.confirm], written: { resume: r, letter: "" } }).groups.find((g) => g.credentialName)?.credentialName;
    assert.ok(name2, `${a} / ${b}`);
    const two = applyConfirmation({ resume: one.resume, letter: "" }, name2!, "certification", "current")!;
    const v = view(two.resume, { confirmedCredentials: [one.confirm, two.confirm], written: { resume: r, letter: "" } });
    assert.ok(v.openItems.some((i) => i.kind === "credential_confirmed_conflict"), `${a} / ${b}`);
  }
});

test("N1: the letter splitter knows months, Ln., Ste., Bros., Mfg., and never splits before a digit", () => {
  for (const s of [
    "I have held my forklift card since Jan. 2019 and it is still current.",
    "I earned my OSHA 10 card at the Oak Ln. Training Center, and it is current.",
    "My forklift card from Acme Bros. Moving is current, so I can start right away.",
    "I hold a CDL from the Ste. Genevieve driving school and it is clean and current.",
    "I got my forklift card at Acme Mfg. Co. in 2019.",
    "I passed in Sept. 4 weeks after the class.",
  ]) {
    assert.equal(splitSentences(`I loaded trucks. ${s}`).length, 2, s);
  }
});

test("S2: an honest title rewrite clears the title card", () => {
  const r = HEAD("", "MATERIAL HANDLER");
  const own = "I worked at Midwest Distribution from 2019 to 2023 and picked orders with a scanner and wrapped pallets.";
  assert.ok(view(r, { ownWords: own }).openItems.some((i) => i.kind === "title_unsaid"));
  const rw = applyRewrite(r, [], "MATERIAL HANDLER | Midwest Distribution | 2019 - 2023", "Warehouse Associate | Midwest Distribution | 2019 - 2023");
  assert.ok(!view(rw.text, { ownWords: own, defendAnswers: rw.answers, written: { resume: r, letter: "" } }).openItems.some((i) => i.kind === "title_unsaid"));
});
