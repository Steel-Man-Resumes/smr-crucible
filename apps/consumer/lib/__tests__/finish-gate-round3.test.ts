/**
 * Finish gate, review round 3 (consumer). Fictional fixtures.
 *
 * The rule: what the person settles on a card settles ONLY that card's own
 * item. A kept skill or a confirmed credential never joins the person's
 * words, so it never settles a title, a headline, a number or another
 * credential. A confirmed credential inside a long sentence moves to its own
 * line under CERTIFICATIONS, written as typed; the letter follows it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as gate from "../finish-gate";

const { buildFinishView, readStoredFinish, recordAnswer } = gate;
type Input = Parameters<typeof buildFinishView>[0];
type Confirm = NonNullable<Input["confirmedCredentials"]>[number];
const fn = <T>(name: string) => (gate as unknown as Record<string, T>)[name];
type Apply = (docs: { resume: string; letter: string }, name: string, type: string, when: string) => { resume: string; letter: string; confirm: Confirm } | null;

const SOURCE = `Morgan Sample
Toledo, OH | morgan@example.com
Line cook at Harbor Street Diner from 2019 to 2023.
I ran the grill on the breakfast line, prepped vegetables before open, and closed the kitchen at night.
The owner asked me to show new cooks the grill.`;
const HEAD = (title = "LINE COOK") => `MORGAN SAMPLE
Toledo, OH | morgan@example.com

PROFESSIONAL EXPERIENCE
${title} | Harbor Street Diner | 2019 - 2023
- Ran the grill on the breakfast line.
- Prepped vegetables before open and closed the kitchen at night.`;
const view = (resumeText: string, extra: Partial<Input> = {}) =>
  buildFinishView({ resumeText, ownWords: SOURCE, defendAnswers: [], written: { resume: resumeText, letter: extra.coverLetterText ?? "" }, ...extra } as Input);
const keys = (v: ReturnType<typeof buildFinishView>) => new Set(v.openItems.map((i) => `${i.target}|${i.rule}|${i.kind ?? ""}|${i.line}`));
const diff = (a: Set<string>, b: Set<string>) => Array.from(a).filter((k) => !b.has(k));

// ---- the rule, per card type ----------------------------------------------------------

test("rule: keeping a skill clears exactly that skill's item, never a title", () => {
  const r = `${HEAD("SOUS CHEF")}\n\nSKILLS\nGrill, Breakfast line, Sous chef support, Food safety`;
  const before = keys(view(r));
  const after = keys(view(r, { keptTerms: ["Sous chef support"] }));
  assert.deepEqual(diff(before, after), ["skillset|STD-T01|grid_term|Sous chef support"]);
  assert.deepEqual(diff(after, before), []);
  assert.ok(Array.from(after).some((k) => k.startsWith("resume|STD-C03")), "the title is still asked");
  assert.doesNotMatch(view(r, { keptTerms: ["Sous chef support"] }).source, /Sous chef/);
});

test("rule: keeping a skill never settles a credential elsewhere on the page", () => {
  const r = `${HEAD()}\n\nSKILLS\nGrill, Breakfast line, Forklift\n\nCERTIFICATIONS\n- Forklift Certified, current`;
  const before = keys(view(r));
  const after = keys(view(r, { keptTerms: ["Forklift"] }));
  assert.deepEqual(diff(before, after), ["skillset|STD-T01|grid_term|Forklift"]);
  assert.ok(Array.from(after).some((k) => k.includes("credential_unsaid")), "the memory prompt stays");
});

test("rule: confirming a credential clears exactly that credential, never a number or a title", () => {
  const apply = fn<Apply>("applyConfirmation");
  assert.equal(typeof apply, "function");
  const r = `${HEAD("SHIFT SUPERVISOR")}\n- Served 30 tables a night on the breakfast line.\n\nCERTIFICATIONS\n- OSHA 30`;
  const before = view(r);
  const res = apply({ resume: r, letter: "" }, "OSHA 30", "card", "2020")!;
  const after = view(res.resume, { confirmedCredentials: [res.confirm], written: { resume: r, letter: "" } });
  const gone = diff(keys(before), keys(after));
  assert.ok(gone.every((k) => k.endsWith("|- OSHA 30")), JSON.stringify(gone));
  assert.ok(gone.length >= 1);
  assert.ok(after.openItems.some((i) => i.rule === "STD-T02" && /Served 30/.test(i.line)), "the 30 tables stay unsourced");
  assert.ok(after.openItems.some((i) => i.rule === "STD-C03"), "the title stays asked");
  assert.doesNotMatch(after.source, /OSHA/);
});

// ---- detection --------------------------------------------------------------------------

for (const t of ["HAZMAT", "TWIC", "Food handler card", "Six Sigma Green Belt", "Hazmat endorsement"]) {
  test(`B1: "${t}" in a skills list is a credential prompt, never on the skills card`, () => {
    const v = view(`${HEAD()}\n\nSKILLS\nGrill, Breakfast line, ${t}`);
    assert.ok(!v.groups.some((g) => g.target === "skillset" && g.terms?.includes(t)));
    assert.ok(v.groups.some((g) => g.credentialName && g.line === t), JSON.stringify(v.groups.map((g) => [g.target, g.line])));
    assert.ok(!v.openItems.some((i) => i.rule === "STD-T02"), "no number read in it");
  });
}

// ---- B3: move out of a long sentence ------------------------------------------------------

test("B3: a confirmed credential in a long sentence moves to its own line under CERTIFICATIONS; the rest is checked", () => {
  const apply = fn<Apply>("applyConfirmation");
  const line = "Certified Forklift Operator (OSHA) who supervised a crew of night loaders and trained every new hire on dock safety";
  const r = `${HEAD()}\n- ${line}`;
  const res = apply({ resume: r, letter: "" }, "Certified Forklift Operator", "card", "2021")!;
  assert.match(res.resume, /\nCERTIFICATIONS\n- Forklift Operator card, 2021$/);
  // Round 4: no orphan "who" at the start; the leftover is held until reworded or cut.
  assert.match(res.resume, /^- Supervised a crew of night loaders and trained every new hire on dock safety$/m);
  assert.doesNotMatch(res.resume, /\(OSHA\)/);
  const v = view(res.resume, { confirmedCredentials: [res.confirm], written: { resume: r, letter: "" } });
  const generic = recordAnswer([], "- Supervised a crew of night loaders and trained every new hire on dock safety", "I did that at the diner most shifts, the owner can say so.", "stands");
  assert.equal(view(res.resume, { confirmedCredentials: [res.confirm], defendAnswers: generic, written: { resume: r, letter: "" } }).state, "draft");
  assert.ok(v.openItems.some((i) => /Supervised a crew/.test(i.line) && i.kind === "credential_remnant"));
});

test("B3: a writer's status word left in the sentence goes with the move, or is flagged", () => {
  const apply = fn<Apply>("applyConfirmation");
  const r = `${HEAD()}\n- Kept my ServSafe Food Handler valid and active through every inspection at the diner`;
  const res = apply({ resume: r, letter: "" }, "ServSafe Food Handler", "card", "expired")!;
  const v = view(res.resume, { confirmedCredentials: [res.confirm], written: { resume: r, letter: "" } });
  // Round 4: every line the move changed is held until the person rewords it or cuts it.
  assert.ok(v.openItems.some((i) => i.kind === "credential_remnant" && !v.groups.find((g) => g.line === i.line)?.answerable), JSON.stringify(v.openItems));
  assert.equal(v.state, "draft");
});

// ---- B4: the letter ---------------------------------------------------------------------

test("B4: a confirmation applies to the letter; a letter left with the writer's version is flagged", () => {
  const apply = fn<Apply>("applyConfirmation");
  const r = `${HEAD()}\n\nCERTIFICATIONS\n- Forklift Certified`;
  const letter = "Dear Hiring Manager,\n\nI ran the grill on the breakfast line at Harbor Street Diner. I am also Forklift Certified, current and in good standing.\n\nSincerely,\nMorgan Sample";
  const res = apply({ resume: r, letter }, "Forklift Certified", "training course", "expired")!;
  assert.match(res.resume, /- Forklift training course, expired/);
  assert.doesNotMatch(res.letter, /Forklift Certified/);
  // Left as the writer wrote it, the letter is held.
  const stale = view(res.resume, { coverLetterText: letter, confirmedCredentials: [res.confirm], written: { resume: r, letter } });
  assert.ok(stale.openItems.some((i) => i.target === "letter" && i.kind === "credential_confirmed_mismatch"), JSON.stringify(stale.openItems));
  assert.equal(stale.state, "draft");
});

// ---- should-fix -----------------------------------------------------------------------------

test("S1: forged or stale keeps and confirmations are dropped on read", () => {
  const r = `${HEAD("KITCHEN MANAGER")}\n\nSKILLS\nGrill, Breakfast line\n\nCERTIFICATIONS\n- ServSafe Manager, current`;
  const stored = readStoredFinish(
    {
      v: 1,
      key: "k",
      docs: { resumeText: r, coverLetterText: "", withheldLines: [], keepInsideLines: false, grounding: null, written: { resume: r, letter: "" } },
      defendAnswers: [],
      keptTerms: ["Kitchen Manager, supervised a crew of twelve", "Head cook"],
      confirmedCredentials: [
        { name: "x", type: "license", when: "current", text: "ServSafe Manager license, current. Kitchen Manager." },
        { name: "ServSafe Manager", type: "license", when: "current", text: "anything at all" },
      ],
    },
    "k"
  )!;
  assert.deepEqual(stored.keptTerms, []);
  assert.equal(stored.confirmedCredentials!.length, 1);
  assert.equal(stored.confirmedCredentials![0].text, "ServSafe Manager license, current", "rebuilt, never taken as stored");
});

test("S3: confirming that would not change the page says so (no stored confirmation)", () => {
  const apply = fn<Apply>("applyConfirmation");
  assert.equal(apply({ resume: HEAD(), letter: "" }, "OSHA 10", "card", "2018"), null);
  const r = `${HEAD()}\n- Earned the OSHA  10 card and used it on every warehouse shift at the Front Street dock`;
  const res = apply({ resume: r, letter: "" }, "OSHA 10", "card", "2018");
  assert.ok(res && res.resume !== r, "a double space still matches");
});

test("S4: the year or status box takes only a real answer", () => {
  const ok = fn<(w: string) => boolean>("isCredentialWhen");
  for (const w of ["2021", "current", "expired in 2019", "in progress", "completed 2018", "Current"]) assert.equal(ok(w), true, w);
  for (const w of ["through", "until", "good for", "passed", "not sure, finished?", "never got it, completed nothing", "current, crew of 6", "I think so"]) assert.equal(ok(w), false, w);
});
