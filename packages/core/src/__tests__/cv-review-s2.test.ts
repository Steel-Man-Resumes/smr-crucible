/**
 * Slice 2 review fixes (CV lanes): status words survive every rendering (H1),
 * every typed field and record row is checked against what the lane hides
 * (H2), degrees print only with a known status (M1), the person picks the lead
 * reference and an officer never leads (M2), personal details by pattern both
 * ways (M3), license numbers never print (M4). Every person and place is
 * invented.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { CV_TYPES, type CvType } from "../careerLaneShared";
import {
  CREDENTIAL_KINDS,
  CREDENTIAL_STATUSES,
  PUBLICATION_STATUSES,
  resolvePracticeEntry,
  type PracticeEntry,
} from "../practiceRecordShared";
import {
  applyTitleMode,
  artistResumePlainText,
  buildArtistResumeModel,
  CREDENTIAL_STATUS_WORD,
  publicationStatusWords,
  rowText,
  type CreativeKindSettings,
} from "../creativeLaneShared";
import { buildCvModel, cvPlainText, isPersonalDetail, LICENSE_NUMBER_RE } from "../cvShared";
import { getCvStatus, looksLikeOfficer } from "../cvChecks";
import { getCreativeStatus, exportOpenItemLines } from "../creativeChecks";

let n = 0;
const id = () => `00000000-0000-4000-8000-${String(7000 + ++n).padStart(12, "0")}`;
function entry(p: Partial<PracticeEntry> & Pick<PracticeEntry, "section" | "title" | "year">): PracticeEntry {
  return { id: id(), user_id: "u", venue: null, city: null, state: null, end_year: null, details: {}, proof: "remembered", names_facility: false, created_at: "", updated_at: "", ...p };
}
const FACILITY = "Example County Correctional Facility";
const BASE: CreativeKindSettings = { displayName: "Ray Example", basedIn: "Toledo, OH", email: "ray@example.com" };
const BA = entry({ section: "education", title: "BA, Sociology", venue: "Example State University", year: 2024, details: { degree: true, status: "conferred" } });

/** The status word an entry must carry wherever it prints. */
function statusWord(e: PracticeEntry): string | null {
  if (e.section === "publication") return publicationStatusWords(e) || null;
  if (e.section === "license") return CREDENTIAL_STATUS_WORD[e.details.credentialStatus as string] ?? null;
  if ((e.section === "education" || e.section === "arts_program") && e.details.status === "in_progress") return "in progress";
  return null;
}

/** Every status-bearing entry, each both inside (names a facility) and outside. */
function statusEntries(): PracticeEntry[] {
  const out: PracticeEntry[] = [];
  for (const inside of [false, true]) {
    const venue = inside ? FACILITY : "Example State University";
    const nf = { names_facility: inside };
    for (const status of PUBLICATION_STATUSES) {
      out.push(entry({ section: "publication", title: `Notes on Reading ${status}`, venue: inside ? `${FACILITY} Newsletter` : "Journal of Adult Education", year: 2024, details: { status, ...(status === "submitted" ? { submittedWhen: "March 2025" } : {}) }, ...nf }));
    }
    for (const credentialKind of CREDENTIAL_KINDS) {
      for (const credentialStatus of CREDENTIAL_STATUSES) {
        out.push(entry({ section: "license", title: `Welding ${credentialKind} ${credentialStatus}`, venue, year: 2023, details: { credentialKind, credentialStatus }, ...nf }));
      }
    }
    out.push(entry({ section: "education", title: "Associate of Arts", venue, year: 2023, details: { degree: true, status: "in_progress", expected: "2027" }, ...nf }));
    out.push(entry({ section: "arts_program", title: "Printmaking Workshop", venue, year: 2023, details: { status: "in_progress" }, ...nf }));
  }
  return out;
}

const MODES = ["true_title", "venue_only", "leave_out"] as const;
function settingsFor(entries: PracticeEntry[], mode: (typeof MODES)[number]): CreativeKindSettings {
  let s: CreativeKindSettings = BASE;
  for (const e of entries) if (e.names_facility) s = applyTitleMode(s, e.id, mode)!;
  return s;
}

