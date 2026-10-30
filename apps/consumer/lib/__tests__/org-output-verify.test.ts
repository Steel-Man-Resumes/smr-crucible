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
  // 2026-10-30: the answer path flags only people of this org outside reach, so the
  // out-of-reach people these tests name are listed (Michael Shaw, Priya, Mason).
  outOfReachNames: ["Michael Shaw", "Priya Nair", "Mason Reed"],
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
    assert.deepEqual(claim, ['I could not match "Michael Shaw" to anyone on your list']);
    // Curly apostrophes and the "I couldn't find" form are the same statement.
    assert.deepEqual(checkOrgClaimsDeterministic("Michael Shaw isn\u2019t on your list yet.", FACTS, said, answer), []);
    assert.deepEqual(checkOrgClaimsDeterministic("Sorry, I couldn't find Michael Shaw on your list.", FACTS, said, answer), []);
    // A claim riding in the same sentence as the no-match phrase is still caught (review round 2).
    assert.equal(checkOrgClaimsDeterministic("Michael isn't on your list, but he got the job at the plant.", FACTS, "is michael on my list", answer).length, 0, "sentence-initial name and a pronoun claim: layer 1 never parsed those; layer 2 checks the claim");
    assert.ok(checkOrgClaimsDeterministic("I couldn't find a listing nearby, and Michael was hired last week.", FACTS, said, answer).some((p) => p.includes('"Michael"')));
    assert.ok(checkOrgClaimsDeterministic("I checked, and Michael Shaw isn't on your list but Michael Shaw got the job.", FACTS, said, answer).some((p) => p.includes('"Michael Shaw"')));
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

// Demo walk W08 (2026-10-27): Lupe on Jean Valjean's page, "Prep me". The
// useful summary came back with "Prep", "Forklift" and "Driver" reported as
// people outside her access, and the day numbers in "Oct 27" and "October 25"
// reported as caseload figures. False warnings teach staff to ignore the box.
describe("W08: dates, job words, panel labels and a resolved surname are not claims", () => {
  const LUPE: OrgFacts = {
    caseload: 2, stalled: 0, neverStarted: 0, hired: 0, unassigned: 0,
    visibleNames: ["Jean", "Marqus"], staffNames: ["Lupe"], orgName: "Southside Bridge",
    outOfReachNames: ["Michael Shaw", "Priya Nair", "Mason Reed"],
  };
  const answer = { typedNamesInNoMatch: true };
  const said = "Prep me for my next conversation with Jean Valjean.";

  it("(b) a job title, a skill word and the panel's own label are not people", () => {
    assert.deepEqual(
      checkOrgClaimsDeterministic("Here is your Prep for Jean, who saved a Forklift Driver opening and asked about Warehouse shifts.", LUPE, said, answer),
      []
    );
  });

  it("(b) a draft for the participant keeps the full person check, job words included", () => {
    // Job words are answer-path only (CC 2026-10-28): drafts stay as strict as before W08.
    const found = checkOrgClaimsDeterministic("Hi Jean, I saw the Forklift Driver opening you saved.", LUPE, said);
    assert.ok(found.some((p) => p.includes('"Forklift"')));
  });

  it("(c) day numbers inside written dates are not caseload counts", () => {
    for (const t of [
      "Jean was last active Sun Oct 25 and joined Oct 27 this week.",
      "Jean was last active October 25 and joined on Oct 27 too.",
      "Jean was last active Sunday, October 25, 2026 by his sharing.",
      "Jean was last active 10/25 and the task is due 10/27/2026 now.",
      "Jean was last active 2026-10-25 by his sharing.",
    ]) assert.deepEqual(checkOrgClaimsDeterministic(t, LUPE, said, answer), [], t);
  });

  it("(c) a bare count is still checked, next to a date or not", () => {
    const found = checkOrgClaimsDeterministic("Since Oct 25 you have 27 people waiting on you.", LUPE, said, answer);
    assert.deepEqual(found, ['the figure "27" is not one of this caseload\'s numbers']);
  });

  it("(a) a surname the server resolved to someone in reach is not flagged", () => {
    const resolved: OrgFacts = { ...LUPE, resolvedNames: ["Valjean"] };
    assert.deepEqual(checkOrgClaimsDeterministic("Here is where Jean Valjean is this week.", resolved, said, answer), []);
    // 2026-10-30: on the answer path a word that matches nobody out of reach is not flagged (layer 2
    // judges people); the draft path still checks it without the server match.
    assert.deepEqual(checkOrgClaimsDeterministic("Here is where Jean Valjean is this week.", LUPE, said, answer), []);
    assert.ok(checkOrgClaimsDeterministic("Here is where Jean Valjean is this week.", LUPE, said).some((p) => p.includes('"Valjean"')), "draft path: still checked");
  });

  it("REGRESSION: an out-of-reach name is still flagged beside a date and a job word, on both paths", () => {
    const t = "Jean met Michael Shaw on Oct 27 for a Forklift Driver opening.";
    const expected = ['I could not match "Michael Shaw" to anyone on your list'];
    assert.deepEqual(checkOrgClaimsDeterministic(t, { ...LUPE, resolvedNames: ["Valjean"] }, said, answer), expected);
    // The draft path is unchanged (2026-10-30): it still flags each unknown word.
    const draft = checkOrgClaimsDeterministic(t, LUPE, said);
    for (const e of ['I could not match "Michael" to anyone on your list', 'I could not match "Shaw" to anyone on your list']) assert.ok(draft.includes(e), `draft path: ${e}`);
    // A name right after a date is still mid-sentence once the date is read as a date.
    assert.deepEqual(
      checkOrgClaimsDeterministic("Jean has an interview on Oct 27 and Michael set it up for him.", LUPE, said, answer),
      ['I could not match "Michael" to anyone on your list']
    );
    // The panel's label words are answer-path only: a draft keeps the full check.
    assert.ok(checkOrgClaimsDeterministic("Hi Jean, your Triage is set.", LUPE, said).some((p) => p.includes('"Triage"')));
  });

  it("names that are also job words stay checked as names", () => {
    assert.ok(checkOrgClaimsDeterministic("Jean should call Mason about the Forklift Driver opening.", LUPE, said, answer).some((p) => p.includes('"Mason"')));
  });
});

