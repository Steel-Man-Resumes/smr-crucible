/**
 * Troy's resume rules decisions (2026-10-07) on the finish page: D3 (one
 * keep-or-cut skills card), D4 (a suggested credential is a memory prompt),
 * D6 (interviewer voice for numbers, credentials and titles). Fictional
 * fixtures.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildFinishView,
  confirmCredential,
  confirmedWords,
  cutCredential,
  cutTerm,
  readStoredFinish,
  recordAnswer,
  SKILLS_CARD_TEXT,
  type DefendAnswer,
} from "../finish-gate";
import {
  credentialMemoryPrompt,
  credentialQuestion,
  questionForFinding,
  Q_NUMBER_DROPPED,
  Q_NUMBER_OWN,
  Q_NUMBER_UNSOURCED,
  Q_TITLE,
} from "@crucible/core/src/resumeStatus";

const SOURCE = `Morgan Sample
Toledo, OH | morgan@example.com
Line cook at Harbor Street Diner from 2019 to 2023.
I ran the grill on the breakfast line, prepped vegetables before open, and closed the kitchen at night.
The owner asked me to show new cooks the grill.`;
const HEAD = `MORGAN SAMPLE
Toledo, OH | morgan@example.com

PROFESSIONAL EXPERIENCE
LINE COOK | Harbor Street Diner | 2019 - 2023
- Ran the grill on the breakfast line.
- Prepped vegetables before open and closed the kitchen at night.`;
type Input = Parameters<typeof buildFinishView>[0];
const view = (resumeText: string, extra: Partial<Input> = {}) =>
  buildFinishView({ resumeText, ownWords: SOURCE, defendAnswers: [], ...extra } as Input);

// ---- D3 --------------------------------------------------------------------------

const SKILLS = `${HEAD}\n\nSKILLS\nGrill, Breakfast line, Food safety, Inventory control, Customer service, Kitchen supervision`;

test("D3: every skill the person never said is on ONE keep-or-cut card", () => {
  const v = view(SKILLS);
  const cards = v.groups.filter((g) => g.target === "skillset");
  assert.equal(cards.length, 1);
  assert.deepEqual(cards[0].terms, ["Food safety", "Inventory control", "Customer service"]);
  assert.equal(cards[0].answerable, false);
  assert.equal(SKILLS_CARD_TEXT, "These skills were added for you. Keep the ones that are true.");
  assert.equal(v.groups.filter((g) => g.target === "skillset" || g.target === "skill").length, 2, "one card for the list, one for the scope term");
});

test("D3: a kept term counts as the person's words; a cut term leaves the page", () => {
  const kept = view(SKILLS, { keptTerms: ["Food safety", "Inventory control"] });
  const card = kept.groups.find((g) => g.target === "skillset");
  assert.deepEqual(card?.terms, ["Customer service"]);
  // Round 3: a kept term settles only its own item; it never joins the person's words.
  assert.doesNotMatch(kept.source, /Food safety/);
  const cut = cutTerm(SKILLS, "Customer service");
  assert.doesNotMatch(cut, /Customer service/);
  const done = view(cut, { keptTerms: ["Food safety", "Inventory control"] });
  assert.ok(!done.groups.some((g) => g.target === "skillset"));
});

test("D3: keeping a term never sources a number in it", () => {
  assert.equal(confirmedWords(["Forty-two point inspections", "Pallet jack 3000"]).match(/\d|forty/gi), null);
});

test("D3: a skill with a scope word stays its own card, settled by saying what they did", () => {
  const v = view(SKILLS);
  const scope = v.groups.find((g) => g.target === "skill" && g.line === "Kitchen supervision");
  assert.ok(scope && scope.answerable && scope.blocking);
  assert.match(scope!.items[0].question, /Say what you did/);
  const generic = recordAnswer([], "Kitchen supervision", "I did that at the diner most shifts, the owner can say so.", "stands");
  assert.ok(view(SKILLS, { defendAnswers: generic }).groups.some((g) => g.line === "Kitchen supervision"));
  const real = recordAnswer([], "Kitchen supervision", "I handled kitchen supervision on Sunday nights when the owner was out.", "stands");
  assert.ok(!view(SKILLS, { defendAnswers: real }).groups.some((g) => g.line === "Kitchen supervision"));
});

// ---- D4 --------------------------------------------------------------------------

const CRED = `${HEAD}\n\nCERTIFICATIONS\n- ServSafe Food Handler`;
const GOOD = "I did that at the diner most shifts, the owner can say so.";
const answerAll = (r: string, extra: Partial<Input> = {}): DefendAnswer[] => {
  let a: DefendAnswer[] = [];
  for (let k = 0; k < 3; k++) for (const g of view(r, { defendAnswers: a, ...extra }).groups) if (g.answerable) a = recordAnswer(a, g.line, `It is a certification, current, and I use it at the diner on weekday shifts.`, "stands");
  return a;
};

test("D4: a credential the person never mentioned is a memory prompt, never settled by an answer", () => {
  const v = view(CRED, { defendAnswers: [...answerAll(CRED), { line: "- ServSafe Food Handler", answer: GOOD, verdict: "stands" }] });
  const card = v.groups.find((g) => g.credentialName);
  assert.ok(card, JSON.stringify(v.groups));
  assert.equal(card!.credentialName, "ServSafe Food Handler");
  assert.equal(card!.answerable, false);
  assert.equal(card!.items.find((i) => i.kind === "credential_unsaid")!.question, "Do you hold ServSafe Food Handler? Many people forget a card or class they earned.");
  assert.equal(v.state, "draft");
});

test("D4: 'Yes, I hold it' keeps it only with a kind and a year or status, and the line becomes what they typed", () => {
  assert.equal(confirmCredential(CRED, "- ServSafe Food Handler", false, "ServSafe Food Handler", "card", ""), null);
  assert.equal(confirmCredential(CRED, "- ServSafe Food Handler", false, "ServSafe Food Handler", "card", "I think so"), null);
  const r = confirmCredential(CRED, "- ServSafe Food Handler", false, "ServSafe Food Handler", "card", "2021")!;
  assert.match(r.text, /^- ServSafe Food Handler card, 2021$/m);
  const v = view(r.text, { confirmedCredentials: [r.confirm] });
  assert.ok(!v.openItems.some((i) => i.kind === "credential_unsaid"), JSON.stringify(v.openItems));
  const done = view(r.text, { confirmedCredentials: [r.confirm], defendAnswers: answerAll(r.text, { confirmedCredentials: [r.confirm] }) });
  assert.equal(done.state, "finished", JSON.stringify(done.openItems));
});

test("D4: the writer's name alone never counts; a stored confirmation without a year or status is dropped", () => {
  const stored = readStoredFinish(
    {
      v: 1,
      key: "k",
      docs: { resumeText: CRED, coverLetterText: "", withheldLines: [], keepInsideLines: false, grounding: null },
      defendAnswers: [],
      confirmedCredentials: [
        { name: "ServSafe Food Handler", type: "card", when: "yes", text: "ServSafe Food Handler card, yes" },
        { name: "ServSafe Food Handler", type: "badge", when: "2021", text: "ServSafe Food Handler badge, 2021" },
      ],
    },
    "k"
  )!;
  assert.deepEqual(stored.confirmedCredentials, []);
  assert.equal(confirmedWords([], [{ name: "ServSafe", type: "card", when: "yes", text: "ServSafe card" }]), "");
});

test("D4: 'No, take it off' removes it; a skills-term credential moves to CERTIFICATIONS when confirmed", () => {
  assert.doesNotMatch(cutCredential(CRED, "- ServSafe Food Handler", false, "ServSafe Food Handler"), /ServSafe/);
  const skills = `${HEAD}\n\nSKILLS\nGrill, Forklift Certified, Breakfast line`;
  const v = view(skills);
  const card = v.groups.find((g) => g.credentialName);
  assert.ok(card && card.target === "skill" && card.line === "Forklift Certified", JSON.stringify(v.groups.map((g) => [g.target, g.line])));
  // Round 3: a credential leaves the skills list and is listed under CERTIFICATIONS as typed.
  const r = confirmCredential(skills, "Forklift Certified", true, "Forklift Certified", "certification", "current")!;
  assert.match(r.text, /^Grill, Breakfast line$/m);
  assert.match(r.text, /CERTIFICATIONS\n- Forklift certification, current$/);
  assert.doesNotMatch(cutCredential(skills, "Forklift Certified", true, "Forklift Certified"), /Forklift/);
});

// ---- D6 --------------------------------------------------------------------------

test("D6: numbers, credentials and titles are asked the way an interviewer would ask", () => {
  for (const q of [Q_NUMBER_UNSOURCED, Q_NUMBER_DROPPED, Q_NUMBER_OWN, Q_TITLE, credentialQuestion("OSHA card")]) assert.match(q, /interviewer/i, q);
  assert.equal(questionForFinding({ rule: "STD-C03", line: "X | Y | 2019", why: "" }), Q_TITLE);
  assert.equal(questionForFinding({ rule: "STD-T02", line: "x", why: "", kind: "added_number" }), Q_NUMBER_UNSOURCED);
  assert.match(credentialMemoryPrompt("CPR"), /^Do you hold CPR\? Many people forget a card or class they earned\.$/);
});

test("D6: everything else stays plain and short, and no question has a long dash or a digit", () => {
  const plain = ["STD-T05", "STD-T07", "STD-C05", "STD-F05", "STD-F06", "STD-F01", "STD-A02"].map((rule) => questionForFinding({ rule, line: "Line", why: `"word" here` }));
  for (const q of plain) {
    assert.doesNotMatch(q, /interviewer/i, q);
    assert.ok(q.split(/\s+/).length <= 30, q);
  }
  for (const q of [...plain, Q_NUMBER_UNSOURCED, Q_NUMBER_DROPPED, Q_NUMBER_OWN, Q_TITLE, credentialQuestion("Card"), credentialMemoryPrompt("Card"), SKILLS_CARD_TEXT]) {
    assert.doesNotMatch(q, /[–—]|--/, q);
    assert.doesNotMatch(q, /\d/, q);
  }
});