describe("H1: status words survive every rendering (kind x title choice x status)", () => {
  const entries = statusEntries();
  for (const mode of MODES) {
    const s = settingsFor(entries, mode);
    for (const cvType of CV_TYPES) {
      it(`CV ${cvType}, facility entries ${mode}`, () => {
        const m = buildCvModel(entries, s, cvType);
        const rows = new Map(m.sections.flatMap((x) => x.rows ?? []).map((r) => [r.entryId, rowText(r.parts)]));
        const st = getCvStatus({ entries, settings: s, cvType, model: m });
        for (const e of entries) {
          const word = statusWord(e);
          const row = rows.get(e.id);
          if (row !== undefined) {
            if (word) assert.ok(row.includes(word), `${cvType}/${mode}: "${row}" must say "${word}"`);
          } else if (mode === "leave_out" && e.names_facility) {
            // Left off on purpose: never on the page.
          } else {
            // Not printed (this sub-type has no section for it, or held): if held, a BLOCK says so.
            const held = m.omitted.find((o) => o.entryId === e.id);
            if (held) assert.ok(st.openItems.some((x) => x.severity === "BLOCK" && x.entryId === e.id) || held.reason === "not_selected", `${e.title} held as ${held.reason} with no BLOCK`);
          }
        }
        // The plain text carries the same words as the rows.
        const txt = cvPlainText(m);
        for (const [, row] of rows) assert.ok(txt.includes(row));
      });
    }
    it(`artist resume, facility entries ${mode}`, () => {
      const m = buildArtistResumeModel(entries, s);
      const txt = artistResumePlainText(m);
      for (const sec of m.sections) {
        for (const r of sec.rows) {
          const e = entries.find((x) => x.id === r.entryId)!;
          const word = statusWord(e);
          if (word) assert.ok(rowText(r.parts).includes(word), `artist/${mode}: "${rowText(r.parts)}" must say "${word}"`);
          assert.ok(txt.includes(rowText(r.parts)));
        }
      }
    });
  }
  it("venue only on a license prints the kind and the status, never the title", () => {
    const lic = entry({ section: "license", title: "Barber License", venue: FACILITY, year: 2022, details: { credentialKind: "license", credentialStatus: "expired" }, names_facility: true });
    const m = buildCvModel([lic], applyTitleMode(BASE, lic.id, "venue_only")!, "clinical");
    const row = rowText(m.sections.find((x) => x.key === "license")!.rows![0].parts);
    assert.match(row, /License/);
    assert.match(row, /\(Expired\)/);
    assert.doesNotMatch(row, /Barber/);
  });
});

