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

  // House build L6 (2026-10-26): money and rates are no longer skipped. A
  // wage nobody gave is the red-team case; a rate in a funder narrative must
  // be one the outcomes read computed.
  it("catches money nobody gave and a rate nobody computed", () => {
    const found = problems("Spend to date is $0.89 and engagement is 62%.");
    assert.equal(found.length, 2, JSON.stringify(found));
    assert.match(found[0], /\$0\.89/);
    assert.match(found[1], /62%/);
  });

  it("allows 0% and 100%", () => {
    assert.deepEqual(problems("None of them are 0% done and one is 100% ready."), []);
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

  it("lets a typed name through only to say that person is not on the list, and only on the answer path", () => {
    // Staff walk 2026-10-27: "fill in for michael shaw" came back with
    // "Michael" and "Shaw" flagged as if they were findings about a person.
    const said = "take me to the add a participant page and fill in for michael shaw";
    const answer = { typedNamesInNoMatch: true };
    assert.deepEqual(checkOrgClaimsDeterministic("I can't add people, but Michael Shaw isn't on your list yet.", FACTS, said, answer), []);
    // The same typed name in any other sentence is still a person outside reach.
    const claim = checkOrgClaimsDeterministic("I can help, and Michael Shaw got the job last week.", FACTS, said, answer);
    assert.deepEqual(claim, ['I could not match "Michael" to anyone on your list', 'I could not match "Shaw" to anyone on your list']);
    // Curly apostrophes and the "I couldn't find" form are the same statement.
    assert.deepEqual(checkOrgClaimsDeterministic("Michael Shaw isn\u2019t on your list yet.", FACTS, said, answer), []);
    assert.deepEqual(checkOrgClaimsDeterministic("Sorry, I couldn't find Michael Shaw on your list.", FACTS, said, answer), []);
    // A claim riding in the same sentence as the no-match phrase is still caught (review round 2).
    assert.equal(checkOrgClaimsDeterministic("Michael isn't on your list, but he got the job at the plant.", FACTS, "is michael on my list", answer).length, 0, "sentence-initial name and a pronoun claim: layer 1 never parsed those; layer 2 checks the claim");
    assert.ok(checkOrgClaimsDeterministic("I couldn't find a listing nearby, and Michael was hired last week.", FACTS, said, answer).some((p) => p.includes('"Michael"')));
    assert.ok(checkOrgClaimsDeterministic("I checked, and Michael Shaw isn't on your list but Michael Shaw got the job.", FACTS, said, answer).some((p) => p.includes('"Michael"')));
    // A draft for a participant never gets the allowance (review 2026-10-27).
    assert.equal(checkOrgClaimsDeterministic("Good news, and Michael Shaw isn't on your list.", FACTS, said).length, 2);
    // An untyped name is flagged with the plain wording.
    const miss = checkOrgClaimsDeterministic("You should also follow up with Priya this week.", FACTS, said, answer);
    assert.deepEqual(miss, ['I could not match "Priya" to anyone on your list']);
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
