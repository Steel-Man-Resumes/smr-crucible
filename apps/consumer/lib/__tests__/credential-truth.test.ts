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
    "My forklift certification is renewable, and I am ready to renew it.",
  ]) it(`caught: ${s.slice(0, 60)}`, () => assert.equal(claimsMoreThanGiven(s, expired), true));
  it("caught as a resume item: Forklift Certification (renewable, previously certified)", () =>
    assert.equal(itemClaimsMoreThanGiven("Forklift Certification (renewable, previously certified)", expired), true));

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

describe("second review: held credentials are not flagged", () => {
  const flags = (src: string, text: string) => claimsMoreThanGiven(text, credentialStatuses(src));
  it("wanting a renewal is not a renewal", () =>
    assert.equal(flags("Forklift certification expired in 2020, need to get it renewed", "Your forklift certification is current and renewable."), true));
  it("trying to get it reinstated is not reinstated", () =>
    assert.equal(credentialStatuses("CDL suspended in 2019, trying to get it reinstated").get("CDL"), "not_current"));
  it("a valid CDL beats an old revocation", () =>
    assert.equal(flags("Valid Class A CDL\n\nCDL was revoked in 2014 because of my conviction", "Your CDL is a real asset for driving jobs."), false));
  it("suspended then now valid", () => assert.equal(flags("CDL suspended 2019 to 2021, now valid", "Your CDL is a real asset."), false));
  it("reinstated on the next line", () =>
    assert.equal(flags("Class A CDL (suspended 2019-2021)\nReinstated in 2022", "Your CDL is a real asset."), false));
  it("another credential's expiry does not touch this one", () =>
    assert.equal(flags("I have my forklift cert but my CDL expired", "Your forklift certification makes warehouse work a good fit."), false));
  it("certified and OSHA 10 expired", () =>
    assert.equal(credentialStatuses("Forklift certified and OSHA 10 expired in 2020").get("forklift"), "held"));
  it("on the state registry is held", () =>
    assert.equal(flags("Completed CNA program, on the state registry", "Your CNA certification opens doors in home health."), false));
  it("passed on the same line is held", () =>
    assert.equal(flags("ServSafe Manager training and exam, passed 2023", "Your ServSafe certification helps."), false));
  it("a finished NCCER program is the credential", () =>
    assert.equal(flags("Completed NCCER Level 1 carpentry program inside", "Your NCCER Level 1 carpentry credential shows real training."), false));
  it("AWS certified welder on the same line", () =>
    assert.equal(flags("Completed welding program at MATC, 2021, AWS certified", "You are a certified welder with MATC training behind you."), false));
  for (const src of [
    "I need my CDL for the job I have",
    "Hoping my CDL gets me a local route",
    "I'm going to keep my CDL current",
    "Drove for Werner 8 years, no CDL violations",
  ]) it(`not wanted: ${src}`, () => assert.notEqual(credentialStatuses(src).get("CDL"), "wanted"));
  it("needs my forklift cert is not wanted", () =>
    assert.notEqual(credentialStatuses("Looking for work that needs my forklift cert").get("forklift"), "wanted"));
  it("I want to get my CDL is still wanted", () => assert.equal(credentialStatuses("I want to get my CDL").get("CDL"), "wanted"));
  it("I want a CDL is wanted", () => assert.equal(credentialStatuses("I want a CDL someday").get("CDL"), "wanted"));
  it("an all-caps item under a heading stays under it", () =>
    assert.equal(credentialStatuses("CERTIFICATIONS\nWELDING\nFORKLIFT\n\nTook a welding class at MATC in 2019").get("welding"), "held"));
  for (const h of ["LICENSES/CERTIFICATIONS", "Training & Certifications", "Licenses and Certifications"]) {
    it(`heading: ${h}`, () => assert.equal(credentialStatuses(`${h}\nWelding\n\nTook a welding class in 2019`).get("welding"), "held"));
  }
  it("inline heading", () => assert.equal(credentialStatuses("Certifications: Welding, Forklift\nTook a welding class in 2019").get("welding"), "held"));
  it("certified in one thing and took a course in another", () =>
    assert.equal(flags("Forklift certified 2020\nTook the EPA 608 course at MATC", "You're forklift certified and took the EPA 608 course last spring."), false));
});

