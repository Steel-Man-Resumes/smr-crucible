import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { checkOrgClaimsDeterministic, conversationWords, type OrgFacts } from "../org-output-verify";

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
    "Eaton Corporation in Jackson runs Hydraulics and Aerospace plants, and Kelly Services runs a second-chance program.",
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
    // A person whose name the staff member typed is checked only by the words they typed, the same for a
    // real person and an unknown one, so the flag never tells anyone who is enrolled (review F1).
    assert.deepEqual(check("Jean starts Monday, and Jackson starts Tuesday.", "how is tom doing"), []);
    assert.deepEqual(check("Jean starts Monday, and Tom starts Tuesday.", "how is tom doing"), [name("Tom")]);
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
    assert.deepEqual(check("Ceci Ayala isn't on your list, but Ceci Ayala got the job.", "how is ceci ayala doing"), [name("Ceci"), name("Ayala")]);
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

describe("review round 1 findings (2026-10-30)", () => {
  const f = (out: string[]): OrgFacts => ({ ...LUPE, outOfReachNames: out });
  it("F1: a typed name gets the same result whether or not the person exists", () => {
    const real = check("Sorry, but a Ceci Ayala is someone I can't speak to.", "how is Ceci Ayala doing");
    const fake = check("Sorry, but a Zelda Quark is someone I can't speak to.", "how is Zelda Quark doing", f([]));
    assert.deepEqual(real.map((p) => p.replace(/Ceci|Ayala/, "X")), fake.map((p) => p.replace(/Zelda|Quark/, "X")));
    assert.equal(real.length, 2);
    // and the honest no-match wording passes for both
    assert.deepEqual(check("I don't have a Ceci Ayala among the people I can see.", "how is Ceci Ayala doing"), []);
    assert.deepEqual(check("I don't have a Zelda Quark among the people I can see.", "how is Zelda Quark doing", f([])), []);
  });
  it("F2: middle names", () => {
    assert.deepEqual(check("Good news, Circe Ayala got hired at Meijer.", "", f(["Circe Ayala Solano"])), [name("Circe Ayala")]);
  });
  it("F3: accented and hyphenated names", () => {
    assert.deepEqual(check("Yesterday José got hired.", "", f(["José Ruiz"])), [name("José")]);
    assert.deepEqual(check("Remember that Mary-Jane started at Goodwill.", "", f(["Mary-Jane Cole"])), [name("Mary"), name("Jane")]);
  });
  it("F4: a first name that is a state name", () => {
    assert.deepEqual(check("Good news: Georgia Smith got hired.", "", f(["Georgia Smith"])), [name("Georgia Smith")]);
  });
  it("F6: case-sensitive, so ordinary words are not a name", () => {
    assert.deepEqual(check("I will hunt for listings in Flint.", "", f(["Will Hunt"])), []);
  });
  it("F8: a name the record shows this viewer is repeating the record", () => {
    const withRecord: OrgFacts = { ...LUPE, staffToolEvidence: [{ tool: "read_participant_overview", facts: {}, numbers: [], names: [], labels: [], phrases: [], toolText: ["Jean was referred by Ceci Ayala"] } as never] };
    assert.deepEqual(check("Jean was referred by Ceci Ayala last month.", "", withRecord), []);
  });
  it("F9: no raw newline inside a flag", () => {
    const out = check("Update:\nCeci\nAyala got the job.");
    assert.ok(out.every((p) => !p.includes("\n")), JSON.stringify(out));
  });
});

