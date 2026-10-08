/**
 * CV lanes (slice 2): the pure half shared by routes, screens and the
 * renderer. No db import.
 *
 * A CV is ASSEMBLED from the practice record, never written fresh: every row
 * is one entry the person typed, dated, reverse chronological inside its
 * section, years at the left. Empty sections never show. The sub-type sets
 * the section order and the length rule (decision C1): academic, teaching
 * and clinical CVs run as long as the true record (never filler); an
 * international CV follows the resume rule, two pages at most (D8).
 *
 * The lane's CURRENT choices are the single source: which entries are picked,
 * and for an entry that names a facility (a college-in-prison program, peer
 * facilitation inside), the true title, a venue-only line, or leave it out.
 * Never a softened title. Never a photo, birth date, marital status or
 * nationality: there is no field for any of them.
 */

import type { CvType } from "./careerLaneShared";
import { type PracticeEntry, type PracticeSection, hasLicenseNumber, placeOf, yearsOf } from "./practiceRecordShared";
import {
  type ArtistRow,
  type CreativeKindSettings,
  type Part,
  CREDENTIAL_KIND_WORD,
  CREDENTIAL_STATUS_WORD,
  artistRowParts,
  hiddenFacilityTerms,
  namesHiddenFacility,
  rowCheckText,
  studyTitle,
  titleModeFor,
} from "./creativeLaneShared";

/**
 * Personal details (CV-03) by SHAPE, never by single words (review s2r2
 * N-M4). A field is cut into pieces at ; | ( ) [ ] , and at the end of a
 * sentence, and a shape counts only where a piece STARTS with it: "Gender:
 * female" or "Member (place of birth: ...)" are caught, a talk called "Race:
 * What Parole Boards Miss" or "Urban Citizen Science Network" are not. A
 * label (gender, race, religion, nationality...) counts only with a short
 * value of one or two words. Passport and Social Security numbers count
 * anywhere. A bare date alone ("Submitted 03/15/2025") is not one.
 *
 * buildCvModel runs this only on fields where a person writes about
 * themselves (the top of the page, Interests and Languages, a role, a job
 * title, a reference's contact line). Titles of works, publications, talks
 * and studies, organization names and who a class was for are never scanned.
 */