describe("'certified' with its own object", () => {
  it("certified in food safety, then a course credential, is kept", () =>
    assert.equal(claimsMoreThanGiven("You are certified in food safety and finished the EPA 608 course.", courseOnly), false));
});

describe("third pass: any sign of holding it wins", () => {
  const flags = (src: string, text: string) => claimsMoreThanGiven(text, credentialStatuses(src));
  const asset = "Your CDL is a real asset for driving jobs.";
  for (const src of [
    "My CDL was suspended for 2 years after my OWI, reinstated in 2020",
    "CDL suspended for DUI in 2015, got it back in 2018",
    "CDL revoked for 3 years, reinstated 2022",
    "My CDL got suspended when I was locked up, reinstated 2023",
    "CDL was suspended for unpaid tickets, it's valid now",
    "Class A CDL\nOTR driver, Werner, 2016 - present\n\nMy CDL was suspended for a year in 2012 after a DUI.",
    "Class A CDL, current\n\nMy CDL was suspended in 2012 after my OWI.",
    "Class A CDL (valid through 2027)\n\nCDL was revoked in 2014 because of my conviction",
    "CDL - active\n\nCDL suspended in 2014",
    "Got my CDL in 2016 and drove for Werner since\n\nCDL was suspended in 2012",
    "Class A CDL, 2016 - present\nCDL suspended for 18 months in 2012",
    "Went through CDL training at Roehl for 4 weeks, passed the road test",
    "CDL training at Roehl for 3 weeks, got my license",
    "I'm trying to get a CDL job close to home",
    "I want to get a CDL A job with home time",
    "I want to start using my CDL again",
    "A lot of jobs want a CDL, which I have",
    "Hoping to get my CDL job back at Werner",
    "I need to take my CDL physical again next month",
    "Drove for Werner 8 years, no CDL or DOT violations",
    "Without my CDL, I'd be stuck in warehouse work",
  ]) it(`held: ${src.slice(0, 50)}`, () => assert.equal(flags(src, asset), false));

  for (const [src, text] of [
    ["EPA 608 prep course, passed the Universal exam", "Your EPA 608 certification opens HVAC doors."],
    ["Completed the CNA program and sat for the state exam, passed", "Your CNA certification opens doors in home health."],
    ["ServSafe class for my job at Culver's, passed the exam", "Your ServSafe certification helps."],
    ["Welding program at MATC for 2 years, AWS certified", "You are a certified welder with MATC training behind you."],
    ["Took CNA classes when I was locked up and passed the state test", "Your CNA certification opens doors."],
    ["Took the CNA class to get certified and passed in 2021", "Your CNA certification opens doors."],
    ["Experience as a certified welder for 6 years\nTook a welding class at MATC in 2019", "You are a certified welder."],
  ] as const) it(`held: ${src.slice(0, 50)}`, () => assert.equal(flags(src, text), false));

  const cprHeld = credentialStatuses("CPR and first aid card, 2024\nEPA 608 Type I and II course, finished 2026");
  for (const s of [
    "Along with the EPA 608 course you are certified in CPR and first aid.",
    "With the EPA 608 course done you are also certified in CPR.",
  ]) it(`kept: ${s.slice(0, 50)}`, () => assert.equal(claimsMoreThanGiven(s, cprHeld), false));
  it("kept: You're OSHA certified with the EPA 608 course behind you.", () =>
    assert.equal(claimsMoreThanGiven("You're OSHA certified with the EPA 608 course behind you.", credentialStatuses("OSHA 10 card, 2021\nEPA 608 course, 2026")), false));

  it("a long line of spaces is quick", () => {
    const t = Date.now();
    credentialStatuses("experience" + " ".repeat(50000) + "x, CDL");
    assert.ok(Date.now() - t < 200);
  });

  // Still caught: the cases the check exists for.
  it("still caught: expired and nothing current", () =>
    assert.equal(flags("Forklift operator, 2013 - 2018\nForklift certified 2013 (expired)", "Your forklift certification is current."), true));
  it("still caught: course only", () =>
    assert.equal(flags("EPA 608 Type I and II course, finished 2026", "Tell them you have EPA 608 and want HVAC."), true));
  it("still caught: suspended, only wanting it back", () =>
    assert.equal(flags("CDL suspended in 2019, trying to get it reinstated", "Your CDL is active, so apply now."), true));
  it("still caught: wanted", () => assert.equal(flags("I want to get my CDL", "You hold a CDL."), true));
});
