/**
 * Slice 2 review, round 3 fixes. N3-H1: the facility matcher has two tiers
 * (tier 1 holds, tier 2 only asks, one tap, the answer kept per phrase and
 * lane). N3-M1: a page with no list of what it prints treats every hidden
 * venue as hidden; bios and work samples judge by what they print. N3-M2:
 * officer ranks, short forms and boards; a bare "Officer" asks once.
 * N3-L1..L5. Every person and place is invented, or a well-known public place
 * name used only as a test string.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { cleanDetails, hasLicenseNumber, resolvePracticeEntry, type PracticeEntry } from "../practiceRecordShared";
import {
  applyPhraseAnswer,
  applyTitleMode,
  buildArtistResumeModel,
  buildWorkSampleList,
  cleanKindSettings,
  facilityCheck,
  foldText,
  hiddenFacilityTerms,
  MAX_PHRASE_ANSWERS,
  phraseKey,
  type CreativeKindSettings,
} from "../creativeLaneShared";
import { bioTextForLane, type BioSentence } from "../creativeBio";
import { buildCvModel, cvPlainText, isPersonalDetail, readsAsDegree, rowHasIdNumber } from "../cvShared";
import { getCvStatus, looksLikeOfficer, maybeOfficer, OFFICER_ASK_QUESTION } from "../cvChecks";
import { exportOpenItemLines, FACILITY_ASK_QUESTION, getCreativeStatus, HIDDEN_ITEM_LINE } from "../creativeChecks";

let n = 0;
const id = () => `00000000-0000-4000-8000-${String(30000 + ++n).padStart(12, "0")}`;
function entry(p: Partial<PracticeEntry> & Pick<PracticeEntry, "section" | "title" | "year">): PracticeEntry {
  return { id: id(), user_id: "u", venue: null, city: null, state: null, end_year: null, details: {}, proof: "checked", names_facility: false, created_at: "", updated_at: "", ...p };
}
const BASE: CreativeKindSettings = { displayName: "Dana Sample", email: "dana@sample.test" };
const BA = entry({ section: "education", title: "BA, Sociology", venue: "Sample State University", year: 2024, details: { degree: true, status: "conferred" } });

function hiddenAt(venue: string, details: PracticeEntry["details"] = {}) {
  const e = entry({ section: "teaching", title: "Literacy Tutor", venue, year: 2022, names_facility: true, details });
  return { e, s: { ...BASE, ...applyTitleMode(BASE, e.id, "leave_out")! } };
}
const cv = (entries: PracticeEntry[], s: CreativeKindSettings) => {
  const model = buildCvModel(entries, s, "academic");
  return { model, text: cvPlainText(model), status: getCvStatus({ entries, settings: s, cvType: "academic", model }) };
};

describe("N3-H1: true words that only share a word with a facility print (no false holds)", () => {
  const cases: [venue: string, field: keyof CreativeKindSettings, text: string][] = [
    ["San Quentin State Prison", "basedIn", "San Francisco, CA"],
    ["San Quentin State Prison", "interests", "Public history of San Jose"],
    ["New Jersey State Prison", "basedIn", "New York, NY"],
    ["New Jersey State Prison", "discipline", "New media artist"],
    ["California State Prison, Los Angeles County", "basedIn", "Los Angeles, California"],
    ["California State Prison, Los Angeles County", "interests", "Los Angeles history"],
    ["California State Prison, Corcoran", "basedIn", "Fresno, California"],
    ["Montana State Prison", "basedIn", "Missoula, Montana"],
    ["Washington State Penitentiary", "interests", "Pacific Northwest history; University of Washington archives"],
    ["Lee Correctional Institution", "displayName", "Jordan Lee"],
    ["Jackson Correctional Institution", "displayName", "Dana Jackson"],
    ["Lee Correctional Institution", "email", "lee.jordan@sample.test"],
    ["Valley State Prison", "interests", "Central Valley farmworker history"],
    ["Mountain View Correctional Facility", "interests", "Point of view in documentary film"],
    ["Great Meadow Correctional Facility", "interests", "The Great Migration"],
    ["Green Haven Correctional Facility", "interests", "Green building; urban gardens"],
    ["Coffee Creek Correctional Facility", "languages", "Spanish; coffee roasting"],
    ["Huntsville Unit", "basedIn", "Huntsville, TX"],
    ["Sample State Prison", "interests", "Prison education; state prison reform"],
    ["Sample County Jail", "interests", "Bail reform; county jail health care"],
    ["Federal Correctional Institution, Dublin", "interests", "James Joyce's Dublin"],
    ["Lincoln Correctional Center", "basedIn", "Lincoln County, MT"],
    ["Fort Dix Federal Correctional Institution", "interests", "Fort Worth music history"],
    ["Folsom State Prison", "basedIn", "Folsom, CA"],
    ["Folsom State Prison", "interests", "Gold Rush towns: Folsom, California"],
  ];
  for (const [venue, field, text] of cases) {
    it(`${venue} kept off: ${field} "${text}" prints and the CV can finish`, () => {
      const { e, s } = hiddenAt(venue);
      const set = { ...s, [field]: text };
      const r = cv([BA, e], set);
      assert.deepEqual(r.model.heldFields, []);
      assert.equal(r.status.state, "finished");
      assert.ok(r.text.includes(text.split(";")[0].trim()) || field === "email");
      // At most a one-tap question, never a BLOCK.
      assert.ok(!r.status.openItems.some((x) => x.rule === "STD-R03" && x.severity === "BLOCK"));
    });
  }
  it("a real job in the prison's town prints, with at most a one-tap question", () => {
    const { e, s } = hiddenAt("Folsom State Prison");
    const job = entry({ section: "appointment", title: "Line cook", venue: "Sample Diner", city: "Folsom", state: "CA", year: 2022 });
    const r = cv([BA, e, job], s);
    assert.match(r.text, /Line cook, Sample Diner, Folsom, CA/);
    assert.equal(r.status.state, "finished");
    const ask = r.status.openItems.find((x) => x.answer === "facility_word");
    assert.equal(ask?.severity, "FIX");
    assert.equal(ask?.question, FACILITY_ASK_QUESTION);
    assert.equal(ask?.phrase, "Folsom, CA");
  });
  it("a job in San Rafael and a reference in Folsom Hall print", () => {
    const sq = hiddenAt("San Quentin State Prison");
    const job = entry({ section: "appointment", title: "Line cook", venue: "Sample Diner", city: "San Rafael", state: "CA", year: 2022 });
    assert.match(cv([BA, sq.e, job], sq.s).text, /Line cook/);
    const fo = hiddenAt("Folsom State Prison");
    const ref = entry({ section: "reference", title: "Dr. Pat Sample", venue: "Sample State University", year: 2022, details: { role: "Professor", contact: "Folsom Hall, room 2, 555-0101", consent: true } });
    const r = cv([BA, fo.e, ref], { ...fo.s, leadReference: ref.id });
    assert.match(r.text, /Pat Sample/);
    assert.equal(r.status.state, "finished");
  });
  it("generic words: a bio sentence about a state prison prints", () => {
    const ex = entry({ section: "teaching", title: "Painting class", venue: "Sample State Prison", year: 2022, names_facility: true });
    const s = applyTitleMode({}, ex.id, "leave_out")!;
    const bio = [{ id: "s1", text: "I learned to paint in a state prison.", origin: "person_written", approved: true }] as BioSentence[];
    assert.equal(bioTextForLane(bio, [ex], s), "I learned to paint in a state prison.");
    const ex2 = entry({ section: "teaching", title: "Painting class", venue: "Sample Correctional Facility", year: 2022, names_facility: true });
    const bio2 = [{ id: "s2", text: "I spent six years in a correctional facility.", origin: "person_written", approved: true }] as BioSentence[];
    assert.equal(bioTextForLane(bio2, [ex2], applyTitleMode({}, ex2.id, "leave_out")!), "I spent six years in a correctional facility.");
  });
  it("a title's topic words stay free: 'Creative writing' prints when the title is kept off", () => {
    const f = entry({ section: "teaching", title: "Creative Writing Workshop, Sample State Prison", venue: "Sample Arts Council", year: 2022, names_facility: true });
    const s = { ...BASE, ...applyTitleMode(BASE, f.id, "venue_only")!, interests: "Creative writing; poetry" };
    const r = cv([BA, f], s);
    assert.match(r.text, /Creative writing; poetry/);
    assert.equal(r.status.state, "finished");
  });
  it("CC case: the person's own name, initials, email, web address and a publication's authors print", () => {
    // An entry with no choice yet keeps its venue off; "Sample" is a distinctive word of it.
    const prog = entry({ section: "arts_program", title: "College program", venue: "Ray County Correctional Facility College Program", year: 2020, names_facility: true });
    const pub = entry({ section: "publication", title: "Two Poems", venue: "Small Review", year: 2022, details: { status: "published", authors: "R. Ray" } });
    const s: CreativeKindSettings = { displayName: "Morgan Ray", email: "morgan@ray.test", website: "morganray.org", interests: "Poetry; write to morgan@ray.test" };
    const r = cv([BA, prog, pub], s);
    for (const t of ["Morgan Ray", "morgan@ray.test", "morganray.org", "R. Ray", "write to morgan@ray.test"]) assert.ok(r.text.includes(t), t);
    assert.deepEqual(r.model.heldFields, []);
    assert.ok(!r.model.omitted.some((o) => o.entryId === pub.id));
    assert.ok(!r.status.openItems.some((x) => x.rule === "STD-R03" && x.severity === "BLOCK" && x.entryId !== prog.id));
    // The artist resume reads the same fields the same way.
    const am = buildArtistResumeModel([prog, pub], s);
    assert.equal(am.header.name, "Morgan Ray");
    assert.deepEqual(am.heldFields, []);
  });
});

describe("N3-H1: what a facility's name picks out is still held (no leaks)", () => {
  const holds: [venue: string, text: string][] = [
    ["San Quentin State Prison", "Shakespeare at San Quentin"],
    ["San Quentin State Prison", "Shakespeare at Quentin"],
    ["San Quentin State Prison", "Shakespeare at SAN-QUENTIN"],
    ["Rikers Island Correctional Facility", "Poetry on Rikers"],
    ["Riker's Island", "the Rikers program"],
    ["Sing Sing Correctional Facility", "Sing Sing theater program"],
    ["Pelican Bay State Prison", "Art class at Pelican Bay"],
    ["Stateville Correctional Center", "Stateville's book club"],
    ["Folsom State Prison", "Theater in Folsom prison"],
    ["Folsom State Prison", "the Folsom yard"],
    ["Huntsville Unit", "Huntsville prison choir"],
    ["Massachusetts Correctional Institution - Norfolk", "Debate team at MCI-Norfolk"],
    ["Sample State Prison, Badger Unit", "Badger Unit book club"],
    ["Valley State Prison", "Welding at Valley State Prison"],
    // N3-L5: soft hyphen, a word broken at a line end, fullwidth and Cyrillic letters.
    ["San Quentin State Prison", "Shakespeare at Quen­tin"],
    ["San Quentin State Prison", "Shakespeare at Quen-\ntin"],
    ["San Quentin State Prison", "Shakespeare at Quen- tin"],
    ["San Quentin State Prison", "Shakespeare at Ｑｕｅｎｔｉｎ"],
    ["San Quentin State Prison", "Shakespeare at Quеntin"],
  ];
  for (const [venue, text] of holds) {
    it(`${venue} kept off: "${JSON.stringify(text)}" in Interests is held with a BLOCK`, () => {
      const { e, s } = hiddenAt(venue);
      const r = cv([BA, e], { ...s, interests: text });
      assert.ok(r.model.heldFields.some((h) => h.field === "interests" && h.reason === "names_hidden"));
      assert.equal(r.status.state, "draft");
      assert.ok(r.status.openItems.some((x) => x.rule === "STD-R03" && x.severity === "BLOCK"));
    });
  }
  it("a whole hidden name is held even in the person's own name field", () => {
    const { e, s } = hiddenAt("San Quentin State Prison");
    assert.equal(cv([BA, e], { ...s, displayName: "Dana Sample, San Quentin State Prison" }).model.header.name, "");
  });
  it("a lone word that also names a town only asks: 'Theater at Folsom'", () => {
    const { e, s } = hiddenAt("Folsom State Prison");
    const r = cv([BA, e], { ...s, interests: "Theater at Folsom" });
    assert.match(r.text, /Theater at Folsom/);
    assert.ok(r.status.openItems.some((x) => x.answer === "facility_word" && x.severity === "FIX" && x.phrase === "Theater at Folsom"));
    // The export's to-do page never quotes the phrase.
    for (const l of exportOpenItemLines(r.status, [BA, e], { ...s, interests: "Theater at Folsom" }, "cv", [BA.id])) assert.doesNotMatch(l, /Folsom/);
  });
  it("folds lookalikes, fullwidth letters and dotted initials", () => {
    assert.equal(foldText("Quеntin"), "Quentin");
    assert.equal(foldText("Ｑｕｅｎｔｉｎ"), "Quentin");
    assert.equal(foldText("S.Q. and C.O."), "SQ and CO");
  });
});

describe("N3-H1 / N3-L5: other names people use for a place (typed by the person)", () => {
  it("the record keeps them from one line, split at commas", () => {
    assert.deepEqual(cleanDetails("teaching", { otherNames: "the Q, SQ; the Q" }).otherNames, ["the Q", "SQ"]);
    const r = resolvePracticeEntry({ section: "teaching", title: "Tutor", venue: "San Quentin State Prison", year: 2022, namesFacility: true, details: { otherNames: ["the Q", "SQ"] } });
    assert.ok(r.ok && r.value.details.otherNames?.length === 2);
  });
  for (const [venue, nick, text] of [
    ["San Quentin State Prison", ["the Q", "SQ"], "Shakespeare in the Q"],
    ["San Quentin State Prison", ["the Q", "SQ"], "Shakespeare at SQ"],
    ["San Quentin State Prison", ["SQ"], "Shakespeare at S.Q."],
    ["Louisiana State Penitentiary", ["Angola"], "Rodeo at Angola"],
    ["California Men's Colony", ["CMC"], "Hospice volunteer at CMC"],
  ] as const) {
    it(`"${text}" is held once "${nick.join(", ")}" is on the entry`, () => {
      const { e, s } = hiddenAt(venue, { otherNames: [...nick] });
      const r = cv([BA, e], { ...s, interests: text });
      assert.ok(r.model.heldFields.some((h) => h.field === "interests"));
      const plain = hiddenAt(venue);
      assert.deepEqual(cv([BA, plain.e], { ...plain.s, interests: text }).model.heldFields, [], "without the field it was not derivable");
    });
  }
  it("a nickname in the person's home place only asks", () => {
    const { e, s } = hiddenAt("San Quentin State Prison", { otherNames: ["SQ"] });
    const r = cv([BA, e], { ...s, basedIn: "SQ village" });
    assert.deepEqual(r.model.heldFields, []);
    assert.ok(r.model.asks.some((a) => a.field === "basedIn"));
  });
});

describe("N3-H1: the one-tap answer, kept per phrase and lane", () => {
  const { e, s } = hiddenAt("Lee Correctional Institution");
  const set = { ...s, displayName: "Jordan Lee" };
  it("asks about the person's name, never holds it", () => {
    const r = cv([BA, e], set);
    assert.equal(r.model.header.name, "Jordan Lee");
    assert.deepEqual(r.model.asks, [{ field: "displayName", phrase: "Jordan Lee" }]);
    assert.ok(!r.status.openItems.some((x) => x.rule === "STD-F05"));
  });
  it('"No" clears it for good; the stored key is a short hash, never the words', () => {
    const next = applyPhraseAnswer(set, "Jordan Lee", "no")!;
    assert.deepEqual(next.phraseAnswers, { [phraseKey("Jordan Lee")]: "no" });
    assert.ok(!JSON.stringify(next.phraseAnswers).includes("Lee"));
    const r = cv([BA, e], next);
    assert.deepEqual(r.model.asks, []);
    assert.equal(r.model.header.name, "Jordan Lee");
    // The same phrase elsewhere is not asked either; a different phrase is.
    assert.deepEqual(cv([BA, e], { ...next, interests: "Jordan Lee" }).model.asks, []);
    assert.equal(cv([BA, e], { ...next, interests: "Spike Lee films" }).model.asks.length, 1);
  });
  it('"Yes, take it out" holds the phrase', () => {
    const next = applyPhraseAnswer({ ...set, interests: "Spike Lee films" }, "Spike Lee films", "yes")!;
    const r = cv([BA, e], next);
    assert.ok(r.model.heldFields.some((h) => h.field === "interests"));
  });
  it('"No" never clears a tier 1 hold', () => {
    const sq = hiddenAt("San Quentin State Prison");
    const next = applyPhraseAnswer({ ...sq.s, interests: "Shakespeare at Quentin" }, "Shakespeare at Quentin", "no")!;
    assert.ok(cv([BA, sq.e], next).model.heldFields.some((h) => h.field === "interests"));
  });
  it("answers never arrive as a whole map, are capped, and keep settings under the database's 16,000 bytes", () => {
    assert.equal(cleanKindSettings({ phraseAnswers: { aaaaaaaaaaaa: "no" } }, {}).phraseAnswers, undefined);
    assert.equal(applyPhraseAnswer({}, "", "no"), null);
    assert.equal(applyPhraseAnswer({}, "x", "maybe"), null);
    let cur: CreativeKindSettings = {};
    for (let i = 0; i < MAX_PHRASE_ANSWERS; i++) cur = applyPhraseAnswer(cur, `phrase number ${i}`, "no")!;
    assert.equal(applyPhraseAnswer(cur, "one more phrase", "no"), null);
    // Worst case: every list at its cap, every field at its length.
    const big: Record<string, unknown> = {
      displayName: "x".repeat(120), discipline: "x".repeat(120), basedIn: "x".repeat(120), email: "x".repeat(160), phone: "x".repeat(40), website: "x".repeat(200),
      interests: "x".repeat(600), languages: "x".repeat(300), leadReference: "00000000-0000-4000-8000-000000000001", callAllowsMore: true, bioPronoun: "they", rev: 99999,
      selection: Array.from({ length: 150 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`),
      titleModes: Object.fromEntries(Array.from({ length: 120 }, (_, i) => [`00000000-0000-4000-8000-${String(i).padStart(12, "0")}`, "true_title"])),
      phraseAnswers: (cur as Record<string, unknown>).phraseAnswers,
    };
    const cleaned = cleanKindSettings({}, big);
    // Postgres prints jsonb with ", " and ": " separators.
    const asJsonb = JSON.stringify(cleaned).replace(/","/g, '", "').replace(/":/g, '": ');
    assert.ok(Buffer.byteLength(asJsonb) < 16000, String(Buffer.byteLength(asJsonb)));
  });
});

describe("N3-M1: a page that cannot say what it prints treats every hidden venue as hidden", () => {
  const VENUE = "Sample North Correctional Center";
  const tutor = entry({ section: "teaching", title: "GED Tutor", venue: VENUE, year: 2021, names_facility: true });
  const s = applyTitleMode(BASE, tutor.id, "leave_out")!;
  const others: [string, PracticeEntry][] = [
    ["a CV-only reference without an OK", entry({ section: "reference", title: "Pat Sample", venue: VENUE, year: 2021, details: { role: "Education director", consent: false } })],
    ["a license", entry({ section: "license", title: "Food Handler", venue: VENUE, year: 2020, details: { credentialKind: "card", credentialStatus: "active" } })],
    ["a consented reference (on a CV, never on a bio)", entry({ section: "reference", title: "Pat Sample", venue: VENUE, year: 2021, details: { role: "Education director", consent: true } })],
  ];
  for (const [what, other] of others) {
    it(`${what} never makes it public on the bio or the work-sample list`, () => {
      const bio = [{ id: "s1", text: `I tutored at ${VENUE}.`, origin: "person_written", approved: true }] as BioSentence[];
      assert.equal(bioTextForLane(bio, [tutor, other], s), "");
      const st = getCreativeStatus({ entries: [tutor, other], settings: s, bio: { lengths: { short: bio, medium: [], long: [] } } });
      assert.ok(st.openItems.some((x) => x.doc === "bio" && x.rule === "STD-R03" && x.severity === "BLOCK"));
      const w = entry({ section: "work", title: "Mural study", year: 2023, details: { medium: "acrylic", description: `Painted with students at ${VENUE}` } });
      assert.ok(!buildWorkSampleList([tutor, other, w], null, s).some((r) => r.entryId === w.id));
      // The export's to-do lines without a page model: the venue is hidden there too.
      for (const l of exportOpenItemLines(st, [tutor, other], s, "bio")) assert.doesNotMatch(l, /Sample North/);
    });
  }
  it("a bio's own record sentence (true title) does make its venue public on that bio", () => {
    const show = entry({ section: "exhibition", title: "Open Studio", venue: VENUE, year: 2023, details: { kind: "group" } });
    const s2 = { ...s, displayName: "Dana Sample" };
    const fact = { id: "f1", text: `Dana Sample's work was in Open Studio, a group exhibition at ${VENUE}, in 2023.`, origin: "fact", sourceEntryId: show.id, approved: true };
    const own = { id: "s1", text: `I tutored at ${VENUE}.`, origin: "person_written", approved: true };
    const text = bioTextForLane([fact, own] as BioSentence[], [tutor, show], s2);
    assert.match(text, /I tutored at Sample North/);
  });
  it("an unflagged work's own true title keeps its word on the list (designed trade, STD-R03 FIX asks)", () => {
    const { e, s: s3 } = hiddenAt("San Quentin State Prison");
    const w = entry({ section: "work", title: "Untitled (Quentin yard)", year: 2023, details: { medium: "oil" } });
    assert.deepEqual(buildWorkSampleList([e, w], null, s3).map((r) => r.title), ["Untitled (Quentin yard)"]);
  });
  it("hiddenFacilityTerms without shown ids: nothing is public", () => {
    const shown = entry({ section: "appointment", title: "Clerk", venue: VENUE, year: 2020 });
    const t = hiddenFacilityTerms([tutor, shown], s);
    assert.ok(t.fullNames.includes("sample north correctional center"));
    assert.ok(!hiddenFacilityTerms([tutor, shown], s, [shown.id]).fullNames.includes("sample north correctional center"));
  });
  it("the export backstop replaces a line that is held or still asked about", () => {
    const fo = hiddenAt("Folsom State Prison");
    const st = { state: "draft" as const, blockCount: 0, fixCount: 1, rulesVersion: "t", openItems: [{ rule: "X", severity: "FIX" as const, line: "Folsom notes", question: "?", why: "", doc: "cv" as const }] };
    assert.deepEqual(exportOpenItemLines(st, [fo.e], fo.s, "cv", []), [HIDDEN_ITEM_LINE]);
  });
});

describe("N3-L1: a row the check drops never makes a venue public", () => {
  it("one settled pass: an unflagged row at a hidden venue, dropped for another hidden name, keeps that venue hidden", () => {
    const t2 = entry({ section: "teaching", title: "GED Tutor", venue: "Sample North Correctional Center", year: 2021, names_facility: true });
    const g = entry({ section: "teaching", title: "Art Tutor", venue: "Rikers Island Correctional Facility", year: 2018, names_facility: true });
    // Not marked, at the first hidden venue; its own words (who it was for) name the second, so it is dropped.
    const a = entry({ section: "teaching", title: "Kitchen trainer", venue: "Sample North Correctional Center", year: 2021, details: { level: "men sent from Rikers" } });
    const s = { ...BASE, titleModes: { [t2.id]: "leave_out" as const, [g.id]: "leave_out" as const }, interests: "Tutoring at Sample North Correctional Center." };
    const r = cv([BA, t2, g, a], s);
    assert.ok(r.model.omitted.some((o) => o.entryId === a.id && o.reason === "names_hidden"));
    assert.doesNotMatch(r.text, /Sample North/);
    assert.ok(r.model.heldFields.some((h) => h.field === "interests"));
  });
});

describe("N3-M2: officers by rank, short form and board", () => {
  const prof = entry({ section: "reference", title: "Dr. Robin Sample", venue: "Sample State University", year: 2024, details: { role: "Professor", consent: true } });
  const officers: [role: string, venue: string][] = [
    ["Sergeant", "Sample County Jail"], ["Lieutenant", "Sample State Prison"], ["Captain", "Sample Detention Facility"],
    ["Warden", "Sample Correctional Institution"], ["Deputy warden", "Sample State Prison"], ["Deputy", "Sample County Sheriff's Office"],
    ["Deputy Sheriff", "Sample County"], ["Detention deputy", "Sample County"], ["Detention officer", ""], ["C.O.", "Sample State Prison"],
    ["CO", "Sample County"], ["Correctional officer", ""], ["USPO", "District of Sample"], ["Pre-trial officer", "Sample County"],
    ["Pretrial officer", ""], ["Officer", "Board of Pardons and Paroles"], ["Member", "Sample State Parole Board"],
    ["Corrections Sergeant", ""], ["Correctional Lieutenant", ""], ["Community justice officer", "Sample County"],
  ];
  for (const [role, venue] of officers) {
    it(`${role}${venue ? `, ${venue}` : ""} is an officer, never the lead`, () => {
      const ref = entry({ section: "reference", title: "P. Sample", venue: venue || null, year: 2024, details: { role, consent: true } });
      assert.ok(looksLikeOfficer(ref));
      const r = cv([BA, prof, ref], { ...BASE, leadReference: ref.id });
      assert.equal(r.status.state, "draft");
      assert.ok(r.status.openItems.some((x) => x.rule === "CV-04" && x.severity === "BLOCK" && /officer/.test(x.question)));
    });
  }
  const notOfficers: [role: string, venue: string][] = [
    ["Army sergeant", "U.S. Army"], ["Deputy director", "Sample Museum"], ["Captain", "Sample Fire Department"], ["Loan officer", "Sample Credit Union"],
    ["Police officer", "Sample City Police Department"], ["Program officer", "Sample Foundation"], ["CO-founder", "Sample Studio"], ["School counselor", "Sample High School"],
  ];
  for (const [role, venue] of notOfficers) {
    it(`${role}, ${venue} is not an officer and is not asked about`, () => {
      const ref = entry({ section: "reference", title: "P. Sample", venue, year: 2024, details: { role, consent: true } });
      assert.ok(!looksLikeOfficer(ref));
      assert.ok(!maybeOfficer(ref));
    });
  }
  const bare: [title: string, role: string, venue: string][] = [
    ["U. Sample", "Officer", "Sample County"], ["V. Sample", "Agent", "State of Sample"], ["W. Sample", "Officer", ""],
    ["Officer P. Sample, Sample County", "", ""], ["P. Sample", "My supervising officer", ""], ["P. Sample", "Supervising officer", "Sample County"],
  ];
  for (const [title, role, venue] of bare) {
    it(`"${[title, role, venue].filter(Boolean).join(", ")}" gets one question (FIX), then the answer decides`, () => {
      const ref = entry({ section: "reference", title, venue: venue || null, year: 2024, details: { role, consent: true } });
      assert.ok(maybeOfficer(ref));
      const r = cv([BA, prof, ref], { ...BASE, leadReference: ref.id });
      const ask = r.status.openItems.find((x) => x.answer === "officer");
      assert.equal(ask?.severity, "FIX");
      assert.equal(ask?.question, OFFICER_ASK_QUESTION);
      assert.equal(r.status.state, "finished");
      const no = { ...ref, details: { ...ref.details, officer: false } };
      const rn = cv([BA, prof, no], { ...BASE, leadReference: ref.id });
      assert.ok(!rn.status.openItems.some((x) => x.answer === "officer"));
      assert.equal(rn.status.state, "finished");
      const yes = { ...ref, details: { ...ref.details, officer: true } };
      const ry = cv([BA, prof, yes], { ...BASE, leadReference: ref.id });
      assert.equal(ry.status.state, "draft");
      assert.ok(ry.status.openItems.some((x) => x.rule === "CV-04" && x.severity === "BLOCK"));
    });
  }
  it("the officer answer saves with the reference (and only a yes or no)", () => {
    assert.equal(cleanDetails("reference", { officer: false }).officer, false);
    assert.equal(cleanDetails("reference", { officer: "no" }).officer, undefined);
  });
  it('a stored "No" never clears a clear officer title', () => {
    const ref = entry({ section: "reference", title: "P. Sample", venue: "Sample County Jail", year: 2024, details: { role: "Sergeant", consent: true, officer: false } });
    assert.ok(looksLikeOfficer(ref));
  });
});

describe("N3-L2: personal details, first person and title forms", () => {
  const caught = [
    "Painting. I am 45 years old.", "I was born in 1980", "Painting; I'm a US citizen", "Painting; my wife and two kids", "Born in Mexico",
    "Age forty-five", "Nationality Mexican", "Citizenship US", "Gender female", "Nationality: United States of America", "Painting (married)",
    "Painting | Single | Two kids", "Race: Black and Latino", "Gender: non-binary person", "555-0101; my age 45",
  ];
  const clear = ["Gender: Equity Award", "Board member, Race: Equity Now", "Race: policing and parole", "Religion: prison ministry history", "Citizenship coach", "Youth coach, 12 kids per team"];
  for (const t of caught) it(`caught: ${t}`, () => assert.ok(isPersonalDetail(t), t));
  for (const t of clear) it(`clear: ${t}`, () => assert.ok(!isPersonalDetail(t), t));
  it("an award and a service row titled with a label and a title print", () => {
    const aw = entry({ section: "award", title: "Gender: Equity Award", venue: "Sample Foundation", year: 2024, details: { kind: "award" } });
    const sv = entry({ section: "service", title: "Board member, Race: Equity Now", venue: "Sample Org", year: 2024 });
    const r = cv([BA, aw, sv], BASE);
    assert.match(r.text, /Gender: Equity Award/);
    assert.match(r.text, /Race: Equity Now/);
  });
});

describe("N3-L3: a degree name with classes after it still needs its status", () => {
  for (const t of ["Bachelor of Arts (classes)", "Bachelor of Arts, 120 credits in Sociology"]) {
    it(`${t} reads as a degree`, () => {
      assert.ok(readsAsDegree(t));
      const e = entry({ section: "education", title: t, venue: "Sample Valley College", year: 2023 });
      const r = cv([BA, e], BASE);
      assert.doesNotMatch(r.text, /Sample Valley/);
      assert.ok(r.status.openItems.some((x) => x.rule === "CV-05" && x.severity === "BLOCK"));
    });
  }
  for (const t of ["Classes toward a Bachelor of Arts", "Coursework toward an Associate of Arts", "Non-degree study in Sociology", "Credits toward a BA"]) {
    it(`${t} does not`, () => assert.ok(!readsAsDegree(t)));
  }
});

describe("N3-L4: number shapes", () => {
  for (const t of ["Registered Nurse RN.1234.567", "Registered Nurse 1234/567", "Registered Nurse 12-34-56"]) it(`held: ${t}`, () => assert.ok(hasLicenseNumber(t)));
  for (const t of ["DOT 49 CFR 172.704 Hazmat", "CPR card, renewed 03/15/2025", "First Aid, 12/2025", "AWS D1.1 Structural Welder", "Version 2.0 trainer"]) it(`clear: ${t}`, () => assert.ok(!hasLicenseNumber(t)));
  it("a badge or employee number in any row is held; a ZIP code is not", () => {
    assert.ok(rowHasIdNumber(entry({ section: "appointment", title: "Driver, badge 4471229", venue: "Sample Co", year: 2024 })));
    assert.ok(rowHasIdNumber(entry({ section: "teaching", title: "Instructor, employee ID 4471229", venue: "Sample Co", year: 2024 })));
    assert.ok(!rowHasIdNumber(entry({ section: "appointment", title: "Driver", venue: "Sample Co, Boise, ID 83702", year: 2024 })));
    const r = cv([BA, entry({ section: "appointment", title: "Driver, badge 4471229", venue: "Sample Co", year: 2024 })], BASE);
    assert.doesNotMatch(r.text, /4471229/);
  });
});
