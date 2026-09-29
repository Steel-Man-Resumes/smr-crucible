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

type CityCase = { id: string; source: string; resume_line: string; expect: "keep" | "remove" };
type CredCase = { id: string; source: string; sentence: string; expect_flag: boolean };
const cases = JSON.parse(readFileSync(join(__dirname, "fixtures", "truth-backstop-cases.json"), "utf8")) as {
  city: CityCase[];
  credential: CredCase[];
};

// Missed catches on this set when it was added (2026-09-29). Lower is better;
// raise only on purpose, with the reason in the commit.
const MAX_MISSED_CITY = 0;
const MAX_MISSED_CREDENTIAL = 25;

function flags(c: CredCase): boolean {
  const statuses = credentialStatuses(c.source);
  // Short lines are checked as items (a skill, a certification line), longer ones as prose.
  return c.sentence.split(/\s+/).length <= 12
    ? itemClaimsMoreThanGiven(c.sentence.replace(/^[-•*]\s*/, ""), statuses)
    : claimsMoreThanGiven(c.sentence, statuses);
}

describe("labeled cases: employer cities", () => {
  const kept = (c: CityCase) => stripUnsupportedJobCities(c.resume_line, c.source).text === c.resume_line;
  for (const c of cases.city.filter((c) => c.expect === "keep")) {
    it(`true city kept: ${c.id}`, () => assert.equal(kept(c), true));
  }
  it("home-town fills caught", () => {
    const missed = cases.city.filter((c) => c.expect === "remove" && kept(c)).map((c) => c.id);
    assert.ok(missed.length <= MAX_MISSED_CITY, `missed: ${missed.join(", ")}`);
  });
});

describe("labeled cases: credentials", () => {
  for (const c of cases.credential.filter((c) => !c.expect_flag)) {
    it(`not flagged: ${c.id}`, () => assert.equal(flags(c), false));
  }
  it("overstatements caught", () => {
    const missed = cases.credential.filter((c) => c.expect_flag && !flags(c)).map((c) => c.id);
    assert.ok(missed.length <= MAX_MISSED_CREDENTIAL, `${missed.length} missed: ${missed.join(", ")}`);
  });
});
