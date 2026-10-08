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
import { type PracticeEntry, type PracticeSection, placeOf, yearsOf } from "./practiceRecordShared";
import { type ArtistRow, type CreativeKindSettings, type Part, artistRowParts, titleModeFor } from "./creativeLaneShared";

/**
 * Words and date shapes that would put a birth date, age, family status,
 * nationality or photo on a CV. Exact words, no guessing. Typed text that
 * carries one never prints (and the checks ask about it).
 */
export const CV_PERSONAL_RE =
  /\b(born|d\.?o\.?b\.?|date of birth|birth ?date|birthday|age:?\s*\d{1,2}|\d{1,2}\s*years old|married|marital|divorced|widowed|nationality|citizenship|photo|headshot)\b|\b\d{1,2}[/.-]\d{1,2}[/.-](19|20)\d{2}\b/i;

const safe = (t: string | undefined): string | undefined => (t && !CV_PERSONAL_RE.test(t) ? t : undefined);

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
  omitted: { entryId: string; reason: "not_selected" | "leave_out" | "needs_choice" | "needs_kind" | "no_consent" }[];
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

export const CREDENTIAL_KIND_WORD: Record<string, string> = {
  license: "License", certification: "Certification", certificate: "Certificate", card: "Card", training: "Training",
};
export const CREDENTIAL_STATUS_WORD: Record<string, string> = {
  active: "Active", inactive: "Inactive", expired: "Expired", in_progress: "In progress", eligible: "Eligible to test",
};

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
    case "license": {
      const row = commaJoin([{ text: `${CREDENTIAL_KIND_WORD[d.credentialKind ?? ""] ?? ""}: ${e.title}` }, { text: e.venue ?? "" }, { text: e.state ?? "" }]);
      row.push({ text: `(${CREDENTIAL_STATUS_WORD[d.credentialStatus ?? ""] ?? ""})` });
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
  const sections: CvSection[] = [];
  let trimmed = false;
  for (const def of CV_ORDER[cvType]) {
    if (def.text) {
      const text = safe(def.text === "interests" ? settings.interests : settings.languages);
      if (text) sections.push({ key: def.key, heading: def.heading, text });
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
      rows.push({ entryId: e.id, years: yearsOf(e), parts: cvRowParts(e, mode), mode });
    }
    if (trimmedHere) trimmed = true;
    if (rows.length) sections.push({ key: def.key, heading: trimmedHere ? `Selected ${def.heading}` : def.heading, rows });
  }
  const contact = [settings.basedIn, settings.email, settings.phone, settings.website].map(safe).filter((x): x is string => !!x);
  return { cvType, header: { name: safe(settings.displayName) ?? "", discipline: safe(settings.discipline) ?? "", contact }, sections, needsChoice, omitted, trimmed };
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