const PIECE = String.raw`(?:^|[;|()\[\]\n,]\s*|[.!?]\s+)`;
const PIECE_END = String.raw`\s*(?:$|[;|()\[\]\n,.!?])`;
const SHORT_VALUE = String.raw`[^\s;|()\[\]\n,.!?]+(?:\s+[^\s;|()\[\]\n,.!?]+)?`;
const NUMBER_WORD = String.raw`(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten)`;
const at = (body: string) => new RegExp(PIECE + body, "i");
export const CV_PERSONAL_PATTERNS: RegExp[] = [
  // born + a date: "Born 1990", "born in 1985", "Born: March 4, 1990", "born 04/12/1990", "Born 2 March 1980"
  at(String.raw`born\b[\s,:]*(?:on\s+|in\s+)?(?:\d{1,2}[/.-]\d{1,2}[/.-]|\d{1,2}(?:st|nd|rd|th)?\s+[a-z]{3,9}\.?,?\s+|[a-z]{3,9}\.?\s+\d{1,2}(?:st|nd|rd|th)?,?\s+)?(?:19|20)\d{2}\b`),
  // a date-of-birth or place-of-birth label with something after it
  at(String.raw`(?:d\.?o\.?b\.?|date of birth|birth ?date|birthday)\s*[:\-–]?\s*[\da-z]`),
  at(String.raw`(?:place of birth|birth ?place|country of birth)\s*[:\-–]?\s*\S`),
  // age: "Age 34", "aged 41", "34 years old", "29 yrs old", "45 y/o"
  at(String.raw`age[d]?\s*[:\-–]?\s*\d{1,3}\b`),
  at(String.raw`\d{1,3}\s*(?:(?:years?|yrs?)\.?\s*old\b|y\/o\b|y\.o\.?|yo\b)`),
  // family status standing alone, or as a label: "Married", "Single.", "Divorced with 2 children", "Status: married"
  at(String.raw`(?:married|single|divorced|widowed|separated)\s*(?:$|[,.;(]|\s+with\b|\s+\d|\s+and\s+\d)`),
  at(String.raw`(?:marital |family |civil )?status\s*[:\-–]\s*(?:married|single|divorced|widowed|separated|partnered)\b`),
  at(String.raw`(?:marital status|spouse|wife|husband|children|kids)\s*[:\-–]\s*\S`),
  at(String.raw`(?:father|mother|parent) of ${NUMBER_WORD}\b`),
  // citizenship standing alone: "US citizen", "American citizen", "Mexican national", "Citizen of Mexico", "Dual citizenship"
  at(String.raw`citizen of\b`),
  at(String.raw`(?:u\.?s\.?(?:a\.?)?|united states|[a-z]+(?:an|ese|ish|ch|i))\s+(?:citizen|national)` + PIECE_END),
  at(String.raw`dual (?:citizen|citizenship|nationality)\b`),
  // a label with a short value: "Nationality: US", "Nationality - Mexican", "Gender: female", "Race: Black"
  at(String.raw`(?:nationality|citizenship|gender|sex|religion|ethnicity|race)\s*[:\-–]\s*${SHORT_VALUE}` + PIECE_END),
  // a photo
  at(String.raw`(?:photo|picture)\s+(?:attached|enclosed|included|below)\b`),
  at(String.raw`headshot\b`),
  // ID numbers (anywhere): passport, Social Security
  /\bpassport\b\s*(?:no\.?|number|num\.?|#)?\s*[:\-]?\s*[a-z]{0,2}\d[a-z0-9]{4,}/i,
  /\b(?:ssn|social security(?:\s+(?:number|no\.?))?)\s*[:#\-]?\s*\d{3}[-\s]?\d{2}[-\s]?\d{4}\b/i,
  /\b\d{3}-\d{2}-\d{4}\b/,
];
export const CV_PERSONAL_RE = new RegExp(CV_PERSONAL_PATTERNS.map((r) => `(?:${r.source})`).join("|"), "i");
export function isPersonalDetail(text: string | null | undefined): boolean {
  return !!text && CV_PERSONAL_PATTERNS.some((r) => r.test(text));
}

/** Sections whose title is the person's own role or a name they gave (scanned). Every other title is a work, a talk, a study or an organization. */
const SCANNED_TITLE: ReadonlySet<PracticeSection> = new Set<PracticeSection>(["appointment", "service", "clinical", "teaching", "membership", "license", "award", "reference"]);
/** The fields of a row where a person might write about themselves (review s2r2 N-M4). Venues, works, talks, studies and who a class was for are left out. */
export function personalFieldsOf(e: PracticeEntry): string[] {
  const out: string[] = [];
  if (SCANNED_TITLE.has(e.section)) out.push(e.title);
  if (e.details.role) out.push(e.details.role);
  if (e.section === "reference" && e.details.contact) out.push(e.details.contact);
  return out;
}
/** True when a row carries a personal detail in a field the person writes about themselves. */
export function rowHasPersonalDetail(e: PracticeEntry): boolean {
  return personalFieldsOf(e).some(isPersonalDetail);
}

/** A license or certificate number (same shape the record refuses). */
export { LICENSE_NUMBER_SHAPE as LICENSE_NUMBER_RE } from "./practiceRecordShared";

/** Rows that may carry an ID number (review s2r2 N-L2): credentials, memberships, clinical placements. */
const NUMBER_SECTIONS: ReadonlySet<PracticeSection> = new Set<PracticeSection>(["license", "membership", "clinical"]);
/** True when a credential, membership or clinical row carries a license, member or ID number (title, venue or state). */
export function rowHasIdNumber(e: PracticeEntry): boolean {
  return NUMBER_SECTIONS.has(e.section) && (hasLicenseNumber(e.title) || hasLicenseNumber(e.venue, { address: true }) || hasLicenseNumber(e.state));
}

/** A title that reads as a degree (the bare word "degree" alone does not: "Non-degree study"). */
export const DEGREE_TITLE_RE = /\b(B\.?F\.?A|M\.?F\.?A|B\.?A|M\.?A|B\.?S|M\.?S|Ph\.?D|Ed\.?D|A\.?A|A\.?S|Associate'?s?|Bachelor'?s?|Master'?s?|Doctor\w*)\b/;
/** A title that already says it is study without a degree. */
const NON_DEGREE_RE = /\b(?:non-?degree|course ?work|classes|credits? (?:toward|towards|in))\b/i;
export function readsAsDegree(title: string): boolean {
  return DEGREE_TITLE_RE.test(title) && !NON_DEGREE_RE.test(title);
}

/**
 * A degree prints only once the person says it was conferred, or is in
 * progress WITH an expected year (STD-T03 on a CV). "Completed" (coursework
 * done, no degree conferred) and no status at all hold it off the page.
 * Study the person marked as coursework (toward a degree, or in a subject)
 * prints as coursework, never as a degree (review s2r2 N-M3).
 */
export function degreeStatusKnown(e: PracticeEntry): boolean {
  if (e.section !== "education") return true;
  if (e.details.study) return true;
  const isDegree = e.details.degree === true || readsAsDegree(e.title);
  if (!isDegree) return true;
  if (e.details.degree !== true) return false;
  if (e.details.status === "conferred") return true;
  return e.details.status === "in_progress" && /\b(19|20)\d{2}\b/.test(String(e.details.expected ?? ""));
}

export interface CvSection {
  key: string;
  heading: string;
  /** Dated rows (most sections). */
  rows?: ArtistRow[];
  /** A short paragraph in the person's own words (interests, languages). */
  text?: string;
}

export interface CvModel {
  cvType: CvType;
  header: { name: string; discipline: string; contact: string[] };
  sections: CvSection[];
  /** Entries a lane choice must settle before they show (R03). */
  needsChoice: string[];
  /** Entries kept off, and why. */
  omitted: {
    entryId: string;
    reason: "not_selected" | "leave_out" | "needs_choice" | "needs_kind" | "no_consent" | "needs_status" | "license_number" | "personal" | "names_hidden";
  }[];
  /** Typed fields kept off the page, and why (they never print while this holds). */
  heldFields: { field: "displayName" | "discipline" | "basedIn" | "email" | "phone" | "website" | "interests" | "languages"; reason: "personal" | "names_hidden" }[];
  /** The reference the person chose to lead (null when none is chosen). */
  leadReference: string | null;
  trimmed: boolean;
}

/** Most pages a CV of this type may run (null: as long as the true record). */
export function cvPageCap(t: CvType): number | null {
  return t === "international" ? 2 : null;
}

export const CV_TYPE_COPY: Record<CvType, { label: string; body: string }> = {
  academic: { label: "Academic or research", body: "For colleges, research groups, fellowships. As long as your real record." },
  teaching: { label: "Teaching", body: "Teaching first. As long as your real record." },
  clinical: { label: "Clinical", body: "Licenses and clinical placements up front. As long as your real record." },
  international: { label: "International", body: "For jobs outside the US. Two pages at most, like a resume." },
};

type Def = { key: string; heading: string; take?: (e: PracticeEntry) => boolean; text?: "interests" | "languages" };
const S = (sections: PracticeSection[]) => (e: PracticeEntry) => sections.includes(e.section);

const EDUCATION: Def = { key: "education", heading: "Education", take: S(["education", "arts_program"]) };
const INTERESTS: Def = { key: "interests", heading: "Interests", text: "interests" };
const APPOINTMENTS: Def = { key: "appointment", heading: "Appointments and Employment", take: S(["appointment"]) };
const RESEARCH: Def = { key: "research", heading: "Research Experience", take: S(["research", "residency"]) };
const PUBLICATIONS: Def = { key: "publication", heading: "Publications", take: S(["publication"]) };
const PRESENTATIONS: Def = { key: "presentation", heading: "Presentations", take: S(["presentation"]) };
const AWARDS: Def = { key: "award", heading: "Grants, Awards and Fellowships", take: S(["award"]) };
const TEACHING: Def = { key: "teaching", heading: "Teaching", take: S(["teaching"]) };
const CLINICAL: Def = { key: "clinical", heading: "Clinical Experience", take: S(["clinical"]) };
const LICENSES: Def = { key: "license", heading: "Licensure and Certification", take: S(["license"]) };
const SERVICE: Def = { key: "service", heading: "Service", take: S(["service"]) };
const MEMBERSHIPS: Def = { key: "membership", heading: "Memberships", take: S(["membership"]) };
const LANGUAGES: Def = { key: "languages", heading: "Languages and Skills", text: "languages" };
const REFERENCES: Def = { key: "reference", heading: "References", take: S(["reference"]) };

/** The conventional section order for each CV sub-type. */
export const CV_ORDER: Record<CvType, Def[]> = {
  academic: [EDUCATION, INTERESTS, APPOINTMENTS, RESEARCH, PUBLICATIONS, PRESENTATIONS, AWARDS, TEACHING, LICENSES, SERVICE, MEMBERSHIPS, LANGUAGES, REFERENCES],
  teaching: [EDUCATION, INTERESTS, TEACHING, APPOINTMENTS, PRESENTATIONS, PUBLICATIONS, AWARDS, LICENSES, SERVICE, MEMBERSHIPS, LANGUAGES, REFERENCES],
  clinical: [EDUCATION, LICENSES, CLINICAL, APPOINTMENTS, RESEARCH, PUBLICATIONS, PRESENTATIONS, AWARDS, SERVICE, MEMBERSHIPS, LANGUAGES, REFERENCES],
  international: [EDUCATION, { ...APPOINTMENTS, heading: "Work Experience" }, TEACHING, RESEARCH, PUBLICATIONS, PRESENTATIONS, AWARDS, LICENSES, SERVICE, MEMBERSHIPS, LANGUAGES, REFERENCES],
};

export { CREDENTIAL_KIND_WORD, CREDENTIAL_STATUS_WORD } from "./creativeLaneShared";

function commaJoin(parts: Part[]): Part[] {
  const kept = parts.filter((p) => p.text && p.text.trim());
  return kept.map((p, i) => (i < kept.length - 1 ? (/^".*"$/.test(p.text) ? { ...p, text: `${p.text.slice(0, -1)},"` } : { ...p, after: "," }) : { ...p }));
}

/** A license or certification prints only with the KIND the person picked and its STATUS (D4). */
export function credentialConfirmed(e: PracticeEntry): boolean {
  return e.section === "license" && !!e.details.credentialKind && !!e.details.credentialStatus;
}

/** One entry as a CV row, exactly from the record, in the lane's current rendering. */
export function cvRowParts(e: PracticeEntry, mode: "true_title" | "venue_only"): Part[] {
  // A credential: its KIND and STATUS print on every rendering (title shown or not).
  if (e.section === "license") {
    const d0 = e.details;
    const kind = CREDENTIAL_KIND_WORD[d0.credentialKind ?? ""] ?? "";
    const status = { text: `(${CREDENTIAL_STATUS_WORD[d0.credentialStatus ?? ""] ?? ""})` };
    const head = mode === "venue_only" ? kind : `${kind}: ${e.title}`;
    const row = commaJoin([{ text: head }, { text: e.venue ?? "" }, { text: e.state ?? "" }]);
    row.push(status);
    return row;
  }
  if (mode === "venue_only") return artistRowParts(e, "venue_only");
  const d = e.details;
  const place = placeOf(e);
  switch (e.section) {
    case "teaching": {
      const row = commaJoin([{ text: e.title }, { text: e.venue ?? "" }, { text: place }, { text: d.level ?? "" }]);
      if (d.instructorOfRecord) row.push({ text: "(instructor of record)" });
      return row;
    }
    case "appointment":
    case "service":
      return commaJoin([{ text: e.title }, { text: e.venue ?? "" }, { text: place }]);
    case "membership":
      return commaJoin([{ text: e.title }, { text: e.venue ?? "" }]);
    case "research":
      return commaJoin([{ text: e.title }, { text: d.role ?? "" }, { text: e.venue ?? "" }, { text: place }]);
    case "presentation": {
      const row = commaJoin([{ text: `"${e.title}"` }, { text: e.venue ?? "", italic: true }, { text: place }]);
      row.push({ text: `(${[d.kind ?? "", d.invited ? "invited" : ""].filter(Boolean).join(", ")})` });
      return row;
    }
    case "clinical": {
      const row = commaJoin([{ text: e.title }, { text: e.venue ?? "" }, { text: place }]);
      if (d.hours) row.push({ text: `(${d.hours} hours)` });
      return row;
    }
    case "reference":
      return commaJoin([{ text: e.title }, { text: d.role ?? "" }, { text: e.venue ?? "" }, { text: d.contact ?? "" }]);
    case "publication": {
      const row = artistRowParts(e, "true_title");
      return d.authors ? [{ text: d.authors, after: "." }, ...row] : row;
    }
    default:
      return artistRowParts(e, "true_title");
  }
}

function newestFirst(a: PracticeEntry, b: PracticeEntry): number {
  return (b.end_year ?? b.year) - (a.end_year ?? a.year) || b.year - a.year || a.title.localeCompare(b.title);
}

/** The CV, assembled from the record with this lane's current choices. */
export function buildCvModel(entries: PracticeEntry[], s: CreativeKindSettings | null | undefined, cvType: CvType): CvModel {
  const settings = s ?? {};
  const picked = Array.isArray(settings.selection) ? new Set(settings.selection.map((x) => x.toLowerCase())) : null;
  const omitted: CvModel["omitted"] = [];
  const needsChoice: string[] = [];
  // First pass: the rows this CV would print. Only these can make a hidden
  // facility name public (review s2r2 N-M1); an entry that is not on this CV
  // never does.
  const pending: { def: Def; rows: ArtistRow[]; trimmedHere: boolean }[] = [];
  for (const def of CV_ORDER[cvType]) {
    if (def.text) {
      pending.push({ def, rows: [], trimmedHere: false });
      continue;
    }
    let list = entries.filter(def.take!).sort(newestFirst);
    // Education: degrees first, then study without a degree (CAA rule).
    if (def.key === "education") list = [...list.filter((e) => e.section === "education" && e.details.degree), ...list.filter((e) => !(e.section === "education" && e.details.degree))];
    const rows: ArtistRow[] = [];
    let trimmedHere = false;
    for (const e of list) {
      if (picked && !picked.has(e.id.toLowerCase())) {
        omitted.push({ entryId: e.id, reason: "not_selected" });
        trimmedHere = true;
        continue;
      }
      const mode = titleModeFor(e, settings);
      if (mode === "unset") {
        needsChoice.push(e.id);
        omitted.push({ entryId: e.id, reason: "needs_choice" });
        continue;
      }
      if (mode === "leave_out") {
        omitted.push({ entryId: e.id, reason: "leave_out" });
        continue;
      }
      if (e.section === "license" && !credentialConfirmed(e)) {
        omitted.push({ entryId: e.id, reason: "needs_kind" });
        continue;
      }
      if (e.section === "reference" && !e.details.consent) {
        omitted.push({ entryId: e.id, reason: "no_consent" });
        continue;
      }
      if (!degreeStatusKnown(e)) {
        omitted.push({ entryId: e.id, reason: "needs_status" });
        continue;
      }
      if (rowHasIdNumber(e)) {
        omitted.push({ entryId: e.id, reason: "license_number" });
        continue;
      }
      if (rowHasPersonalDetail(e)) {
        omitted.push({ entryId: e.id, reason: "personal" });
        continue;
      }
      rows.push({ entryId: e.id, years: yearsOf(e), parts: cvRowParts(e, mode), mode });
    }
    pending.push({ def, rows, trimmedHere });
  }

  // The lane's hidden facility terms (built from what this CV prints) and the
  // personal-detail shapes apply to every typed field and every row: a hit
  // stays off the page (and blocks).
  const hidden = hiddenFacilityTerms(entries, settings, pending.flatMap((p) => p.rows.map((r) => r.entryId)));
  const heldFields: CvModel["heldFields"] = [];
  const safe = (field: CvModel["heldFields"][number]["field"]): string | undefined => {
    const t = settings[field];
    if (!t) return undefined;
    if (isPersonalDetail(t)) return void heldFields.push({ field, reason: "personal" });
    if (namesHiddenFacility(t, hidden)) return void heldFields.push({ field, reason: "names_hidden" });
    return t;
  };
  const sections: CvSection[] = [];
  let trimmed = false;
  for (const { def, rows: all, trimmedHere } of pending) {
    if (def.text) {
      const text = safe(def.text);
      if (text) sections.push({ key: def.key, heading: def.heading, text });
      continue;
    }
    const rows = all.filter((r) => {
      if (!namesHiddenFacility(rowCheckText(r), hidden)) return true;
      omitted.push({ entryId: r.entryId, reason: "names_hidden" });
      return false;
    });
    // References: the person's chosen lead first; never picked by year.
    if (def.key === "reference" && settings.leadReference) {
      const lead = rows.findIndex((r) => r.entryId.toLowerCase() === settings.leadReference!.toLowerCase());
      if (lead > 0) rows.unshift(...rows.splice(lead, 1));
    }
    if (trimmedHere) trimmed = true;
    if (rows.length) sections.push({ key: def.key, heading: trimmedHere ? `Selected ${def.heading}` : def.heading, rows });
  }
  const contact = (["basedIn", "email", "phone", "website"] as const).map(safe).filter((x): x is string => !!x);
  const name = safe("displayName") ?? "";
  const discipline = safe("discipline") ?? "";
  const refs = sections.find((x) => x.key === "reference")?.rows ?? [];
  const leadReference = settings.leadReference && refs[0]?.entryId.toLowerCase() === settings.leadReference.toLowerCase() ? refs[0].entryId : null;
  return { cvType, header: { name, discipline, contact }, sections, needsChoice, omitted, heldFields, leadReference, trimmed };
}

/** The CV as plain text. */
export function cvPlainText(m: CvModel): string {
  const lines: string[] = [];
  if (m.header.name) lines.push(m.header.name);
  if (m.header.discipline) lines.push(m.header.discipline);
  if (m.header.contact.length) lines.push(m.header.contact.join(" | "));
  for (const s of m.sections) {
    lines.push("", s.heading.toUpperCase());
    if (s.text) lines.push(s.text);
    for (const r of s.rows ?? []) lines.push(`${r.years}  ${r.parts.map((p) => p.text + (p.after ?? "")).join(" ")}`);
  }
  return lines.join("\n").trim();
}