describe("H2: every typed field and record row is checked against what the lane hides", () => {
  const inside = entry({ section: "teaching", title: "Peer Literacy Tutor", venue: FACILITY, year: 2020, names_facility: true });
  const hide = applyTitleMode(BASE, inside.id, "leave_out")!;
  const fields = ["displayName", "discipline", "basedIn", "email", "phone", "website", "interests", "languages"] as const;
  for (const f of fields) {
    it(`${f} naming a hidden facility is held off the page with a neutral BLOCK`, () => {
      const s = { ...hide, [f]: `Work at ${FACILITY}` };
      for (const cvType of CV_TYPES) {
        const m = buildCvModel([BA, inside], s, cvType);
        assert.doesNotMatch(cvPlainText(m), /Correctional/, `${cvType}: never prints`);
        const shows = cvType === "academic" || cvType === "teaching" || !["interests"].includes(f);
        if (!shows) continue;
        const st = getCvStatus({ entries: [BA, inside], settings: s, cvType, model: m });
        assert.ok(st.openItems.some((x) => x.severity === "BLOCK"), `${cvType}/${f}: BLOCK`);
        for (const line of exportOpenItemLines(st, [BA, inside], s, "cv")) assert.doesNotMatch(JSON.stringify(line), /Correctional/);
      }
    });
  }
  it("a record row that is not marked but names the hidden facility is held too", () => {
    const award = entry({ section: "award", title: `${FACILITY} Art Prize`, year: 2021 });
    const m = buildCvModel([BA, inside, award], hide, "academic");
    assert.doesNotMatch(cvPlainText(m), /Correctional/);
    assert.ok(m.omitted.some((o) => o.entryId === award.id && o.reason === "names_hidden"));
    assert.ok(getCvStatus({ entries: [BA, inside, award], settings: hide, cvType: "academic", model: m }).openItems.some((x) => x.severity === "BLOCK" && x.entryId === award.id));
  });
  it("part of a hidden title counts (2+ real words, s2r2 N-H1), but a phrase already on the page does not", () => {
    const tutor = entry({ section: "teaching", title: "Inside Teaching Program GED tutor", venue: "Example State Correctional Facility", year: 2019, names_facility: true });
    const s = { ...applyTitleMode(BASE, tutor.id, "leave_out")!, languages: "Spanish; tutoring (Inside Teaching Program)" };
    const m = buildCvModel([BA, tutor], s, "teaching");
    assert.doesNotMatch(cvPlainText(m), /Inside Teaching Program/);
    assert.ok(getCvStatus({ entries: [BA, tutor], settings: s, cvType: "teaching", model: m }).openItems.some((x) => x.severity === "BLOCK"));
    // Two real words of it count now (review s2r2 N-H1).
    const s1 = { ...applyTitleMode(BASE, tutor.id, "leave_out")!, languages: "Teaching program design" };
    assert.doesNotMatch(cvPlainText(buildCvModel([BA, tutor], s1, "teaching")), /Teaching program/);
    // Stopword runs and mid-word overlaps never count.
    for (const ok of ["Spanish; GED tutoring", "Restart in prison reform research"]) {
      const s2 = { ...applyTitleMode(BASE, tutor.id, "leave_out")!, languages: ok };
      assert.match(cvPlainText(buildCvModel([BA, tutor], s2, "teaching")), new RegExp(ok.split(";")[0]), ok);
    }
    // Venue only: the venue is on the page, so its words never hold the entry's own row.
    const vo = entry({ section: "teaching", title: "GED Tutor, Example State Correctional Facility", venue: "Example State Correctional Facility", year: 2019, names_facility: true });
    const m2 = buildCvModel([BA, vo], applyTitleMode(BASE, vo.id, "venue_only")!, "teaching");
    assert.match(cvPlainText(m2), /Example State Correctional Facility/);
    assert.ok(!m2.omitted.some((o) => o.entryId === vo.id));
    // A shown outside entry that shares a phrase with a hidden title stays.
    const outside = entry({ section: "education", title: "Adult Basic Education Certificate", venue: "Example Community College", year: 2022, details: { degree: false } });
    const inside2 = entry({ section: "teaching", title: "Adult Basic Education Instructor", venue: FACILITY, year: 2019, names_facility: true });
    const m3 = buildCvModel([BA, outside, inside2], applyTitleMode(BASE, inside2.id, "leave_out")!, "teaching");
    assert.match(cvPlainText(m3), /Adult Basic Education Certificate/);
  });
  it("the artist resume holds typed fields the same way", () => {
    const s = { ...hide, discipline: `Painter, ${FACILITY}` };
    const m = buildArtistResumeModel([inside], s);
    assert.doesNotMatch(artistResumePlainText(m), /Correctional/);
    assert.ok(getCreativeStatus({ entries: [inside], settings: s, artistResume: { model: m } }).openItems.some((x) => x.severity === "BLOCK"));
  });
});

