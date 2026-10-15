/**
 * Finish gate, re-check round 15 (consumer). Fictional fixtures.
 *
 * A courtesy sentence that claims a title ("I am eager to bring my experience
 * as a shift supervisor ...") gets the title card; a settled title card
 * settles its exact phrase for good and never loops; a promotion's higher title
 * on the earlier years gets a card.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as gate from "../finish-gate";

const { buildFinishView, ownWordsFor, titleYesResult, recordTitleYes, applyOwnTitle } = gate;
type Input = Parameters<typeof buildFinishView>[0];
const UPLOAD = `Jordan Smith
419-555-0100 | jordan.smith@example.com | Toledo, OH

WORK HISTORY
Cashier | Burger Barn | 2019 - 2023
ran the register, counted drawers, opened the store`;
const PAGE = (summary = "", header = "CASHIER | Burger Barn | Toledo, OH | 2019 - 2023") => `JORDAN SMITH
Toledo, OH | 419-555-0100 | jordan.smith@example.com
${summary ? `\nSUMMARY\n${summary}\n` : ""}
PROFESSIONAL EXPERIENCE
${header}
- Ran the register and counted drawers`;
const view = (resumeText: string, o: { letter?: string; answers?: Parameters<typeof recordTitleYes>[0]; upload?: string } = {}) =>
  buildFinishView({ resumeText, ownWords: ownWordsFor({ resumeText: o.upload ?? UPLOAD }, false), defendAnswers: o.answers ?? [], coverLetterText: o.letter ?? "", written: { resume: resumeText, letter: o.letter ?? "" }, ownResumeText: o.upload ?? UPLOAD } as Input);

test("R15-B4: a courtesy sentence that claims a title gets the title card, and nothing else in it is asked", () => {
  const letter = "Dear Hiring Manager,\n\nI ran the register at Burger Barn. I am eager to bring my experience as a shift supervisor at Burger Barn to your store.\n\nSincerely,\nJordan Smith";
  const v = view(PAGE(), { letter });
  const g = v.groups.find((x) => x.target === "letter" && x.title)!;
  assert.deepEqual(g.title, { current: "shift supervisor", role: true });
  assert.ok(!v.openItems.some((i) => i.target === "letter" && i.kind === "scope_unsaid"));
  const plain = "Dear Hiring Manager,\n\nI ran the register at Burger Barn. I am eager to join your store.\n\nSincerely,\nJordan Smith";
  assert.ok(!view(PAGE(), { letter: plain }).openItems.some((i) => i.target === "letter"));
});

test("R15-B1: a settled title card settles that exact phrase and never loops", () => {
  const s = "Retail shift lead who ran the register.";
  const r = PAGE(s);
  const g = view(r).groups.find((x) => x.line === s && x.title)!;
  assert.ok(g, "the added word gets a card");
  // With or without the card's own title passed, "Yes" typed as shown settles it.
  assert.equal(titleYesResult(s, g.title!.current), "ok");
  assert.equal(titleYesResult(s, g.title!.current, g.title!.current), "ok");
  const a = recordTitleYes([], s, g.title!.current);
  assert.ok(!view(r, { answers: a }).openItems.some((i) => i.line === s && i.kind === "title_unsaid"));
  // "Use my title" settles the new phrase too.
  const own = applyOwnTitle(r, [], s, "Cashier", g.title!.current);
  assert.ok(own.changed);
  assert.ok(!view(own.text, { answers: own.answers }).openItems.some((i) => i.kind === "title_unsaid" && /Cashier who ran/.test(i.line)));
});

test("R15-B3: the higher title on a promotion's earlier years gets a card", () => {
  const upload = "Jordan Smith\n419-555-0100 | jordan.smith@example.com | Toledo, OH\n\nWORK HISTORY\nShift Lead | Kroger | 2019 - 2023\nCashier | Kroger | 2016 - 2019";
  const r = `JORDAN SMITH\nToledo, OH | 419-555-0100 | jordan.smith@example.com\n\nPROFESSIONAL EXPERIENCE\nSHIFT LEAD | Kroger | Toledo, OH | 2019 - 2023\n- Ran the register\nSHIFT LEAD | Kroger | Toledo, OH | 2016 - 2019\n- Ran the register`;
  const titled = view(r, { upload }).groups.filter((g) => g.title).map((g) => g.line);
  assert.deepEqual(titled, ["SHIFT LEAD | Kroger | Toledo, OH | 2016 - 2019"]);
});
