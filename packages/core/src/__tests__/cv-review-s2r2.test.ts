/**
 * Slice 2 review, round 2 fixes (CV lanes and the slice 1 pages that share
 * the facility check): part of a hidden facility name counts (N-H1); only
 * what THIS page prints makes a hidden name public (N-M1); the officer test
 * covers plurals and federal and community supervision (N-M2); honest study
 * without a degree (N-M3); the personal-detail scan reads only fields a
 * person writes about themselves, and only short shapes (N-M4, N-L1); ID
 * numbers in more shapes and rows, never in a standard's name or a ZIP code
 * (N-L2, N-L3). Every person and place is invented or a well-known public
 * place name used only as a test string.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { CV_TYPES } from "../careerLaneShared";
import { cleanDetails, hasLicenseNumber, resolvePracticeEntry, type PracticeEntry } from "../practiceRecordShared";
import {
  applyTitleMode,
  artistResumePlainText,
  buildArtistResumeModel,
  distinctiveWords,
  hiddenFacilityTerms,
  namesHiddenFacility,
  shownEntryIds,
  studyTitle,
  type CreativeKindSettings,
} from "../creativeLaneShared";
import { bioTextForLane, type BioSentence } from "../creativeBio";
import { buildCvModel, cvPlainText, isPersonalDetail, degreeStatusKnown } from "../cvShared";
import { getCvStatus, looksLikeOfficer } from "../cvChecks";
import { checkRecord, exportOpenItemLines } from "../creativeChecks";

let n = 0;
const id = () => `00000000-0000-4000-8000-${String(9000 + ++n).padStart(12, "0")}`;
function entry(p: Partial<PracticeEntry> & Pick<PracticeEntry, "section" | "title" | "year">): PracticeEntry {
  return { id: id(), user_id: "u", venue: null, city: null, state: null, end_year: null, details: {}, proof: "remembered", names_facility: false, created_at: "", updated_at: "", ...p };
}
const BASE: CreativeKindSettings = { displayName: "Ray Example", basedIn: "Toledo, OH", email: "ray@example.com" };
const BA = entry({ section: "education", title: "BA, Sociology", venue: "Example State University", year: 2024, details: { degree: true, status: "conferred" } });

/** A facility entry kept off, and the settings that keep it off. */
function hiddenAt(venue: string) {
  const e = entry({ section: "teaching", title: "Literacy Tutor", venue, year: 2022, names_facility: true });
  return { e, s: applyTitleMode(BASE, e.id, "leave_out")! };
}