describe("W08 review round 2", () => {
  const LUPE: OrgFacts = {
    caseload: 2, stalled: 0, neverStarted: 0, hired: 0, unassigned: 0,
    visibleNames: ["Jean", "Marqus"], staffNames: ["Lupe"], orgName: "Southside Bridge",
    outOfReachNames: ["Michael Shaw", "Priya Nair", "Mason Reed"],
  };
  const answer = { typedNamesInNoMatch: true };

  it("S2: a resolved surname is allowed on the answer path only; a draft flags it as before", () => {
    const facts: OrgFacts = { ...LUPE, resolvedNames: ["Valjean"] };
    const t = "Hi Jean, I saw Valjean on the list today.";
    assert.deepEqual(checkOrgClaimsDeterministic(t, facts, "Prep me for Valjean", answer), []);
    assert.deepEqual(checkOrgClaimsDeterministic(t, facts, "Prep me for Valjean"), ['I could not match "Valjean" to anyone on your list']);
    assert.deepEqual(checkOrgClaimsDeterministic(t, facts, "Prep me for Valjean"), checkOrgClaimsDeterministic(t, LUPE, "Prep me for Valjean"), "draft path identical with or without the resolution");
  });

  it("S6: a count after a month name is still a count", () => {
    for (const [t, n] of [
      ["In October 38 participants finished the program.", "38"],
      ["As of today Oct 27 people are stalled.", "27"],
      ["In Oct 45 people started.", "45"],
      ["Tom saw it May 20 days ago.", "20"],
    ] as const) {
      assert.deepEqual(checkOrgClaimsDeterministic(t, LUPE, "", answer), [`the figure "${n}" is not one of this caseload's numbers`], t);
    }
  });

  it("S6: real dates still pass", () => {
    for (const t of ["Jean was last active Sun Oct 25 this week.", "Jean joined October 25, 2026 by his sharing.", "Jean was last active 10/25 this week.", "Jean was active Oct 31 and Nov 1 too."]) {
      assert.deepEqual(checkOrgClaimsDeterministic(t, LUPE, "", answer), [], t);
    }
  });
});

