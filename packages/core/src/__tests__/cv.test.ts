/**
 * CV lanes (076): the CV assembled from the practice record, its section
 * order and length rule by sub-type, the lane's facility choices, D4 for
 * credentials, and the CV truth checks. Every person and place is invented.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveLaneSettings } from "../careerLaneShared";
import { LANE_INSERT_SQL } from "../careerLane";
import { resolvePracticeEntry, type PracticeEntry } from "../practiceRecordShared";
import { applyTitleMode, type CreativeKindSettings } from "../creativeLaneShared";
import { buildCvModel, cvPlainText, cvPageCap, CV_ORDER, credentialConfirmed } from "../cvShared";
import { getCvStatus } from "../cvChecks";
import { exportOpenItemLines } from "../creativeChecks";
import { CREATIVE_ARTIFACT_TYPES, ARTIFACT_CONTENT_UPDATE_SQL } from "../refineryArtifact";

let n = 0;
const id = () => `00000000-0000-4000-8000-${String(5000 + ++n).padStart(12, "0")}`;
function entry(p: Partial<PracticeEntry> & Pick<PracticeEntry, "section" | "title" | "year">): PracticeEntry {
  return { id: id(), user_id: "u", venue: null, city: null, state: null, end_year: null, details: {}, proof: "remembered", names_facility: false, created_at: "", updated_at: "", ...p };
}

const BA = entry({ section: "education", title: "BA, Sociology", venue: "Example State University", city: "Toledo", state: "OH", year: 2024, details: { degree: true, status: "conferred" } });
const INSIDE_COLLEGE = entry({ section: "education", title: "Associate of Arts", venue: "Example County Correctional Facility College Program", year: 2019, end_year: 2021, details: { degree: true, status: "conferred" }, names_facility: true });
const CERT = entry({ section: "education", title: "Certificate in Peer Support", venue: "Community College of Toledo", year: 2022, details: { degree: false } });
const PEER = entry({ section: "teaching", title: "Peer Literacy Tutor", venue: "Example County Correctional Facility", year: 2018, end_year: 2021, details: { level: "adult learners" }, names_facility: true });
const TA = entry({ section: "teaching", title: "Teaching Assistant", venue: "Example State University", year: 2023, details: { instructorOfRecord: false } });
const RA = entry({ section: "appointment", title: "Research Assistant", venue: "Reentry Lab, Example State University", city: "Toledo", state: "OH", year: 2023, end_year: 2024 });
const PUB = entry({ section: "publication", title: "Learning Behind the Wall", venue: "Journal of Adult Education", year: 2025, details: { status: "submitted", submittedWhen: "March 2025", authors: "R. Example and J. Sample" } });
const TALK = entry({ section: "presentation", title: "College in Prison, From the Inside", venue: "State Adult Education Conference", city: "Columbus", state: "OH", year: 2024, details: { kind: "talk" } });
const LIC_OK = entry({ section: "license", title: "Certified Peer Recovery Specialist", venue: "Ohio Certification Board", state: "OH", year: 2023, details: { credentialKind: "certification", credentialStatus: "active" } });
const LIC_NO_KIND = entry({ section: "license", title: "Food Handler", venue: "County Health Department", year: 2022 });
const REF_OK = entry({ section: "reference", title: "J. Sample", venue: "Example State University", year: 2023, details: { role: "Course instructor", contact: "jsample@example.edu", consent: true } });
const REF_NO = entry({ section: "reference", title: "A. Other", venue: "Somewhere", year: 2020, details: { role: "Supervisor" } });
const WORK = entry({ section: "work", title: "Night Bus", year: 2023, details: { medium: "ink", dimensions: "9 x 12 in" } });
const ALL = [BA, INSIDE_COLLEGE, CERT, PEER, TA, RA, PUB, TALK, LIC_OK, LIC_NO_KIND, REF_OK, REF_NO, WORK];
const BASE: CreativeKindSettings = { displayName: "Ray Example", basedIn: "Toledo, OH", email: "ray@example.com", interests: "Adult literacy and education inside prisons." };
const withModes = (m: "true_title" | "venue_only" | "leave_out"): CreativeKindSettings => applyTitleMode(applyTitleMode(BASE, INSIDE_COLLEGE.id, m), PEER.id, m)!;

describe("CV lane kind and sub-type (076)", () => {
  it("a CV lane always has a sub-type (academic by default); other lanes never do", () => {
    const r = resolveLaneSettings({ name: "CV", kind: "cv" }, null);
    assert.ok(r.ok && r.value.cv_type === "academic");
    const t = resolveLaneSettings({ name: "CV", kind: "cv", cvType: "clinical" }, null);
    assert.ok(t.ok && t.value.cv_type === "clinical");
    const x = resolveLaneSettings({ name: "Shop", kind: "resume", cvType: "clinical" }, null);
    assert.ok(x.ok && x.value.cv_type === null);
    assert.deepEqual(resolveLaneSettings({ name: "CV", kind: "cv", cvType: "fancy" }, null), { ok: false, error: "bad_cv_type" });
    assert.match(LANE_INSERT_SQL, /kind, path, cv_type/);
  });
  it("the new record kinds validate like the rest; a talk says what kind it was", () => {
    assert.deepEqual(resolvePracticeEntry({ section: "presentation", title: "x", year: 2024 }), { ok: false, error: "kind_required" });
    const lic = resolvePracticeEntry({ section: "license", title: "x", year: 2024, details: { credentialKind: "guess", credentialStatus: "active", number: "123" } });
    assert.ok(lic.ok && lic.value.details.credentialKind === undefined && !("number" in lic.value.details));
  });
  it("a CV is a creative document type: only the creative routes write it", () => {
    assert.ok((CREATIVE_ARTIFACT_TYPES as readonly string[]).includes("cv"));
    assert.ok(ARTIFACT_CONTENT_UPDATE_SQL("").includes("'cv'"));
  });
});

describe("the CV, assembled from the record", () => {
  it("academic order: education, interests, appointments, publications, presentations, teaching, licensure, references", () => {
    const m = buildCvModel(ALL, withModes("true_title"), "academic");
    assert.deepEqual(m.sections.map((s) => s.key), ["education", "interests", "appointment", "publication", "presentation", "teaching", "license", "reference"]);
  });
  it("clinical puts licensure up front; teaching puts teaching up front", () => {
    assert.equal(buildCvModel(ALL, withModes("true_title"), "clinical").sections[1].key, "license");
    assert.equal(buildCvModel(ALL, withModes("true_title"), "teaching").sections.find((s) => s.rows)!.key, "education");
    assert.deepEqual(buildCvModel(ALL, withModes("true_title"), "teaching").sections.map((s) => s.key).slice(0, 3), ["education", "interests", "teaching"]);
  });
  it("every row is dated, newest first; degrees before study without a degree", () => {
    const m = buildCvModel(ALL, withModes("true_title"), "academic");
    const ed = m.sections.find((s) => s.key === "education")!.rows!;
    assert.deepEqual(ed.map((r) => r.entryId), [BA.id, INSIDE_COLLEGE.id, CERT.id]);
    for (const s of m.sections) for (const r of s.rows ?? []) assert.match(r.years, /^\d{4}(-\d{4})?$/);
  });
  it("exact titles: instructor of record only when true; a submitted piece says submitted and when", () => {
    const text = cvPlainText(buildCvModel(ALL, withModes("true_title"), "academic"));
    assert.match(text, /2023  Teaching Assistant, Example State University$/m);
    assert.ok(!/instructor of record/.test(text));
    assert.match(text, /R\. Example and J\. Sample\. "Learning Behind the Wall," Journal of Adult Education \(submitted March 2025\)/);
    assert.match(text, /"College in Prison, From the Inside," State Adult Education Conference, Columbus, OH \(talk\)/);
  });
  it("inside education and teaching: true title, venue only, or left off, never softened", () => {
    const truth = cvPlainText(buildCvModel(ALL, withModes("true_title"), "academic"));
    assert.match(truth, /2019-2021  Associate of Arts, Example County Correctional Facility College Program/);
    assert.match(truth, /2018-2021  Peer Literacy Tutor, Example County Correctional Facility, adult learners/);
    const venue = cvPlainText(buildCvModel(ALL, withModes("venue_only"), "academic"));
    assert.match(venue, /2019-2021  Study, Example County Correctional Facility College Program/);
    assert.ok(!/Associate of Arts|Peer Literacy Tutor/.test(venue));
    const off = cvPlainText(buildCvModel(ALL, withModes("leave_out"), "academic"));
    assert.ok(!/Example County|Associate of Arts|Peer Literacy/.test(off));
    const unset = buildCvModel(ALL, BASE, "academic");
    assert.deepEqual(unset.needsChoice.sort(), [INSIDE_COLLEGE.id, PEER.id].sort());
    assert.ok(!/Example County/.test(cvPlainText(unset)));
  });
  it("D4: a credential prints only with the person's kind and status; a reference only with their OK", () => {
    const text = cvPlainText(buildCvModel(ALL, withModes("true_title"), "academic"));
    assert.match(text, /Certification: Certified Peer Recovery Specialist, Ohio Certification Board, OH \(Active\)/);
    assert.ok(!/Food Handler/.test(text));
    assert.ok(credentialConfirmed(LIC_OK) && !credentialConfirmed(LIC_NO_KIND));
    assert.match(text, /J\. Sample, Course instructor, Example State University, jsample@example\.edu/);
    assert.ok(!/A\. Other/.test(text));
  });
  it("works are never on a CV; there is no photo or birth date field at all", () => {
    const text = cvPlainText(buildCvModel(ALL, withModes("true_title"), "academic"));
    assert.ok(!/Night Bus/.test(text));
    for (const order of Object.values(CV_ORDER)) for (const d of order) assert.ok(!/photo|birth/i.test(d.heading));
  });
  it("length by sub-type (C1): international two pages at most, the rest as long as the record", () => {
    assert.equal(cvPageCap("international"), 2);
    assert.equal(cvPageCap("academic"), null);
    assert.equal(cvPageCap("clinical"), null);
  });
});

describe("CV truth checks", () => {
  it("a clean CV is finished; the open items have the getResumeStatus shape", () => {
    const entries = [BA, TA, RA, PUB, TALK, LIC_OK, REF_OK];
    const st = getCvStatus({ entries, settings: BASE, cvType: "academic", pages: 2 });
    assert.equal(st.state, "finished", JSON.stringify(st.openItems));
  });
  it("CV-02 (D4): a credential with no kind or status is a BLOCK and stays off the page", () => {
    const st = getCvStatus({ entries: ALL, settings: withModes("true_title"), cvType: "academic" });
    assert.ok(st.openItems.some((x) => x.rule === "CV-02" && x.severity === "BLOCK" && x.entryId === LIC_NO_KIND.id));
  });
  it("STD-R03: an inside entry with no choice is a BLOCK; its line never shows the title", () => {
    const st = getCvStatus({ entries: ALL, settings: BASE, cvType: "academic" });
    // The two choices (one-tap cards for a shared word "Example" are separate, combined review rulings).
    const r03 = st.openItems.filter((x) => x.rule === "STD-R03" && x.severity === "BLOCK" && x.answer !== "facility_word");
    assert.equal(r03.length, 2, JSON.stringify(r03));
    for (const l of exportOpenItemLines(st, ALL, BASE, "cv")) assert.ok(!/Example County|Associate of Arts|Peer Literacy/.test(l), l);
  });
  it("venue only: to-do lines show the venue-only rendering, never the title", () => {
    const s = withModes("venue_only");
    const st = getCvStatus({ entries: ALL, settings: s, cvType: "academic" });
    for (const x of st.openItems) assert.ok(!/Associate of Arts|Peer Literacy Tutor/.test(x.line), x.line);
  });
  it("CV-01: a row that differs from the record, or a moved year, is a BLOCK; lines use the current rendering", () => {
    const s = withModes("true_title");
    const m = buildCvModel(ALL, s, "academic");
    const bad = structuredClone(m);
    const row = bad.sections.find((x) => x.key === "teaching")!.rows!.find((r) => r.entryId === TA.id)!;
    row.parts = [{ text: "Adjunct Professor, Example State University" }];
    const st = getCvStatus({ entries: ALL, settings: s, cvType: "academic", model: bad });
    assert.ok(st.openItems.some((x) => x.rule === "CV-01" && x.entryId === TA.id));
    for (const x of st.openItems) assert.ok(!/Adjunct Professor/.test(x.line), x.line);
    const moved = structuredClone(m);
    moved.sections[0].rows![0].years = "2020";
    assert.ok(getCvStatus({ entries: ALL, settings: s, cvType: "academic", model: moved }).openItems.some((x) => x.rule === "STD-T05"));
  });
  it("CV-03: a birth date, age, family status or nationality in what the person typed is a BLOCK (exact words, no guessing)", () => {
    // Interests print on academic and teaching CVs only, so that case is checked on an academic CV.
    for (const [bad, cvType] of [[{ basedIn: "Toledo, OH. Born 1990" }, "international"], [{ interests: "Married, two kids." }, "academic"], [{ languages: "English. Nationality: US" }, "international"], [{ phone: "DOB 04/12/1990" }, "international"]] as const) {
      const st = getCvStatus({ entries: [BA], settings: { ...BASE, ...bad }, cvType });
      assert.ok(st.openItems.some((x) => x.rule === "CV-03" && x.severity === "BLOCK"), JSON.stringify(bad));
      for (const x of st.openItems.filter((i) => i.rule === "CV-03")) assert.ok(!/1990|Married|Nationality/.test(x.line), "the line never quotes it");
      assert.ok(!/1990|Married|Nationality|DOB/.test(cvPlainText(buildCvModel([BA], { ...BASE, ...bad }, cvType))), "and it never prints");
    }
    assert.ok(!getCvStatus({ entries: [BA], settings: BASE, cvType: "academic" }).openItems.some((x) => x.rule === "CV-03"));
  });
  it("CV-04: a reference without their OK is asked about; an officer is never the lead reference", () => {
    const st = getCvStatus({ entries: ALL, settings: withModes("true_title"), cvType: "academic" });
    assert.ok(st.openItems.some((x) => x.rule === "CV-04" && x.entryId === REF_NO.id));
    const officer = entry({ section: "reference", title: "P. Officer", venue: "County Probation", year: 2022, details: { role: "Probation officer", consent: true } });
    const st2 = getCvStatus({ entries: [BA, officer, { ...REF_OK, year: 2020 }], settings: BASE, cvType: "academic" });
    // Two references: the person picks the lead (never by year); an officer picked as lead BLOCKs.
    assert.ok(st2.openItems.some((x) => x.rule === "CV-04" && x.severity === "BLOCK" && x.line === "References"));
    const st3 = getCvStatus({ entries: [BA, officer, { ...REF_OK, year: 2020 }], settings: { ...BASE, leadReference: officer.id }, cvType: "academic" });
    assert.ok(st3.openItems.some((x) => x.rule === "CV-04" && x.severity === "BLOCK" && /corrections officer/.test(x.question)));
  });
  it("STD-F07: international past two pages is a BLOCK; academic has no page cap", () => {
    assert.ok(getCvStatus({ entries: [BA], settings: BASE, cvType: "international", pages: 3 }).openItems.some((x) => x.rule === "STD-F07"));
    assert.ok(!getCvStatus({ entries: [BA], settings: BASE, cvType: "academic", pages: 7 }).openItems.some((x) => x.rule === "STD-F07"));
  });
  it("teaching titles: 'Professor' without instructor of record is asked about (CR-07)", () => {
    const prof = entry({ section: "teaching", title: "Adjunct Professor", venue: "Example State University", year: 2024 });
    assert.ok(getCvStatus({ entries: [prof], settings: BASE, cvType: "teaching" }).openItems.some((x) => x.rule === "CR-07"));
  });
});

describe("migration 076", () => {
  const sql = readFileSync(join(__dirname, "..", "..", "migrations", "076_cv_lanes.sql"), "utf8");
  it("sets lock_timeout, keeps owner-only tables, carries a rollback note", () => {
    assert.match(sql, /^SET LOCAL lock_timeout = '5s';/m);
    assert.match(sql, /ROLLBACK, in this order/);
    assert.match(sql, /smr_widen_list_check\('career_lane', 'kind', 'career_lane_kind_check', ARRAY\['resume', 'creative', 'cv'\]\)/);
    const code = sql.split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n");
    assert.doesNotMatch(code, /DROP CONSTRAINT IF EXISTS (career_lane_kind_check|refinery_artifact_artifact_type_check|practice_entry_section_check)/);
    // Review s2 LOW 1 and LOW 8: rollback frees CV-lane rows first; apply in one transaction.
    const rollback = sql.slice(sql.indexOf("ROLLBACK, in this order"));
    const free = rollback.indexOf("UPDATE refinery_artifact SET lane_id = NULL WHERE lane_id IN (SELECT id FROM career_lane WHERE kind = 'cv');");
    assert.ok(free > 0 && free < rollback.indexOf("DELETE FROM"), "the rollback's first statement frees rows saved in a CV lane");
    assert.match(sql, /psql -1/);
    assert.match(sql, /career_lane_cv_type_shape/);
    for (const s of ["research", "presentation", "clinical", "license", "service", "appointment", "membership", "reference"]) assert.ok(sql.includes(`'${s}'`), s);
    assert.ok(sql.includes("'cv'"));
  });
});
