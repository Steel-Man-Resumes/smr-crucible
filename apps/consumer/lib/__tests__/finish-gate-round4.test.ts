/**
 * Finish gate, review round 4 (consumer). Fictional fixtures.
 *
 * S2: no fragment ships. The letter drops the whole sentence a credential
 * was in (with a note); a resume line the move changed is held until the
 * person rewords it or cuts it. S5: one credential, one key, across both
 * documents. Notes: a headline is never replaced whole; a non-blocking item
 * never points at a line that is not on the page.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as gate from "../finish-gate";

const { buildFinishView, applyConfirmation, applyRewrite, cutLine, recordAnswer } = gate;
type Input = Parameters<typeof buildFinishView>[0];

const BASE = `Morgan Sample
Toledo, OH | morgan@example.com
Line cook at Harbor Street Diner from 2019 to 2023.
I ran the grill on the breakfast line, prepped vegetables before open, and closed the kitchen at night.
The owner asked me to show new cooks the grill.
On weekends I loaded trucks at the dock at the Front Street warehouse.`;
const HEAD = (extra = "") => `MORGAN SAMPLE
Toledo, OH | morgan@example.com

PROFESSIONAL EXPERIENCE
LINE COOK | Harbor Street Diner | 2019 - 2023
- Ran the grill on the breakfast line.
- Prepped vegetables before open and closed the kitchen at night.${extra}`;
const view = (resumeText: string, extra: Partial<Input> = {}) =>
  buildFinishView({ resumeText, ownWords: BASE, defendAnswers: [], ...extra } as Input);

test("S2: the letter drops the whole sentence the credential was in, and says so", () => {
  for (const sent of [
    "I also hold my ServSafe Manager certification, so I am ready to start.",
    "As a ServSafe Manager certified cook, I ran the grill on the breakfast line.",
    "I ran the grill on the breakfast line and hold a ServSafe Manager card.",
  ]) {
    const letter = `Dear Hiring Manager,\n\nI ran the grill on the breakfast line at Harbor Street Diner and closed the kitchen at night. ${sent}\n\nSincerely,\nMorgan Sample`;
    const res = applyConfirmation({ resume: HEAD(), letter }, "ServSafe Manager", "card", "2020")!;
    assert.equal(res.letter.split("\n")[2], "I ran the grill on the breakfast line at Harbor Street Diner and closed the kitchen at night.", sent);
    const v = view(res.resume, { coverLetterText: res.letter, confirmedCredentials: [res.confirm], written: { resume: HEAD(), letter } });
    const note = v.openItems.find((i) => i.kind === "credential_letter_note");
    assert.ok(note && note.severity === "FIX" && note.question === "We took out a sentence about ServSafe Manager. Add one in your own words if you want.");
  }
});

test("S2: a resume line the move changed is held until the person rewords it or cuts it (round 5: when it is not their words)", () => {
  const line = "Earned my OSHA 10 card and safely moved freight trucks at the Front Street dock on weekends";
  const r = HEAD(`\n- ${line}`);
  const res = applyConfirmation({ resume: r, letter: "" }, "OSHA 10", "card", "2019")!;
  const remnant = "- Safely moved freight trucks at the Front Street dock on weekends";
  assert.ok(res.resume.includes(remnant), res.resume);
  const written = { resume: r, letter: "" };
  const v = view(res.resume, { confirmedCredentials: [res.confirm], written });
  const g = v.groups.find((x) => x.line === remnant)!;
  assert.ok(g && g.blocking && !g.answerable, "only a rewrite or a cut");
  // An answer never settles it.
  const answered = view(res.resume, { confirmedCredentials: [res.confirm], written, defendAnswers: recordAnswer([], remnant, "I loaded trucks at the Front Street dock every weekend for the owner.", "stands") });
  assert.ok(answered.openItems.some((i) => i.kind === "credential_remnant"));
  // The person's own rewrite settles it.
  const rw = applyRewrite(res.resume, [], remnant, "Loaded the weekend trucks at the Front Street dock");
  assert.ok(!view(rw.text, { confirmedCredentials: [res.confirm], written, defendAnswers: rw.answers }).openItems.some((i) => i.kind === "credential_remnant"));
  // So does a cut.
  assert.ok(!view(cutLine(res.resume, remnant), { confirmedCredentials: [res.confirm], written }).openItems.some((i) => i.kind === "credential_remnant"));
});

test("S6 (round 5): a clean leftover that is already the person's own words is not held", () => {
  const line = "OSHA 10 certified and loaded trucks at the dock at the Front Street warehouse";
  const r = HEAD(`\n- ${line}`);
  const res = applyConfirmation({ resume: r, letter: "" }, "OSHA 10", "card", "2019")!;
  assert.match(res.resume, /^- Loaded trucks at the dock at the Front Street warehouse$/m, res.resume);
  const v = view(res.resume, { confirmedCredentials: [res.confirm], written: { resume: r, letter: "" } });
  assert.ok(!v.openItems.some((i) => i.kind === "credential_remnant"), JSON.stringify(v.openItems));
  // A fragment is always held, even in their words.
  assert.equal(gate.readsAsFragment("and loaded trucks at the dock"), true);
  assert.equal(gate.readsAsFragment("Who loaded trucks at the dock"), true);
  assert.equal(gate.readsAsFragment("The Front Street warehouse dock"), true);
  assert.equal(gate.readsAsFragment("Loaded trucks at the dock"), false);
});

test("S2: what remains never starts or ends on a joining word, and has no double period", () => {
  const r = HEAD("\n- OSHA 10 card holder who loaded trucks at the dock at the Front Street warehouse on weekends");
  const res = applyConfirmation({ resume: r, letter: "" }, "OSHA 10", "card", "2019")!;
  assert.match(res.resume, /^- Loaded trucks at the dock at the Front Street warehouse on weekends$/m);
  assert.doesNotMatch(res.resume, /\.\./);
});

test("S5: 'Forklift Certified' on the resume and 'Certified Forklift Operator' in the letter are one credential, one prompt", () => {
  const r = HEAD("\n\nCERTIFICATIONS\n- Forklift Certified");
  const letter = "Dear Hiring Manager,\n\nI ran the grill at Harbor Street Diner. I am a Certified Forklift Operator and can run any lift.\n\nSincerely,\nMorgan Sample";
  const v = view(r, { coverLetterText: letter, written: { resume: r, letter } });
  assert.equal(v.groups.filter((g) => g.credentialName).length, 1, JSON.stringify(v.groups.map((g) => [g.target, g.credentialName])));
  const res = applyConfirmation({ resume: r, letter }, "Forklift Certified", "training course", "expired")!;
  assert.doesNotMatch(res.letter, /Forklift/);
  // The line is written only from the confirmation: no writer's type or status word survives.
  assert.match(res.resume, /CERTIFICATIONS\n- Forklift training course, expired$/);
  const after = view(res.resume, { coverLetterText: res.letter, confirmedCredentials: [res.confirm], written: { resume: r, letter } });
  assert.ok(!after.groups.some((g) => g.credentialName), "no second prompt for the same credential");
});

test("NOTE: a headline that carries a credential keeps the rest; it is never replaced whole", () => {
  const r = `MORGAN SAMPLE\nToledo, OH | morgan@example.com\nForklift Certified Line Cook | Breakfast Grill\n\nPROFESSIONAL EXPERIENCE\nLINE COOK | Harbor Street Diner | 2019 - 2023\n- Ran the grill on the breakfast line.`;
  const v = view(r, { written: { resume: r, letter: "" } });
  const g = v.groups.find((x) => x.credentialName);
  assert.equal(g?.credentialName, "Forklift Certified");
  const res = applyConfirmation({ resume: r, letter: "" }, "Forklift Certified", "card", "2021")!;
  assert.match(res.resume, /^Line Cook \| Breakfast Grill$/m);
  assert.match(res.resume, /CERTIFICATIONS\n- Forklift card, 2021$/);
});

test("NOTE: a non-blocking item never points at a line that is not on the page", () => {
  const src = `${BASE}\nI have my OSHA 10 card from 2019.`;
  const r = HEAD("\n\nCERTIFICATIONS\n- OSHA 30, 2019");
  const v = buildFinishView({ resumeText: r, ownWords: src, defendAnswers: [] });
  const lines = new Set(r.split("\n").map((l) => l.trim()));
  for (const i of v.openItems) if (i.severity === "FIX" && i.line && i.target !== "skill" && i.target !== "skillset") assert.ok(lines.has(i.line), i.line);
});