describe("review round 2 findings (2026-10-30)", () => {
  const f = (extra: Partial<OrgFacts>): OrgFacts => ({ ...LUPE, ...extra });
  it("R2-1: a name anywhere in the conversation is never answered differently for a real and an invented person", () => {
    const longAgo = conversationWords([{ role: "user", content: "x".repeat(9000) }, { role: "user", content: "how is Ceci Ayala doing" }, { role: "assistant", content: "..." }]);
    const fakeAgo = conversationWords([{ role: "user", content: "x".repeat(9000) }, { role: "user", content: "how is Zelda Quark doing" }]);
    assert.deepEqual(check("Ceci Ayala got hired at Meijer.", "say that name again", f({ conversationWords: longAgo })), []);
    assert.deepEqual(check("Zelda Quark got hired at Meijer.", "say that name again", f({ outOfReachNames: [], conversationWords: fakeAgo })), []);
    for (const disguised of ["C-e-c-i A-y-a-l-a", "Ce​ci Ay​ala", "Ceci Ayala".normalize("NFD")]) {
      assert.deepEqual(check("Ceci Ayala got hired at Meijer.", "", f({ conversationWords: conversationWords([{ role: "user", content: disguised }]) })), [], disguised);
    }
  });
  it("R2-2: typing the first name of someone in reach does not switch off an out-of-reach namesake", () => {
    const g = f({ visibleNames: ["Jean", "Marqus", "Tom"] });
    assert.deepEqual(check("Good news, Tom Jackson got hired.", "how is Tom doing", g), [name("Tom Jackson")]);
  });
  it("R2-3: the record must show the whole name, not its words scattered", () => {
    const g = f({ staffToolEvidence: [{ tool: "find_employers", facts: {}, numbers: [], names: [], labels: [], phrases: [], toolText: ["Jackson MI. Ayala Staffing. Relly Foods."] } as never] });
    assert.deepEqual(check("Good news, Ceci Ayala got hired.", "", g), [name("Ceci Ayala")]);
  });
  it("R2-4: a first name that is a place by what follows it is not a person", () => {
    const g = f({ outOfReachNames: ["Georgia Smith", "Chase Brown", "Lincoln Hale"] });
    for (const t of ["Your organization is in Georgia.", "Chase Bank has second chance accounts.", "Try the office in Lincoln County.", "There is one in Austin, TX."]) assert.deepEqual(check(t, "", g), [], t);
    assert.deepEqual(check("You could ask Chase about it.", "", g), [name("Chase")]);
  });
  it("R2-5: two-letter words are not names", () => {
    assert.deepEqual(check("You could ask Dr Lee at the clinic.", "is Dr Lee still there", f({ outOfReachNames: [] })), [name("Lee")]);
  });
  it("R2-6: a full name in capitals and a name with an inner capital", () => {
    assert.deepEqual(check("UPDATE: CECI AYALA GOT HIRED."), [name("CECI AYALA")]);
    assert.deepEqual(check("You could also ask DeShawn.", "", f({ outOfReachNames: ["DeShawn Price"] })), [name("DeShawn")]);
  });
});

describe("harness ROOM-11 (2026-10-30): a check-in draft may name the participant's own saved employer", () => {
  it("company words from this turn's read pass on the draft path, free text and job titles do not", async () => {
    const { projectStaffToolEvidence } = await import("../staff-tool-evidence");
    const ev = projectStaffToolEvidence("read_participant_overview", {
      status: "ok", person: { firstName: "Marqus" },
      applications: [{ jobTitle: "Forklift crew, Marcus Jones", company: "Market Square Distribution (fictional)", status: "saved" }],
      recentNotes: [{ kind: "call", on: "2026-10-01", author: "Lupe", body: "Tasha from the shelter called." }],
    })!;
    const f: OrgFacts = { ...LUPE, staffToolEvidence: [ev] };
    assert.deepEqual(checkOrgClaimsDeterministic("Hi Marqus, I saw you saved two jobs at Market Square Distribution.", f, ""), []);
    const bad = checkOrgClaimsDeterministic("Hi Marqus, Marcus and Tasha asked about you.", f, "");
    assert.ok(bad.includes(name("Marcus")) && bad.includes(name("Tasha")), JSON.stringify(bad));
  });
  it("a character count is not a figure", () => {
    assert.deepEqual(check("Text message (under 320 characters): Hi Jean, checking in."), []);
  });
});

