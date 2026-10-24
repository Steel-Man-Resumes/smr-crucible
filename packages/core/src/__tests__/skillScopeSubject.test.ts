/** Fix lane check, round 1 (review B3): handing out work counts as the person's delegation only when they are the subject. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { skillScopeNotTheirs } from "../scopeWords";

const TERM = "Work assignment and task delegation";
const clears = (src: string) => skillScopeNotTheirs(TERM, src).length === 0;

test("B3: someone else handing out work never clears the person's delegation", () => {
  for (const s of [
    "My supervisor assigned tasks to me every morning.",
    "The lead assigned the daily work and I did it.",
    "Shift manager would assign duties.",
    "I loaded trucks and my lead assigned the work.",
    "I helped assign tasks.",
    "I was assigned the daily work.",
    "I never assigned the work.",
  ]) assert.equal(clears(s), false, s);
});

test("B3: the person's own handing out of work clears it: plain, adverb, duty bullet, own duty list", () => {
  for (const s of [
    "I assign the daily work.",
    "I usually assign tasks to the crew.",
    "- Assign daily work to the crew.",
    "I manage day-to-day production operations, supervise the production employees, and assign the daily work.",
  ]) assert.equal(clears(s), true, s);
});
