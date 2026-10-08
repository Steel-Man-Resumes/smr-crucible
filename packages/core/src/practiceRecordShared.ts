/**
 * The practice record: the pure, client-safe half (no db import).
 *
 * Structured facts about a person's creative work, entered by the person in
 * their own words: shows, performances, residencies, commissions,
 * publications, press, collections, teaching, arts programs (inside programs
 * included), awards, education and works. Each entry carries its own year and
 * venue and a proof mark. These entries ARE the person's source: every line of
 * an artist resume, bio fact or work-sample row must trace back to one.
 *
 * One fact history. A title, venue or year lives here once. A lane chooses
 * what to show (and, for a title that names a facility, HOW: the true title,
 * a venue-only line, or leave it out), never a different version of the fact.
 *
 * Migration 075 holds the same shape in the database (sections, the year
 * range, proof marks, sizes); this module checks the details JSON.
 */

export const PRACTICE_SECTIONS = [
  "exhibition",
  "performance",
  "residency",
  "commission",
  "publication",
  "press",
  "collection",
  "teaching",
  "arts_program",
  "award",
  "education",
  "work",
  // CV record kinds (076)
  "appointment",
  "research",
  "presentation",
  "clinical",
  "license",
  "service",
  "membership",
  "reference",
] as const;
export type PracticeSection = (typeof PRACTICE_SECTIONS)[number];

export const PROOF_MARKS = ["checked", "remembered", "need_to_find"] as const;
export type ProofMark = (typeof PROOF_MARKS)[number];

/** How one lane shows an entry whose title or place names a facility (R03). */
export const TITLE_MODES = ["true_title", "venue_only", "leave_out"] as const;
export type TitleMode = (typeof TITLE_MODES)[number];

export const EXHIBITION_KINDS = ["solo", "two_person", "group"] as const;
export const PERFORMANCE_KINDS = ["performance", "screening", "reading"] as const;
export const PUBLICATION_STATUSES = ["published", "in_press", "accepted", "submitted"] as const;
export const AWARD_KINDS = ["award", "grant", "fellowship"] as const;
export const EDUCATION_STATUSES = ["conferred", "completed", "in_progress"] as const;
export const HOLDER_KINDS = ["public", "private"] as const;
export const PRESENTATION_KINDS = ["talk", "poster", "panel", "workshop"] as const;
/** D4: the person picks what KIND of credential it is. Never inferred. */
export const CREDENTIAL_KINDS = ["license", "certification", "certificate", "card", "training"] as const;
/** Where a credential stands, as held. Never upgraded on the page. */
export const CREDENTIAL_STATUSES = ["active", "inactive", "expired", "in_progress", "eligible"] as const;

export const MAX_PRACTICE_ENTRIES = 300;

/** A license or certificate number: letters with 5+ digits, a long digit run, or "#" / "No." / "number" before digits. */
export const LICENSE_NUMBER_SHAPE = /#\s*[A-Z]{0,4}-?\d|\b(?:no\.?|num\.?|number)\s*:?\s*[A-Z]{0,4}-?\d|\b[A-Z]{1,6}[-\s]?\d{5,}\b|\b\d{5,}\b/i;
export const PRACTICE_WRITES_PER_DAY = 400;

const TITLE_MAX = 300;
const VENUE_MAX = 200;
const CITY_MAX = 100;
const STATE_MAX = 60;
const NOTE_MAX = 300;
const QUOTE_MAX = 1200;

/**
 * Section-specific details. Every field is the person's own words or their
 * own yes/no. Nothing here is ever written by a model.
 */