describe("review round 3 findings (2026-10-30)", () => {
  const g = (extra: Partial<OrgFacts>): OrgFacts => ({ ...LUPE, visibleNames: ["Jean", "Marqus", "Michael", "Thomas"], ...extra });
  it("R3-1: a full name built only from in-reach words gives the same result for a real and an invented person", () => {
    const real = check("Michael Thomas got hired at Meijer.", "how is Michael Thomas doing", g({ outOfReachNames: ["Michael Thomas"] }));
    const fake = check("Marqus Thomas got hired at Meijer.", "how is Marqus Thomas doing", g({ outOfReachNames: [] }));
    assert.deepEqual(real, []);
    assert.deepEqual(fake, []);
    // "Tom" said alone, the model writing the out-of-reach Tom Jackson, is still caught.
    assert.deepEqual(check("Good news, Tom Jackson got hired.", "how is Tom doing", g({ visibleNames: ["Jean", "Tom"] })), [name("Tom Jackson")]);
  });
  it("R3-2: a name only in a message's parts or tool results still counts as said", () => {
    const words = conversationWords([{ role: "user", content: "hi", parts: [{ type: "text", text: "how is Ceci Ayala doing" }] }, { role: "assistant", toolInvocations: [{ result: { note: "Ceci Ayala" } }] }]);
    assert.ok(words.includes("ceci") && words.includes("ayala"), JSON.stringify(words));
  });
  // Accepted: ", ID" is Idaho as written ("Ceci, ID in hand" is not flagged); a real code is a real place.
  it("R3-3: a comma and two capitals is not always a state", () => {
    for (const t of ["Tell Ceci, HR needs her form.", "Ask Ceci, OK?", "Ceci, RSVP by Friday."]) assert.ok(check(t).includes(name("Ceci")), t);
    assert.deepEqual(check("There is help in Jackson, MI, and in Ceci, MI too.", "", f2(["Ceci Ayala"])), []);
  });
  it("R3-5: a flag quotes the answer's own spelling", () => {
    assert.deepEqual(check("Good news, José Ruiz got hired.", "", f2(["Jose Ruiz"])), [name("José Ruiz")]);
    assert.deepEqual(check("Good news, Ana O’Brien got hired.", "", f2(["Ana O'Brien"])), [name("Ana O’Brien")]);
  });
  function f2(out: string[]): OrgFacts { return { ...LUPE, outOfReachNames: out }; }
});

describe("review round 4 findings (2026-10-30)", () => {
  const f3 = (out: string[], extra: Partial<OrgFacts> = {}): OrgFacts => ({ ...LUPE, outOfReachNames: out, ...extra });
  it("R4-3: the newest messages always count, however long the session", () => {
    const filler = Array.from({ length: 400 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: "x".repeat(1400), toolInvocations: [{ result: { a: { b: { c: { d: { e: { f: { g: { h: { i: { j: "deep" } } } } } } } } } } }] }));
    const words = conversationWords([...filler, { role: "assistant", content: "Earlier you asked about Ceci Ayala." }]);
    assert.ok(words.includes("ceci") && words.includes("deep"));
  });
  it("R4-4: apostrophe first names are one name and still checked", () => {
    assert.deepEqual(check("Good news, D'Andre got hired.", "", f3(["D'Andre Price"])), [name("D'Andre")]);
    assert.deepEqual(check("Good news, Ja’Mya got hired.", "", f3(["Ja'Mya Bell"])), [name("Ja’Mya")]);
    assert.deepEqual(check("It's here, and that's fine.", "", f3(["D'Andre Price"])), []);
  });
  it("R4-5: an org name is a phrase on the draft path, never loose words", () => {
    const ev = { tool: "read_participant_overview", facts: {}, numbers: [], names: [], labels: [], phrases: [], orgText: ["Ceci Ayala Cleaning LLC", "Market Square Distribution (fictional)"] } as never;
    const g = f3([], { staffToolEvidence: [ev] });
    assert.deepEqual(checkOrgClaimsDeterministic("Hi Marqus, Ceci Ayala Cleaning has a shift, and so does Market Square Distribution.", g, ""), []);
    const bad = checkOrgClaimsDeterministic("Hi Marqus, Ceci Ayala called about you.", g, "");
    assert.ok(bad.includes(name("Ceci")) && bad.includes(name("Ayala")), JSON.stringify(bad));
  });
  it("R4-6: a count before characters or words is a figure unless it is a limit", () => {
    assert.ok(check("17 characters on your caseload got hired.").some((p) => p.includes('"17"')));
    assert.deepEqual(check("Keep it under 50 words, and the text is a 160-character limit, 320 characters at most."), []);
  });
  it("R4-7: a state name followed by another capitalized word is an organization", () => {
    assert.ok(check("Good news, Ceci, Michigan Works can help.").includes(name("Ceci")));
    assert.deepEqual(check("There is help near Ceci, MI and Jackson, Michigan."), []);
  });
});

