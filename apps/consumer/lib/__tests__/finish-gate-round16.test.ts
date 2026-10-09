/**
 * Finish gate, re-check round 16 (consumer path: upload -> ownWordsFor -> finish view). Fictional fixtures.
 *
 * R16-B1: "Shift Lead at Kroger" with its years on the next line, or a no-year
 * sentence naming the higher title, never moves a promotion's title onto the
 * earlier years or a merged span. Honest dash-header pastes clear.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as gate from "../finish-gate";

const { buildFinishView, ownWordsFor } = gate;
type Input = Parameters<typeof buildFinishView>[0];
const C = "Sam Ortiz\n419-555-0177 | sam.ortiz@example.com | Toledo, OH\n\nWORK HISTORY\n";
const PH = "SAM ORTIZ\nToledo, OH | 419-555-0177 | sam.ortiz@example.com\n\nPROFESSIONAL EXPERIENCE\n";
const view = (upload: string, page: string) =>
  buildFinishView({ resumeText: page, ownWords: ownWordsFor({ resumeText: upload }, false), defendAnswers: [], coverLetterText: "", written: { resume: page, letter: "" }, ownResumeText: upload, keptTerms: [] } as unknown as Input);
const titleCards = (upload: string, page: string) => view(upload, page).openItems.filter((i) => i.kind === "title_unsaid").map((i) => i.line);

const MERGED = PH + "SHIFT LEAD | Kroger | Toledo, OH | 2016 - 2023\n- Opened the store and ran the register";
const EARLY = PH + "SHIFT LEAD | Kroger | Toledo, OH | 2019 - 2023\n- Opened the store\nSHIFT LEAD | Kroger | Toledo, OH | 2016 - 2019\n- Ran the register";
const HONEST = PH + "SHIFT LEAD | Kroger | Toledo, OH | 2019 - 2023\n- Opened the store\nCASHIER | Kroger | Toledo, OH | 2016 - 2019\n- Ran the register";

test("R16-B1: a promotion pasted as 'Title at Employer' with the years on the next line asks", () => {
  const up = C + "Shift Lead at Kroger\n2019 - 2023\nopened the store, ran the register\n\nCashier at Kroger\n2016 - 2019\nran the register";
  assert.equal(titleCards(up, MERGED).length, 1);
  assert.deepEqual(titleCards(up, EARLY), ["SHIFT LEAD | Kroger | Toledo, OH | 2016 - 2019"]);
  assert.deepEqual(titleCards(up, HONEST), []);
  assert.equal(view(up, HONEST).state, "finished");
});

test("R16-B1: a no-year sentence naming the higher title never settles the merged header", () => {
  const promo = C + "Cashier | Kroger | 2016 - 2019\nran the register\n\nShift Lead | Kroger | 2019 - 2023\nopened the store";
  for (const s of ["I was a shift lead at Kroger.", "My job at Kroger was shift lead.", "I worked as a shift lead at Kroger.", "Shift lead at Kroger."]) {
    assert.equal(titleCards(`${promo}\n${s}`, MERGED).length, 1, s);
  }
  assert.deepEqual(titleCards(`${promo}\nI was a shift lead at Kroger.`, HONEST), []);
});

test("R16: an honest dash-header paste finishes with no title card", () => {
  const up = C + "Shift Lead — Kroger — 2019–2023\nopened the store\n\nCashier - Kroger - 2016 - 2019\nran the register";
  assert.deepEqual(titleCards(up, HONEST), []);
});
