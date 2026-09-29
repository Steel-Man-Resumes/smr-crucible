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
  itemClaimsMoreThanGiven,
  stripOverstatedCredentialLines,
  stripOverstatedCredentials,
  stripOverstatedCredentialsDeep,
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

  it("claiming one the person never mentioned is caught", () =>
    assert.equal(claimsMoreThanGiven("Your OSHA 10 card shows you know the safety basics.", none), true));
  it("advice to get one the person never mentioned is kept", () =>
    assert.equal(claimsMoreThanGiven("Get your OSHA 10 card online for about $60.", none), false));
  it("an invented forklift certification is caught", () =>
    assert.equal(claimsMoreThanGiven("You are a certified forklift operator.", credentialStatuses("Forklift operator, 2019 - 2021")), true));
});

describe("sweeping text, resume lines and the report object", () => {
  it("removes only the overstated sentence and keeps line breaks", () => {
    const letter = "I finished the EPA 608 course.\n\nMy EPA 608 certification covers refrigerants. I like fixing things.";
    const r = stripOverstatedCredentials(letter, courseOnly);
    assert.equal(r.removed.length, 1);
    assert.equal(r.text, "I finished the EPA 608 course.\n\nI like fixing things.");
  });

  it("drops a resume certification line whole and leaves the rest", () => {
    const resume = "CERTIFICATIONS\n- EPA 608 Certification, Type I and II (2026)\n- OSHA 10 General Industry (2021)";
    const r = stripOverstatedCredentialLines(resume, courseOnly);
    assert.deepEqual(r.removed, ["- EPA 608 Certification, Type I and II (2026)"]);
    assert.equal(r.text, "CERTIFICATIONS\n- OSHA 10 General Industry (2021)");
  });

  it("drops a skill named as the claim and an emptied next step, never a career path", () => {
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
    const r = stripOverstatedCredentialsDeep(report, courseOnly);
    assert.equal(r.removed.length, 2);
    assert.deepEqual(r.value.skills.map((s) => s.name), ["Grill station"]);
    assert.equal(r.value.career_paths.length, 1);
    assert.equal(r.value.career_paths[0].title, "Certified HVAC Helper");
    assert.deepEqual(r.value.career_paths[0].next_steps, ["Call the Job Center Monday."]);
  });

  it("changes nothing when no credential is involved", () => {
    const report = { summary: "Line cook with nine years on the grill.", skills: [{ name: "Grill station" }] };
    const r = stripOverstatedCredentialsDeep(report, none);
    assert.equal(r.removed.length, 0);
    assert.deepEqual(r.value, report);
  });
});