describe("review round 5 findings (2026-10-30)", () => {
  it("R5-3: a padded id never pushes older names out", () => {
    const words = conversationWords([{ role: "user", content: "how is Ceci Ayala doing" }, { role: "assistant", id: "x".repeat(2_100_000), content: "ok" }]);
    assert.ok(words.includes("ceci"));
  });
  it("R5-5: 'about N words' is a figure", () => {
    assert.ok(check("Your caseload has about 17 words.").some((p) => p.includes('"17"')));
  });
  it("R5-6: other apostrophe marks keep a name whole", () => {
    const g: OrgFacts = { ...LUPE, outOfReachNames: ["D'Andre Price"] };
    assert.deepEqual(check("Good news, DʼAndre got hired.", "", g), [name("DʼAndre")]);
    assert.deepEqual(check("Good news, D`Andre got hired.", "", g), [name("D`Andre")]);
  });
});

describe("staff prompt review (2026-10-30): crisis lines and years are not figures", () => {
  it("B1: 911, 988, 211 as help lines pass; as counts they are figures", () => {
    for (const t of ["Follow your organization's safety protocol first. If anyone is in danger now, call 911. For a mental health crisis, call or text 988. For local help, dial 211.", "Call 988 (call or text) or call 911 if it is an emergency.", "Jean can text 988 any time."]) assert.deepEqual(check(t), [], t);
    assert.ok(check("This year 211 people were served.").some((p) => p.includes('"211"')));
  });
  it("F8: a year after a time word is a date", () => {
    for (const t of ["In 2026 the team grew.", "Since 2024, Jean has worked nights.", "This covers FY 2026.", "From 2025 to 2026 the program ran twice."]) assert.deepEqual(check(t), [], t);
    assert.ok(check("2026 people got hired.").some((p) => p.includes('"2026"')));
  });
});

