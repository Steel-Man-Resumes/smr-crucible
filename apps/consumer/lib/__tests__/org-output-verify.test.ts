/**
 * Layer 1 is the half that cannot be allowed to fail, so it is the half with
 * tests. The false-positive cases matter as much as the catches: a verifier
 * that flags ordinary sentences gets switched off, and then nothing is checked.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { checkOrgClaimsDeterministic, type OrgFacts } from "../org-output-verify";

const FACTS: OrgFacts = {
  caseload: 3,
  stalled: 1,
  neverStarted: 0,
  hired: 1,
  unassigned: 0,
  visibleNames: ["Terrell", "Wes", "Colton"],
  staffNames: ["Russ", "Alma", "Dana"],
};

const problems = (t: string) => checkOrgClaimsDeterministic(t, FACTS);

describe("numbers must be ours", () => {
  it("accepts the real caseload figures", () => {
    assert.deepEqual(problems("You have 3 people, 1 has not moved in two weeks."), []);
  });

  it("accepts arithmetic a person would say out loud", () => {
    // "2 of your 3" -- the difference of two real figures is still grounded.
    assert.deepEqual(problems("That leaves 2 of your 3 active."), []);
  });

  it("CATCHES a number that came from nowhere", () => {
    const found = problems("Your caseload of 47 is trending well.");
    assert.equal(found.length, 1);
    assert.match(found[0], /47/);
  });

  it("catches an invented outcome count", () => {
    assert.ok(problems("9 people started work this quarter.").length > 0);
  });

  it("ignores money and percentages, which are reported elsewhere", () => {
    assert.deepEqual(problems("Spend to date is $0.89 and engagement is 62%."), []);
  });
});

describe("people must be inside reach", () => {
  it("allows a participant this viewer can see", () => {
    assert.deepEqual(problems("I would start with Colton, he has gone quiet."), []);
  });

  it("allows a colleague in the same organization", () => {
    assert.deepEqual(problems("You could ask Alma to pick that up."), []);
  });

  it("CATCHES somebody outside this viewer's reach", () => {
    // Priya is real, but she is Alma's client and Russ cannot see her. This is
    // the check that stops one caseload leaking into another's conversation.
    const found = problems("You should also follow up with Priya this week.");
    assert.equal(found.length, 1);
    assert.match(found[0], /Priya/);
  });

  it("catches an entirely invented person", () => {
    assert.ok(problems("Consider checking in with Marcus about his interview.").length > 0);
  });

  it("does not flag ordinary capitalized words mid-sentence", () => {
    assert.deepEqual(
      problems("Try that on Tuesday, and mention the Forge results if it helps."),
      []
    );
  });
});

describe("clean output passes", () => {
  it("passes a realistic answer end to end", () => {
    const answer =
      "Start with Colton. He has not been active in two weeks, which is the " +
      "longest of your 3. Wes is moving fine and Terrell already started work.";
    assert.deepEqual(problems(answer), []);
  });
});