// Round 3 (2026-10-28, review R2 B1): dates are read as dates on the answer
// path only, and only before the end, punctuation or a short list of words.
describe("W08 review round 3: dates never hide a count; drafts match origin/main", () => {
  const LUPE: OrgFacts = {
    caseload: 2, stalled: 0, neverStarted: 0, hired: 0, unassigned: 0,
    visibleNames: ["Jean", "Marqus"], staffNames: ["Lupe"], orgName: "Southside Bridge",
    outOfReachNames: ["Michael Shaw", "Priya Nair", "Mason Reed"],
  };
  const answer = { typedNamesInNoMatch: true };
  const fig = (n: string) => `the figure "${n}" is not one of this caseload's numbers`;

  it("B1: every invented count after a month stays flagged on BOTH paths", () => {
    for (const [t, n] of [
      ["Since Oct 1, 2500 participants have enrolled.", "2500"],
      ["Since Oct 1 1500 people enrolled.", "1500"],
      ["In October 22 graduates got jobs.", "22"],
      ["In September 19 young adults enrolled.", "19"],
      ["Since Sept 1, 1800 meals were served.", "1800"],
      ["In October 38 participants finished the program.", "38"],
    ] as const) {
      assert.deepEqual(checkOrgClaimsDeterministic(t, LUPE, "", answer), [fig(n)], `answer: ${t}`);
      assert.deepEqual(checkOrgClaimsDeterministic(t, LUPE, ""), [fig(n)], `draft: ${t}`);
    }
  });

  it("B1: real dates pass on the answer path", () => {
    for (const t of ["Jean was last active Sun Oct 25", "Jean joined October 25, 2026.", "Jean was active Oct 31 and Nov 1.", "Jean was last active Oct 24 at 6 PM."]) {
      assert.deepEqual(checkOrgClaimsDeterministic(t, LUPE, "", answer), [], t);
    }
  });

  // Expected outputs captured from origin/main ad00ff05's checkOrgClaimsDeterministic
  // (draft path: no opts) on 2026-10-28. The draft path must not drift from them.
  const ORIGIN_DRAFT: readonly (readonly [string, readonly string[]])[] = [
    ["Since Oct 1, 2500 participants have enrolled.", [fig("2500")]],
    ["Since Oct 1 1500 people enrolled.", [fig("1500")]],
    ["In October 22 graduates got jobs.", [fig("22")]],
    ["In September 19 young adults enrolled.", [fig("19")]],
    ["Since Sept 1, 1800 meals were served.", [fig("1800")]],
    ["Jean was last active Sun Oct 25 at noon.", [fig("25")]],
    ["Jean joined October 25, 2026.", []],
    ["Jean was active Oct 31 and Nov 1.", [fig("31")]],
    ["Jean was last active Oct 24 at 6 PM.", []],
    ["Jean met Michael Shaw on Oct 27 about a Forklift Driver opening.", [fig("27"), 'I could not match "Michael" to anyone on your list', 'I could not match "Shaw" to anyone on your list', 'I could not match "Forklift" to anyone on your list', 'I could not match "Driver" to anyone on your list']],
    ["Hi Jean, I saw the Forklift Driver opening you saved.", ['I could not match "Forklift" to anyone on your list', 'I could not match "Driver" to anyone on your list']],
    ["Jean was last active 2026-10-25 by his sharing.", [fig("2026")]],
    ["Oct 27 Marcus called about 27 people.", [fig("27"), fig("27")]],
  ];
  it("parity: the draft path gives origin/main's output for every sentence", () => {
    for (const [t, expected] of ORIGIN_DRAFT) assert.deepEqual(checkOrgClaimsDeterministic(t, LUPE, ""), expected, t);
  });
});

// Round 4 (2026-10-28, review R3 S1): ordinary ways a date is followed in a
// t.ROY answer. Answer path only; the draft path is origin/main's (parity above).
describe("W08 review round 4: dates as t.ROY writes them", () => {
  const LUPE: OrgFacts = {
    caseload: 2, stalled: 0, neverStarted: 0, hired: 0, unassigned: 0,
    visibleNames: ["Jean", "Marqus"], staffNames: ["Lupe"], orgName: "Southside Bridge",
    outOfReachNames: ["Michael Shaw", "Priya Nair", "Mason Reed"],
  };
  const answer = { typedNamesInNoMatch: true };

  it("a bullet list, a clock time, a parenthesis and a following word are dates", () => {
    for (const t of [
      "- Last active: Oct 25\n- Interview: Oct 29",
      "Interview Thu Oct 29 9:00 AM at the plant.",
      "Last active Oct 25 (Sun).",
      "He has been quiet since Oct 25 this week.",
      "Last active Oct 24 6 PM.",
      "Interview Oct 29 - bring ID.",
      "Last active Oct 25 \u2014 nothing since.",
    ]) assert.deepEqual(checkOrgClaimsDeterministic(t, LUPE, "", answer), [], t);
  });

  it("a count after a date is still the only thing flagged", () => {
    assert.deepEqual(checkOrgClaimsDeterministic("Since Oct 25 you have 27 people waiting on you.", LUPE, "", answer), ['the figure "27" is not one of this caseload\'s numbers']);
  });
});
