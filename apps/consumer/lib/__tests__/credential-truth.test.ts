/**
 * Credentials say exactly what the person said, tested with real report lines.
 *
 * The overstated sentences below were written by the report for two sample
 * people: one who finished an EPA 608 course (never said he passed the exam),
 * one whose forklift certification had expired. Each must be caught. The
 * honest versions, and true lines about credentials people really hold, must
 * be kept: deleting a true line is the worse mistake.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  claimsMoreThanGiven,
  credentialStatuses,
  findOverstatedCredentialLines,
  findOverstatedCredentials,
  findOverstatedCredentialsDeep,
  itemClaimsMoreThanGiven,
} from "../credential-truth";

const courseOnly = credentialStatuses(
  "EPA 608 Type I and II course, Metro Community College, finished 2026\nI finished the EPA 608 class and I want an HVAC helper job."
);
const expired = credentialStatuses("Forklift operator, Midwest Pallet Supply, 2013 - 2018\nForklift certified 2013 (expired)");
const none = credentialStatuses("Line cook, Harbor Street Grill, 2019 - present");

describe("reading status from the person's own words", () => {
  it("a finished course is a course", () => assert.equal(courseOnly.get("EPA 608"), "course"));
  it("certified but expired is not current", () => assert.equal(expired.get("forklift"), "not_current"));
  it("Class A CDL is a license, not a class", () => assert.equal(credentialStatuses("Class A CDL, 2019").get("CDL"), "held"));
  it("CDL Class A is held too", () => assert.equal(credentialStatuses("CDL Class A with tanker endorsement").get("CDL"), "held"));
  it("a training card is held", () => assert.equal(credentialStatuses("OSHA 10 training card, 2021").get("OSHA 10"), "held"));
  it("a listed credential with a year is held", () => assert.equal(credentialStatuses("OSHA 10 General Industry certificate, 2021").get("OSHA 10"), "held"));
  it("a suspended license is not current", () => assert.equal(credentialStatuses("CDL suspended in 2022").get("CDL"), "not_current"));
  it("wanting one is not having it", () => assert.equal(credentialStatuses("I want to get my CDL").get("CDL"), "wanted"));
  it("renewed after it expired is held", () =>
    assert.equal(credentialStatuses("Forklift certified 2013 (expired)\nRenewed forklift certification 2025").get("forklift"), "held"));
  it("a certification course is still a course", () =>
    assert.equal(credentialStatuses("EPA 608 certification course, finished 2026").get("EPA 608"), "course"));
  it("one credential's course word does not taint another on the same line", () => {
    const s = credentialStatuses("OSHA 10 card, forklift training in progress");
    assert.equal(s.get("OSHA 10"), "held");
    assert.equal(s.get("forklift"), "course");
  });
});

describe("a finished course is not a certification", () => {
  const overstated = [
    "Your EPA 608 certification directly covers refrigerant handling, which is the core skill.",
    "Tell them you have EPA 608 and want HVAC.",
    "Contact restaurant equipment supply and service companies directly and explain you cooked for years and hold EPA 608.",
    "Keep your EPA 608 Type I and II certification documentation ready to show employers.",
    "You finished the EPA 608 Type I and II course, which is exactly the certification employers look for.",
    "Put your EPA 608 Type I and II at the top of your resume.",
    "Your EPA 608 sets you apart from other applicants.",
    "Highlight your EPA 608, your cooler inventory and repair work.",
    "It uses your kitchen knowledge and your EPA 608 at the same time.",
    "Your EPA 608 and hands-on repair history make you a legitimate candidate.",
    "Tell them you have EPA 608 and get an interview.",
  ];
  for (const s of overstated) it(`caught: ${s.slice(0, 60)}`, () => assert.equal(claimsMoreThanGiven(s, courseOnly), true));

  it("a skill named as the certification is caught", () =>
    assert.equal(itemClaimsMoreThanGiven("EPA 608 Certification (Type I and II) - HVAC Refrigerant Handling", courseOnly), true));

  const honest = [
    "You finished the EPA 608 Type I and II course.",
    "You finished the EPA 608 certification course.",
    "Your EPA 608 training shows you can learn the trade.",
    "Take the EPA 608 exam to get certified.",
    "Some employers pay for or reimburse your EPA 608 test fee.",
    "The EPA 608 certification requires passing a proctored exam.",
    "Once you pass the exam, your EPA 608 certification will open doors.",
  ];
  for (const s of honest) it(`kept: ${s.slice(0, 60)}`, () => assert.equal(claimsMoreThanGiven(s, courseOnly), false));
});

describe("an expired credential stays expired", () => {
  for (const s of [
    "Say clearly that you are certified experience and want forklift placements.",
    "Forklift Certification (renewable, previously certified)",
    "My forklift certification is renewable, and I am ready to renew it.",
  ]) it(`caught: ${s.slice(0, 60)}`, () => assert.equal(claimsMoreThanGiven(s, expired), true));

  for (const s of [
    "Your forklift certification expired in 2013.",
    "Many employers provide forklift certification on site.",
    "Renewing your forklift certification is a quick step.",
    "I drove forklifts for five years with no accidents.",
    "You have forklift experience from five years at Midwest Pallet.",
  ]) it(`kept: ${s.slice(0, 60)}`, () => assert.equal(claimsMoreThanGiven(s, expired), false));

  const suspended = credentialStatuses("CDL suspended in 2022");
  it("a suspended license cannot be called active", () =>
    assert.equal(claimsMoreThanGiven("Your CDL is active, so apply for driving jobs now.", suspended), true));
  it("saying it was suspended is kept", () =>
    assert.equal(claimsMoreThanGiven("Your CDL was suspended, so reinstatement is the next step.", suspended), false));
});

describe("held, wanted and never mentioned", () => {
  const held = credentialStatuses("Class A CDL, 2019\nOSHA 10 training card, 2021");
  it("a held license can be claimed", () => assert.equal(claimsMoreThanGiven("Your Class A CDL opens doors in freight.", held), false));
  it("a held card can be claimed", () => assert.equal(claimsMoreThanGiven("Your OSHA 10 card shows you know the safety basics.", held), false));

  const wanted = credentialStatuses("I want to get my CDL");
  it("wanting a CDL is not having one", () => assert.equal(claimsMoreThanGiven("You have a CDL, so driving jobs are open to you.", wanted), true));
  it("advice to get it is kept", () => assert.equal(claimsMoreThanGiven("Get your CDL through a trucking school.", wanted), false));

  it("a credential the person never mentioned is left to the truth check", () =>
    assert.equal(claimsMoreThanGiven("Your OSHA 10 card shows you know the safety basics.", none), false));
  it("advice to get one the person never mentioned is kept", () =>
    assert.equal(claimsMoreThanGiven("Get your OSHA 10 card online for about $60.", none), false));
  it("a skill word with no certification status is left to the truth check", () =>
    assert.equal(claimsMoreThanGiven("You are a certified forklift operator.", credentialStatuses("Forklift operator, 2019 - 2021")), false));
});

describe("held credentials read as held (review cases)", () => {
  it("OSHA 10 training is the card", () => assert.equal(credentialStatuses("Completed OSHA 10 training in 2021").get("OSHA 10"), "held"));
  it("10-hour OSHA is OSHA 10", () => assert.equal(credentialStatuses("10 hour OSHA, 2021").get("OSHA 10"), "held"));
  it("CPR class is the card", () => assert.equal(credentialStatuses("CPR and first aid class, 2024").get("CPR"), "held"));
  it("never lost is not lost", () => assert.equal(credentialStatuses("Class A CDL, never had it suspended").get("CDL"), "held"));
  it("a bare 'lost' is not a status", () => assert.equal(credentialStatuses("Lost my job but kept my CDL").get("CDL"), "held"));
  it("got it back is held", () => assert.equal(credentialStatuses("CDL was suspended in 2019, got it back in 2023").get("CDL"), "held"));
  it("a line under a certifications heading is held", () =>
    assert.equal(credentialStatuses("CERTIFICATIONS\nForklift\nFlagger").get("forklift"), "held"));
  it("a forklift cert is held", () => assert.equal(credentialStatuses("Forklift cert through Goodwill, 2022").get("forklift"), "held"));
  it("ServSafe Food Handler is one credential", () => {
    const s = credentialStatuses("ServSafe Food Handler, 2023");
    assert.equal(s.get("ServSafe"), "held");
    assert.equal(s.get("food handler"), undefined);
  });
  it("'no accidents' does not make a CDL wanted", () => assert.equal(credentialStatuses("CDL driver, no accidents in six years").get("CDL"), "held"));
  it("'no CDL' is not having one", () => assert.equal(credentialStatuses("No CDL yet").get("CDL"), "wanted"));
  it("welders count as welding", () => assert.equal(credentialStatuses("Took a welding class at the college").get("welding"), "course"));

  const held = credentialStatuses("OSHA 10 training, 2021\nServSafe Food Handler, 2023");
  it("a held completion card is never flagged", () =>
    assert.deepEqual(findOverstatedCredentials("Your OSHA 10 card and ServSafe Food Handler certification help.", held), []));
});

describe("'you are certified' has to be about the credential", () => {
  it("certified in something else next to a course credential is kept", () =>
    assert.equal(claimsMoreThanGiven("You are certified in CPR, and you finished the EPA 608 Type I and II course last spring.", courseOnly), false));
  it("certified right next to the course credential is caught", () =>
    assert.equal(claimsMoreThanGiven("You are certified for EPA 608 refrigerant work.", courseOnly), true));
});

describe("finding claims to check (nothing is removed)", () => {
  it("finds the overstated sentence in a letter", () => {
    const letter = "I finished the EPA 608 course.\n\nMy EPA 608 certification covers refrigerants. I like fixing things.";
    assert.deepEqual(findOverstatedCredentials(letter, courseOnly), ["My EPA 608 certification covers refrigerants."]);
  });

  it("finds a resume certification line and skips job header lines", () => {
    const resume = [
      "LINE COOK | Harbor Street Grill | 2019 - Present",
      "CERTIFICATIONS",
      "- EPA 608 Certification, Type I and II (2026)",
      "- OSHA 10 General Industry (2021)",
    ].join("\n");
    assert.deepEqual(findOverstatedCredentialLines(resume, courseOnly), ["- EPA 608 Certification, Type I and II (2026)"]);
  });

  it("finds a skill named as the claim and a next step, never a career-path title", () => {
    const report = {
      skills: [{ name: "EPA 608 Certification (Type I and II)", category: "hard" }, { name: "Grill station", category: "hard" }],
      career_paths: [
        {
          title: "Certified HVAC Helper",
          match_reason: "You finished the EPA 608 course.",
          next_steps: ["Tell them you have EPA 608 and want HVAC.", "Call the Job Center Monday."],
        },
      ],
    };
    assert.deepEqual(findOverstatedCredentialsDeep(report, courseOnly), [
      "EPA 608 Certification (Type I and II)",
      "Tell them you have EPA 608 and want HVAC.",
    ]);
  });

  it("finds nothing when no credential is involved", () => {
    const report = { summary: "Line cook with nine years on the grill.", skills: [{ name: "Grill station" }] };
    assert.deepEqual(findOverstatedCredentialsDeep(report, none), []);
  });
});