describe("M1: a degree prints only conferred, or in progress with an expected year", () => {
  const cases: [Record<string, unknown>, boolean][] = [
    [{ degree: true, status: "conferred" }, true],
    [{ degree: true, status: "in_progress", expected: "2027" }, true],
    [{ degree: true, status: "in_progress", expected: "spring 2027" }, true],
    [{ degree: true, status: "in_progress" }, false],
    [{ degree: true, status: "in_progress", expected: "soon" }, false],
    [{ degree: true, status: "completed" }, false],
    [{ degree: true }, false],
    [{}, false],
  ];
  for (const [details, prints] of cases) {
    it(`${JSON.stringify(details)} ${prints ? "prints" : "BLOCKs"}`, () => {
      const e = entry({ section: "education", title: "MA, Education", venue: "Example State University", year: 2025, details });
      const m = buildCvModel([e], BASE, "academic");
      const st = getCvStatus({ entries: [e], settings: BASE, cvType: "academic", model: m });
      if (prints) {
        assert.match(cvPlainText(m), /MA, Education/);
        if (details.status === "in_progress") assert.match(cvPlainText(m), /in progress, expected/);
      } else {
        assert.doesNotMatch(cvPlainText(m), /MA, Education/);
        assert.ok(st.openItems.some((x) => x.rule === "CV-05" && x.severity === "BLOCK"));
        assert.equal(st.state, "draft");
      }
    });
  }
  it("a certificate (not a degree) prints without a status", () => {
    const cert = entry({ section: "education", title: "Certificate in Peer Support", venue: "Example Community College", year: 2022, details: { degree: false } });
    assert.match(cvPlainText(buildCvModel([cert], BASE, "academic")), /Certificate in Peer Support/);
  });
});

describe("M2: the person picks the lead reference; an officer never leads", () => {
  const teacher = entry({ section: "reference", title: "J. Sample", venue: "Example State University", year: 2024, details: { role: "Course instructor", consent: true } });
  const boss = entry({ section: "reference", title: "K. Other", venue: "Example Print Shop", year: 2019, details: { role: "Supervisor", consent: true } });
  it("two references and no choice: BLOCK, never ordered by year", () => {
    const st = getCvStatus({ entries: [BA, teacher, boss], settings: BASE, cvType: "academic" });
    assert.ok(st.openItems.some((x) => x.rule === "CV-04" && x.severity === "BLOCK"));
    assert.equal(st.state, "draft");
  });
  it("the chosen lead prints first, even when older", () => {
    const s = { ...BASE, leadReference: boss.id };
    const m = buildCvModel([BA, teacher, boss], s, "academic");
    assert.equal(m.sections.find((x) => x.key === "reference")!.rows![0].entryId, boss.id);
    assert.ok(!getCvStatus({ entries: [BA, teacher, boss], settings: s, cvType: "academic", model: m }).openItems.some((x) => x.rule === "CV-04"));
  });
  const officers: Partial<PracticeEntry>[] = [
    { title: "P. Officer", venue: "County Probation", details: { role: "Probation officer", consent: true } },
    { title: "Q. Agent", venue: "State Parole Board", details: { role: "Agent", consent: true } },
    { title: "R. Smith", venue: "Example County Jail", details: { role: "Officer", consent: true } },
    { title: "S. Lee, PO", venue: "Example Reentry Office", details: { role: "", consent: true } },
    { title: "T. Ray", venue: "Department of Corrections", details: { role: "Case manager", consent: true } },
    { title: "U. Day", venue: "Example County Sheriff", details: { role: "Officer", consent: true } },
  ];
  for (const o of officers) {
    it(`officer as chosen lead BLOCKs: ${o.details!.role || o.title}`, () => {
      const off = entry({ section: "reference", year: 2023, ...(o as Pick<PracticeEntry, "title">) });
      assert.ok(looksLikeOfficer(off));
      const s = { ...BASE, leadReference: off.id };
      const st = getCvStatus({ entries: [BA, teacher, off], settings: s, cvType: "academic" });
      assert.ok(st.openItems.some((x) => x.rule === "CV-04" && x.severity === "BLOCK" && x.entryId === off.id));
      // Alone, an officer is the lead by default: still BLOCK.
      assert.ok(getCvStatus({ entries: [BA, off], settings: BASE, cvType: "academic" }).openItems.some((x) => x.rule === "CV-04" && x.severity === "BLOCK"));
    });
  }
  for (const role of ["Loan officer", "Case manager", "Program officer", "Supervisor"]) {
    it(`not an officer without a corrections word: ${role}`, () => {
      assert.ok(!looksLikeOfficer(entry({ section: "reference", title: "V. Hill", venue: "Example Credit Union", year: 2023, details: { role, consent: true } })));
    });
  }
});

