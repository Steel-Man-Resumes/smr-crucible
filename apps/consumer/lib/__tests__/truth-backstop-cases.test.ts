/**
 * The employer-city and credential backstops against a labeled set of realistic
 * inputs (fixtures/truth-backstop-cases.json): resume pastes and plain-language
 * stories written the way people type them, labeled by reviewers who never saw
 * the code.
 *
 * Two different bars. The worse mistakes (taking a true city off a resume,
 * flagging a credential the person really holds) must never happen on this set.
 * Missed catches are allowed, since the truth check also runs, but their count
 * may not grow: a change that catches less has to be a deliberate choice.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { claimsMoreThanGiven, credentialStatuses, itemClaimsMoreThanGiven } from "../credential-truth";
import { stripUnsupportedJobCities } from "../job-line-truth";

type CityCase = { id: string; source: string; resume_line: string; expect: "keep" | "remove"; ambiguous?: boolean };
type CredCase = { id: string; source: string; sentence: string; expect_flag: boolean; ambiguous?: boolean };
const cases = JSON.parse(readFileSync(join(__dirname, "fixtures", "truth-backstop-cases.json"), "utf8")) as {
  city: CityCase[];
  credential: CredCase[];
};

// Missed catches on this set (2026-09-29, 655 cases). Lower is better; raise
// only on purpose, with the reason in the commit.
const MAX_MISSED_CITY = 5;
const MAX_MISSED_CREDENTIAL = 65;

/** Checked the way the app checks it: a short line without end punctuation is a
 *  resume or skills item; anything else is prose. The case writers sometimes
 *  name the context ("Report: ...", "Cover letter: ...", "Headline: ..."); resume
 *  and letter text is the person's own voice, report text is advice to them. */
function flags(c: CredCase): boolean {
  const statuses = credentialStatuses(c.source);
  const ctx = (c.sentence.match(/^(Report|Cover letter|Resume line|Headline|Summary|Skills|Resume)\s*:\s*/i) || [])[1]?.toLowerCase();
  const text = ctx && ctx !== "skills" ? c.sentence.replace(/^[^:]+:\s*/, "") : c.sentence;
  const words = text.split(/\s+/).length;
  const item =
    ctx === "skills" ||
    ((ctx === "resume line" || ctx === "headline" || ctx === "resume") && words <= 12) ||
    (!ctx && words <= 12 && !/[.!?]\s*$/.test(text));
  const firstPerson = (!!ctx && ctx !== "report") || /\b(?:I|I'm|I've|my|me)\b/.test(text);
  return item
    ? itemClaimsMoreThanGiven(text.replace(/^[-\u2022*]\s*/, ""), statuses)
    : claimsMoreThanGiven(text, statuses, { firstPerson });
}

describe("labeled cases: employer cities", () => {
  const kept = (c: CityCase) => stripUnsupportedJobCities(c.resume_line, c.source).text === c.resume_line;
  for (const c of cases.city.filter((c) => c.expect === "keep" && !c.ambiguous)) {
    it(`true city kept: ${c.id}`, () => assert.equal(kept(c), true));
  }
  it("home-town fills caught", () => {
    const missed = cases.city.filter((c) => c.expect === "remove" && !c.ambiguous && kept(c)).map((c) => c.id);
    assert.ok(missed.length <= MAX_MISSED_CITY, `${missed.length} missed: ${missed.join(", ")}`);
  });
});

describe("labeled cases: credentials", () => {
  for (const c of cases.credential.filter((c) => !c.expect_flag && !c.ambiguous)) {
    it(`not flagged: ${c.id}`, () => assert.equal(flags(c), false));
  }
  it("overstatements caught", () => {
    const missed = cases.credential.filter((c) => c.expect_flag && !c.ambiguous && !flags(c)).map((c) => c.id);
    assert.ok(missed.length <= MAX_MISSED_CREDENTIAL, `${missed.length} missed: ${missed.join(", ")}`);
  });
});