export interface PracticeDetails {
  /** exhibition: solo | two_person | group. performance: performance | screening | reading. award: award | grant | fellowship. */
  kind?: string;
  /** Only when the person says so (CR-02). */
  juried?: boolean;
  invitational?: boolean;
  curator?: string;
  touring?: boolean;
  /** publication: published | in_press | accepted | submitted. education: conferred | completed | in_progress. */
  status?: string;
  /** publication submitted: when (the person's words, e.g. "March 2026"). */
  submittedWhen?: string;
  /** commission: someone commissioned it and paid. */
  paid?: boolean;
  /** commission client, collection holder: OK to name them. */
  consent?: boolean;
  /** collection: public | private. */
  holder?: string;
  /** teaching: ages or level ("adults", "grades 6 to 8"). */
  level?: string;
  /** teaching: the person was the instructor of record. */
  instructorOfRecord?: boolean;
  /** education: a degree the college conferred (true) or study without a degree (false). */
  degree?: boolean;
  /** education in progress: the year the person expects to finish, in their words. */
  expected?: string;
  /** arts program / performance: the person's role, as they say it. */
  role?: string;
  /** press: the author, the date as printed, and an exact quote from the piece. */
  author?: string;
  date?: string;
  quote?: string;
  /** work: medium, size or length, one line in the person's words, file name. */
  medium?: string;
  dimensions?: string;
  duration?: string;
  description?: string;
  fileName?: string;
  /** publication: the authors as the person lists them ("R. Example and J. Sample"). */
  authors?: string;
  /** presentation: talk | poster | panel | workshop (kind), invited only when the person says so. */
  invited?: boolean;
  /** clinical: hours, the person's own number (never supplied). */
  hours?: string;
  /** license: the KIND the person picked (D4) and its status as held. */
  credentialKind?: string;
  credentialStatus?: string;
  /** reference: how to reach them, as the reference agreed. */
  contact?: string;
  /**
   * Set by the server only, never from a request: earlier titles and venues
   * of an entry that names a facility. A lane that keeps the entry off keeps
   * these off too, so a rename never lets an old name through.
   */
  formerNames?: string[];
}

export interface PracticeEntry {
  id: string;
  user_id: string;
  section: PracticeSection;
  title: string;
  venue: string | null;
  city: string | null;
  state: string | null;
  year: number;
  end_year: number | null;
  details: PracticeDetails;
  proof: ProofMark;
  names_facility: boolean;
  created_at: string;
  updated_at: string;
}

/** The person-facing name of each section, and what its fields mean there. */
export const SECTION_COPY: Record<
  PracticeSection,
  { label: string; title: string; venue: string; example: string; hasRange?: boolean }
> = {
  exhibition: { label: "Exhibition", title: "Show title", venue: "Gallery or venue", example: "Night Shift" },
  performance: { label: "Performance, screening or reading", title: "Name of the show, film or reading", venue: "Venue", example: "Open Mic Series" },
  residency: { label: "Residency", title: "Residency name", venue: "Host organization", example: "Summer Print Residency", hasRange: true },
  commission: { label: "Commission", title: "Name of the work", venue: "Who commissioned it", example: "Corner Store Mural" },
  publication: { label: "Publication (your work)", title: "Title of your piece", venue: "Where it ran (magazine, book, site)", example: "Two Poems" },
  press: { label: "Press about you", title: "Headline", venue: "Outlet", example: "Local Artist Opens Studio" },
  collection: { label: "Collection", title: "Name of the work", venue: "Who holds it", example: "Untitled (Blue)" },
  teaching: { label: "Teaching", title: "Your title, exactly as it was", venue: "Organization", example: "Teaching Artist", hasRange: true },
  arts_program: { label: "Arts program", title: "Program name", venue: "Who ran it (sponsor)", example: "Community Print Workshop", hasRange: true },
  award: { label: "Award, grant or fellowship", title: "Name of the award", venue: "Who gave it", example: "Emerging Artist Grant" },
  education: { label: "Education or training", title: "Degree or study, exactly as on the paper", venue: "School (the one that gave it)", example: "Certificate in Printmaking", hasRange: true },
  work: { label: "A work (for your sample list)", title: "Title of the work", venue: "", example: "Shift Change" },
  appointment: { label: "Job or appointment (for a CV)", title: "Your title, exactly as it was", venue: "Where (school, clinic, employer)", example: "Research Assistant", hasRange: true },
  research: { label: "Research experience", title: "Project or role", venue: "Lab, team or organization", example: "Reentry Housing Study", hasRange: true },
  presentation: { label: "Presentation or talk", title: "Title of the talk or poster", venue: "Conference or event", example: "Learning Behind the Wall" },
  clinical: { label: "Clinical rotation or placement", title: "Your role, exactly as it was", venue: "Site", example: "Nursing Student Rotation", hasRange: true },
  license: { label: "License or certification", title: "Name, exactly as on the card or license", venue: "Who issued it", example: "Certified Peer Recovery Specialist" },
  service: { label: "Service", title: "Your role", venue: "Organization or committee", example: "Student Advisory Board Member", hasRange: true },
  membership: { label: "Membership", title: "Organization", venue: "", example: "State Arts Educators Association", hasRange: true },
  reference: { label: "Reference", title: "Their name", venue: "Where they work", example: "J. Sample" },
};