describe("N-H1: part of a hidden facility name counts", () => {
  const cases: [venue: string, says: string[]][] = [
    ["San Quentin State Prison", ["San Quentin", "SAN QUENTIN", "san-quentin", "Quentin"]],
    ["Stateville Correctional Center", ["Stateville", "STATEVILLE", "stateville's yard"]],
    ["Rikers Island Correctional Facility", ["Riker's", "Rikers Island", "RIKERS"]],
  ];
  // Review s2r3 N3-H1: the person's home place (basedIn) is never held, only asked about (below).
  for (const [venue, says] of cases) {
    for (const say of says) {
      for (const field of ["interests", "languages", "discipline"] as const) {
        it(`${venue}: "${say}" in ${field} is held off the CV with a BLOCK`, () => {
          const { e, s } = hiddenAt(venue);
          const set = { ...s, [field]: `Theater; the program at ${say}` };
          for (const cvType of CV_TYPES) {
            const m = buildCvModel([BA, e], set, cvType);
            const text = cvPlainText(m);
            assert.ok(!text.toLowerCase().includes(say.toLowerCase().replace(/'s.*$/, "")), `${cvType}: never prints`);
            if (m.heldFields.some((h) => h.field === field)) {
              const st = getCvStatus({ entries: [BA, e], settings: set, cvType, model: m });
              assert.equal(st.state, "draft");
              assert.ok(st.openItems.some((x) => x.rule === "STD-R03" && x.severity === "BLOCK"));
              for (const line of exportOpenItemLines(st, [BA, e], set, "cv", shownEntryIds(m))) assert.ok(!line.toLowerCase().includes(say.toLowerCase().slice(0, 5)));
            }
          }
        });
      }
    }
  }
  it("a two-word name: the terms hold 'san quentin' and the distinctive word, never 'san' alone (s2r3)", () => {
    const { e, s } = hiddenAt("San Quentin State Prison");
    const t = hiddenFacilityTerms([e], s);
    assert.ok(t.fullNames.includes("san quentin state prison"));
    assert.ok(t.runs.includes("san quentin"));
    assert.deepEqual(t.words, ["quentin"]);
    assert.ok(!t.runs.includes("state prison"), "generic words alone never count");
  });
  it("a one-distinctive-word name: 'Stateville' alone counts", () => {
    assert.deepEqual(distinctiveWords("Stateville Correctional Center"), ["stateville"]);
    const { e, s } = hiddenAt("Stateville Correctional Center");
    assert.equal(namesHiddenFacility("I taught at Stateville.", hiddenFacilityTerms([e], s)), "stateville");
  });
  it("generic words, directions and numbers are never distinctive", () => {
    assert.deepEqual(distinctiveWords("North Central Federal Detention Unit 32 of the State"), []);
    assert.deepEqual(distinctiveWords("Example County Jail Annex II"), ["example"]);
  });
  it("a word already on the page through a shown entry does not count", () => {
    const { e, s } = hiddenAt("Example Valley State Prison");
    const shown = entry({ section: "education", title: "Certificate in Welding", venue: "Example Valley College", year: 2021, details: { degree: false } });
    const m = buildCvModel([BA, shown, e], { ...s, interests: "Welding; the Example Valley trail" }, "academic");
    assert.match(cvPlainText(m), /Example Valley trail/);
    // ...but the full name, or a run that is not on the page, still does.
    const m2 = buildCvModel([BA, shown, e], { ...s, interests: "Welding at Valley State Prison" }, "academic");
    assert.doesNotMatch(cvPlainText(m2), /Valley State Prison/);
  });
  it("a title's single words count only where the title names the facility", () => {
    const t = entry({ section: "arts_program", title: "Theater program, Example Ridge Prison", venue: "Example Arts Council", year: 2025, names_facility: true, details: { status: "in_progress" } });
    const s = applyTitleMode(BASE, t.id, "venue_only")!;
    const terms = hiddenFacilityTerms([BA, t], s);
    assert.ok(terms.words.includes("ridge"));
    assert.ok(!terms.words.includes("theater") && !terms.runs.some((r) => r.includes("theater")));
    // The venue-only row prints (its kind label is the page's word, not the person's).
    assert.match(cvPlainText(buildCvModel([BA, t], s, "academic")), /Arts program, Example Arts Council \(in progress\)/);
  });
  it("slice 1: the artist resume header and a bio sentence are held too", () => {
    const { e, s } = hiddenAt("San Quentin State Prison");
    const set = { ...s, discipline: "Theater maker (Shakespeare at San Quentin)" };
    const m = buildArtistResumeModel([e], set);
    assert.equal(m.header.discipline, "");
    assert.deepEqual(m.heldFields, ["discipline"]);
    assert.doesNotMatch(artistResumePlainText(m), /Quentin/);
    const bio: BioSentence[] = [
      { id: "s1", text: "I direct Shakespeare at San Quentin.", origin: "own", approved: true },
      { id: "s2", text: "I make theater.", origin: "own", approved: true },
    ] as BioSentence[];
    assert.equal(bioTextForLane(bio, [e], set), "I make theater.");
  });
  it("the file name and metadata use the printed name: a held name never rides along", () => {
    const { e, s } = hiddenAt("San Quentin State Prison");
    // A whole hidden name is held in every field, the name field included.
    const m = buildCvModel([BA, e], { ...s, displayName: "Dana Sample, San Quentin State Prison" }, "academic");
    assert.equal(m.header.name, "");
    // Part of one in the person's own name is only asked about (s2r3 N3-H1).
    const m2 = buildCvModel([BA, e], { ...s, displayName: "Dana Sample, San Quentin" }, "academic");
    assert.equal(m2.header.name, "Dana Sample, San Quentin");
    assert.ok(m2.asks.some((a) => a.field === "displayName"));
  });
});

describe("N-M1: only an entry on THIS page, shown with its true title, makes a hidden venue public", () => {
  const VENUE = "Example North Correctional Center";
  const tutor = entry({ section: "teaching", title: "GED Tutor", venue: VENUE, year: 2021, names_facility: true });
  const s = { ...applyTitleMode(BASE, tutor.id, "leave_out")!, interests: `Adult literacy; tutoring at ${VENUE}.` };
  const notOnCv: [string, PracticeEntry][] = [
    ["a reference without an OK", entry({ section: "reference", title: "Pat Example", venue: VENUE, year: 2021, details: { role: "Education director", contact: "pat@example.org", consent: false } })],
    ["an exhibition (never on a CV)", entry({ section: "exhibition", title: "Group show", venue: VENUE, year: 2020, details: { kind: "group" } })],
    ["a license with no kind", entry({ section: "license", title: "Food Handler", venue: VENUE, year: 2020 })],
    ["a degree with no status", entry({ section: "education", title: "Associate of Arts", venue: VENUE, year: 2020, details: { degree: true } })],
    ["a row held for a personal detail", entry({ section: "appointment", title: "Clerk (born 1980)", venue: VENUE, year: 2020 })],
    ["an entry still needing proof", entry({ section: "appointment", title: "Clerk", venue: VENUE, year: 2020, proof: "need_to_find" })],
  ];
  for (const [what, other] of notOnCv) {
    it(`${what} does not make it public`, () => {
      const entries = [BA, tutor, other];
      const m = buildCvModel(entries, s, "teaching");
      assert.ok(!shownEntryIds(m).includes(other.id) || what.includes("proof"));
      if (what.includes("proof")) return; // a need-to-find entry the CV prints is on the page (a note, not a hold)
      assert.doesNotMatch(cvPlainText(m), /Example North/);
      const st = getCvStatus({ entries, settings: s, cvType: "teaching", model: m });
      assert.equal(st.state, "draft");
      for (const line of exportOpenItemLines(st, entries, s, "cv", shownEntryIds(m))) assert.doesNotMatch(line, /Example North/);
    });
  }
  it("an entry this CV prints with its true title does make it public", () => {
    const job = entry({ section: "appointment", title: "Library Assistant", venue: VENUE, year: 2019 });
    const m = buildCvModel([BA, tutor, job], s, "teaching");
    assert.match(cvPlainText(m), /Library Assistant, Example North Correctional Center/);
    assert.match(cvPlainText(m), /tutoring at Example North/);
  });
  it("a venue-only line does not make another entry's hidden venue public (the person settles it)", () => {
    const vo = entry({ section: "teaching", title: "Reading Tutor", venue: VENUE, year: 2018, names_facility: true });
    const set = applyTitleMode(s, vo.id, "venue_only")!;
    const m = buildCvModel([BA, tutor, vo], set, "teaching");
    assert.doesNotMatch(cvPlainText(m), /Example North/);
    assert.ok(m.omitted.some((o) => o.entryId === vo.id && o.reason === "names_hidden"));
    assert.equal(getCvStatus({ entries: [BA, tutor, vo], settings: set, cvType: "teaching", model: m }).state, "draft");
  });
  it("the artist resume: an entry it does not print never makes a venue public", () => {
    const show = entry({ section: "exhibition", title: "Group show", venue: VENUE, year: 2020, details: { kind: "group" } });
    const set = { ...applyTitleMode({ ...BASE, selection: [tutor.id] }, tutor.id, "leave_out")!, discipline: `Painter at ${VENUE}` };
    const m = buildArtistResumeModel([tutor, show], set);
    assert.equal(m.header.discipline, "");
  });
});

describe("N-M2: the officer test, every form, word boundaries only", () => {
  const officers: [string, string][] = [
    ["Case manager", "Federal Bureau of Prisons"],
    ["Case manager", "Example Federal Bureau of Prisons Office"],
    ["Counselor", "BOP"],
    ["Officer", "U.S. Pretrial Services"],
    ["Pretrial services officer", "Example County"],
    ["Case manager", "Example Residential Reentry Center"],
    ["Counselor", "Example RRC"],
    ["Case manager", "Example Halfway House"],
    ["Agent", "Example Community Corrections"],
    ["Officer", "Example Department of Corrections"],
    ["Counselor", "Example State DOC"],
    ["Unit manager", "Example State Prison"],
    ["Unit manager", "Example State Prisons"],
    ["Supervising agent", "Example County Jails"],
    ["Supervising agent", "Example County Jail"],
    ["Counselor", "Example Correctional Facility"],
    ["Probation and parole agent", "Example County"],
    ["Case managers", "Example Detention Center"],
  ];
  const prof = entry({ section: "reference", title: "Dr. Lee Sample", venue: "Example State University", year: 2020, details: { role: "Professor", contact: "lee@example.edu", consent: true } });
  for (const [role, venue] of officers) {
    it(`blocks as lead: ${role}, ${venue}`, () => {
      const ref = entry({ section: "reference", title: "M. Example", venue, year: 2024, details: { role, contact: "555-0101", consent: true } });
      assert.ok(looksLikeOfficer(ref));
      const st = getCvStatus({ entries: [BA, ref, prof], settings: { ...BASE, leadReference: ref.id }, cvType: "academic" });
      assert.equal(st.state, "draft");
      assert.ok(st.openItems.some((x) => x.rule === "CV-04" && x.severity === "BLOCK" && /officer/.test(x.question)));
    });
  }
  const clear: [string, string][] = [
    ["Loan officer", "Example Credit Union"],
    ["Counselor", "Example High School"],
    ["Unit manager", "Example Plastics"],
    ["Case manager", "Example Housing Authority"],
    ["Agent", "Example Realty"],
    ["Program officer", "Example Foundation"],
    ["Officer", "Example Bopper Club"],
    ["Counselor", "Example Docks"],
  ];
  for (const [role, venue] of clear) {
    it(`not an officer: ${role}, ${venue}`, () => {
      assert.ok(!looksLikeOfficer(entry({ section: "reference", title: "K. Example", venue, year: 2024, details: { role, consent: true } })));
    });
  }
});

describe("N-M3: honest study without a degree", () => {
  it("the person's choice is kept, and study is never also a degree", () => {
    assert.deepEqual(cleanDetails("education", { study: "toward_degree", degree: true }), { degree: false, study: "toward_degree" });
    assert.deepEqual(cleanDetails("education", { study: "made_up" }), {});
  });
  for (const [study, title, prints] of [
    ["toward_degree", "Associate of Arts", "Coursework toward Associate of Arts"],
    ["coursework", "Sociology", "Coursework in Sociology"],
    ["toward_degree", "Coursework toward an Associate of Arts (30 credits)", "Coursework toward an Associate of Arts (30 credits)"],
  ] as const) {
    it(`${study}: "${title}" prints as "${prints}", passes the degree gate, never reads as a degree`, () => {
      const e = entry({ section: "education", title, venue: "Example Valley College", year: 2023, details: cleanDetails("education", { study, status: "completed" }) });
      assert.equal(studyTitle(e), prints);
      assert.ok(degreeStatusKnown(e));
      const m = buildCvModel([BA, e], BASE, "academic");
      const text = cvPlainText(m);
      assert.match(text, new RegExp(`2023  ${prints.replace(/[()]/g, "\\$&")}, Example Valley College`));
      assert.doesNotMatch(text, /^2023  Associate/m);
      const st = getCvStatus({ entries: [BA, e], settings: BASE, cvType: "academic", model: m });
      assert.equal(st.state, "finished");
      assert.ok(!checkRecord([e], BASE).some((x) => x.rule === "STD-T03"), "answered: no degree nudge");
      // After the degrees (CAA order).
      assert.ok(text.indexOf("BA, Sociology") < text.indexOf(prints));
    });
  }
  it("in progress study keeps its status words", () => {
    const e = entry({ section: "education", title: "Bachelor of Science", venue: "Example Valley College", year: 2024, details: cleanDetails("education", { study: "toward_degree", status: "in_progress", expected: "2027" }) });
    assert.match(cvPlainText(buildCvModel([BA, e], BASE, "academic")), /Coursework toward Bachelor of Science, Example Valley College \(in progress, expected 2027\)/);
  });
  it("a title that already says it is not a degree prints; the nudge stays", () => {
    for (const title of ["Coursework toward an Associate of Arts (30 credits)", "Non-degree study in Sociology"]) {
      const e = entry({ section: "education", title, venue: "Example Valley College", year: 2024, details: { degree: false, status: "completed" } });
      const m = buildCvModel([BA, e], BASE, "academic");
      assert.ok(cvPlainText(m).includes(title));
      const st = getCvStatus({ entries: [BA, e], settings: BASE, cvType: "academic", model: m });
      assert.equal(st.state, "finished");
    }
  });
  it("a degree title marked 'not a degree' with no study kind is still held (it would read as a degree)", () => {
    const e = entry({ section: "education", title: "Master of Arts in Sociology", venue: "Example Valley College", year: 2024, details: { degree: false } });
    const m = buildCvModel([BA, e], BASE, "academic");
    assert.doesNotMatch(cvPlainText(m), /Master of Arts/);
    assert.ok(getCvStatus({ entries: [BA, e], settings: BASE, cvType: "academic", model: m }).openItems.some((x) => x.rule === "CV-05" && /classes without a degree/.test(x.question)));
  });
});

describe("N-M4 / N-L1: personal details, only short shapes in fields a person writes about themselves", () => {
  const mustPrint: [PracticeEntry["section"], Partial<PracticeEntry>][] = [
    ["presentation", { title: "Race: What Parole Boards Miss", venue: "Example Criminology Conference", details: { kind: "talk" } }],
    ["publication", { title: "Gender: A Reentry Reader", venue: "Example University Press", details: { status: "published" } }],
    ["publication", { title: "Religion: Faith Communities and Reentry", venue: "Journal of Example Studies", details: { status: "published" } }],
    ["publication", { title: "Single. A Memoir in Essays", venue: "Example Review", details: { status: "published" } }],
    ["membership", { title: "Member", venue: "Urban Citizen Science Network" }],
    ["membership", { title: "Member", venue: "American Citizen Journalism Guild" }],
    ["membership", { title: "American Citizen Journalism Guild" }],
    ["teaching", { title: "GED Instructor", venue: "Example Adult Learning Center", details: { level: "adults aged 18 to 60" } }],
    ["teaching", { title: "Reading Tutor", venue: "Example Head Start", details: { level: "children 4 years old" } }],
    ["research", { title: "Health of children born 2000-2005 in Example County", venue: "Example State University", details: { role: "Research assistant" } }],
    ["appointment", { title: "Research Assistant, Nationality and Migration Lab", venue: "Example State University" }],
  ];
  for (const [section, o] of mustPrint) {
    it(`prints on a finished CV: ${section} "${o.title}"`, () => {
      const e = entry({ section, year: 2025, ...(o as Pick<PracticeEntry, "title">) });
      const m = buildCvModel([BA, e], BASE, "academic");
      assert.ok(m.sections.some((x) => (x.rows ?? []).some((r) => r.entryId === e.id)), "on the page");
      assert.equal(getCvStatus({ entries: [BA, e], settings: BASE, cvType: "academic", model: m }).state, "finished");
    });
  }
  for (const t of ["Race: policing and parole", "Religion: prison ministry history", "Citizenship and reentry policy; photo essays"]) {
    it(`Interests "${t}" prints`, () => {
      const s = { ...BASE, interests: t };
      const m = buildCvModel([BA], s, "academic");
      assert.ok(cvPlainText(m).includes(t));
      assert.equal(getCvStatus({ entries: [BA], settings: s, cvType: "academic", model: m }).state, "finished");
    });
  }
  const caught = [
    "Place of birth: Guadalajara, Mexico", "Birthplace - Guadalajara", "Nationality - Mexican", "Nationality: Mexican", "Born 2 March 1980",
    "born 2nd March 1980", "Passport no. X1234567", "Passport number: 123456789", "SSN 123-45-6789", "Social Security 123 45 6789", "123-45-6789",
    "45 y/o", "Status: married, two children", "Mexican national", "Dual citizenship (US and Mexico)", "Father of three", "Gender: female",
    "Member (place of birth: Guadalajara, Mexico)", "Peer mentor; DOB 1980-01-02",
  ];
  for (const t of caught) it(`caught: ${t}`, () => assert.ok(isPersonalDetail(t), t));
  it("a row with one in a field the person writes about themselves is held, with a neutral line", () => {
    const e = entry({ section: "membership", title: "Member (place of birth: Guadalajara, Mexico)", venue: "Example Society", year: 2024 });
    const m = buildCvModel([BA, e], BASE, "academic");
    assert.doesNotMatch(cvPlainText(m), /Guadalajara/);
    const st = getCvStatus({ entries: [BA, e], settings: BASE, cvType: "academic", model: m });
    assert.ok(st.openItems.some((x) => x.rule === "CV-03" && x.severity === "BLOCK" && !/Guadalajara/.test(x.line)));
    for (const line of exportOpenItemLines(st, [BA, e], BASE, "cv", shownEntryIds(m))) assert.doesNotMatch(line, /Guadalajara/);
  });
  it("a reference's contact line and a role are scanned", () => {
    const ref = entry({ section: "reference", title: "J. Sample", venue: "Example Co", year: 2020, details: { role: "Supervisor", contact: "555-0100; SSN 123-45-6789", consent: true } });
    assert.doesNotMatch(cvPlainText(buildCvModel([BA, ref], BASE, "academic")), /6789/);
  });
});

describe("N-L2 / N-L3: ID numbers in more shapes and rows; standard names and ZIP codes are fine", () => {
  const numbers = ["Registered Nurse 123-4567", "Pharmacy Technician 4471-2290", "Registered Nurse (lic RN 12 345 67)", "WI 1234567", "Member #4471229", "Clinical rotation (student ID 20231187)"];
  for (const t of numbers) it(`a number: ${t}`, () => assert.ok(hasLicenseNumber(t), t));
  const fine = ["ISO 27001 Lead Auditor", "ISO/IEC 27001:2022 Lead Implementer", "NCCER Core Curriculum 00101", "NCCER Module 00101-15", "ANSI/ASME B31.3 Process Piping", "NFPA 70E", "OSHA 30", "Welding 2019-2021", "Class of 2019 2020"];
  for (const t of fine) it(`not a number: ${t}`, () => assert.ok(!hasLicenseNumber(t), t));
  it("a ZIP code in an address is not a number; elsewhere five digits still are", () => {
    assert.ok(!hasLicenseNumber("Example County Health, 59923", { address: true }));
    assert.ok(!hasLicenseNumber("Example Clinic, Libby, MT 59923", { address: true }));
    assert.ok(hasLicenseNumber("Example County Health 59923"));
  });
  it("the record refuses a number in the title, the issuer or the state field", () => {
    for (const [title, venue, state] of [["Registered Nurse 123-4567", "State Board of Nursing", "WI"], ["Registered Nurse", "State Board of Nursing", "WI 1234567"]]) {
      assert.deepEqual(resolvePracticeEntry({ section: "license", title, venue, state, year: 2024, details: { credentialKind: "license", credentialStatus: "active" } }), { ok: false, error: "license_number" });
    }
    for (const [title, venue] of [["ISO 27001 Lead Auditor", "Example Certification Body"], ["NCCER Core Curriculum 00101", "NCCER"], ["Food Handler", "Example County Health, 59923"]]) {
      assert.ok(resolvePracticeEntry({ section: "license", title, venue, state: "MT", year: 2024, details: { credentialKind: "certification", credentialStatus: "active" } }).ok, title);
    }
  });
  it("an old license row with a number in the state field is held off the page", () => {
    const e = entry({ section: "license", title: "Registered Nurse", venue: "State Board of Nursing", state: "WI 1234567", year: 2023, details: { credentialKind: "license", credentialStatus: "active" } });
    const m = buildCvModel([BA, e], BASE, "clinical");
    assert.doesNotMatch(cvPlainText(m), /1234567/);
    assert.ok(getCvStatus({ entries: [BA, e], settings: BASE, cvType: "clinical", model: m }).openItems.some((x) => x.rule === "CV-02" && x.severity === "BLOCK"));
  });
  it("membership and clinical rows with a number are held, with a plain question", () => {
    const mem = entry({ section: "membership", title: "Member #4471229", venue: "Example Nurses Association", year: 2024 });
    const cl = entry({ section: "clinical", title: "Clinical rotation (student ID 20231187)", venue: "Example General Hospital", year: 2024, details: { hours: "120" } });
    const m = buildCvModel([BA, mem, cl], BASE, "clinical");
    assert.doesNotMatch(cvPlainText(m), /4471229|20231187/);
    const st = getCvStatus({ entries: [BA, mem, cl], settings: BASE, cvType: "clinical", model: m });
    assert.equal(st.openItems.filter((x) => x.rule === "CV-02" && /member number or ID number/.test(x.question)).length, 2);
    for (const line of exportOpenItemLines(st, [BA, mem, cl], BASE, "cv", shownEntryIds(m))) assert.doesNotMatch(line, /4471229|20231187/);
  });
});
