import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { checkOrgClaimsDeterministic, type OrgFacts } from "../org-output-verify";

// 2026-10-30: on the staff ANSWER path, layer 1 flags a name only when it is a
// real person in this organization outside the viewer's reach. Towns,
// employers, agencies, programs and statuses are never people. The draft path
// for a participant keeps the old full check.
const LUPE: OrgFacts = {
  caseload: 2, stalled: 0, neverStarted: 0, hired: 0, unassigned: 0,
  visibleNames: ["Jean", "Marqus"], staffNames: ["Lupe"], orgName: "Southside Bridge",
  outOfReachNames: ["Ceci Ayala", "Tom Jackson"],
};
const answer = { typedNamesInNoMatch: true };
const name = (n: string) => `I could not match "${n}" to anyone on your list`;
const check = (t: string, said = "", f: OrgFacts = LUPE) => checkOrgClaimsDeterministic(t, f, said, answer);

describe("answer path: places, employers, agencies and statuses are not people", () => {
  const clean = [
    "Here are employers near Kalamazoo, Battle Creek and Grand Rapids that hire people with records.",
    "For housing help in Marquette, try the Upper Peninsula offices; MSHDA lists them too.",
    "Your Offender Success contact in Region 4 works with MDOC parole agents in Muskegon.",
    "Eaton Corporation in Jackson runs Hydraulics and Aerospace plants, and Kelly Services runs Kelly 33.",
    "Jean moved from Interviewing to Offered, and Marqus is still at Applied.",
    "The Eastside Fish Fry and Grill listing in Lansing was checked Oct 22.",
    "Michigan Works in Traverse City and Goodwill in Flint both list Second Chance hiring.",
    "Open Directory, then Connections, and press Undo if the Retention section moved.",
  ];
  for (const t of clean) it(t, () => assert.deepEqual(check(t), []));

  it("a town that is also an out-of-reach surname is not flagged on its own", () => {
    assert.deepEqual(check("There are two employers in Jackson that hire people with records."), []);
  });
});

describe("answer path: real people outside reach are flagged", () => {
  it("an out-of-reach first name mid-sentence", () => {
    assert.deepEqual(check("You might also check on Ceci this week."), [name("Ceci")]);
  });
  it("a full name, once, even at the start of a sentence", () => {
    assert.deepEqual(check("Ceci Ayala got an interview at the plant."), [name("Ceci Ayala")]);
  });
  it("a surname alone, when the first name is in the answer or typed", () => {
    assert.deepEqual(check("Jean and Tom both applied, and Jackson starts Monday."), [name("Tom"), name("Jackson")]);
    assert.deepEqual(check("Jean starts Monday, and Jackson starts Tuesday.", "how is tom doing"), [name("Jackson")]);
    assert.deepEqual(check("Jean starts Monday, and Jackson has two openings."), []);
  });
  it("a full name whose first name is shared with someone in reach", () => {
    const f: OrgFacts = { ...LUPE, visibleNames: ["Jean", "Marqus", "Tom"] };
    assert.deepEqual(check("Tom Jackson got the job.", "", f), [name("Tom Jackson")]);
    assert.deepEqual(check("Jean and Tom both applied.", "", f), []);
  });
  it("saying the person is not on the list is allowed only for a name the staff member typed", () => {
    assert.deepEqual(check("Ceci Ayala isn't on your list.", "how is ceci ayala doing"), []);
    // A pronoun claim after it is layer 2's (as before); the name repeated in a claim is layer 1's.
    assert.deepEqual(check("Ceci Ayala isn't on your list, but she got the job.", "how is ceci ayala doing"), []);
    assert.deepEqual(check("Ceci Ayala isn't on your list, but Ceci Ayala got the job.", "how is ceci ayala doing"), [name("Ceci Ayala")]);
    assert.deepEqual(check("Ceci Ayala isn't on your list."), [name("Ceci Ayala")], "not typed: no allowance");
  });
});

describe("answer path: reach 'all' (nobody out of reach)", () => {
  it("never flags a name", () => {
    const all: OrgFacts = { ...LUPE, outOfReachNames: [] };
    assert.deepEqual(check("Ceci Ayala and Michael Shaw both got interviews.", "", all), []);
  });
});

describe("draft path: unchanged", () => {
  it("still flags unknown capitalized words in a draft for a participant", () => {
    const d = checkOrgClaimsDeterministic("Hi Jean, Ogden Staffing in Lansing has a shift.", LUPE, "");
    assert.ok(d.includes(name("Ogden")) && d.includes(name("Staffing")) && d.includes(name("Lansing")), JSON.stringify(d));
  });
  it("out-of-reach names are flagged word by word as before", () => {
    const d = checkOrgClaimsDeterministic("Hi Jean, Ceci Ayala called.", LUPE, "");
    assert.ok(d.includes(name("Ceci")) && d.includes(name("Ayala")), JSON.stringify(d));
  });
});

describe("numbers: unchanged on the answer path", () => {
  it("an invented count is still flagged", () => {
    assert.ok(check("17 people on your caseload got hired in Kalamazoo.").some((p) => p.includes('"17"')));
  });
});
