/**
 * Demo fix T1 (2026-10-28): staff t.ROY answers stop showing false "Check
 * these before you use them" warnings. Each live failure on production
 * 75dcfc5 is replayed word for word with the tool results the server
 * returned, and must come back clean on the ANSWER path. The DRAFT path (a
 * message for a participant, no opts) must give origin/main's output for
 * every sentence: captured below from origin/main 75dcfc5, plus a 5,000
 * sentence fuzz run by the lane (0 differences, see T1-REPORT.md).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { checkOrgClaimsDeterministic, orgFlagNotice, typedPlaceWords, type OrgFacts } from "../org-output-verify";
import { createStaffEvidenceCollector, projectStaffToolEvidence } from "../staff-tool-evidence";
import { ANSWERS, EMPLOYERS_RESULT, OVERVIEW_RESULT, LUPE } from "./demo-fix-t1-fixtures";

const answer = { typedNamesInNoMatch: true };
const employers = projectStaffToolEvidence("find_employers", EMPLOYERS_RESULT)!;
const overview = projectStaffToolEvidence("read_participant_overview", OVERVIEW_RESULT)!;
const withTools = (...e: NonNullable<OrgFacts["staffToolEvidence"]>): OrgFacts => ({ ...LUPE, staffToolEvidence: e });
const name = (n: string) => `I could not match "${n}" to anyone on your list`;
const fig = (n: string) => `the figure "${n}" is not one of this caseload's numbers`;

describe("T1: the live false warnings are gone on the answer path", () => {
  it("1. Today layout answer: section names are not people", () => {
    assert.deepEqual(checkOrgClaimsDeterministic(ANSWERS.layout, LUPE, "Put my tasks first on Today", answer), []);
    // Same answer with the layout read in the turn.
    assert.deepEqual(checkOrgClaimsDeterministic(ANSWERS.layout, withTools(), "Put my tasks first on Today", answer), []);
  });

  it("2. Jackson: the typed place and the listing text are not inventions", () => {
    assert.deepEqual(checkOrgClaimsDeterministic(ANSWERS.jacksonAsk, LUPE, "Find employers in Jackson that hire people with records", answer), []);
    assert.deepEqual(checkOrgClaimsDeterministic(ANSWERS.jackson, withTools(employers), "Jackson, Michigan.", answer), []);
  });

  it("3. Lansing: the listing from the read and the Undo button word", () => {
    assert.deepEqual(checkOrgClaimsDeterministic(ANSWERS.lansing, withTools(employers), "find employers in Lansing that hire people with records", answer), []);
    assert.deepEqual(checkOrgClaimsDeterministic(ANSWERS.undo, LUPE, "what can you do?", answer), []);
  });

  it("4. Prep me for Valjean: a dated note and an employer on his tracker", () => {
    const facts: OrgFacts = { ...withTools(overview), resolvedNames: ["Valjean"] };
    assert.deepEqual(checkOrgClaimsDeterministic(ANSWERS.prep, facts, "Prep me for Valjean", answer), []);
  });

  it("the words come from the server's own record of the tool results", () => {
    const c = createStaffEvidenceCollector();
    c.record("find_employers", EMPLOYERS_RESULT);
    assert.deepEqual(checkOrgClaimsDeterministic(ANSWERS.jackson, withTools(...c.items), "Jackson, Michigan.", answer), []);
    // A failed read gives nothing.
    const failed = createStaffEvidenceCollector();
    failed.record("find_employers", { ...EMPLOYERS_RESULT, status: "unavailable" });
    assert.ok(checkOrgClaimsDeterministic(ANSWERS.jackson, withTools(...failed.items), "Jackson, Michigan.", answer).includes(name("Hydraulics")));
  });
});

describe("T1: what must still be flagged", () => {
  it("an out-of-reach person not in the tool output and not typed as a place", () => {
    const said = "Find employers in Jackson that hire people with records";
    assert.deepEqual(checkOrgClaimsDeterministic("Jackson said Michael Shaw called on Oct 27.", withTools(employers), said, answer), [name("Michael"), name("Shaw")]);
    assert.deepEqual(checkOrgClaimsDeterministic("In Jackson, Michael Shaw called on Oct 27.", withTools(employers), said, answer), [name("Michael"), name("Shaw")]);
  });

  it("a name the staff member typed into the search box is not tool output", () => {
    const echoed = projectStaffToolEvidence("find_employers", { ...EMPLOYERS_RESULT, q: "Michael Shaw" })!;
    assert.ok(!(echoed.toolText ?? []).some((t) => t.includes("Michael")));
    // find_local_help echoes the place asked for: that is not tool text either.
    const help = projectStaffToolEvidence("find_local_help", { status: "ok", place: { state: "MI", city: "Michael Shaw" }, resources: [{ organization: "Jackson Food Share", city: "Jackson" }] })!;
    assert.deepEqual(help.toolText, ["ok", "Jackson Food Share", "Jackson"]);
    assert.deepEqual(checkOrgClaimsDeterministic("I looked, and Michael Shaw starts Monday.", withTools(echoed), "find employers for Michael Shaw", answer), [name("Michael"), name("Shaw")]);
  });

  it("a person after to or from is not a place, and a possessive is not a place", () => {
    for (const said of ["write to Michael Shaw", "a note from Michael Shaw", "anything in Michael Shaw's file", "talk to Michael Shaw, ok?"]) {
      assert.deepEqual([...typedPlaceWords(said)], [], said);
      assert.deepEqual(checkOrgClaimsDeterministic("I checked, and Michael Shaw got the job.", LUPE, said, answer), [name("Michael"), name("Shaw")], said);
    }
    assert.deepEqual([...typedPlaceWords("employers at Lansing, MI")], ["lansing"]);
    assert.deepEqual([...typedPlaceWords("jobs near battle creek")], ["battle", "creek"]);
  });

  it("a figure that is not in the tool output or the caseload", () => {
    assert.deepEqual(checkOrgClaimsDeterministic("Kelly runs the Kelly 34 program, and Kelly has 33 openings.", withTools(employers), "Jackson, Michigan.", answer), [fig("34")]);
    // A phone number's digits in listing text are never figures.
    const phone = projectStaffToolEvidence("find_employers", { ...EMPLOYERS_RESULT, employers: [{ ...EMPLOYERS_RESULT.employers[0], evidence: "Call 517-555-0142 for the plant." }] })!;
    assert.deepEqual(checkOrgClaimsDeterministic("There are 517 openings and 555 hires.", withTools(phone), "", answer), [fig("517"), fig("555")]);
  });

  it("dates: a date unless a count noun follows", () => {
    for (const t of ["Your Oct 27 note says he has not confirmed.", "Last active Oct 24 at 6 PM.", "His interview is Oct 29.", "Checked Sep 15, 2026. Recheck by Dec 14, 2026."]) {
      assert.deepEqual(checkOrgClaimsDeterministic(t, LUPE, "", answer), [], t);
    }
    for (const [t, n] of [["As of today Oct 27 people are stalled.", "27"], ["In October 22 graduates got jobs.", "22"], ["In September 19 young adults enrolled.", "19"], ["Tom saw it May 20 days ago.", "20"], ["Since Oct 23 participants joined.", "23"]] as const) {
      assert.deepEqual(checkOrgClaimsDeterministic(t, LUPE, "", answer), [fig(n)], t);
    }
  });
});

describe("T1: the footer reads as plain sentences", () => {
  it("one sentence per flag, no figure line for a name", () => {
    assert.equal(
      orgFlagNotice([name("Retention")]),
      '\n\n---\n**Check these before you use them.** I could not match "Retention" to anyone on your list. Your dashboard is the system of record, so check there before you use this.'
    );
  });

  it("the figure line only when a number was flagged", () => {
    assert.equal(
      orgFlagNotice([fig("33"), name("Ogden")]),
      '\n\n---\n**Check these before you use them.** The figure "33" is not one of this caseload\'s numbers. I could not match "Ogden" to anyone on your list. Your dashboard is the system of record, so take the figure from there, not from me.'
    );
  });

  it("a second-pass flag quotes the answer's own sentence once", () => {
    const out = orgFlagNotice(["Jean got the job at the plant."]);
    assert.ok(out.includes('I could not support this: "Jean got the job at the plant".'), out);
    assert.ok(!/I could not support I could not/.test(orgFlagNotice([name("Retention"), "Jean got the job."])));
  });
});

describe("T1: the draft path is origin/main's, byte for byte", () => {
  // Captured from origin/main 75dcfc5 checkOrgClaimsDeterministic (no opts) on
  // 2026-10-28 with the same facts: LUPE, both tool reads, Valjean resolved.
  const ORIGIN: readonly (readonly [string, string, readonly string[]])[] = [
    ["Hi Jean, the Retention check-ins due list and Referrals past due list are on Today.", "", ["I could not match \"Retention\" to anyone on your list", "I could not match \"Referrals\" to anyone on your list"]],
    ["Hi Jean, press Undo if you want it back. Your Inbox, People and Directory are on the left.", "", ["I could not match \"Undo\" to anyone on your list", "I could not match \"Inbox\" to anyone on your list", "I could not match \"Directory\" to anyone on your list"]],
    ["Hi Jean, Eaton Corporation in Jackson runs Hydraulics and Aerospace plants.", "Find employers in Jackson that hire people with records", ["I could not match \"Hydraulics\" to anyone on your list", "I could not match \"Aerospace\" to anyone on your list"]],
    ["Hi Jean, Kelly runs the Kelly 33 program with the Second Chance Business Coalition.", "Jackson, Michigan.", ["the figure \"33\" is not one of this caseload's numbers", "I could not match \"Business\" to anyone on your list", "I could not match \"Coalition\" to anyone on your list"]],
    ["Hi Jean, Eastside Fish Fry & Grill in Lansing hires people with records.", "find employers in Lansing that hire people with records", []],
    ["Hi Jean, your Oct 27 note says the STS interview is not confirmed.", "Prep me for Valjean", []],
    ["Hi Jean, we can meet Oct 24 at 6 PM or Oct 29.", "", []],
    ["Hi Jean, the other 5 include Snap On, ALogix and Ogden.", "Prep me for Valjean", []],
    ["Jackson said Michael Shaw called on Oct 27.", "Find employers in Jackson that hire people with records", ["I could not match \"Michael\" to anyone on your list", "I could not match \"Shaw\" to anyone on your list"]],
    ["Hi Jean, Michael Shaw from Jackson called.", "write to Michael Shaw", ["I could not match \"Michael\" to anyone on your list", "I could not match \"Shaw\" to anyone on your list"]],
    ["In October 22 graduates got jobs and Oct 27 people are stalled.", "", []],
    ["In September 19 young adults enrolled.", "", ["the figure \"19\" is not one of this caseload's numbers"]],
    ["Hi Jean, Grand Rapids has 33 openings at Ogden Staffing.", "find employers in grand rapids, MI", ["the figure \"33\" is not one of this caseload's numbers", "I could not match \"Grand\" to anyone on your list", "I could not match \"Rapids\" to anyone on your list"]],
    ["Hi Jean, I saw Valjean on the list and Mason called about Grid view.", "Prep me for Valjean", ["I could not match \"Valjean\" to anyone on your list", "I could not match \"Mason\" to anyone on your list", "I could not match \"Grid\" to anyone on your list"]],
    ["Hi Jean, Settings, Connections and Saved views are under My setup.", "", ["I could not match \"Connections\" to anyone on your list"]],
    ["Hi Jean, call Lansing about the Production Supervisor (1st & 2nd Shifts) job on Thu Oct 29.", "", []],
    ["Hi Jean, I sent the email to Kelly Services on Oct 27.", "", ["\"I sent\": t.ROY cannot send, save or book anything; you do that yourself"]],
    ["Hi Jean, Hydraulics pays $18.50 an hour and 62% of hires stay.", "", ["the amount \"$18.50\" is not one you gave me; pay and wages come only from you", "the rate \"62%\" is not one the query computed", "I could not match \"Hydraulics\" to anyone on your list"]],
  ];
  it("every sentence gives origin's flags", () => {
    const facts: OrgFacts = { ...withTools(employers, overview), resolvedNames: ["Valjean"] };
    assert.ok(ORIGIN.length >= 15);
    for (const [t, said, expected] of ORIGIN) assert.deepEqual(checkOrgClaimsDeterministic(t, facts, said || undefined), expected, t);
  });

  it("the tool text a projection adds is new; every field origin had is unchanged", () => {
    const { toolText, ...rest } = employers;
    assert.ok(toolText && toolText.some((t) => t.includes("Kelly 33")));
    assert.ok(!toolText!.some((t) => t === "MI"), "the state the staff member asked for is not tool text");
    assert.deepEqual(Object.keys(rest).sort(), ["facts", "labels", "names", "numbers", "phrases", "tool"]);
  });
});