describe("review round 10 findings (2026-10-30)", () => {
  const fig = (n: string) => `the figure "${n}" is not one of this caseload's numbers`;
  it("N10-1: a help line followed by a count is a count", () => {
    for (const [t, n] of [["Text 211 participants about Friday.", "211"], ["Call 988 clients this week.", "988"], ["You could call 911 people today.", "911"], ["Call or text 211 of your participants.", "211"]] as const) assert.ok(check(t).includes(fig(n)), t);
  });
  it("N10-2: a year followed by a count noun, or a short range end, is a count", () => {
    for (const [t, n] of [["For 2026 participants we have a plan.", "2026"], ["By 2030 hires the program doubles.", "2030"], ["Of 2049 applicants, 12 were hired.", "2049"], ["Placements grew from 2025 to 40 this year.", "40"], ["Hires went from 2024 to 35.", "35"]] as const) assert.ok(check(t).includes(fig(n)), t);
    for (const t of ["The 2025-26 cohort starts in January.", "From 2025 to 2026 the program ran twice.", "In 2026."]) assert.deepEqual(check(t), [], t);
  });
  it("N10-3: the exemptions never change name results", () => {
    const d = checkOrgClaimsDeterministic("Since 2024 Eaton has hired from the program.", LUPE, "");
    assert.ok(!d.some((p) => p.includes("Eaton")), JSON.stringify(d));
    assert.ok(checkOrgClaimsDeterministic("Good news, Dial 911 Meijer!", LUPE, "").some((p) => p.includes('"Dial"')));
  });
  it("N10-4: a number before a period or a comma is checked", () => {
    for (const [t, n] of [["Your caseload has 17.", "17"], ["Total hired this year: 23.", "23"], ["Hires: 23, placements: 41.", "41"]] as const) assert.ok(check(t).includes(fig(n)), t);
    for (const t of ["About 3.5 hours.", "Your 1,000-mile drive is long.", "Region 9 covers the Upper Peninsula.", "Go to Room 204, then Step 3."]) assert.deepEqual(check(t), [], t);
  });
});

describe("harness TRAP-NUMBER-02 (2026-10-30)", () => {
  it("a supported rate written as 'percent' is not also flagged as a figure", () => {
    const f3: OrgFacts = { caseload: 3, stalled: 0, neverStarted: 0, hired: 0, unassigned: 0, visibleNames: ["Jean", "Marqus", "Circe"], staffNames: ["Lupe"], orgName: "Southside Bridge" };
    assert.deepEqual(check("Right now all 3 people on your caseload were active in the last two weeks. That's 100 percent, 3 of 3, and 0 are not active.", "", f3), []);
    assert.ok(check("That's 62 percent of your caseload.", "", f3).some((p) => p.includes("62")));
  });
});

describe("review round 11 findings (2026-10-31)", () => {
  const fig = (n: string) => `the figure "${n}" is not one of this caseload's numbers`;
  const big: OrgFacts = { ...LUPE, caseload: 40 };
  it("N11-1: dates, clock minutes, places and pages at a sentence end are not counts", () => {
    for (const t of ["Her interview is at 2:45.", "The program runs through June 2027.", "The grant closes December 2026.", "Starting January 2026, the cohort meets weekly.", "That covers Q3 2026.", "She graduated in 1998.", "Since 1999, the shelter has been open.", "Ask for room 204.", "Send it to PO Box 1066.", "Exit at mile marker 48.", "See page 2 of 15."]) {
      assert.deepEqual(checkOrgClaimsDeterministic(t, big, "", { typedNamesInNoMatch: true }), [], t);
      assert.deepEqual(checkOrgClaimsDeterministic(`Hi Jean, ${t.charAt(0).toLowerCase()}${t.slice(1)}`, big, "").filter((p) => p.startsWith("the figure")), [], `draft: ${t}`);
    }
  });
  it("N11-2: a count after a label, a year or a help line is still a count", () => {
    for (const [t, n] of [["Region 43 people got jobs.", "43"], ["Level 57 participants passed.", "57"], ["Of 2025 total participants, 12 got jobs.", "2025"], ["In 2026 additional placements.", "2026"], ["2024-45 new participants started.", "2024"]] as const) {
      assert.ok(checkOrgClaimsDeterministic(t, big, "", { typedNamesInNoMatch: true }).includes(fig(n)), t);
    }
    assert.ok(checkOrgClaimsDeterministic("Text 211 any participants.", big, "", { typedNamesInNoMatch: true }).includes(fig("211")));
    assert.deepEqual(checkOrgClaimsDeterministic("If anyone is in danger, call 911 right away.", big, "", { typedNamesInNoMatch: true }), []);
  });
});