export function isPracticeSection(v: unknown): v is PracticeSection {
  return typeof v === "string" && (PRACTICE_SECTIONS as readonly string[]).includes(v);
}

export function isProofMark(v: unknown): v is ProofMark {
  return typeof v === "string" && (PROOF_MARKS as readonly string[]).includes(v);
}

export function isTitleMode(v: unknown): v is TitleMode {
  return typeof v === "string" && (TITLE_MODES as readonly string[]).includes(v);
}

/** Trim, drop control characters, collapse spaces, cap. Null when empty. */
export function cleanLine(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const s = v
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max)
    .trim();
  return s ? s : null;
}

/**
 * Words that usually mean a title or place names a prison, jail or other
 * facility. Only a HINT: the person decides (names_facility). Used to pre-tick
 * the box and to ask when it is not ticked.
 */
const FACILITY_RE =
  /\b(prisons?|penitentiar(?:y|ies)|correctional|corrections|jails?|detention|reformator(?:y|ies)|incarcerat\w*|inmates?|lock-?up|work release|halfway house|juvenile hall|state pen|d\.?o\.?c\.?)\b/i;

export function looksLikeFacilityName(...texts: Array<string | null | undefined>): boolean {
  return texts.some((t) => typeof t === "string" && FACILITY_RE.test(t));
}

function oneOf<T extends readonly string[]>(list: T, v: unknown): T[number] | undefined {
  return typeof v === "string" && (list as readonly string[]).includes(v) ? (v as T[number]) : undefined;
}

function bool(v: unknown): boolean | undefined {
  return v === true ? true : v === false ? false : undefined;
}