describe("M3: personal details by pattern, both ways", () => {
  const caught = [
    "Born 1990", "born in 1985", "Born: March 4, 1990", "born 04/12/1990", "DOB 04/12/1990", "Date of birth: 4 March 1990",
    "Age 34", "aged 41", "34 years old", "29 yrs old", "Married", "Married, two kids.", "Single.", "Divorced with 2 children",
    "Spouse: Ana", "Marital status: single", "US citizen", "American citizen", "Citizen of Mexico", "Nationality: US",
    "Citizenship: Canadian", "Photo attached", "headshot below",
  ];
  const clear = [
    "Citizenship and reentry policy; photo essays", "Marital status and recidivism", "Born-digital archives",
    "Submitted 03/15/2025", "Voting rights and citizenship", "Photo essays on single parents", "Married couples in reentry research",
    "Age-friendly cities", "Citizen science in reentry", "Adult literacy and education inside prisons", "Single-case design", "Spanish and English",
  ];
  for (const t of caught) it(`caught: ${t}`, () => assert.ok(isPersonalDetail(t), t));
  for (const t of clear) it(`clear: ${t}`, () => assert.ok(!isPersonalDetail(t), t));
  it("a record row with a birth date is held with a neutral line", () => {
    const e = entry({ section: "award", title: "Scholar award (born 1990)", year: 2020 });
    const m = buildCvModel([BA, e], BASE, "academic");
    assert.doesNotMatch(cvPlainText(m), /1990/);
    const st = getCvStatus({ entries: [BA, e], settings: BASE, cvType: "academic", model: m });
    assert.ok(st.openItems.some((x) => x.rule === "CV-03" && x.severity === "BLOCK" && !/1990/.test(x.line)));
  });
  it("real research interests print and stay finished", () => {
    const s = { ...BASE, interests: "Citizenship and reentry policy; photo essays" };
    const m = buildCvModel([BA], s, "academic");
    assert.match(cvPlainText(m), /Citizenship and reentry policy/);
    assert.ok(!getCvStatus({ entries: [BA], settings: s, cvType: "academic", model: m }).openItems.some((x) => x.rule === "CV-03"));
  });
});

describe("M4: a license number never prints", () => {
  const shapes = ["Barber License #48213", "Barber License No. 48213", "License number 48213", "Cosmetology CS-1234567", "CDL A 0012345678", "RN 1234567"];
  for (const t of shapes) {
    it(`refused on save and held on the page: ${t}`, () => {
      assert.ok(LICENSE_NUMBER_RE.test(t));
      assert.deepEqual(resolvePracticeEntry({ section: "license", title: t, year: 2023, details: { credentialKind: "license", credentialStatus: "active" } }), { ok: false, error: "license_number" });
      // A row already stored with a number (written before this rule): held, BLOCK, never printed.
      const e = entry({ section: "license", title: t, venue: "State Board", year: 2023, details: { credentialKind: "license", credentialStatus: "active" } });
      const m = buildCvModel([BA, e], BASE, "clinical");
      assert.doesNotMatch(cvPlainText(m), /48213|1234567|0012345678/);
      assert.ok(getCvStatus({ entries: [BA, e], settings: BASE, cvType: "clinical", model: m }).openItems.some((x) => x.rule === "CV-02" && x.severity === "BLOCK"));
    });
  }
  it("a license without a number prints", () => {
    const e = entry({ section: "license", title: "Barber License", venue: "State Board", year: 2023, details: { credentialKind: "license", credentialStatus: "active" } });
    assert.match(cvPlainText(buildCvModel([e], BASE, "clinical")), /Barber License/);
  });
});

describe("every CV sub-type answers the same way for every entry kind (no crash, no unknown status)", () => {
  it("builds for all types", () => {
    const entries = statusEntries();
    for (const cvType of CV_TYPES as readonly CvType[]) {
      const m = buildCvModel(entries, settingsFor(entries, "true_title"), cvType);
      assert.ok(m.sections.length > 0);
    }
  });
});
