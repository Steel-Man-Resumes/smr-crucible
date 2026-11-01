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
    // 2026-10-30: a failed read lends no words, and layer 1 no longer reads employer words as people
    // on the answer path; layer 2 gets no evidence from a failed read and judges the claims.
    assert.deepEqual(checkOrgClaimsDeterministic(ANSWERS.jackson, withTools(...failed.items), "Jackson, Michigan.", answer).filter((p) => p.includes("Hydraulics")), []);
    assert.ok(checkOrgClaimsDeterministic(ANSWERS.jackson, withTools(...failed.items), "Jackson, Michigan.").includes(name("Hydraulics")), "draft path: still checked");
  });
});

describe("T1: what must still be flagged", () => {
  it("an out-of-reach person not in the tool output and not typed as a place", () => {
    const said = "Find employers in Jackson that hire people with records";
    assert.deepEqual(checkOrgClaimsDeterministic("Jackson said Michael Shaw called on Oct 27.", withTools(employers), said, answer), [name("Michael Shaw")]);
    assert.deepEqual(checkOrgClaimsDeterministic("In Jackson, Michael Shaw called on Oct 27.", withTools(employers), said, answer), [name("Michael Shaw")]);
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

describe("T1 follow-up: places typed earlier in the conversation", () => {
  // As the route builds it: staffTypedWords, the user's own messages only, newest last.
  const typed = (...m: string[]) => m.join("\n");

  it("Lansing typed two turns earlier, then a turn with no tool read: no flag", () => {
    const facts: OrgFacts = { ...LUPE, staffTyped: typed("find employers in Lansing that hire people with records", "put my tasks first on Today", "what can you do?") };
    assert.deepEqual(checkOrgClaimsDeterministic("I can run a real Lansing search if you want one, and you can press Undo.", facts, "what can you do?", answer), []);
    // 2026-10-30: a town is never read as a person on the answer path, earlier message or not.
    assert.deepEqual(checkOrgClaimsDeterministic("I can run a real Lansing search if you want one.", LUPE, "what can you do?", answer), []);
  });

  it("Michael Shaw typed earlier as a person still flags", () => {
    const facts: OrgFacts = { ...LUPE, staffTyped: typed("talk to Michael Shaw", "find employers in Lansing", "what can you do?") };
    assert.deepEqual(checkOrgClaimsDeterministic("I checked, and Michael Shaw got the job in Lansing.", facts, "what can you do?", answer), [name("Michael"), name("Shaw")]);
  });

  it("the draft path ignores earlier messages", () => {
    const facts: OrgFacts = { ...LUPE, staffTyped: "find employers in Lansing" };
    assert.deepEqual(checkOrgClaimsDeterministic("Hi Jean, try the Lansing search.", facts, ""), checkOrgClaimsDeterministic("Hi Jean, try the Lansing search.", LUPE, ""));
  });
});

describe("T1 round 2 (review S1 to S4)", () => {
  it("S1: a name in a note body or a Today reason is not loose known text", () => {
    const leaky = JSON.parse(JSON.stringify(OVERVIEW_RESULT));
    leaky.recentNotes.push({ author: "Lupe", on: "2026-10-26", body: "Rode to the job fair with Marcus Delgado from the Tuesday group; his PO Dana Whitfield says 14 people from his unit got hired. Address 1234 Main St." });
    const today = { status: "ok", readAt: "2026-10-28T20:00:00Z", asOf: "2026-10-28", items: [{ section: "tasks", firstName: "Jean", reason: "Call Rosa Quintero back about the Ogden shift", when: "2026-10-29", action: "Open" }], total: 1 };
    // 2026-10-30: Marcus Delgado is in this org but not Lupe's. A note she can read names him, so naming him
    // repeats the record (review F8/R2-3 ruling: the record wins); a claim about him is layer 2's. Someone
    // out of reach whom no record of hers names is still flagged.
    const facts: OrgFacts = { ...withTools(projectStaffToolEvidence("read_participant_overview", leaky)!, projectStaffToolEvidence("read_today_queue", today)!), outOfReachNames: ["Marcus Delgado", "Nina Okafor"] };
    assert.deepEqual(checkOrgClaimsDeterministic("Marcus Delgado also got hired at Ogden last week.", facts, "", answer), []);
    assert.ok(checkOrgClaimsDeterministic("Jean saw Nina Okafor at the fair.", facts, "", answer).includes(name("Nina Okafor")));
    assert.ok(checkOrgClaimsDeterministic("Jean saw Nina at the fair.", facts, "", answer).includes(name("Nina")));
    // People outside the organization (a PO, an employer contact) are not anyone's caseload: layer 1 leaves
    // them to layer 2 on the answer path, and the draft path still checks them.
    assert.deepEqual(checkOrgClaimsDeterministic("Jean's PO, Dana Whitfield, wants him at the Ogden shift.", facts, "", answer), []);
    const po = checkOrgClaimsDeterministic("Jean's PO, Dana Whitfield, wants him at the Ogden shift.", facts, "");
    assert.ok(po.includes(name("Dana")) && po.includes(name("Whitfield")), JSON.stringify(po));
    assert.ok(checkOrgClaimsDeterministic("Rosa Quintero said the Ogden shift is open to Jean.", facts, "").includes(name("Quintero")));
    assert.ok(checkOrgClaimsDeterministic("Of your caseload, 1234 people got hired.", facts, "", answer).includes(fig("1234")));
  });

  it("S2: a figure from listing text is never a rate", () => {
    assert.ok(checkOrgClaimsDeterministic("Your placement rate is 33%.", withTools(employers), "", answer).some((p) => p.includes('"33%"')));
    assert.deepEqual(checkOrgClaimsDeterministic("Kelly runs the Kelly 33 program.", withTools(employers), "", answer), []);
  });

  it("S3: invented counts after a month stay flagged; record words and the demo answers pass", () => {
    for (const [t, n] of [["In October 23 graduated.", "23"], ["Oct 23 hired.", "23"], ["In October 23 of your people got hired.", "23"], ["October 23 placed.", "23"], ["Oct 23 total.", "23"], ["Oct 27 interviews.", "27"]] as const) {
      assert.deepEqual(checkOrgClaimsDeterministic(t, LUPE, "", answer), [fig(n)], t);
    }
    for (const t of ["Your Oct 27 note says he has not confirmed.", "Your Oct 27 interview at STS is on file.", "Oct 27 Jean called."]) {
      assert.deepEqual(checkOrgClaimsDeterministic(t, LUPE, "", answer), [], t);
    }
  });

  it("S4: OK, HI and ME are not states; an earlier question about a name is not a place", () => {
    assert.deepEqual([...typedPlaceWords("Michael Shaw, OK?")], []);
    assert.deepEqual([...typedPlaceWords("Michael Shaw, ME")], []);
    assert.deepEqual([...typedPlaceWords("Lansing, Michigan")], ["lansing"]);
    const facts: OrgFacts = { ...LUPE, staffTyped: "any news in Michael Shaw?\nwhat can you do?" };
    assert.deepEqual(checkOrgClaimsDeterministic("I checked, and Michael Shaw got the job.", facts, "what can you do?", answer), [name("Michael"), name("Shaw")]);
    assert.deepEqual(checkOrgClaimsDeterministic("I found Michael Shaw on your list; he was hired.", { ...LUPE, staffTyped: "talk to Michael Shaw, OK?" }, "", answer), [name("Michael"), name("Shaw")]);
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
    // orgText (2026-10-30) is the second new field: organization names a participant draft may repeat.
    const { toolText, orgText, ...rest } = employers;
    assert.ok(orgText && orgText.includes("Eaton Corporation") && !orgText.some((t) => t.includes("Kelly 33")), JSON.stringify(orgText));
    assert.ok(toolText && toolText.some((t) => t.includes("Kelly 33")));
    assert.ok(!toolText!.some((t) => t === "MI"), "the state the staff member asked for is not tool text");
    assert.deepEqual(Object.keys(rest).sort(), ["facts", "labels", "names", "numbers", "phrases", "tool"]);
  });
});