/** Keep only the details that belong to this section, cleaned. Unknown keys are dropped. */
export function cleanDetails(section: PracticeSection, raw: unknown): PracticeDetails {
  const d = (raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  const out: PracticeDetails = {};
  const put = <K extends keyof PracticeDetails>(k: K, v: PracticeDetails[K] | null | undefined) => {
    if (v !== undefined && v !== null) out[k] = v;
  };
  switch (section) {
    case "exhibition":
      put("kind", oneOf(EXHIBITION_KINDS, d.kind));
      put("juried", bool(d.juried));
      put("invitational", bool(d.invitational));
      put("curator", cleanLine(d.curator, VENUE_MAX));
      break;
    case "performance":
      put("kind", oneOf(PERFORMANCE_KINDS, d.kind));
      put("role", cleanLine(d.role, NOTE_MAX));
      put("touring", bool(d.touring));
      break;
    case "residency":
      break;
    case "commission":
      put("paid", bool(d.paid));
      put("consent", bool(d.consent));
      break;
    case "publication":
      put("status", oneOf(PUBLICATION_STATUSES, d.status));
      put("submittedWhen", cleanLine(d.submittedWhen, 40));
      put("authors", cleanLine(d.authors, NOTE_MAX));
      break;
    case "press":
      put("author", cleanLine(d.author, VENUE_MAX));
      put("date", cleanLine(d.date, 40));
      // A quote keeps its exact characters (spaces inside are the source's).
      if (typeof d.quote === "string" && d.quote.trim()) out.quote = d.quote.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").trim().slice(0, QUOTE_MAX);
      break;
    case "collection":
      put("holder", oneOf(HOLDER_KINDS, d.holder));
      put("consent", bool(d.consent));
      break;
    case "teaching":
      put("level", cleanLine(d.level, NOTE_MAX));
      put("instructorOfRecord", bool(d.instructorOfRecord));
      break;
    case "arts_program":
      put("role", cleanLine(d.role, NOTE_MAX));
      put("status", oneOf(EDUCATION_STATUSES, d.status));
      break;
    case "award":
      put("kind", oneOf(AWARD_KINDS, d.kind));
      break;
    case "education":
      put("degree", bool(d.degree));
      put("status", oneOf(EDUCATION_STATUSES, d.status));
      put("expected", cleanLine(d.expected, 40));
      break;
    case "appointment":
      break;
    case "research":
      put("role", cleanLine(d.role, NOTE_MAX));
      break;
    case "presentation":
      put("kind", oneOf(PRESENTATION_KINDS, d.kind));
      put("invited", bool(d.invited));
      break;
    case "clinical":
      put("hours", cleanLine(d.hours, 20));
      break;
    case "license":
      put("credentialKind", oneOf(CREDENTIAL_KINDS, d.credentialKind));
      put("credentialStatus", oneOf(CREDENTIAL_STATUSES, d.credentialStatus));
      break;
    case "service":
    case "membership":
      break;
    case "reference":
      put("role", cleanLine(d.role, NOTE_MAX));
      put("contact", cleanLine(d.contact, 200));
      put("consent", bool(d.consent));
      break;
    case "work":
      put("medium", cleanLine(d.medium, NOTE_MAX));
      put("dimensions", cleanLine(d.dimensions, 120));
      put("duration", cleanLine(d.duration, 60));
      put("description", cleanLine(d.description, NOTE_MAX));
      put("fileName", cleanLine(d.fileName, 160));
      break;
  }
  return out;
}

export interface PracticeEntryInput {
  section?: unknown;
  title?: unknown;
  venue?: unknown;
  city?: unknown;
  state?: unknown;
  year?: unknown;
  endYear?: unknown;
  details?: unknown;
  proof?: unknown;
  namesFacility?: unknown;
}

/** The cleaned entry, as columns. */
export interface PracticeEntryValue {
  section: PracticeSection;
  title: string;
  venue: string | null;
  city: string | null;
  state: string | null;
  year: number;
  end_year: number | null;
  details: PracticeDetails;
  proof: ProofMark;
  names_facility: boolean;
}

export type PracticeEntryError =
  | "bad_section"
  | "title_required"
  | "year_required"
  | "bad_end_year"
  | "bad_proof"
  | "kind_required"
  | "status_required"
  | "submitted_needs_when"
  | "license_number";

export type PracticeEntryResult = { ok: true; value: PracticeEntryValue } | { ok: false; error: PracticeEntryError };

function yearOf(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && /^\s*\d{4}\s*$/.test(v) ? parseInt(v, 10) : NaN;
  return Number.isInteger(n) && n >= 1900 && n <= 2100 ? n : null;
}

/**
 * Merge an input over the current entry (or nothing, for a new one) and check
 * it. A field sent with a bad value is refused, never guessed. The section of
 * an existing entry never changes.
 */
export function resolvePracticeEntry(input: PracticeEntryInput, current?: PracticeEntryValue | null): PracticeEntryResult {
  const section = current ? current.section : input.section;
  if (!isPracticeSection(section)) return { ok: false, error: "bad_section" };
  const pick = <T>(sent: unknown, clean: (v: unknown) => T, cur: T): T => (sent === undefined ? cur : clean(sent));

  const title = pick(input.title, (v) => cleanLine(v, TITLE_MAX), current?.title ?? null);
  if (!title) return { ok: false, error: "title_required" };
  const year = input.year === undefined && current ? current.year : yearOf(input.year);
  if (year === null) return { ok: false, error: "year_required" };
  let endYear: number | null = current?.end_year ?? null;
  if (input.endYear !== undefined) {
    if (input.endYear === null || input.endYear === "") endYear = null;
    else {
      endYear = yearOf(input.endYear);
      if (endYear === null) return { ok: false, error: "bad_end_year" };
    }
  }
  if (endYear !== null && endYear < year) return { ok: false, error: "bad_end_year" };
  if (endYear !== null && endYear === year) endYear = null;

  let proof: ProofMark = current?.proof ?? "remembered";
  if (input.proof !== undefined) {
    if (!isProofMark(input.proof)) return { ok: false, error: "bad_proof" };
    proof = input.proof;
  }
  const details = input.details === undefined && current ? current.details : cleanDetails(section, input.details);

  // The facts a page needs to say this entry truthfully, asked for up front.
  if ((section === "exhibition" || section === "performance" || section === "presentation") && !details.kind) return { ok: false, error: "kind_required" };
  if (section === "publication" && !details.status) return { ok: false, error: "status_required" };
  if (section === "publication" && details.status === "submitted" && !details.submittedWhen) {
    return { ok: false, error: "submitted_needs_when" };
  }

  const venue = pick(input.venue, (v) => cleanLine(v, VENUE_MAX), current?.venue ?? null);
  // A license or certificate number is never kept with the entry (a public lookup key).
  if (section === "license" && (LICENSE_NUMBER_SHAPE.test(title) || LICENSE_NUMBER_SHAPE.test(venue ?? ""))) {
    return { ok: false, error: "license_number" };
  }
  const namesFacility =
    input.namesFacility === undefined ? current?.names_facility ?? false : input.namesFacility === true;

  // Remember a facility entry's earlier names (server side; cleanDetails drops any sent in).
  const former = Array.isArray(current?.details?.formerNames) ? [...(current!.details.formerNames as string[])] : [];
  if (current && (namesFacility || current.names_facility)) {
    for (const [was, now] of [[current.title, title], [current.venue, venue]] as const) {
      if (was && was !== now && !former.includes(was)) former.push(was);
    }
  }
  if (former.length) (details as PracticeDetails).formerNames = former.slice(-6).map((x) => x.slice(0, TITLE_MAX));

  return {
    ok: true,
    value: {
      section,
      title,
      venue,
      city: pick(input.city, (v) => cleanLine(v, CITY_MAX), current?.city ?? null),
      state: pick(input.state, (v) => cleanLine(v, STATE_MAX), current?.state ?? null),
      year,
      end_year: endYear,
      details,
      proof,
      names_facility: namesFacility,
    },
  };
}

export const PRACTICE_ERROR_COPY: Record<PracticeEntryError | "too_many" | "too_many_writes" | "not_found" | "failed", string> = {
  bad_section: "Pick what kind of entry this is.",
  title_required: "Give it a name: the show, the work, the program.",
  year_required: "What year was it? Four digits, like 2021.",
  bad_end_year: "The end year has to be the same as the start year or later.",
  bad_proof: "Pick checked, remembered, or still finding the proof.",
  kind_required: "What kind was it? A show: solo, two-person or group. A performance: performance, screening or reading. A talk: talk, poster, panel or workshop.",
  status_required: "Is it published, in press, accepted, or submitted?",
  submitted_needs_when: "When did you submit it? A month and year is enough.",
  license_number: "Leave the license or certificate number off. Just the name, who issued it, and where it stands. A reader can ask for the number.",
  too_many: "That's a lot of entries. Remove a few you don't need before adding more.",
  too_many_writes: "That's a lot of changes for one day. Try again tomorrow.",
  not_found: "That entry isn't there anymore. Refresh the page.",
  failed: "That didn't save. Try again.",
};

/** "2019" or "2019-2021" (a plain hyphen, house rule). */
export function yearsOf(e: Pick<PracticeEntry, "year" | "end_year">): string {
  return e.end_year && e.end_year !== e.year ? `${e.year}-${e.end_year}` : String(e.year);
}

/** "City, ST", or one of them, or "". */
export function placeOf(e: Pick<PracticeEntry, "city" | "state">): string {
  return [e.city, e.state].filter((x): x is string => !!x && !!x.trim()).join(", ");
}
